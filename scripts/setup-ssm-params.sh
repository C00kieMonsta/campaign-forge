#!/usr/bin/env bash
# Run once locally with AWS admin credentials.
# Stores all backend secrets in SSM Parameter Store.
# The EC2 instance reads these on first boot via ec2-bootstrap.sh.
#
# Usage:
#   ./scripts/setup-ssm-params.sh              # Interactive mode
#   ./scripts/setup-ssm-params.sh --file FILE  # Load from JSON file

set -euo pipefail

REGION="${AWS_REGION:-eu-north-1}"
PREFIX="/campaign-forge/production"

put_param() {
  local name="$1"
  local value="$2"
  local type="${3:-SecureString}"

  aws ssm put-parameter \
    --region "$REGION" \
    --name "${PREFIX}/${name}" \
    --value "$value" \
    --type "$type" \
    --overwrite \
    --no-cli-pager

  echo "  ✓ ${PREFIX}/${name}"
}

get_json_field() {
  local json="$1"
  local field="$2"
  echo "$json" | jq -r ".$field"
}

echo "=== Campaign Forge — SSM Parameter Setup ==="
echo "Region: $REGION"
echo "Prefix: $PREFIX"
echo ""

# Check for --file flag
if [[ "${1:-}" == "--file" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "Error: --file requires a path argument"
    exit 1
  fi
  
  file="$2"
  if [[ ! -f "$file" ]]; then
    echo "Error: File not found: $file"
    exit 1
  fi
  
  echo "Loading from: $file"
  json=$(cat "$file")
  
  aws_key_id=$(get_json_field "$json" "AWS_ACCESS_KEY_ID")
  aws_secret=$(get_json_field "$json" "AWS_SECRET_ACCESS_KEY")
  contacts_table=$(get_json_field "$json" "CONTACTS_TABLE")
  campaigns_table=$(get_json_field "$json" "CAMPAIGNS_TABLE")
  groups_table=$(get_json_field "$json" "GROUPS_TABLE")
  ses_from_email=$(get_json_field "$json" "SES_FROM_EMAIL")
  unsub_secret=$(get_json_field "$json" "UNSUBSCRIBE_SECRET")
  public_base_url=$(get_json_field "$json" "PUBLIC_BASE_URL")
  admin_credentials=$(get_json_field "$json" "ADMIN_CREDENTIALS" | jq -c .)
  jwt_secret=$(get_json_field "$json" "JWT_SECRET")
else
  # ── AWS credentials used by the backend (DynamoDB + SES) ─────────────────────
  read -rp "AWS_ACCESS_KEY_ID (backend): " aws_key_id
  read -rsp "AWS_SECRET_ACCESS_KEY (backend): " aws_secret
  echo ""

  # ── DynamoDB table names ──────────────────────────────────────────────────────
  read -rp "CONTACTS_TABLE [cf-contacts-prod]: " contacts_table
  contacts_table="${contacts_table:-cf-contacts-prod}"

  read -rp "CAMPAIGNS_TABLE [cf-campaigns-prod]: " campaigns_table
  campaigns_table="${campaigns_table:-cf-campaigns-prod}"

  read -rp "GROUPS_TABLE [cf-groups-prod]: " groups_table
  groups_table="${groups_table:-cf-groups-prod}"

  # ── SES ───────────────────────────────────────────────────────────────────────
  read -rp "SES_FROM_EMAIL: " ses_from_email

  # ── Unsubscribe secret (32+ random chars) ────────────────────────────────────
  read -rsp "UNSUBSCRIBE_SECRET: " unsub_secret
  echo ""

  # ── Public base URL (e.g. https://api.yourdomain.com/api) ─────────────────────
  read -rp "PUBLIC_BASE_URL (e.g. https://api.campaignforge.io/api): " public_base_url

  # ── Admin credentials ─────────────────────────────────────────────────────────
  echo "ADMIN_CREDENTIALS: JSON array of {email, hash} objects."
  echo "Generate hashes with: node -e \"const b=require('bcryptjs');b.hash('password',12).then(console.log)\""
  read -rp "ADMIN_CREDENTIALS (JSON): " admin_credentials
  read -rsp "JWT_SECRET (32+ random chars): " jwt_secret
  echo ""
fi

echo ""
echo "Storing parameters..."
put_param "AWS_ACCESS_KEY_ID"     "$aws_key_id"
put_param "AWS_SECRET_ACCESS_KEY" "$aws_secret"
put_param "CONTACTS_TABLE"        "$contacts_table"  "String"
put_param "CAMPAIGNS_TABLE"       "$campaigns_table" "String"
put_param "GROUPS_TABLE"          "$groups_table"    "String"
put_param "SES_FROM_EMAIL"        "$ses_from_email"  "String"
put_param "UNSUBSCRIBE_SECRET"    "$unsub_secret"
put_param "PUBLIC_BASE_URL"       "$public_base_url" "String"
put_param "ADMIN_CREDENTIALS"     "$admin_credentials"
put_param "JWT_SECRET"            "$jwt_secret"

echo ""
echo "✅ All parameters stored under ${PREFIX}/"
echo ""
echo "Next step: run ./scripts/create-ec2.sh"
