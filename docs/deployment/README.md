# Deployment Guide

This guide covers the deployment architecture, processes, and infrastructure management for the Material Extractor platform.

## 🚀 Live Deployment

**✅ Successfully Deployed!**

- **Frontend**: `https://app.remorai.solutions`
- **Backend API**: `https://api.app.remorai.solutions`
- **Status**: Production ready and operational

## 🏗️ Architecture

### Infrastructure

- **Frontend**: Next.js static export deployed on AWS CloudFront
- **Backend**: NestJS application running on AWS ECS Fargate
- **Database**: Supabase (PostgreSQL)
- **File Storage**: AWS S3
- **DNS & SSL**: Route 53 and ACM certificates
- **Monitoring**: CloudWatch logs and metrics

### Technology Stack

- **Frontend**: Next.js 15, React 18, TypeScript, Tailwind CSS
- **Backend**: NestJS, TypeScript, Node.js
- **Database**: PostgreSQL (Supabase)
- **Infrastructure**: AWS CDK, CloudFormation
- **CI/CD**: GitHub Actions
- **Testing**: Jest, React Testing Library

## 🚀 Deployment Process

The application is automatically deployed via GitHub Actions when code is pushed to the main branch.

### Deployment Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   GitHub Actions   │────│   AWS CDK Deploy    │────│   Production     │
│                 │    │                  │    │                 │
│ • Run Tests     │    │ • Infrastructure │    │ • CloudFront    │
│ • Build Apps    │    │ • ECS Fargate    │    │ • ECS Services  │
│ • Deploy Stack  │    │ • Route 53 DNS   │    │ • Load Balancer │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Environment Configuration

- **Production Region**: `eu-north-1`
- **CDK Account**: `637224115651`
- **Domain**: `app.remorai.solutions`
- **API Subdomain**: `api.app.remorai.solutions`

## 🔐 Certificate Management

### Overview

The application uses SSL/TLS certificates for secure HTTPS connections. Due to AWS CloudFront requirements, certificates must be managed carefully across regions.

### Certificate Strategy

- **Frontend (CloudFront)**: Requires certificate in `us-east-1` region
- **Backend (ALB)**: Uses certificate in the same region as deployment (`eu-north-1`)

### Frontend Certificate Setup

The frontend uses a manually created certificate for the root domain:

1. **Certificate Creation**:
   - Go to **AWS Certificate Manager** in `us-east-1` region
   - Request a public certificate for `remorai.solutions`
   - Use **DNS validation** via Route 53
   - Wait for validation (typically 5-10 minutes)

2. **CDK Integration**:

   ```typescript
   certificate = acm.Certificate.fromCertificateArn(
     this,
     "ImportedCertificate",
     "arn:aws:acm:us-east-1:637224115651:certificate/593d7cdf-1bd6-4cee-aad9-e7ac64c086df"
   );
   ```

3. **Domain Coverage**:
   - ✅ `remorai.solutions` (root domain)
   - Note: If you need wildcard support, add `*.remorai.solutions` as Subject Alternative Name

### Backend Certificate Setup

The backend certificate is automatically created during CDK deployment:

```typescript
certificate = new acm.Certificate(this, "BackendCertificate", {
  domainName: props.domainName, // api.app.remorai.solutions
  validation: acm.CertificateValidation.fromDns(hostedZone)
});
```

### SSL/TLS Certificates

- **Frontend Certificate**: `us-east-1` (CloudFront requirement)
  - **ARN**: `arn:aws:acm:us-east-1:637224115651:certificate/593d7cdf-1bd6-4cee-aad9-e7ac64c086df`
  - **Domains**: `remorai.solutions` (root domain)
  - **Status**: Issued and validated
- **Backend Certificate**: `eu-north-1` (ALB requirement)
  - **Domain**: `api.app.remorai.solutions`
  - **Auto-created**: Via CDK during deployment
- **Validation**: DNS validation via Route 53

### Certificate Renewal

- **AWS-managed certificates** auto-renew before expiration
- **Monitor expiration** via CloudWatch or ACM console
- **Update ARNs** in CDK code if certificates are replaced

### Troubleshooting

**Common Issues**:

- **Domain mismatch**: Ensure certificate covers the exact domain being used
- **Region mismatch**: CloudFront certificates must be in `us-east-1`
- **Validation pending**: Check DNS records in Route 53 hosted zone

**Solutions**:

- Verify certificate status in ACM console
- Check Route 53 DNS records for validation
- Ensure proper domain configuration in CDK stacks

## 🔧 Infrastructure Management

### CDK Commands

```bash
cd infrastructure

# Install dependencies
npm install

# Build infrastructure code
npm run build

# Synthesize CloudFormation templates
npm run synth

# Deploy to production
npm run deploy
```

### Stack Components

- **Backend Stack**: ECS Fargate service with Application Load Balancer
- **Frontend Stack**: CloudFront distribution with S3 origin
- **Networking**: VPC with public/private subnets and NAT gateways
- **Security**: Security groups, IAM roles, and SSL certificates

## 📊 Monitoring & Logs

- **Application Logs**: CloudWatch log groups for backend services
- **Access Logs**: ALB and CloudFront access logging
- **Metrics**: CloudWatch custom metrics and dashboards
- **Health Checks**: Load balancer health checks on `/api/health`

## 🚨 Troubleshooting

### Common Deployment Issues

1. **Certificate validation fails**:
   - Check DNS records in Route 53
   - Verify certificate ARN is correct
   - Ensure certificate is in the correct region

2. **ECS service fails to start**:
   - Check CloudWatch logs for container errors
   - Verify environment variables are set correctly
   - Ensure Docker image is built and pushed successfully

3. **CloudFront distribution not updating**:
   - Wait for distribution to fully deploy (can take 10-15 minutes)
   - Create invalidation for updated files
   - Check S3 bucket permissions

### Recovery Procedures

1. **Rollback deployment**:
   - Use previous CloudFormation stack version
   - Redeploy from known good commit

2. **Emergency fixes**:
   - Direct S3 file updates for frontend hotfixes
   - ECS service task restart for backend issues

## 🔌 WebSocket Real-Time Configuration

The application uses WebSocket connections for real-time updates, enabling instant UI updates when database records change without polling or page refreshes.

### Architecture Overview

```
Database Change → Postgres NOTIFY → Backend PgListener → WebSocket Gateway → Frontend Clients → Cache Update
```

### Required Environment Variables

#### Backend Configuration

Add these variables to `apps/backend/.env` (development) and production environment:

```bash
# Real-time WebSocket Configuration
# IMPORTANT: DATABASE_URL_DIRECT must use port 5432 (direct Postgres, not PgBouncer)
# PgBouncer does not support LISTEN/NOTIFY commands required for real-time functionality
DATABASE_URL_DIRECT=postgresql://user:pass@host:5432/db?sslmode=require

# Comma-separated list of database tables to monitor for changes
PG_CHANNELS=extraction_jobs,extraction_results projects,data_layers,supplier_matches

# Frontend URL for WebSocket CORS configuration
FRONTEND_URL=https://app.remorai.solutions
```

**Critical Notes**:

- `DATABASE_URL_DIRECT` **must** connect directly to Postgres on port **5432**
- Do **not** use PgBouncer connection (typically port 6543) for this variable
- PgBouncer does not support `LISTEN/NOTIFY` commands required for real-time updates
- For Supabase, use the "Direct connection" string from project settings

#### Frontend Configuration

Add this variable to `apps/frontend/.env.local` (development) and production environment:

```bash
# WebSocket endpoint for real-time updates
NEXT_PUBLIC_WS_URL=wss://api.app.remorai.solutions/ws
```

**Environment-specific values**:

- **Development**: `ws://localhost:8001/ws`
- **Production**: `wss://api.app.remorai.solutions/ws`

### Database Connection Types

When using Supabase or similar managed Postgres services, you typically have two connection strings:

1. **Pooled Connection** (PgBouncer) - Port 6543
   - Used for: Regular application queries via Prisma
   - Variable: `DATABASE_URL`
   - Supports: Standard SQL queries, transactions
   - Does NOT support: `LISTEN/NOTIFY`, advisory locks, prepared statements

2. **Direct Connection** - Port 5432
   - Used for: Real-time WebSocket layer (LISTEN/NOTIFY)
   - Variable: `DATABASE_URL_DIRECT`
   - Supports: All Postgres features including `LISTEN/NOTIFY`
   - Note: Limited connection pool, use sparingly

### Supabase Configuration

To get the correct connection strings from Supabase:

1. Go to **Project Settings** → **Database**
2. Find **Connection string** section
3. Copy **Connection pooling** string → Use for `DATABASE_URL`
4. Copy **Direct connection** string → Use for `DATABASE_URL_DIRECT`
5. Ensure direct connection uses port **5432**

### Monitored Tables

The following tables emit real-time notifications:

- `extraction_jobs` - Job status and progress updates
- `extraction_results` - New extraction results
- `projects` - Project creation, updates, and deletion
- `data_layers` - File upload and processing status
- `supplier_matches` - Supplier matching results

To add or remove monitored tables, update the `PG_CHANNELS` environment variable.

### WebSocket Endpoint

- **Path**: `/ws`
- **Protocol**: WebSocket (ws:// for dev, wss:// for production)
- **CORS**: Configured via `FRONTEND_URL` environment variable
- **Authentication**: Currently relies on CORS (future: JWT validation)

### Testing WebSocket Connection

```bash
# Test WebSocket connection (requires wscat)
npm install -g wscat

# Connect to local development
wscat -c ws://localhost:8001/ws

# Subscribe to a channel
> {"type":"subscribe","channel":"projects"}

# You should receive notifications when projects are created/updated/deleted
```

### Troubleshooting

**WebSocket connection fails**:

- Verify `NEXT_PUBLIC_WS_URL` is set correctly
- Check CORS configuration in backend (`FRONTEND_URL`)
- Ensure WebSocket endpoint is accessible (not blocked by firewall)

**No real-time updates received**:

- Verify `DATABASE_URL_DIRECT` uses port 5432 (not PgBouncer)
- Check backend logs for PgListener connection status
- Verify database triggers are installed (see migration files)
- Confirm `PG_CHANNELS` includes the table you're monitoring

**Connection drops frequently**:

- Check network stability
- Verify load balancer WebSocket support (sticky sessions)
- Review CloudWatch logs for backend errors

## 🔄 Environment Management

### Staging Environment

- **Purpose**: Pre-production testing
- **Deployment**: Automatic on PR merge to develop branch
- **Database**: Separate Supabase project for staging

### Production Environment

- **Purpose**: Live application
- **Deployment**: Manual trigger or release tag
- **Database**: Production Supabase project
- **Monitoring**: Full monitoring and alerting enabled

## 📈 Scaling Considerations

### Current Limits

- **ECS Tasks**: Auto-scaling between 1-10 tasks
- **CloudFront**: Global CDN with edge caching
- **Database**: Supabase managed scaling

### Future Scaling

- **Multi-region deployment** for improved latency
- **Database read replicas** for improved performance
- **Container resource optimization** based on usage patterns
