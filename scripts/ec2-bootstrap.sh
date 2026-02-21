#!/usr/bin/env bash
# EC2 User Data — runs once on first boot as root.
# Pulls secrets from SSM, installs deps, clones repo, starts the API.

set -euo pipefail

REGION="eu-north-1"
SSM_PREFIX="/campaign-forge/production"
REPO_URL_BASE="github.com/C00kieMonsta/campaign-forge.git"
APP_DIR="/home/ec2-user/campaign-forge"
APP_USER="ec2-user"
API_NAME="campaign-forge-api"
DOMAIN="api.moniquepirson.be"    # change if your subdomain differs
ADMIN_EMAIL="monpirson@gmail.com"

log() { echo "[bootstrap] $*"; }

# ── Helpers ───────────────────────────────────────────────────────────────────
ssm_get() {
  aws ssm get-parameter \
    --region "$REGION" \
    --name "${SSM_PREFIX}/$1" \
    --with-decryption \
    --query Parameter.Value \
    --output text
}

# ── System packages ───────────────────────────────────────────────────────────
log "Installing system packages..."
dnf update -y
dnf install -y git nginx

# ── Node.js 20 via NodeSource ─────────────────────────────────────────────────
log "Installing Node.js 20..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

# ── pnpm ─────────────────────────────────────────────────────────────────────
log "Installing pnpm..."
npm install -g pnpm@latest

# ── PM2 ──────────────────────────────────────────────────────────────────────
log "Installing PM2..."
npm install -g pm2

# ── Pull secrets from SSM ────────────────────────────────────────────────────
log "Fetching secrets from SSM..."
AWS_ACCESS_KEY_ID=$(ssm_get "AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY=$(ssm_get "AWS_SECRET_ACCESS_KEY")
CONTACTS_TABLE=$(ssm_get "CONTACTS_TABLE")
CAMPAIGNS_TABLE=$(ssm_get "CAMPAIGNS_TABLE")
GROUPS_TABLE=$(ssm_get "GROUPS_TABLE")
SES_FROM_EMAIL=$(ssm_get "SES_FROM_EMAIL")
UNSUBSCRIBE_SECRET=$(ssm_get "UNSUBSCRIBE_SECRET")
PUBLIC_BASE_URL=$(ssm_get "PUBLIC_BASE_URL")
ADMIN_CREDENTIALS=$(ssm_get "ADMIN_CREDENTIALS")
JWT_SECRET=$(ssm_get "JWT_SECRET")

# ── Clone repo ────────────────────────────────────────────────────────────────
log "Cloning repository..."
sudo -u "$APP_USER" git clone \
  "https://${REPO_URL_BASE}" \
  "$APP_DIR"

# ── Write .env ────────────────────────────────────────────────────────────────
log "Writing .env..."
cat > "${APP_DIR}/apps/backend/.env" <<EOF
NODE_ENV=production
PORT=3001
AWS_REGION=${REGION}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
CONTACTS_TABLE=${CONTACTS_TABLE}
CAMPAIGNS_TABLE=${CAMPAIGNS_TABLE}
GROUPS_TABLE=${GROUPS_TABLE}
SES_FROM_EMAIL=${SES_FROM_EMAIL}
SES_REGION=${REGION}
UNSUBSCRIBE_SECRET=${UNSUBSCRIBE_SECRET}
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
ADMIN_CREDENTIALS=${ADMIN_CREDENTIALS}
JWT_SECRET=${JWT_SECRET}
EOF
chown "$APP_USER:$APP_USER" "${APP_DIR}/apps/backend/.env"
chmod 600 "${APP_DIR}/apps/backend/.env"

# ── Build ─────────────────────────────────────────────────────────────────────
log "Installing dependencies and building..."
cd "$APP_DIR"
sudo -u "$APP_USER" pnpm install --frozen-lockfile
sudo -u "$APP_USER" pnpm build:packages
sudo -u "$APP_USER" pnpm build:backend

# ── PM2 start + save ─────────────────────────────────────────────────────────
log "Starting API with PM2..."
sudo -u "$APP_USER" pm2 start "${APP_DIR}/apps/backend/dist/main.js" \
  --name "$API_NAME" \
  --cwd "${APP_DIR}/apps/backend" \
  --env production

sudo -u "$APP_USER" pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
  -u "$APP_USER" --hp "/home/$APP_USER"

# ── Nginx config ──────────────────────────────────────────────────────────────
log "Configuring Nginx..."
NGINX_DOMAIN="${DOMAIN}"
cat > /etc/nginx/conf.d/campaign-forge.conf <<'NGINX_EOF'
server {
    listen 80;
    server_name NGINX_DOMAIN_PLACEHOLDER;

    # Campaign send can take several minutes for large contact lists
    location ~ ^/api/admin/campaigns/[^/]+/send$ {
        proxy_pass             http://localhost:3001;
        proxy_http_version     1.1;
        proxy_set_header       Host $host;
        proxy_set_header       X-Real-IP $remote_addr;
        proxy_set_header       X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header       X-Forwarded-Proto $scheme;
        proxy_read_timeout     600s;
        proxy_send_timeout     600s;
        client_max_body_size   1m;
    }

    location / {
        proxy_pass         http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 10m;
    }
}
NGINX_EOF
sed -i "s/NGINX_DOMAIN_PLACEHOLDER/${NGINX_DOMAIN}/" /etc/nginx/conf.d/campaign-forge.conf

systemctl enable nginx
systemctl start nginx

# ── Certbot / Let's Encrypt ───────────────────────────────────────────────────
log "Installing Certbot..."
dnf install -y python3-certbot-nginx

log "Requesting TLS certificate for ${DOMAIN}..."
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --email "$ADMIN_EMAIL" \
  --domains "$DOMAIN" \
  --redirect

systemctl reload nginx

# ── CloudWatch agent ──────────────────────────────────────────────────────────
log "Installing CloudWatch agent..."
dnf install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/home/ec2-user/.pm2/logs/campaign-forge-api-out.log",
            "log_group_name": "/campaign-forge/api",
            "log_stream_name": "pm2-out",
            "timezone": "UTC"
          },
          {
            "file_path": "/home/ec2-user/.pm2/logs/campaign-forge-api-error.log",
            "log_group_name": "/campaign-forge/api",
            "log_stream_name": "pm2-error",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/nginx/access.log",
            "log_group_name": "/campaign-forge/nginx",
            "log_stream_name": "access",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/nginx/error.log",
            "log_group_name": "/campaign-forge/nginx",
            "log_stream_name": "error",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/cloud-init-output.log",
            "log_group_name": "/campaign-forge/bootstrap",
            "log_stream_name": "cloud-init",
            "timezone": "UTC"
          }
        ]
      }
    }
  }
}
EOF

systemctl enable amazon-cloudwatch-agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

log "✅ Bootstrap complete — API is live at https://${DOMAIN}"
log "Logs available in CloudWatch under /campaign-forge/"
