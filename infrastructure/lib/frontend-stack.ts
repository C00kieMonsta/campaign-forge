import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import * as fs from "fs";
import { Construct } from "constructs";

interface FrontendStackProps extends cdk.StackProps {
  stage: string;
  domainName?: string;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const adminBucket = this.createSite("Admin", `cf-admin-${props.stage}`, "apps/frontend/dist");
    const landingBucket = this.createSite("Landing", `cf-landing-${props.stage}`, "apps/landing/dist");

    new cdk.CfnOutput(this, "AdminUrl", {
      value: `https://${adminBucket.distribution.distributionDomainName}`,
    });
    new cdk.CfnOutput(this, "LandingUrl", {
      value: `https://${landingBucket.distribution.distributionDomainName}`,
    });
  }

  private createSite(name: string, bucketName: string, distPath: string) {
    const bucket = new s3.Bucket(this, `${name}Bucket`, {
      bucketName,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, `${name}CDN`, {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) },
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: cdk.Duration.seconds(0) },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    const absPath = path.resolve(__dirname, "../../", distPath);
    if (fs.existsSync(absPath)) {
      new s3deploy.BucketDeployment(this, `${name}Deploy`, {
        sources: [s3deploy.Source.asset(absPath)],
        destinationBucket: bucket,
        distribution,
        distributionPaths: ["/*"],
      });
    }

    return { bucket, distribution };
  }
}
