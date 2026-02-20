#!/usr/bin/env bash
# Attach ACM certificate to CloudFront distributions + add alternate domains
# Run once the ACM cert is ISSUED

set -euo pipefail

REGION="eu-north-1"
CERT_ARN="arn:aws:acm:us-east-1:637224115651:certificate/3a44de64-d4db-4050-8d91-ef279ca7eec2"
LANDING_DIST_ID="EGRD8CW31DJMF"
ADMIN_DIST_ID="E1YXROUPVUPI32"
LANDING_DOMAIN="moniquepirson.be"
ADMIN_DOMAIN="admin.moniquepirson.be"

aws_cf() { aws --region us-east-1 --no-cli-pager cloudfront "$@"; }

echo "=== CloudFront + ACM Certificate Setup ==="

# Check cert status
CERT_STATUS=$(aws --region us-east-1 --no-cli-pager acm describe-certificate \
  --certificate-arn "$CERT_ARN" \
  --query "Certificate.Status" --output text)

echo "Certificate Status: $CERT_STATUS"

if [[ "$CERT_STATUS" != "ISSUED" ]]; then
  echo "❌ Certificate not yet ISSUED. Status: $CERT_STATUS"
  echo "Check: https://console.aws.amazon.com/acm/home?region=us-east-1"
  exit 1
fi

echo "✅ Certificate is ISSUED"
echo ""

update_distribution() {
  local dist_id="$1"
  local domain="$2"
  local label="$3"

  echo "Updating $label distribution ($dist_id)..."

  local response etag config updated tmpfile
  response=$(aws_cf get-distribution-config --id "$dist_id")
  etag=$(echo "$response" | jq -r '.ETag')
  config=$(echo "$response" | jq '.DistributionConfig')

  updated=$(echo "$config" | jq \
    --arg cert "$CERT_ARN" \
    --arg domain "$domain" \
    '.ViewerCertificate = {
      "ACMCertificateArn": $cert,
      "SSLSupportMethod": "sni-only",
      "MinimumProtocolVersion": "TLSv1.2_2021"
    } |
    .Aliases = {
      "Quantity": 1,
      "Items": [$domain]
    }')

  tmpfile=$(mktemp)
  echo "$updated" > "$tmpfile"

  aws_cf update-distribution \
    --id "$dist_id" \
    --distribution-config "file://${tmpfile}" \
    --if-match "$etag" > /dev/null

  rm -f "$tmpfile"
  echo "  ✓ Updated — alternate domain: $domain"
}

update_distribution "$LANDING_DIST_ID" "$LANDING_DOMAIN" "landing"
update_distribution "$ADMIN_DIST_ID" "$ADMIN_DOMAIN" "admin"

echo ""
echo "======================================================"
echo "✅ CloudFront distributions updated with HTTPS"
echo "======================================================"
echo ""
echo "DNS is already pointing:"
echo "  $LANDING_DOMAIN → CloudFront (landing)"
echo "  $ADMIN_DOMAIN   → CloudFront (admin)"
echo ""
echo "HTTPS should now work on both domains."
echo "Takes 5-15 min for CloudFront to deploy globally."
echo "======================================================"
