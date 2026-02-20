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
ADMIN_EMAIL="antoineboxho@gmail.com"

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
  --env production

sudo -u "$APP_USER" pm2 save
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
  -u "$APP_USER" --hp "/home/$APP_USER"

# ── Nginx config ──────────────────────────────────────────────────────────────
log "Configuring Nginx..."
cat > /etc/nginx/conf.d/campaign-forge.conf <<'NGINX'
server {
    listen 80;
    server_name _;

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
NGINX

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

log "✅ Bootstrap complete — API is live at https://${DOMAIN}"
log "Next: Update GitHub Secrets with EC2_HOST and EC2_SSH_KEY"
log "Then: Configure Route53 / DNS to point to the Elastic IP"
