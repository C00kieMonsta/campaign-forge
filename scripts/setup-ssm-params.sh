#!/usr/bin/env bash
# Run once locally with AWS admin credentials.
# Stores all backend secrets in SSM Parameter Store.
# The EC2 instance reads these on first boot via ec2-bootstrap.sh.

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

echo "=== Campaign Forge — SSM Parameter Setup ==="
echo "Region: $REGION"
echo "Prefix: $PREFIX"
echo ""

# ── AWS credentials used by the backend (DynamoDB + SES) ─────────────────────
read -rp "AWS_ACCESS_KEY_ID (backend): " aws_key_id
read -rsp "AWS_SECRET_ACCESS_KEY (backend): " aws_secret
echo ""

# ── DynamoDB table names ──────────────────────────────────────────────────────
read -rp "CONTACTS_TABLE [cf-contacts-prod]: " contacts_table
contacts_table="${contacts_table:-cf-contacts-prod}"

read -rp "CAMPAIGNS_TABLE [cf-campaigns-prod]: " campaigns_table
campaigns_table="${campaigns_table:-cf-campaigns-prod}"

# ── SES ───────────────────────────────────────────────────────────────────────
read -rp "SES_FROM_EMAIL: " ses_from_email

# ── Unsubscribe secret (32+ random chars) ────────────────────────────────────
read -rsp "UNSUBSCRIBE_SECRET: " unsub_secret
echo ""

# ── Public base URL (e.g. https://api.yourdomain.com/api) ─────────────────────
read -rp "PUBLIC_BASE_URL (e.g. https://api.campaignforge.io/api): " public_base_url

# ── GitHub PAT for git clone (repo:read scope) ───────────────────────────────
echo ""
echo "GitHub Personal Access Token (read:packages + contents scope)."
echo "Used by the EC2 bootstrap to clone the repo."
read -rsp "GITHUB_PAT: " github_pat
echo ""

echo ""
echo "Storing parameters..."
put_param "AWS_ACCESS_KEY_ID"     "$aws_key_id"
put_param "AWS_SECRET_ACCESS_KEY" "$aws_secret"
put_param "CONTACTS_TABLE"        "$contacts_table"  "String"
put_param "CAMPAIGNS_TABLE"       "$campaigns_table" "String"
put_param "SES_FROM_EMAIL"        "$ses_from_email"  "String"
put_param "UNSUBSCRIBE_SECRET"    "$unsub_secret"
put_param "PUBLIC_BASE_URL"       "$public_base_url" "String"
put_param "GITHUB_PAT"            "$github_pat"

echo ""
echo "✅ All parameters stored under ${PREFIX}/"
echo ""
echo "Next step: run ./scripts/create-ec2.sh"
