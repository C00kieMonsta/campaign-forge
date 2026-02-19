# Deployment Guide

## Architecture

```
moniquepirson.be        → CloudFront → S3 (landing)
admin.moniquepirson.be  → CloudFront → S3 (admin frontend)
api.moniquepirson.be    → EC2 t2.micro (nginx → NestJS via PM2)
```

---

## GitHub Secrets & Variables

Go to **Settings → Secrets and variables → Actions** in your GitHub repo.

### Secrets (sensitive values)
| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID_S3` | IAM user with S3 + CloudFront access |
| `AWS_SECRET_ACCESS_KEY_S3` | ↑ |
| `EC2_HOST` | Public IP or domain of your EC2 instance |
| `EC2_SSH_KEY` | Private SSH key to access EC2 (entire contents of .pem file) |

### Variables (non-sensitive config)
| Variable | Value |
|---|---|
| `API_BASE_URL` | `https://api.moniquepirson.be/api` |
| `LANDING_S3_BUCKET` | `cf-landing-production` |
| `LANDING_CF_DISTRIBUTION` | CloudFront distribution ID for landing |
| `ADMIN_S3_BUCKET` | `cf-admin-production` |
| `ADMIN_CF_DISTRIBUTION` | CloudFront distribution ID for admin |

---

## AWS Setup (one-time)

### 1. S3 Buckets
Create two S3 buckets in `eu-north-1`:
- `cf-landing-production`
- `cf-admin-production`

For each bucket:
- Block all public access: **ON** (CloudFront will serve it)
- Versioning: optional

### 2. CloudFront Distributions
Create two distributions (one per bucket).

For each distribution:
- **Origin**: your S3 bucket (use OAC — Origin Access Control)
- **Default root object**: `index.html`
- **Custom error pages**: 404 → `/index.html` (status 200) — required for SPA routing
- **Price class**: Use only North America and Europe (cheapest)
- **HTTPS**: use ACM certificate (free) — request in `us-east-1` region
- **Alternate domain**: `moniquepirson.be` (landing) or `admin.moniquepirson.be` (admin)

### 3. ACM Certificate
- Go to **ACM in us-east-1** (required for CloudFront)
- Request a certificate for `moniquepirson.be` and `*.moniquepirson.be`
- Validate via DNS (add CNAME records in OVH)

### 4. Route53 / OVH DNS
Point your OVH DNS to CloudFront:
- `moniquepirson.be` → CNAME to CloudFront distribution domain
- `admin.moniquepirson.be` → CNAME to CloudFront distribution domain
- `api.moniquepirson.be` → A record to EC2 public IP

> OVH uses its own nameservers so add the records in OVH DNS zone, not Route53.

### 5. EC2 Instance

**Launch instance:**
- AMI: Amazon Linux 2023
- Type: `t2.micro` (free tier) → switch to `t4g.nano` after 12 months (~$3/month)
- Storage: 8GB gp3
- Security group:
  - SSH (22) from your IP only
  - HTTP (80) from anywhere (nginx)
  - HTTPS (443) from anywhere (nginx)
  - Custom TCP 3001 — NOT exposed publicly (nginx proxies to it)

**One-time EC2 setup (SSH in and run):**

```bash
# Install Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs git

# Install pnpm
npm install -g pnpm@10.8.0

# Install PM2
npm install -g pm2

# Install nginx
sudo dnf install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Clone the repo
cd /home/ec2-user
git clone https://github.com/YOUR_ORG/campaign-forge.git
cd campaign-forge

# Install dependencies
pnpm install

# Create .env from example
cp apps/backend/.env.example apps/backend/.env
nano apps/backend/.env   # fill in all values

# Build and start
pnpm build:packages
pnpm build:backend
pm2 start apps/backend/dist/main.js --name campaign-forge-api --env production
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

**nginx config** (`/etc/nginx/conf.d/api.conf`):

```nginx
server {
    listen 80;
    server_name api.moniquepirson.be;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then reload: `sudo nginx -s reload`

**HTTPS with Let's Encrypt (free):**

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.moniquepirson.be
# Auto-renewal is set up automatically
```

---

## EC2 `.env` file

Fill in `/home/ec2-user/campaign-forge/apps/backend/.env` with production values:

```bash
PORT=3001
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=<ddb-iam-user-key>
AWS_SECRET_ACCESS_KEY=<ddb-iam-user-secret>
CONTACTS_TABLE=cf-contacts-production
CAMPAIGNS_TABLE=cf-campaigns-production
SES_FROM_EMAIL=<verified-sender@moniquepirson.be>
SES_REGION=eu-north-1
UNSUBSCRIBE_SECRET=<run: openssl rand -base64 32>
PUBLIC_BASE_URL=https://api.moniquepirson.be/api
```

> This file lives only on the EC2 instance and is never committed to git.

---

## DynamoDB Production Tables

Run once (with DDB IAM credentials):

```bash
# Contacts table
aws dynamodb create-table \
  --table-name cf-contacts-production \
  --attribute-definitions \
    AttributeName=emailLower,AttributeType=S \
    AttributeName=gsi1pk,AttributeType=S \
    AttributeName=gsi1sk,AttributeType=S \
  --key-schema AttributeName=emailLower,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes '[{"IndexName":"byStatus","KeySchema":[{"AttributeName":"gsi1pk","KeyType":"HASH"},{"AttributeName":"gsi1sk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --region eu-north-1

# Campaigns table
aws dynamodb create-table \
  --table-name cf-campaigns-production \
  --attribute-definitions AttributeName=campaignId,AttributeType=S \
  --key-schema AttributeName=campaignId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-north-1
```

---

## Triggering Deployments

**Automatic:** Every push to `main` deploys all three apps.

**Manual (selective):** Go to Actions → Deploy Application → Run workflow.
You can choose which parts to deploy (landing / frontend / backend).
