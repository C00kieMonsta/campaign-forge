#!/usr/bin/env bash
# Run once (locally) with AWS admin credentials to provision:
#   - IAM role + instance profile (SSM read access)
#   - Security group (SSH + HTTP + HTTPS)
#   - Key pair (saved to ~/.ssh/)
#   - EC2 t3.micro instance (free tier)
#   - Elastic IP (stays yours, survives instance recreation)
#
# To DESTROY and recreate the instance only (keeps the Elastic IP):
#   ./scripts/create-ec2.sh --recreate

set -euo pipefail

REGION="${AWS_REGION:-eu-north-1}"
INSTANCE_NAME="campaign-forge-backend"
KEY_NAME="campaign-forge-key"
KEY_FILE="${HOME}/.ssh/${KEY_NAME}.pem"
INSTANCE_TYPE="t3.micro"  # Free tier eligible in eu-north-1 (~$0.01/hour)
SSM_PREFIX="/campaign-forge/production"

RECREATE=false
[[ "${1:-}" == "--recreate" ]] && RECREATE=true

# ── Helpers ───────────────────────────────────────────────────────────────────
aws_cmd() { aws --region "$REGION" --no-cli-pager "$@"; }

get_latest_ami() {
  # Amazon Linux 2023 (has glibc 2.34, supports Node.js 20+)
  aws_cmd ec2 describe-images \
    --owners amazon \
    --filters "Name=name,Values=al2023-ami-2023*-x86_64" \
    --query "sort_by(Images, &CreationDate)[-1].ImageId" \
    --output text
}

# ── Elastic IP: allocate once, reuse forever ──────────────────────────────────
ALLOCATION_ID=$(aws_cmd ec2 describe-addresses \
  --filters "Name=tag:Name,Values=${INSTANCE_NAME}" \
  --query "Addresses[0].AllocationId" --output text 2>/dev/null || echo "None")

if [[ "$ALLOCATION_ID" == "None" || -z "$ALLOCATION_ID" ]]; then
  echo "Allocating Elastic IP..."
  ALLOCATION_ID=$(aws_cmd ec2 allocate-address \
    --domain vpc \
    --query AllocationId --output text)

  aws_cmd ec2 create-tags \
    --resources "$ALLOCATION_ID" \
    --tags "Key=Name,Value=${INSTANCE_NAME}"

  echo "  ✓ Elastic IP allocated: $ALLOCATION_ID"
else
  echo "  ✓ Reusing existing Elastic IP: $ALLOCATION_ID"
fi

ELASTIC_IP=$(aws_cmd ec2 describe-addresses \
  --allocation-ids "$ALLOCATION_ID" \
  --query "Addresses[0].PublicIp" --output text)
echo "  ✓ Elastic IP address: $ELASTIC_IP"

# ── Terminate existing instance if recreating ─────────────────────────────────
if $RECREATE; then
  OLD_INSTANCE=$(aws_cmd ec2 describe-instances \
    --filters \
      "Name=tag:Name,Values=${INSTANCE_NAME}" \
      "Name=instance-state-name,Values=running,stopped,pending" \
    --query "Reservations[0].Instances[0].InstanceId" --output text)

  if [[ "$OLD_INSTANCE" != "None" && -n "$OLD_INSTANCE" ]]; then
    echo "Terminating old instance $OLD_INSTANCE..."
    aws_cmd ec2 terminate-instances --instance-ids "$OLD_INSTANCE"
    aws_cmd ec2 wait instance-terminated --instance-ids "$OLD_INSTANCE"
    echo "  ✓ Terminated"
  fi
fi

# ── IAM role for SSM access ───────────────────────────────────────────────────
ROLE_NAME="${INSTANCE_NAME}-role"
PROFILE_NAME="${INSTANCE_NAME}-profile"

if ! aws_cmd iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  echo "Creating IAM role ${ROLE_NAME}..."
  aws_cmd iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "ec2.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }'

  aws_cmd iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "ssm-read-campaign-forge" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [\"ssm:GetParameter\", \"ssm:GetParameters\", \"ssm:GetParametersByPath\"],
        \"Resource\": \"arn:aws:ssm:${REGION}:*:parameter${SSM_PREFIX}/*\"
      }]
    }"

  aws_cmd iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "cloudwatch-logs-campaign-forge" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{
        \"Effect\": \"Allow\",
        \"Action\": [
          \"logs:CreateLogGroup\",
          \"logs:CreateLogStream\",
          \"logs:PutLogEvents\",
          \"logs:DescribeLogStreams\"
        ],
        \"Resource\": \"arn:aws:logs:${REGION}:*:log-group:/campaign-forge/*\"
      }]
    }"

  aws_cmd iam create-instance-profile --instance-profile-name "$PROFILE_NAME"
  aws_cmd iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" \
    --role-name "$ROLE_NAME"

  echo "  Waiting for IAM propagation..."
  sleep 10
  echo "  ✓ IAM role ready"
else
  echo "  ✓ IAM role already exists"
fi

# ── Key pair ──────────────────────────────────────────────────────────────────
if [[ ! -f "$KEY_FILE" ]]; then
  echo "Creating key pair ${KEY_NAME}..."
  # Delete from AWS if it exists (stale)
  aws_cmd ec2 delete-key-pair --key-name "$KEY_NAME" &>/dev/null || true
  aws_cmd ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --query KeyMaterial --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "  ✓ Key saved to $KEY_FILE"
else
  echo "  ✓ Key already exists at $KEY_FILE"
fi

# ── Security group ────────────────────────────────────────────────────────────
SG_ID=$(aws_cmd ec2 describe-security-groups \
  --filters "Name=group-name,Values=${INSTANCE_NAME}-sg" \
  --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || echo "None")

if [[ "$SG_ID" == "None" || -z "$SG_ID" ]]; then
  echo "Creating security group..."
  SG_ID=$(aws_cmd ec2 create-security-group \
    --group-name "${INSTANCE_NAME}-sg" \
    --description "Campaign Forge backend" \
    --query GroupId --output text)

  for port in 22 80 443; do
    aws_cmd ec2 authorize-security-group-ingress \
      --group-id "$SG_ID" \
      --protocol tcp --port "$port" --cidr 0.0.0.0/0
  done
  echo "  ✓ Security group: $SG_ID"
else
  echo "  ✓ Security group already exists: $SG_ID"
fi

# ── User data (bootstrap script) ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_DATA_FILE="${SCRIPT_DIR}/ec2-bootstrap.sh"

if [[ ! -f "$USER_DATA_FILE" ]]; then
  echo "ERROR: $USER_DATA_FILE not found"
  exit 1
fi

# ── Launch EC2 ────────────────────────────────────────────────────────────────
AMI_ID=$(get_latest_ami)
echo "Launching EC2 instance (AMI: $AMI_ID, Type: $INSTANCE_TYPE)..."

INSTANCE_ID=$(aws_cmd ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --iam-instance-profile "Name=${PROFILE_NAME}" \
  --user-data "file://${USER_DATA_FILE}" \
  --monitoring Enabled=false \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}}]" \
  --query "Instances[0].InstanceId" --output text)

echo "  Instance ID: $INSTANCE_ID"
echo "  Waiting for instance to start..."
aws_cmd ec2 wait instance-running --instance-ids "$INSTANCE_ID"
echo "  ✓ Instance running"

# ── Associate Elastic IP ──────────────────────────────────────────────────────
echo "Associating Elastic IP..."
aws_cmd ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOCATION_ID"
echo "  ✓ Associated"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "✅ EC2 instance ready"
echo "======================================================"
echo "Instance ID : $INSTANCE_ID"
echo "Elastic IP  : $ELASTIC_IP"
echo "SSH         : ssh -i $KEY_FILE ec2-user@$ELASTIC_IP"
echo ""
echo "The bootstrap script is running in the background."
echo "It takes ~5 minutes to complete. You can watch it with:"
echo "  ssh -i $KEY_FILE ec2-user@$ELASTIC_IP"
echo "  sudo tail -f /var/log/cloud-init-output.log"
echo ""
echo "Next steps:"
echo "  1. Add EC2_HOST=$ELASTIC_IP as a GitHub Secret"
echo "  2. Copy the private key contents as EC2_SSH_KEY GitHub Secret:"
echo "     cat $KEY_FILE"
echo "  3. api.moniquepirson.be → $ELASTIC_IP already set in Route 53"
echo "======================================================"
