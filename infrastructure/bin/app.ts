#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../lib/data-stack";
import { BackendStack } from "../lib/backend-stack";
import { FrontendStack } from "../lib/frontend-stack";

const app = new cdk.App();

const stage = process.env.STAGE || app.node.tryGetContext("stage") || "dev";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "eu-west-1",
};
const domainName = process.env.ROOT_DOMAIN || app.node.tryGetContext("domainName");
const sesFromEmail = process.env.SES_FROM_EMAIL || app.node.tryGetContext("sesFromEmail");

console.log(`Campaign Forge — stage: ${stage}, region: ${env.region}`);

const data = new DataStack(app, `CF-Data-${stage}`, { env, stage });

new BackendStack(app, `CF-Backend-${stage}`, {
  env,
  stage,
  contactsTable: data.contactsTable,
  campaignsTable: data.campaignsTable,
  domainName,
  sesFromEmail,
});

new FrontendStack(app, `CF-Frontend-${stage}`, {
  env,
  stage,
  domainName,
});

app.synth();
