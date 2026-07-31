import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

interface LexDataStackProps extends cdk.StackProps {
  stage: string;
  /** The EXISTING VPC the campaign-forge backend EC2 runs in (looked up, not created). */
  vpcId: string;
  /** The campaign-forge backend EC2's security group — the only source allowed on 5432. */
  backendSecurityGroupId: string;
  /**
   * Origins allowed to PUT directly to the documents bucket (the admin app). Must list every
   * origin the admin UI is served from, including the local dev server, or the browser's
   * preflight for a presigned upload fails.
   */
  allowedUploadOrigins: string[];
}

/**
 * The ONLY CloudFormation-managed part of campaign-forge: the new Lex data plane —
 * a single small RDS PostgreSQL (pgvector), a dedicated versioned+encrypted S3 bucket for
 * legal documents, and the OpenAI API key + DB credentials in Secrets Manager.
 *
 * Standalone by design: the Campaigns infra (DynamoDB tables, the EC2, its VPC) was created
 * by hand (see ./scripts), NOT by CDK — so this stack LOOKS UP the existing default VPC and
 * references the backend EC2's security group rather than depending on a CDK BackendStack.
 * RDS lives in that same VPC so the EC2 can reach it, but is not publicly accessible.
 */
export class LexDataStack extends cdk.Stack {
  readonly database: rds.DatabaseInstance;
  readonly documentsBucket: s3.Bucket;
  readonly openAiSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: LexDataStackProps) {
    super(scope, id, props);

    const isProd = props.stage === "prod";

    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId });
    const backendSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "BackendSg",
      props.backendSecurityGroupId
    );

    // ── Legal documents bucket (dedicated; NEVER the campaign attachments bucket) ──────
    this.documentsBucket = new s3.Bucket(this, "LexDocumentsBucket", {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: isProd
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      // Documents are uploaded by the browser straight to S3 with a presigned PUT, so the
      // bytes bypass nginx and the EC2 box entirely. That cross-origin PUT needs CORS.
      // ETag is exposed so the client can confirm what S3 stored.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: props.allowedUploadOrigins,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag", "x-amz-version-id"],
          maxAge: 3000
        }
      ]
      // Object Lock (WORM retention) for court-file immutability is a deliberate later
      // decision — it must be enabled at creation and makes objects undeletable, so it is
      // left off until the retention policy is agreed.
    });

    // ── OpenAI API key (value set out-of-band after creation) ──────────────────────────
    this.openAiSecret = new secretsmanager.Secret(this, "LexOpenAiApiKey", {
      secretName: `cf-lex-${props.stage}/openai-api-key`,
      description:
        "OpenAI API key for Lex — set the real value manually after creation"
    });

    // ── RDS PostgreSQL 16 + pgvector ───────────────────────────────────────────────────
    const dbSg = new ec2.SecurityGroup(this, "LexDbSG", {
      vpc,
      allowAllOutbound: true,
      description: "Lex RDS PostgreSQL"
    });
    dbSg.addIngressRule(
      backendSg,
      ec2.Port.tcp(5432),
      "Postgres from campaign-forge backend EC2"
    );

    this.database = new rds.DatabaseInstance(this, "LexPostgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16
      }),
      // db.t4g.micro — cheapest Graviton burstable; adequate for a low-traffic legal tool.
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO
      ),
      vpc,
      // The default VPC's subnets are public; keep RDS NOT publicly accessible so it is only
      // reachable in-VPC from the backend SG.
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publiclyAccessible: false,
      securityGroups: [dbSg],
      databaseName: "lex",
      credentials: rds.Credentials.fromGeneratedSecret("lexadmin", {
        secretName: `cf-lex-${props.stage}/db-credentials`
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: cdk.Duration.days(isProd ? 7 : 1),
      deletionProtection: isProd,
      removalPolicy: isProd
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.SNAPSHOT
      // pgvector ships with RDS PG16; the `vector` extension (+ halfvec/HNSW) is created
      // by the first node-pg-migrate migration. No parameter-group preload is required.
    });

    // ── Runtime access policy ──────────────────────────────────────────────────────────
    // The app authenticates as a static IAM USER (from SSM), not an EC2 role, so we emit a
    // standalone managed policy the operator attaches to that user (or the instance role).
    const runtimeAccessPolicy = new iam.ManagedPolicy(
      this,
      "LexRuntimeAccessPolicy",
      {
        managedPolicyName: `cf-lex-${props.stage}-runtime-access`,
        description: "Read Lex secrets + read/write the Lex documents bucket",
        statements: [
          new iam.PolicyStatement({
            actions: ["secretsmanager:GetSecretValue"],
            resources: [
              this.openAiSecret.secretArn,
              this.database.secret!.secretArn
            ]
          }),
          new iam.PolicyStatement({
            actions: [
              "s3:GetObject",
              "s3:GetObjectVersion",
              "s3:PutObject",
              "s3:DeleteObject",
              "s3:ListBucket"
            ],
            resources: [
              this.documentsBucket.bucketArn,
              this.documentsBucket.arnForObjects("*")
            ]
          })
        ]
      }
    );

    // ── Outputs (copy into SSM / .env: DATABASE_URL, OPENAI_API_KEY_SECRET_ARN, LEX_DOCUMENTS_BUCKET) ──
    new cdk.CfnOutput(this, "LexDbEndpoint", {
      value: this.database.dbInstanceEndpointAddress,
      description:
        "Lex Postgres host (build DATABASE_URL from this + the db-credentials secret)"
    });
    new cdk.CfnOutput(this, "LexDbCredentialsSecretArn", {
      value: this.database.secret?.secretArn ?? "n/a",
      description: "Secrets Manager ARN holding the Lex DB username/password"
    });
    new cdk.CfnOutput(this, "LexOpenAiSecretArn", {
      value: this.openAiSecret.secretArn,
      description: "Store this as SSM/​env OPENAI_API_KEY_SECRET_ARN"
    });
    new cdk.CfnOutput(this, "LexDocumentsBucketName", {
      value: this.documentsBucket.bucketName,
      description: "Store this as SSM/env LEX_DOCUMENTS_BUCKET"
    });
    new cdk.CfnOutput(this, "LexRuntimeAccessPolicyArn", {
      value: runtimeAccessPolicy.managedPolicyArn,
      description:
        "Attach this policy to the runtime IAM user (behind SSM AWS_ACCESS_KEY_ID)"
    });
  }
}
