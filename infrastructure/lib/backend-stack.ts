import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface BackendStackProps extends cdk.StackProps {
  stage: string;
  domainName?: string;
  backendImageUri?: string;
}

export class BackendStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly vpc: ec2.Vpc;
  private readonly certificate?: acm.ICertificate;
  private readonly httpsListener?: elbv2.ApplicationListener;
  private readonly hostedZone?: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    // 1. Create VPC (2 AZs for ALB requirement)
    this.vpc = new ec2.Vpc(this, "BackendVPC", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: "Public",
          cidrMask: 24
        }
      ]
    });

    // Add S3 Gateway endpoint
    this.vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3
    });

    // 2. Reference existing S3 buckets (already created in previous stack)
    // These buckets were retained from the previous deployment and contain data
    const organizationAssetsBucket = s3.Bucket.fromBucketName(
      this,
      "OrganizationAssetsBucket",
      `remorai-org-assets-${props.stage}`
    );

    const fileProcessingBucket = s3.Bucket.fromBucketName(
      this,
      "FileProcessingBucket",
      `remorai-file-processing-${props.stage}`
    );

    // 3. Create ECS Cluster
    const cluster = new ecs.Cluster(this, "BackendCluster", {
      vpc: this.vpc,
      enableFargateCapacityProviders: true
    });

    // 4. Create Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, "BackendALB", {
      vpc: this.vpc,
      internetFacing: true
    });

    this.alb.setAttribute("idle_timeout.timeout_seconds", "300");

    // HTTP Listener
    const httpListener = this.alb.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not Found"
      })
    });

    // 5. Create certificate for api.* subdomain if domain is provided
    if (props.domainName) {
      this.hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.domainName
      });

      this.certificate = new acm.Certificate(this, "BackendCertificate", {
        domainName: `api.${props.domainName}`,
        validation: acm.CertificateValidation.fromDns(this.hostedZone)
      });

      // Create HTTPS listener on ALB for backend
      this.httpsListener = this.alb.addListener("BackendHttpsListener", {
        port: 443,
        certificates: [this.certificate],
        protocol: elbv2.ApplicationProtocol.HTTPS,
        defaultAction: elbv2.ListenerAction.fixedResponse(404, {
          contentType: "text/plain",
          messageBody: "Not Found"
        })
      });

      // Create Route53 A record for api.* subdomain
      new route53.ARecord(this, "BackendARecord", {
        zone: this.hostedZone,
        recordName: `api.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(this.alb)
        )
      });

      // Create AAAA record for IPv6
      new route53.AaaaRecord(this, "BackendAaaaRecord", {
        zone: this.hostedZone,
        recordName: `api.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(this.alb)
        )
      });
    }

    // 6. Create log group
    const logGroup = new logs.LogGroup(this, "BackendLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create execution role for ECR access
    const executionRole = new cdk.aws_iam.Role(this, "BackendExecutionRole", {
      assumedBy: new cdk.aws_iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        )
      ]
    });

    // 7. Create Fargate Task Definition
    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "BackendTaskDef",
      {
        memoryLimitMiB: 1024, // Reduced to 1GB for cost optimization
        cpu: 512, // Reduced to 0.5 vCPU for cost optimization
        executionRole,
        // Cost optimization: Use ARM64 architecture (Graviton) which is ~20% cheaper
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
        }
      }
    );

    // Add container to task definition
    const container = this.taskDefinition.addContainer("backend", {
      image: (() => {
        // Use pre-built ECR image if provided, otherwise build from source
        if (props.backendImageUri) {
          return ecs.ContainerImage.fromRegistry(props.backendImageUri);
        }

        // Fallback: Build from source (for local development)
        let rootPath: string;

        // First try relative to current working directory (infrastructure folder)
        const cwdPath = path.resolve(process.cwd());
        if (fs.existsSync(path.join(cwdPath, "apps/backend/Dockerfile"))) {
          rootPath = cwdPath;
        } else {
          // Fallback to relative to __dirname (going up two levels from infrastructure/lib)
          rootPath = path.resolve(__dirname, "../..");
        }

        return ecs.ContainerImage.fromAsset(rootPath, {
          file: "apps/backend/Dockerfile",
          platform: Platform.LINUX_ARM64 // Cost optimization: Build for ARM64
        });
      })(),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "BackendService",
        logGroup
      }),
      environment: {
        NODE_ENV: "production",
        PORT: "80",
        STAGE: props.stage,

        // Frontend URL for CORS configuration
        FRONTEND_URL: props.domainName
          ? `https://app.${props.domainName}`
          : process.env.FRONTEND_URL || "",

        // S3 Bucket configuration
        AWS_ORGANIZATION_ASSETS_BUCKET: organizationAssetsBucket.bucketName,
        AWS_FILE_PROCESSING_BUCKET: fileProcessingBucket.bucketName,

        // Supabase configuration (from CDK deploy environment)
        ...(process.env.SUPABASE_URL
          ? { SUPABASE_URL: process.env.SUPABASE_URL }
          : {}),
        ...(process.env.SUPABASE_JWT_SECRET
          ? { SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET }
          : {}),
        ...(process.env.SUPABASE_ANON_KEY
          ? { SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY }
          : {}),
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY
          ? { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
          : {}),

        // Database configuration (from CDK deploy environment)
        ...(process.env.DATABASE_URL
          ? { DATABASE_URL: process.env.DATABASE_URL }
          : {}),
        ...(process.env.DIRECT_DATABASE_URL
          ? { DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL }
          : {}),
        ...(process.env.DATABASE_URL_DIRECT
          ? { DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT }
          : {}),

        // AI Service API Keys (from CDK deploy environment)
        ...(process.env.GEMINI_API_KEY
          ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY }
          : {}),
        ...(process.env.OPENAI_API_KEY
          ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
          : {}),
        ...(process.env.ANTHROPIC_API_KEY
          ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
          : {}),
        ...(process.env.MISTRAL_API_KEY
          ? { MISTRAL_API_KEY: process.env.MISTRAL_API_KEY }
          : {}),

        // Environment variables from .env file (fallback for local development)
        ...(() => {
          try {
            const envPath = path.resolve(__dirname, "../../apps/backend/.env");
            if (fs.existsSync(envPath)) {
              const envContent = fs.readFileSync(envPath, "utf8");
              const envVars: Record<string, string> = {};

              envContent.split("\n").forEach((line) => {
                const trimmed = line.trim();
                if (
                  trimmed &&
                  !trimmed.startsWith("#") &&
                  trimmed.includes("=")
                ) {
                  const [key, ...valueParts] = trimmed.split("=");
                  const value = valueParts.join("=");
                  // Only use .env values if not already set from process.env
                  if (!process.env[key]) {
                    envVars[key] = value;
                  }
                }
              });
              return envVars;
            } else {
              return {};
            }
          } catch (error) {
            return {};
          }
        })()
      }
    });

    // Add port mapping
    container.addPortMappings({
      containerPort: 80,
      protocol: ecs.Protocol.TCP
    });

    // 8. Create Fargate Service
    this.service = new ecs.FargateService(this, "BackendApiService", {
      cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      enableExecuteCommand: true,
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      healthCheckGracePeriod: cdk.Duration.seconds(30),
      // Use regular Fargate for reliability (Spot capacity often unavailable in eu-north-1)
      capacityProviderStrategies: [
        {
          capacityProvider: "FARGATE",
          weight: 1,
          base: 1
        }
      ]
    });

    // 9. Create Target Group
    this.targetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "BackendTargetGroup",
      {
        vpc: this.vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [this.service],
        healthCheck: {
          path: "/api/health",
          interval: cdk.Duration.seconds(10),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
          healthyHttpCodes: "200"
        },
        deregistrationDelay: cdk.Duration.seconds(5),
        stickinessCookieDuration: cdk.Duration.minutes(5),
        stickinessCookieName: "MATERIAL_EXTRACTOR_SESSION"
      }
    );

    // 10. Add listener rules to route traffic
    if (props.domainName && this.httpsListener) {
      // Route API subdomain traffic via HTTPS
      new elbv2.ApplicationListenerRule(this, "BackendHttpsListenerRule", {
        listener: this.httpsListener,
        priority: 100,
        conditions: [
          elbv2.ListenerCondition.hostHeaders([`api.${props.domainName}`])
        ],
        action: elbv2.ListenerAction.forward([this.targetGroup])
      });
    }

    // For development, route based on path via HTTP
    new elbv2.ApplicationListenerRule(this, "BackendHttpListenerRule", {
      listener: httpListener,
      priority: 200,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/*"])],
      action: elbv2.ListenerAction.forward([this.targetGroup])
    });

    // Grant S3 permissions to ECS task role for existing buckets
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        resources: [
          `arn:aws:s3:::${organizationAssetsBucket.bucketName}`,
          `arn:aws:s3:::${organizationAssetsBucket.bucketName}/*`,
          `arn:aws:s3:::${fileProcessingBucket.bucketName}`,
          `arn:aws:s3:::${fileProcessingBucket.bucketName}/*`
        ]
      })
    );

    // Grant SES permissions to ECS task role for sending emails
    this.taskDefinition.taskRole.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ],
        resources: [
          `arn:aws:ses:${this.region}:${cdk.Stack.of(this).account}:identity/remorai.solutions`,
          `arn:aws:ses:${this.region}:${cdk.Stack.of(this).account}:identity/support@remorai.solutions`
        ]
      })
    );

    // 11. Auto Scaling
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1, // Reduced to 1 for cost optimization
      maxCapacity: 5 // Reduced to 5 for cost optimization
    });

    // CPU-based scaling
    scaling.scaleOnCpuUtilization("BackendCpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(10),
      scaleOutCooldown: cdk.Duration.minutes(5)
    });

    // Memory-based scaling
    scaling.scaleOnMemoryUtilization("BackendMemoryScaling", {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.minutes(10),
      scaleOutCooldown: cdk.Duration.minutes(5)
    });

    // 12. CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, "BackendDashboard", {
      dashboardName: `Remorai-Backend-${props.stage}`
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "ECS Service Metrics",
        left: [
          this.service.metricCpuUtilization(),
          this.service.metricMemoryUtilization()
        ],
        width: 12,
        height: 6
      }),

      new cloudwatch.GraphWidget({
        title: "Target Group Health",
        left: [
          this.targetGroup.metrics.healthyHostCount(),
          this.targetGroup.metrics.unhealthyHostCount()
        ],
        width: 12,
        height: 6
      }),

      new cloudwatch.GraphWidget({
        title: "Request Count & Latency",
        left: [this.targetGroup.metrics.requestCount()],
        right: [this.targetGroup.metrics.targetResponseTime()],
        width: 12,
        height: 6
      })
    );

    // 13. CloudWatch Alarms
    new cloudwatch.Alarm(this, "HighCpuAlarm", {
      metric: this.service.metricCpuUtilization(),
      threshold: 80,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Backend CPU usage is too high"
    });

    new cloudwatch.Alarm(this, "HighMemoryAlarm", {
      metric: this.service.metricMemoryUtilization(),
      threshold: 85,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Backend memory usage is too high"
    });

    new cloudwatch.Alarm(this, "HighResponseTimeAlarm", {
      metric: this.targetGroup.metrics.targetResponseTime(),
      threshold: 1000, // 1 second
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "API response time is too high"
    });

    // Outputs
    const serviceUrl =
      props.domainName && this.certificate
        ? `https://api.${props.domainName}`
        : `http://${this.alb.loadBalancerDnsName}`;

    new cdk.CfnOutput(this, "BackendServiceUrl", {
      value: serviceUrl,
      description: "Backend API Service URL"
    });

    if (this.certificate) {
      new cdk.CfnOutput(this, "BackendCertificateArn", {
        value: this.certificate.certificateArn,
        description: "Backend Certificate ARN"
      });
    }

    new cdk.CfnOutput(this, "BackendDashboardUrl", {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: "CloudWatch Dashboard URL"
    });

    new cdk.CfnOutput(this, "BackendServiceName", {
      value: this.service.serviceName,
      description: "Backend ECS Service Name"
    });

    new cdk.CfnOutput(this, "BackendALBDnsName", {
      value: this.alb.loadBalancerDnsName,
      description: "Backend ALB DNS Name"
    });
  }
}
