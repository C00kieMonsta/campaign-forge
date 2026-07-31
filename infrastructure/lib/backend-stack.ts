import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface BackendStackProps extends cdk.StackProps {
  stage: string;
  contactsTable: dynamodb.Table;
  campaignsTable: dynamodb.Table;
  domainName?: string;
  sesFromEmail?: string;
}

export class BackendStack extends cdk.Stack {
  readonly instance: ec2.Instance;
  // Exposed so LexDataStack can place RDS in the same VPC, open 5432 from this SG, and
  // grant the EC2 role access to the docs bucket + secrets. This is one-directional
  // (LexData depends on Backend), so there is NO cross-stack cycle — and the VPC stays
  // owned by this stack, avoiding the destructive VPC/EC2 replacement that extracting a
  // separate NetworkStack would cause.
  readonly vpc: ec2.Vpc;
  readonly securityGroup: ec2.SecurityGroup;
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // maxAzs: 2 is required so LexDataStack can build an RDS DB subnet group (RDS mandates
    // subnets in >=2 AZs, even for a single-AZ instance). This only ADDS a second public
    // subnet; the existing subnet/VPC/EC2 logical IDs are unchanged. VERIFY with `cdk diff`
    // before deploying to prod that neither the VPC nor the EC2 is replaced.
    const vpc = new ec2.Vpc(this, "BackendVPC", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { subnetType: ec2.SubnetType.PUBLIC, name: "Public", cidrMask: 24 }
      ]
    });

    // Keeps document/DB traffic (and S3 API calls) on the AWS backbone rather than the
    // public IP path — no NAT needed, and cheaper.
    vpc.addGatewayEndpoint("S3GatewayEndpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3
    });

    const sg = new ec2.SecurityGroup(this, "BackendSG", {
      vpc,
      allowAllOutbound: true,
      description: "Campaign Forge backend"
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), "SSH");
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP");
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS");
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3001), "NestJS API");

    const role = new iam.Role(this, "BackendRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        )
      ]
    });

    props.contactsTable.grantReadWriteData(role);
    props.campaignsTable.grantReadWriteData(role);

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"]
      })
    );

    const keyPairName = process.env.EC2_KEY_PAIR || `cf-${props.stage}`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "yum update -y",
      "curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -",
      "yum install -y nodejs git",
      "npm install -g pnpm@10",
      "mkdir -p /opt/campaign-forge",
      `cat > /opt/campaign-forge/.env << 'ENVEOF'`,
      `PORT=3001`,
      `AWS_REGION=${this.region}`,
      `CONTACTS_TABLE=${props.contactsTable.tableName}`,
      `CAMPAIGNS_TABLE=${props.campaignsTable.tableName}`,
      `SES_FROM_EMAIL=${props.sesFromEmail || "noreply@example.com"}`,
      `SES_REGION=${this.region}`,
      `UNSUBSCRIBE_SECRET=${props.stage}-change-me-to-a-real-secret-32chars`,
      `PUBLIC_BASE_URL=http://localhost:3001/api`,
      `ENVEOF`
    );

    this.instance = new ec2.Instance(this, "BackendInstance", {
      vpc,
      // Bumped t2.micro -> t3.small: PDF parsing + embedding batches + a pg pool need more
      // than 1 vCPU / 1 GB. NOTE: an instance-class change REPLACES the EC2 — confirm the
      // new public IP is re-associated (EIP/DNS) before cutting over.
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.SMALL
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: sg,
      role,
      userData,
      keyPair: ec2.KeyPair.fromKeyPairName(this, "KeyPair", keyPairName),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: true
    });

    this.vpc = vpc;
    this.securityGroup = sg;
    this.role = role;

    new cdk.CfnOutput(this, "InstancePublicIp", {
      value: this.instance.instancePublicIp,
      description: "Backend EC2 public IP"
    });

    new cdk.CfnOutput(this, "InstanceId", {
      value: this.instance.instanceId,
      description: "Backend EC2 instance ID (for SSM)"
    });

    new cdk.CfnOutput(this, "SSHCommand", {
      value: `ssh -i ${keyPairName}.pem ec2-user@\${${this.instance.instancePublicIp}}`,
      description: "SSH into the instance"
    });
  }
}
