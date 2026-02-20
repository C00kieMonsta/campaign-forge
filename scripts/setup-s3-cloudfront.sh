#!/usr/bin/env bash
# Run once locally with AWS admin credentials.
# Creates:
#   - 2 S3 buckets (landing + admin)
#   - 2 Origin Access Controls
#   - 2 CloudFront distributions (with SPA error routing)
#   - Bucket policies allowing CloudFront OAC access
#   - ACM certificate request (us-east-1, required for CloudFront)
#
# Final URLs:
#   https://moniquepirson.be       → landing
#   https://admin.moniquepirson.be → admin frontend
#   https://api.moniquepirson.be   → backend API

set -euo pipefail

REGION="${AWS_REGION:-eu-north-1}"
LANDING_BUCKET="cf-landing-production"
ADMIN_BUCKET="cf-admin-production"
DOMAIN="moniquepirson.be"
WWW_DOMAIN="www.${DOMAIN}"
ADMIN_DOMAIN="admin.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
ELASTIC_IP="13.53.241.122"

# CloudFront Managed Cache Policy: CachingOptimized
CF_CACHE_POLICY="658327ea-f89d-4fab-a63d-7e88639e58f6"

aws_r() { aws --region "$REGION" --no-cli-pager "$@"; }
aws_us() { aws --region us-east-1 --no-cli-pager "$@"; }

ACCOUNT_ID=$(aws_r sts get-caller-identity --query Account --output text)

echo "=== Campaign Forge — S3 + CloudFront Setup ==="
echo "Account : $ACCOUNT_ID"
echo "Region  : $REGION"
echo ""

# ── S3 Buckets ────────────────────────────────────────────────────────────────
create_bucket() {
  local bucket="$1"
  if aws_r s3api head-bucket --bucket "$bucket" 2>/dev/null; then
    echo "  ✓ Bucket already exists: $bucket"
  else
    aws_r s3api create-bucket \
      --bucket "$bucket" \
      --create-bucket-configuration LocationConstraint="$REGION" > /dev/null
    aws_r s3api put-public-access-block \
      --bucket "$bucket" \
      --public-access-block-configuration \
        BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
    echo "  ✓ Created bucket: $bucket"
  fi
}

echo "Creating S3 buckets..."
create_bucket "$LANDING_BUCKET"
create_bucket "$ADMIN_BUCKET"

# ── Origin Access Controls ────────────────────────────────────────────────────
create_oac() {
  local name="$1"
  local existing
  existing=$(aws_us cloudfront list-origin-access-controls \
    --query "OriginAccessControlList.Items[?Name=='${name}'].Id | [0]" --output text)

  if [[ -n "$existing" && "$existing" != "None" ]]; then
    echo "  ✓ OAC already exists: $name ($existing)" >&2
    echo "$existing"
    return
  fi

  local tmpfile
  tmpfile=$(mktemp)
  cat > "$tmpfile" <<JSON
{
  "Name": "${name}",
  "Description": "OAC for ${name}",
  "SigningProtocol": "sigv4",
  "SigningBehavior": "always",
  "OriginAccessControlOriginType": "s3"
}
JSON

  local id
  id=$(aws_us cloudfront create-origin-access-control \
    --origin-access-control-config "file://${tmpfile}" \
    --query "OriginAccessControl.Id" --output text)
  rm -f "$tmpfile"

  echo "  ✓ Created OAC: $name ($id)" >&2
  echo "$id"
}

echo "Creating Origin Access Controls..."
LANDING_OAC_ID=$(create_oac "cf-landing-oac")
ADMIN_OAC_ID=$(create_oac "cf-admin-oac")

# ── CloudFront Distributions ──────────────────────────────────────────────────
create_distribution() {
  local bucket="$1"
  local oac_id="$2"
  local comment="$3"
  local origin_id="${bucket}-origin"
  local bucket_domain="${bucket}.s3.${REGION}.amazonaws.com"

  local dist_id
  dist_id=$(aws_us cloudfront list-distributions \
    --query "DistributionList.Items[?Comment=='${comment}'].Id | [0]" --output text)

  if [[ -n "$dist_id" && "$dist_id" != "None" ]]; then
    echo "  ✓ Distribution already exists: $comment ($dist_id)" >&2
    echo "$dist_id"
    return
  fi

  local tmpfile
  tmpfile=$(mktemp)
  cat > "$tmpfile" <<JSON
{
  "CallerReference": "${bucket}-$(date +%s)",
  "Comment": "${comment}",
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "${origin_id}",
      "DomainName": "${bucket_domain}",
      "S3OriginConfig": { "OriginAccessIdentity": "" },
      "OriginAccessControlId": "${oac_id}"
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "${origin_id}",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "${CF_CACHE_POLICY}",
    "Compress": true,
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    }
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 0
      },
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 0
      }
    ]
  },
  "PriceClass": "PriceClass_100",
  "Enabled": true,
  "HttpVersion": "http2and3"
}
JSON

  local id
  id=$(aws_us cloudfront create-distribution \
    --distribution-config "file://${tmpfile}" \
    --query "Distribution.Id" --output text)
  rm -f "$tmpfile"

  echo "  ✓ Created distribution: $comment ($id)" >&2
  echo "$id"
}

echo "Creating CloudFront distributions..."
LANDING_DIST_ID=$(create_distribution "$LANDING_BUCKET" "$LANDING_OAC_ID" "campaign-forge-landing")
ADMIN_DIST_ID=$(create_distribution "$ADMIN_BUCKET" "$ADMIN_OAC_ID" "campaign-forge-admin")

# ── Bucket Policies ───────────────────────────────────────────────────────────
apply_bucket_policy() {
  local bucket="$1"
  local dist_id="$2"
  local dist_arn="arn:aws:cloudfront::${ACCOUNT_ID}:distribution/${dist_id}"
  local tmpfile
  tmpfile=$(mktemp)
  cat > "$tmpfile" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontOAC",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::${bucket}/*",
    "Condition": {
      "StringEquals": {
        "AWS:SourceArn": "${dist_arn}"
      }
    }
  }]
}
JSON
  aws_r s3api put-bucket-policy --bucket "$bucket" --policy "file://${tmpfile}"
  rm -f "$tmpfile"
  echo "  ✓ Bucket policy applied: $bucket"
}

echo "Applying bucket policies..."
apply_bucket_policy "$LANDING_BUCKET" "$LANDING_DIST_ID"
apply_bucket_policy "$ADMIN_BUCKET" "$ADMIN_DIST_ID"

# ── Get CloudFront domains ────────────────────────────────────────────────────
LANDING_CF_DOMAIN=$(aws_us cloudfront get-distribution \
  --id "$LANDING_DIST_ID" --query "Distribution.DomainName" --output text)
ADMIN_CF_DOMAIN=$(aws_us cloudfront get-distribution \
  --id "$ADMIN_DIST_ID" --query "Distribution.DomainName" --output text)

# ── ACM Certificate ───────────────────────────────────────────────────────────
echo "Requesting ACM certificate..."
CERT_ARN=$(aws_us acm list-certificates \
  --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn | [0]" --output text)

if [[ -z "$CERT_ARN" || "$CERT_ARN" == "None" ]]; then
  CERT_ARN=$(aws_us acm request-certificate \
    --domain-name "$DOMAIN" \
    --subject-alternative-names "*.${DOMAIN}" \
    --validation-method DNS \
    --query CertificateArn --output text)
  echo "  ✓ Certificate requested"
else
  echo "  ✓ Certificate already exists"
fi

# Get validation CNAMEs to add to OVH
VALIDATION_RECORDS=$(aws_us acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --query "Certificate.DomainValidationOptions[].ResourceRecord" \
  --output text 2>/dev/null || echo "  (pending — re-run in a moment to see CNAMEs)")

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "✅ S3 + CloudFront setup complete"
echo "======================================================"
echo ""
echo "─── GitHub Variables (Settings → Secrets → Variables) ───"
echo "LANDING_S3_BUCKET       = $LANDING_BUCKET"
echo "LANDING_CF_DISTRIBUTION = $LANDING_DIST_ID"
echo "ADMIN_S3_BUCKET         = $ADMIN_BUCKET"
echo "ADMIN_CF_DISTRIBUTION   = $ADMIN_DIST_ID"
echo "API_BASE_URL            = https://${API_DOMAIN}/api"
echo ""
echo "─── OVH DNS Records ──────────────────────────────────────"
echo "  1. DELETE existing A record: ${DOMAIN} → 213.186.33.5"
echo ""
echo "  2. ADD CNAME records:"
echo "     ${WWW_DOMAIN}   CNAME → $LANDING_CF_DOMAIN"
echo "     ${ADMIN_DOMAIN} CNAME → $ADMIN_CF_DOMAIN"
echo ""
echo "  3. ADD A record:"
echo "     ${API_DOMAIN}   A → $ELASTIC_IP"
echo ""
echo "  4. ADD redirect (OVH Redirection tab, 301 permanent):"
echo "     ${DOMAIN} → https://${WWW_DOMAIN}"
echo ""
echo "─── ACM Validation CNAMEs (also add to OVH) ─────────────"
echo "$VALIDATION_RECORDS"
echo "  ARN: $CERT_ARN"
echo ""
echo "─── Final URLs ───────────────────────────────────────────"
echo "Landing : https://${WWW_DOMAIN}  (${DOMAIN} redirects here via OVH)"
echo "Admin   : https://${ADMIN_DOMAIN}"
echo "API     : https://${API_DOMAIN}"
echo ""
echo "⚠️  Next: Once the ACM cert shows ISSUED (check AWS ACM console),"
echo "   attach it to both CloudFront distributions + add alternate domains."
echo "⚠️  CloudFront distributions take 5-15 min to deploy globally."
echo "======================================================"
