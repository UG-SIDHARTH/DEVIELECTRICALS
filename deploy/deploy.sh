#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

cd "${PROJECT_DIR}"

echo "=========================================================="
echo " Devi Electrical: Production Deployment Script            "
echo "=========================================================="

# 1. Verify required environment variables
if [[ ! -f ".env" ]]; then
  echo "FATAL: Root .env file missing. Create .env with PUBLIC_ORIGIN=<your_https_origin>."
  exit 1
fi

source .env
if [[ -z "${PUBLIC_ORIGIN:-}" ]]; then
  echo "FATAL: PUBLIC_ORIGIN not set in .env."
  exit 1
fi

# 2. Pre-deploy backup before executing migrations
echo "Taking pre-deployment database backup..."
docker compose --profile tools run --rm backup || {
  echo "WARNING: Pre-deploy backup failed! Halting deployment."
  exit 1
}

# 3. Retag existing active image as previous for rollback
if docker image inspect devi-app:latest > /dev/null 2>&1; then
  echo "Tagging current image as devi-app:previous..."
  docker tag devi-app:latest devi-app:previous
fi

# 4. Pull updates if git repository
if [[ -d ".git" ]]; then
  echo "Checking for git updates..."
  git pull origin main || true
fi

# 5. Build Docker images
echo "Building Docker images (building native modules from source on host CPU)..."
docker compose build --build-arg PUBLIC_ORIGIN="${PUBLIC_ORIGIN}" app

# 6. Run database migrations as devi_admin
echo "Applying database migrations..."
docker compose --profile tools run --rm migrate

# 7. Start application and Cloudflare tunnel
echo "Restarting application container and Cloudflare tunnel..."
docker compose up -d app cloudflared

# 8. Health check verification
echo "Waiting for app healthcheck to pass..."
HEALTHY=0
for i in {1..30}; do
  if docker compose ps app | grep -q "healthy"; then
    HEALTHY=1
    break
  fi
  echo "Waiting for container healthcheck (${i}/30)..."
  sleep 2
done

if [[ "${HEALTHY}" -eq 1 ]]; then
  echo "=========================================================="
  echo "✓ Deployment successful! Devi Electrical stack is healthy."
  echo "=========================================================="
else
  echo "CRITICAL: Healthcheck failed! Attempting rollback to devi-app:previous..."
  if docker image inspect devi-app:previous > /dev/null 2>&1; then
    docker tag devi-app:previous devi-app:latest
    docker compose up -d app
    echo "Rollback to devi-app:previous completed. Check 'docker compose logs app' for crash logs."
  fi
  exit 1
fi
