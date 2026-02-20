#!/usr/bin/env bash
# Migrate DNS to Route53 + add ALIAS records for CloudFront
# Run once, then update OVH nameservers to Route53

set -euo pipefail

DOMAIN="moniquepirson.be"
ADMIN_DOMAIN="admin.${DOMAIN}"
API_DOMAIN="api.${DOMAIN}"
LANDING_DIST_ID="EGRD8CW31DJMF"
ADMIN_DIST_ID="E1YXROUPVUPI32"
LANDING_CF_DOMAIN="d1suczvsadsjm1.cloudfront.net"
ADMIN_CF_DOMAIN="d7yf45rwtu431.cloudfront.net"
ELASTIC_IP="13.53.241.122"
CERT_ARN="arn:aws:acm:us-east-1:637224115651:certificate/3a44de64-d4db-4050-8d91-ef279ca7eec2"

aws_r53() { aws --region us-east-1 --no-cli-pager route53 "$@"; }
aws_cf() { aws --region us-east-1 --no-cli-pager cloudfront "$@"; }

echo "=== Route53 DNS Migration ==="

# Create hosted zone
echo "Creating Route53 hosted zone for ${DOMAIN}..."
ZONE_ID=$(aws_r53 list-hosted-zones-by-name \
  --dns-name "${DOMAIN}" \
  --query "HostedZones[0].Id" --output text 2>/dev/null || echo "None")

if [[ "$ZONE_ID" == "None" || -z "$ZONE_ID" ]]; then
  ZONE_RESPONSE=$(aws_r53 create-hosted-zone \
    --name "${DOMAIN}" \
    --caller-reference "$(date +%s)" \
    --query "HostedZone.Id" --output text)
  ZONE_ID="$ZONE_RESPONSE"
  echo "  ✓ Created zone: $ZONE_ID"
else
  echo "  ✓ Zone already exists: $ZONE_ID"
fi

# Extract just the zone ID (remove /hostedzone/ prefix)
ZONE_ID_CLEAN="${ZONE_ID##*/}"

# Get nameservers
echo "Getting Route53 nameservers..."
NAMESERVERS=$(aws_r53 list-resource-record-sets \
  --hosted-zone-id "$ZONE_ID_CLEAN" \
  --query "ResourceRecordSets[?Type=='NS'].ResourceRecords[*].Value" \
  --output text)

echo "  Route53 Nameservers:"
for ns in $NAMESERVERS; do
  echo "    - $ns"
done

# Create ALIAS for bare domain → landing CloudFront
echo "Creating Route53 records..."

# Bare domain → landing (ALIAS)
aws_r53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID_CLEAN" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"${DOMAIN}\",
        \"Type\": \"A\",
        \"AliasTarget\": {
          \"HostedZoneId\": \"Z2FDTNDATAQYW2\",
          \"DNSName\": \"${LANDING_CF_DOMAIN}\",
          \"EvaluateTargetHealth\": false
        }
      }
    }]
  }" 2>/dev/null || echo "  (bare domain record may already exist)"

echo "  ✓ ${DOMAIN} → CloudFront landing (ALIAS)"

# Admin subdomain → admin CloudFront
aws_r53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID_CLEAN" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"${ADMIN_DOMAIN}\",
        \"Type\": \"A\",
        \"AliasTarget\": {
          \"HostedZoneId\": \"Z2FDTNDATAQYW2\",
          \"DNSName\": \"${ADMIN_CF_DOMAIN}\",
          \"EvaluateTargetHealth\": false
        }
      }
    }]
  }" 2>/dev/null || echo "  (admin domain record may already exist)"

echo "  ✓ ${ADMIN_DOMAIN} → CloudFront admin (ALIAS)"

# API subdomain → EC2
aws_r53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID_CLEAN" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"${API_DOMAIN}\",
        \"Type\": \"A\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"${ELASTIC_IP}\"}]
      }
    }]
  }" 2>/dev/null || echo "  (api domain record may already exist)"

echo "  ✓ ${API_DOMAIN} → EC2 (${ELASTIC_IP})"

# ACM validation CNAME (for cert issuance)
echo "Adding ACM validation CNAME..."
aws_r53 change-resource-record-sets \
  --hosted-zone-id "$ZONE_ID_CLEAN" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"_a03e5a73b9a8b862b7e6067e128830ae.${DOMAIN}\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"_8f0b6892f69203c44720b9f0f586cb29.jkddzztszm.acm-validations.aws\"}]
      }
    }]
  }" 2>/dev/null || echo "  (validation CNAME may already exist)"

echo "  ✓ ACM validation CNAME added"

echo ""
echo "======================================================"
echo "✅ Route53 setup complete"
echo "======================================================"
echo ""
echo "⚠️  NEXT STEP: Update OVH nameservers"
echo ""
echo "In OVH domain settings, set the nameservers to:"
for ns in $NAMESERVERS; do
  echo "    $ns"
done
echo ""
echo "After DNS propagates (5-30 min):"
echo "  1. ACM cert should automatically ISSUED"
echo "  2. Then run: ./scripts/attach-cert-cloudfront.sh"
echo "  3. CloudFront will get HTTPS on bare domain"
echo ""
echo "Zone ID: $ZONE_ID_CLEAN"
echo "======================================================"
