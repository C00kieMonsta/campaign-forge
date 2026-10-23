#!/usr/bin/env bash
set -euo pipefail

# Run as root on Amazon Linux. Application deploys must also patch existing hosts.
is_patched() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    process.exit(major === 24 && (minor > 22 || (minor === 22 && patch >= 1)) ? 0 : 1);
  '
}

if ! is_patched; then
  setup_script=$(mktemp)
  trap 'rm -f "$setup_script"' EXIT
  curl --fail --silent --show-error --location --connect-timeout 10 --max-time 120 \
    https://rpm.nodesource.com/setup_24.x -o "$setup_script"
  bash "$setup_script"
  dnf install -y nodejs
fi

if ! is_patched; then
  echo "Node.js 24.22.1 or a newer Node.js 24 security release is required" >&2
  exit 1
fi
node --version
