import * as fs from "fs";
import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

/**
 * Frontend Stack: S3 + CloudFront SPA hosting
 *
 * Architecture:
 * - S3 bucket for static assets (private, no public access)
 * - CloudFront distribution for global CDN
 * - Origin Access Identity (OAI) for secure S3 access
 * - SPA routing: 404/403 errors → index.html
 * - Cache policies: HTML (no cache) + assets (1 year)
 * - Custom domain + ACM certificate (optional)
 */
export interface FrontendStackProps extends cdk.StackProps {
  stage: string;
  domainName?: string;
  albDnsName?: string; // ALB DNS name for API URL computation (fallback)
}

export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.IDistribution;
  public readonly bucket: s3.IBucket;
  private readonly certificate?: acm.ICertificate;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // Create certificate for app.* subdomain if domain is provided
    if (props.domainName) {
      const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.domainName
      });

      this.certificate = new acm.Certificate(this, "FrontendCertificate", {
        domainName: `app.${props.domainName}`,
        validation: acm.CertificateValidation.fromDns(hostedZone)
      });
    }

    // Compute API URL for environment variables
    const apiUrl = props.domainName
      ? `https://api.${props.domainName}`
      : props.albDnsName
        ? `http://${props.albDnsName}`
        : "";

    // 1. Create S3 bucket for static website hosting
    // Note: We don't use websiteIndexDocument/websiteErrorDocument because CloudFront handles SPA routing via CustomErrorResponses
    this.bucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `remorai-frontend-${props.stage}`,
      publicReadAccess: false, // CloudFront will access via OAI
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy:
        props.stage === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.stage !== "production",
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          maxAge: 3000
        }
      ]
    });

    // 2. Create Origin Access Identity for CloudFront
    // Note: Frontend is deployed manually to S3 + CloudFront
    // CDK code serves as infrastructure-as-code reference (automated deployment blocked by AWS policy)
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "FrontendOAI",
      {
        comment: `OAI for ${props.stage} frontend`
      }
    );

    // Grant CloudFront read access to the bucket
    this.bucket.grantRead(originAccessIdentity);

    // 3. Create CloudFront distribution with optimized cache policies
    const logBucket = new s3.Bucket(this, "FrontendLogBucket", {
      bucketName: `remorai-frontend-logs-${props.stage}`,
      removalPolicy:
        props.stage === "production"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.stage !== "production",
      // CloudFront logging requires ACLs
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: true
      }),
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30) // Keep logs for 30 days
        }
      ]
    });

    // Custom cache policies for SPA optimization:
    // - HTML (index.html, *.html): No caching for fresh routing
    // - Assets (*.js, *.css, *.png, etc): Long-lived cache (1 year) with fingerprinting
    const htmlCachePolicy = new cloudfront.CachePolicy(
      this,
      "HtmlCachePolicy",
      {
        comment: "Policy for HTML files - no caching for SPA routing",
        defaultTtl: cdk.Duration.seconds(0), // No caching
        maxTtl: cdk.Duration.seconds(1), // Revalidate immediately
        minTtl: cdk.Duration.seconds(0),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true
      }
    );

    const assetsCachePolicy = new cloudfront.CachePolicy(
      this,
      "AssetsCachePolicy",
      {
        comment: "Policy for versioned assets - aggressive caching (1 year)",
        defaultTtl: cdk.Duration.days(365),
        maxTtl: cdk.Duration.days(365),
        minTtl: cdk.Duration.seconds(0),
        cookieBehavior: cloudfront.CacheCookieBehavior.none(),
        headerBehavior: cloudfront.CacheHeaderBehavior.none(),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true
      }
    );

    const distributionConfig: cloudfront.DistributionProps = {
      defaultBehavior: {
        origin: new origins.S3Origin(this.bucket, {
          originAccessIdentity
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
        // Default behavior for index.html
        cachePolicy: htmlCachePolicy
      },
      // Override cache policy for versioned assets
      additionalBehaviors: {
        // Versioned JavaScript and CSS (e.g., main.abc123.js)
        "*.js": {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: assetsCachePolicy
        },
        "*.css": {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          compress: true,
          cachePolicy: assetsCachePolicy
        },
        // Images and other assets
        "*.png": {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          compress: true,
          cachePolicy: assetsCachePolicy
        },
        "*.jpg": {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          compress: true,
          cachePolicy: assetsCachePolicy
        },
        "*.svg": {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          compress: true,
          cachePolicy: assetsCachePolicy
        },
        "*.woff2": {
          origin: new origins.S3Origin(this.bucket, {
            originAccessIdentity
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
          compress: false, // Fonts already compressed
          cachePolicy: assetsCachePolicy
        }
      },
      defaultRootObject: "index.html",
      enableLogging: true,
      logBucket: logBucket,
      logFilePrefix: "frontend-access-logs/",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      domainNames:
        props.domainName && this.certificate
          ? [`app.${props.domainName}`]
          : undefined,
      certificate:
        props.domainName && this.certificate ? this.certificate : undefined
    };

    this.distribution = new cloudfront.Distribution(
      this,
      "FrontendDistribution",
      distributionConfig
    );

    // Configure error responses for SPA routing (404/403 → index.html)
    // Note: ErrorCachingMinTtl is not supported by CloudFormation
    const cfnDistribution = this.distribution.node
      .defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.CustomErrorResponses",
      [
        {
          ErrorCode: 404,
          ResponseCode: 200,
          ResponsePagePath: "/index.html"
        },
        {
          ErrorCode: 403,
          ResponseCode: 200,
          ResponsePagePath: "/index.html"
        }
      ]
    );

    // 4. Deploy frontend build to S3 with BucketDeployment
    // CI/CD pipeline builds and deploys assets. CDK ensures infrastructure exists.
    // Note: BucketDeployment is only active when dist folder exists
    const frontendDistPath = path.join(__dirname, "../../apps/frontend/dist");
    const distExists = fs.existsSync(frontendDistPath);

    if (distExists) {
      // Use BucketDeployment for assets that built in the pipeline
      new s3deploy.BucketDeployment(this, "FrontendDeployment", {
        sources: [s3deploy.Source.asset(frontendDistPath)],
        destinationBucket: this.bucket,
        distribution: this.distribution,
        // Invalidate all paths except versioned assets for faster cache invalidation
        distributionPaths: ["/index.html", "/*.html"],
        prune: true, // Remove old files when deploying new version
        retainOnDelete: props.stage === "production" // Keep files on stack deletion in prod
      });

      new cdk.CfnOutput(this, "FrontendAssetsDeployed", {
        value: "true",
        description: "Frontend assets deployed to S3 via CDK BucketDeployment"
      });
    } else {
      // Production deployments must use CI/CD pipeline
      // Dev/test can optionally deploy manually
      if (props.stage !== "production") {
        new cdk.CfnOutput(this, "FrontendAssetsDeployed", {
          value: "false",
          description:
            "Frontend assets NOT deployed. Build the frontend first: pnpm build --filter @apps/frontend"
        });
      } else {
        new cdk.CfnOutput(this, "FrontendAssetsDeployed", {
          value: "false",
          description:
            "Production deployment: Frontend assets deployed via CI/CD pipeline (aws s3 sync)"
        });
      }
    }

    // 5. Create Route53 records if domain is provided
    if (props.domainName && this.certificate) {
      const hostedZone = route53.HostedZone.fromLookup(
        this,
        "HostedZoneForRecords",
        {
          domainName: props.domainName
        }
      );

      new route53.ARecord(this, "FrontendARecord", {
        zone: hostedZone,
        recordName: `app.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        )
      });

      // Also create AAAA record for IPv6
      new route53.AaaaRecord(this, "FrontendAaaaRecord", {
        zone: hostedZone,
        recordName: `app.${props.domainName}`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        )
      });
    }

    // 6. Outputs
    const frontendUrl = props.domainName
      ? `https://app.${props.domainName}`
      : `https://${this.distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "FrontendUrl", {
      value: frontendUrl,
      description: "Frontend Application URL"
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: this.bucket.bucketName,
      description: "S3 Bucket Name for Frontend Assets"
    });

    new cdk.CfnOutput(this, "FrontendDistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront Distribution ID"
    });

    new cdk.CfnOutput(this, "FrontendDistributionDomainName", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront Distribution Domain Name"
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: apiUrl,
      description: "Backend API URL (passed to frontend build)"
    });
  }
}
