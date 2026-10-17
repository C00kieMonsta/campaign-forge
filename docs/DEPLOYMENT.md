# Deployment Guide

## Architecture

```
www.moniquepirson.be   → CloudFront → S3 (landing)
moniquepirson.be       → OVH 301 redirect → www.moniquepirson.be
admin.moniquepirson.be → CloudFront → S3 (admin frontend)
api.moniquepirson.be   → EC2 t3.micro → nginx → NestJS (PM2)
```

> Root domain (`moniquepirson.be`) cannot have a CNAME record (DNS limitation).
> OVH's redirect handles it — visitors to the bare domain are forwarded to `www`.

Secrets live in **AWS SSM Parameter Store**. The EC2 instance reads them
once on first boot — no secrets are ever stored in git or GitHub.

---

## GitHub Secrets & Variables

**Settings → Secrets and variables → Actions**

### Secrets
| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID_S3` | IAM user with S3 + CloudFront permissions |
| `AWS_SECRET_ACCESS_KEY_S3` | ↑ |
| `EC2_HOST` | Elastic IP of the EC2 instance (set after running `create-ec2.sh`) |
| `EC2_SSH_KEY` | Contents of `~/.ssh/campaign-forge-key.pem` (set after running `create-ec2.sh`) |

### Variables (non-sensitive config)
| Variable | Value |
|---|---|
| `API_BASE_URL` | `https://api.moniquepirson.be/api` |
| `LANDING_S3_BUCKET` | `cf-landing-production` |
| `LANDING_CF_DISTRIBUTION` | CloudFront distribution ID for `moniquepirson.be` |
| `ADMIN_S3_BUCKET` | `cf-admin-production` |
| `ADMIN_CF_DISTRIBUTION` | CloudFront distribution ID for `admin.moniquepirson.be` |

> These values are printed at the end of `./scripts/setup-s3-cloudfront.sh`.

---

## One-Time Setup Order

```
1. setup-ssm-params.sh      → store secrets in SSM
2. create-ec2.sh            → spin up EC2 (reads SSM on boot, fully automated)
3. setup-s3-cloudfront.sh   → create S3 buckets + CloudFront distributions
4. GitHub Secrets           → add EC2_HOST + EC2_SSH_KEY + AWS_ACCESS_KEY_ID_S3
5. GitHub Variables         → copy values printed by setup-s3-cloudfront.sh
6. DNS (OVH)                → add CNAMEs + A record printed by the script
7. ACM cert validation      → add DNS CNAMEs, wait for ISSUED status
8. Push to main             → CI deploys everything
```

---

## 1. Store Secrets in SSM

Run once locally. Requires AWS credentials with SSM + IAM write access.

```bash
./scripts/setup-ssm-params.sh
```

You'll be prompted for:
- Backend IAM credentials (DynamoDB + SES access)
- DynamoDB table names
- SES sender email
- Unsubscribe secret (`openssl rand -base64 32`)
- Public base URL (`https://api.campaignforge.io/api`)
- GitHub PAT (classic, `repo` scope — for EC2 to clone the repo on boot)

---

## 2. Provision EC2

Run once locally. Requires AWS credentials with EC2 + IAM write access.

```bash
./scripts/create-ec2.sh
```

This script:
1. Allocates an **Elastic IP** (permanent — survives instance recreation)
2. Creates an **IAM role** granting the instance SSM read access
3. Creates a **key pair** at `~/.ssh/campaign-forge-key.pem`
4. Creates a **security group** (SSH + HTTP + HTTPS)
5. Launches a `t2.micro` instance with `ec2-bootstrap.sh` as user-data
6. Associates the Elastic IP to the instance

The bootstrap script runs in the background on first boot (~5 min):
- Installs Node.js, pnpm, PM2, nginx, certbot
- Clones the repo using the GitHub PAT from SSM
- Writes `.env` from SSM parameters
- Builds and starts the API with PM2
- Configures nginx + TLS (Let's Encrypt for `api.moniquepirson.be`)

Watch bootstrap progress:
```bash
ssh -i ~/.ssh/campaign-forge-key.pem ec2-user@<ELASTIC_IP>
sudo tail -f /var/log/cloud-init-output.log
```

### Recreating the instance (zero secrets copy-paste)

If you need to replace the EC2 instance (e.g., after termination or corruption):

```bash
./scripts/create-ec2.sh --recreate
```

The Elastic IP stays the same, DNS doesn't change, and SSM already has all
the secrets — the new instance bootstraps itself automatically.

---

## 3. Add GitHub Secrets

After `create-ec2.sh` finishes, add two secrets to GitHub:

```
EC2_HOST = <the Elastic IP printed by the script>
EC2_SSH_KEY = <contents of ~/.ssh/campaign-forge-key.pem>
```

---

## 4. S3 Buckets

Create two buckets in `eu-north-1`:
- `cf-landing-production`
- `cf-admin-production`

For each: **Block all public access ON** (CloudFront serves them via OAC).

---

## 5. CloudFront Distributions

Create two distributions (one per bucket).

For each:
- **Origin**: S3 bucket via OAC (Origin Access Control)
- **Default root object**: `index.html`
- **Custom error pages**: 404 → `/index.html` (200) — required for SPA routing
- **Price class**: North America and Europe only (cheapest)
- **HTTPS**: attach ACM certificate (see below)
- **Alternate domain**: `moniquepirson.be` (landing) / `moniquepirson.be` (admin frontend via path behavior)

### ACM Certificate

1. Go to **ACM in us-east-1** (required for CloudFront — not eu-north-1)
2. Request a certificate for `moniquepirson.be` and `*.moniquepirson.be`
3. Validate via DNS — add the CNAME records in your DNS provider

---

## 6. DNS

In your **OVH DNS zone**:

1. **Delete** the existing `moniquepirson.be A → 213.186.33.5` record (OVH parking page)

2. **Add CNAME records:**

| Record | Type | Value |
|---|---|---|
| `www.moniquepirson.be` | CNAME | CloudFront domain for landing (printed by the script) |
| `admin.moniquepirson.be` | CNAME | CloudFront domain for admin (printed by the script) |
| `api.moniquepirson.be` | A | `13.53.241.122` (Elastic IP) |

3. **Add a 301 redirect** (OVH → your domain → Redirection tab):
   - From: `moniquepirson.be`
   - To: `https://www.moniquepirson.be`
   - Type: Permanent (301)

4. **Add ACM validation CNAMEs** (printed by the script) — required to issue the TLS certificate.

> Root apex domains can't have CNAME records (DNS spec). The OVH redirect handles it transparently.

---

## 7. DynamoDB Production Tables

Run once with DDB IAM credentials:

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
  --global-secondary-indexes '[{
    "IndexName":"byStatus",
    "KeySchema":[
      {"AttributeName":"gsi1pk","KeyType":"HASH"},
      {"AttributeName":"gsi1sk","KeyType":"RANGE"}
    ],
    "Projection":{"ProjectionType":"ALL"}
  }]' \
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

## Moving to another AWS account (data snapshot)

**Settings → Sauvegarde complète** downloads one zip with everything the app stores:

- the three DynamoDB tables (contacts, campaigns, groups), one item per line;
- the Lex Postgres database, every table as NDJSON plus `schema.json` and the applied migrations;
- every object of the campaign attachments bucket and of the Lex documents bucket.

The page counts each source first and refuses the download while any source cannot be read, so a
missing permission shows up as a line on the page rather than as a silently incomplete archive.
`manifest.json` inside the zip lists what was written; its `failures` list must be empty before
the archive is trusted. The zip's `README.md` describes the layout and the restore order.

The download is a navigation (the archive can run to gigabytes), authorised by a two-minute token
in the query string. It needs the dedicated nginx location in `scripts/nginx/assistant-locations.inc`,
which the deploy installs; without it nginx buffers the whole zip to disk first.

### Permissions the runtime credentials need

The backend's IAM user (behind `AWS_ACCESS_KEY_ID` in SSM) must be allowed to:

| Source | Actions |
|---|---|
| each DynamoDB table | `dynamodb:Scan` (already used by the contact search and the groups list) |
| `S3_BUCKET` | `s3:ListBucket` on the bucket, `s3:GetObject` on its objects |
| `LEX_DOCUMENTS_BUCKET` | `s3:ListBucket`, `s3:GetObject` (granted by the `cf-lex-<stage>-runtime-access` policy) |

### Restore outline

1. Create the DynamoDB tables (section 7) and write the `dynamodb/*.ndjson` items back.
2. Deploy `LexDataStack` in the new account, run `pnpm migrate`, then load `postgres/*.ndjson`
   skipping `pgmigrations` and any column marked `generated` in `schema.json`.
3. Upload `s3/<bucket>/...` under the keys listed in `manifest.json`, then null or refresh
   `s3_version_id` in `lex_documents`, `lex_authorities` and `lex_message_audio`.
4. Run `scripts/setup-ssm-params.sh` against the new account and deploy.

---

## Triggering Deployments

**Automatic:** Every push to `main` deploys all three apps.

**Manual (selective):** Actions → Deploy Application → Run workflow.
Choose which parts to deploy: landing / admin frontend / backend.

### What the CI does for the backend

1. Builds the code on the runner
2. SSHs into the EC2 instance
3. `git pull origin main`
4. `pnpm install && pnpm build:packages && pnpm build:backend`
5. `pm2 restart campaign-forge-api`

The `.env` file is already on the instance (written by bootstrap). The CI
never needs to touch secrets.
