#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { LexDataStack } from "../lib/lex-data-stack";

// ─────────────────────────────────────────────────────────────────────────────────────────
// campaign-forge's Campaigns infra (DynamoDB cf-*-prod tables, the campaign-forge-backend
// EC2 in the default VPC, and the S3 buckets) was created BY HAND / via ./scripts — NOT by
// CloudFormation. The DataStack / BackendStack / FrontendStack classes in lib/ therefore do
// NOT reflect the live account and are intentionally NOT instantiated here: deploying them
// would collide with (or duplicate) the hand-managed resources.
//
// The NEW Lex data plane is the only CloudFormation-managed part of this project.
// ─────────────────────────────────────────────────────────────────────────────────────────

const app = new cdk.App();

const stage = process.env.STAGE || app.node.tryGetContext("stage") || "prod";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region:
    process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "eu-north-1"
};

// The existing default VPC + the campaign-forge-backend EC2's security group (production
// account 637224115651). Override with `-c lexVpcId=... -c backendSgId=...` for other envs.
const vpcId = app.node.tryGetContext("lexVpcId") || "vpc-09f1e74b932f52bf8";
const backendSecurityGroupId =
  app.node.tryGetContext("backendSgId") || "sg-03cea12cd5eea54d0";

// Origins allowed to upload documents straight to S3 (presigned PUT). The admin app is served
// from admin.moniquepirson.be (see scripts/setup-route53.sh) and matches the backend's own CORS
// allow-list in main.ts; localhost is the Vite dev server. Override with
// `-c uploadOrigins=https://a,https://b`.
const allowedUploadOrigins = (
  app.node.tryGetContext("uploadOrigins") ||
  "https://admin.moniquepirson.be,http://localhost:5173,http://localhost:3000"
)
  .split(",")
  .map((origin: string) => origin.trim())
  .filter(Boolean);

new LexDataStack(app, `CF-LexData-${stage}`, {
  env,
  stage,
  vpcId,
  backendSecurityGroupId,
  allowedUploadOrigins
});

app.synth();
