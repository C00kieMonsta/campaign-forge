# AWS CDK Infrastructure for Remorai

## Overview

This directory contains Infrastructure as Code (IaC) for Remorai using AWS CDK. The infrastructure is organized into independent stacks for frontend and backend, allowing flexible deployment options.

## Project Structure

```
infrastructure/
├── bin/
│   └── app.ts              # CDK app entry point, stack configuration
├── lib/
│   ├── frontend-stack.ts   # S3 + CloudFront SPA hosting
│   └── backend-stack.ts    # ECS + ALB + RDS backend
├── cdk.json               # CDK configuration
├── tsconfig.json
├── package.json
└── README.md
```

## Prerequisites

### Local Development

```bash
# Install Node.js 18+
node --version

# Install dependencies
npm install

# Install AWS CDK CLI globally
npm install -g aws-cdk@2.154.0

# Verify installation
cdk --version
```

### AWS Setup

1. Create AWS account
2. Create IAM user with AdministratorAccess policy
3. Configure AWS credentials:
   ```bash
   aws configure
   # Enter Access Key ID
   # Enter Secret Access Key
   # Enter region: eu-north-1
   # Enter output format: json
   ```

### Environment Variables

```bash
# Required for CDK synthesis
export AWS_ACCOUNT_ID="637722411565"
export AWS_REGION="eu-north-1"
export CDK_DEFAULT_ACCOUNT="637722411565"
export CDK_DEFAULT_REGION="eu-north-1"

# Domain configuration
export ROOT_DOMAIN="remorai.solutions"

# Backend Docker image (for production)
export BACKEND_IMAGE_URI="637722411565.dkr.ecr.eu-north-1.amazonaws.com/remorai-app-registry:abc123"
```

## Frontend Stack (S3 + CloudFront)

### Architecture Components

**S3 Bucket**

- Name: `remorai-frontend-{stage}`
- Private: No public read access
- Block Public Access: All enabled
- CORS: Configured for asset delivery
- Lifecycle: Version old objects

**CloudFront Distribution**

- Origin: S3 bucket via Origin Access Identity
- Viewer Protocol Policy: HTTPS only
- Geo-restriction: North America + Europe (PriceClass_100)
- Default Root Object: `index.html`
- SPA Routing: 404/403 errors → index.html

**Cache Policies** (Optimized for SPA + Static Assets)

```
HTML Files (index.html, *.html)
├── TTL: 0 seconds (no caching)
├── Revalidate: Always check origin
└── Purpose: Fresh routing for SPA

Versioned Assets (main.abc123.js, *.css, images)
├── TTL: 1 year (365 days)
├── Immutable flag: Yes
└── Purpose: Long-term browser cache

Fonts (*.woff2, *.ttf)
├── TTL: 1 year
├── Compression: No (already compressed)
└── Purpose: Fast loading
```

### Cost Optimization

- **PriceClass_100:** Cheapest CDN tier (North America + Europe)
- **S3 Static Hosting:** No compute costs
- **Log Retention:** 30 days (balance monitoring vs storage)

### Deployment

#### Development (with local dist)

```bash
cd infrastructure
npm run build

# Option 1: Build frontend first, then deploy both
pnpm build --filter @apps/frontend
npx cdk deploy Remorai-Frontend-dev

# Option 2: Just deploy infrastructure (no assets)
npx cdk deploy Remorai-Frontend-dev
```

#### Production (CI/CD)

- Frontend assets deployed via `aws s3 sync` in GitHub Actions
- CDK ensures S3 bucket + CloudFront distribution exist
- No frontend assets embedded in CDK deployment

## Backend Stack (ECS + ALB)

### Architecture Components

**Virtual Private Cloud (VPC)**

- 2 Availability Zones (high availability requirement)
- Public subnets only (cost optimization)
- S3 Gateway Endpoint (no NAT gateway cost)

**Security Groups**

- ALB: Accepts HTTP:80, HTTPS:443
- ECS Tasks: Accepts traffic from ALB only

**Application Load Balancer**

- HTTP:80 Listener: `/api/*` routes to ECS (dev/testing)
- HTTPS:443 Listener: `api.remorai.solutions` with ACM certificate
- Idle timeout: 300 seconds
- Sticky sessions: 5 minutes (for long-running operations)

**ECS Cluster & Fargate Service**

- Cluster: `BackendCluster`
- Service: `BackendApiService`
- Task CPU: 512 (0.5 vCPU)
- Task Memory: 1024 MB (1 GB)
- Desired count: 1 task
- Scaling: Min 1, Max 5 tasks

**Auto Scaling Policies**

- CPU-based: Scale out at 70%, scale in after 10 minutes
- Memory-based: Scale out at 80%, scale in after 10 minutes
- Cooldown: Prevents rapid scaling

**Health Checks**

- Endpoint: `/api/health`
- Interval: 10 seconds
- Timeout: 5 seconds
- Healthy threshold: 2 consecutive
- Unhealthy threshold: 3 consecutive

**S3 Buckets**

- `remorai-org-assets-{stage}`: Organization files (RETAIN)
- `remorai-file-processing-{stage}`: Temp storage with 90-day lifecycle

**Monitoring**

- CloudWatch Logs: 1 week retention (cost optimization)
- CloudWatch Dashboard: CPU, memory, request count, latency
- Alarms: CPU 80%, Memory 85%, Response time 1s

### Cost Optimization

- **1 Task (not 3):** Reduced costs during development
- **512 CPU + 1GB RAM:** Minimum Fargate configuration
- **Public subnets only:** No NAT gateway (~$30/month saved)
- **1-week log retention:** Balance monitoring vs storage
- **Spot pricing:** Available but disabled by default

### Deployment

#### Development

```bash
cd infrastructure
npm run build

# Build backend image locally or use existing
export BACKEND_IMAGE_URI="my-registry/image:tag"

npx cdk deploy Remorai-Backend-dev \
  --context backendImageUri=$BACKEND_IMAGE_URI
```

#### Production (CI/CD)

```bash
# Automatic via GitHub Actions (cd-deploy.yml)
# Builds Docker image → pushes to ECR → deploys with CDK
```

## CDK Commands

### Development Workflow

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Watch for changes during development
npm run watch

# Synthesize CloudFormation template
cdk synth

# Preview changes
cdk diff

# Dry-run deployment (no approval needed for dev)
cdk deploy --all --require-approval never
```

### Production Deployment

```bash
# Full deployment (both stacks)
npm run deploy:all

# Frontend only
npm run deploy:frontend

# Backend only
npm run deploy:backend STAGE=production

# Destroy stacks (CAUTION!)
npm run destroy

# Cross-account deployment
cdk deploy \
  --context stage=production \
  --require-approval never
```

## Configuration Management

### Environment Variables

```bash
# Stage (dev, staging, production)
export STAGE="production"

# Domain name (for custom domain + SSL)
export ROOT_DOMAIN="remorai.solutions"

# AWS Account
export CDK_DEFAULT_ACCOUNT="637722411565"
export CDK_DEFAULT_REGION="eu-north-1"

# Backend Docker image (ECR)
export BACKEND_IMAGE_URI="637722411565.dkr.ecr.eu-north-1.amazonaws.com/remorai-app-registry:latest"
```

### Context Variables (cdk.json)

```json
{
  "context": {
    "stage": "production",
    "rootDomain": "remorai.solutions",
    "backendImageUri": "637722411565.dkr.ecr.eu-north-1.amazonaws.com/remorai-app-registry:latest"
  }
}
```

### GitHub Workflow Integration

```yaml
env:
  STAGE: production
  AWS_REGION: eu-north-1
  CDK_DEFAULT_REGION: eu-north-1
  CDK_DEFAULT_ACCOUNT: ${{ vars.AWS_ACCOUNT_ID }}
  ROOT_DOMAIN: remorai.solutions
  BACKEND_IMAGE_URI: ${{ needs.build-backend.outputs.image-uri }}
```

## Troubleshooting

### CloudFormation Errors

**Error: "User is not authorized to perform: iam:CreateRole"**

- Solution: Ensure IAM user has AdministratorAccess
- Or: Add specific CDK permissions in IAM policy

**Error: "S3 bucket already exists"**

- Solution: S3 bucket names are globally unique
- Check: `aws s3 ls | grep remorai-frontend`
- Fix: Change bucket name in code or manually delete

**Error: "ACM Certificate validation failed"**

- Solution: Verify Route53 hosted zone exists
- Check: `aws route53 list-hosted-zones`
- DNS propagation takes 5-15 minutes

### ECS Task Issues

**Task keeps restarting**

1. Check CloudWatch logs: `aws logs tail /ecs/backend`
2. Verify environment variables in CDK
3. Check Docker image exists in ECR

**Health check failing**

1. SSH into ECS task: `aws ecs execute-command`
2. Test endpoint: `curl localhost:80/api/health`
3. Check container logs for errors

### CloudFront Issues

**Assets not updating after deployment**

1. CloudFront invalidation pending: `aws cloudfront list-invalidations`
2. Browser cache: Clear (Ctrl+Shift+Delete)
3. Verify S3 object versions: `aws s3api list-object-versions`

## Monitoring & Debugging

### CloudWatch Dashboard

```bash
# View dashboard
aws cloudwatch get-dashboard \
  --dashboard-name "Remorai-Backend-production"
```

### View Logs

```bash
# ECS logs (last 1 hour)
aws logs tail /ecs/backend --follow --since 1h

# CloudFront logs (in S3)
aws s3 cp s3://remorai-frontend-logs-production/ ./logs/ --recursive

# VPC Flow Logs
aws logs tail /aws/vpc/flowlogs --follow
```

### Test Connectivity

```bash
# Test S3 access
aws s3 ls s3://remorai-frontend-production

# Test ECR access
aws ecr describe-images --repository-name remorai-app-registry

# Test ECS health
aws elbv2 describe-target-health \
  --target-group-arn <arn> \
  --region eu-north-1
```

## Security Best Practices

### S3 Frontend

- ✅ Block all public access (CloudFront only)
- ✅ Enable versioning
- ✅ Enable MFA delete (production)
- ✅ Enable server-side encryption

### Backend ECS

- ✅ Tasks run in private VPC (no direct internet)
- ✅ Security group restricts to ALB only
- ✅ IAM task role for S3 access (not hardcoded keys)
- ✅ CloudWatch logs encrypted at rest

### Database

- ✅ Use Supabase managed PostgreSQL (not self-hosted)
- ✅ Connection pool separate from direct migrations
- ✅ Network security via VPC peering (not public)

## Cost Estimation

### Monthly Costs (Production)

| Component                          | Monthly      | Notes                        |
| ---------------------------------- | ------------ | ---------------------------- |
| ECS Fargate (512 CPU, 1GB, 1 task) | ~$15         | Auto-scales to 5 max         |
| ALB                                | ~$20         | Fixed + per-LCU              |
| NAT Gateway                        | ~$32         | If used (currently disabled) |
| S3 Storage                         | ~$5          | Frontend assets (~500MB)     |
| CloudFront                         | ~$10         | Low traffic tier             |
| CloudWatch Logs                    | ~$5          | 1 week retention             |
| Data transfer                      | ~$5          | Egress from S3/CF            |
| **Total**                          | **~$90-120** | Baseline infrastructure      |

### Cost Optimization Tips

1. **Use Spot Pricing** for ECS (additional 70% savings)
2. **Consolidate Logs** to S3 Glacier (1 week in CW, archive to S3)
3. **CloudFront Geo-restriction** (PriceClass_100 vs 200)
4. **Reserved Capacity** (1-year commitment = 30% savings)

## Further Reading

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_best_practices.html)
- [CloudFront Performance](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/)
- [Prisma Database Deployment](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate)
