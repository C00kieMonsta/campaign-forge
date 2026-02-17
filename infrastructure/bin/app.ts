#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { BackendStack } from "../lib/backend-stack";
import { FrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

// Get configuration from environment
const stage = process.env.STAGE || app.node.tryGetContext("stage") || "dev";
const rootDomain =
  process.env.ROOT_DOMAIN || app.node.tryGetContext("rootDomain");
const backendImageUri =
  process.env.BACKEND_IMAGE_URI || app.node.tryGetContext("backendImageUri");

// AWS environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region:
    process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "eu-north-1"
};

// Get deployment target
const deployTarget =
  process.env.DEPLOY_TARGET || app.node.tryGetContext("deploy") || "all";

// Log the configuration
console.log(`Deploying infrastructure for domain: ${rootDomain || "not set"}

Using pre-built backend image: ${backendImageUri || "will build from source"}

Configuration:

  - Stage: ${stage}

  - Deploy Target: ${deployTarget}

  - Root Domain: ${rootDomain || "not set"}

  - Backend Image URI: ${backendImageUri || "will build from source"}

  - Environment: ${JSON.stringify(env)}`);

// 1. Deploy Backend Stack (fully self-contained)
let backendStack: BackendStack | undefined;
if (deployTarget === "backend" || deployTarget === "all") {
  backendStack = new BackendStack(app, `Remorai-Backend-${stage}`, {
    stage,
    domainName: rootDomain,
    backendImageUri,
    env,
    tags: {
      Environment: stage,
      Project: "Remorai",
      Component: "Backend"
    }
  });
}

// 2. Deploy Frontend Stack (completely independent)
let frontendStack: FrontendStack | undefined;
if (deployTarget === "frontend" || deployTarget === "all") {
  frontendStack = new FrontendStack(app, `Remorai-Frontend-${stage}`, {
    stage,
    domainName: rootDomain,
    albDnsName: backendStack?.alb.loadBalancerDnsName,
    env,
    tags: {
      Environment: stage,
      Project: "Remorai",
      Component: "Frontend"
    }
  });
}

app.synth();
