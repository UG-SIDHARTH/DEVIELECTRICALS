#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
SECRETS_DIR="${PROJECT_DIR}/secrets"

mkdir -p "${SECRETS_DIR}"

generate_random_hex() {
  local bytes="${1:-32}"
  openssl rand -hex "${bytes}"
}

generate_random_base64() {
  local bytes="${1:-32}"
  openssl rand -base64 "${bytes}" | tr -d '\n'
}

echo "=== Devi Electrical: Cryptographic Secret Generator ==="

# 1. db_admin_password
if [[ ! -f "${SECRETS_DIR}/db_admin_password" ]]; then
  echo "Generating db_admin_password..."
  generate_random_hex 24 > "${SECRETS_DIR}/db_admin_password"
else
  echo "db_admin_password already exists. Skipping."
fi

# 2. db_app_password
if [[ ! -f "${SECRETS_DIR}/db_app_password" ]]; then
  echo "Generating db_app_password..."
  generate_random_hex 24 > "${SECRETS_DIR}/db_app_password"
else
  echo "db_app_password already exists. Skipping."
fi

# 3. db_backup_password
if [[ ! -f "${SECRETS_DIR}/db_backup_password" ]]; then
  echo "Generating db_backup_password..."
  generate_random_hex 24 > "${SECRETS_DIR}/db_backup_password"
else
  echo "db_backup_password already exists. Skipping."
fi

# 4. data_keys (AES-256-GCM 32-byte key in JSON envelope)
if [[ ! -f "${SECRETS_DIR}/data_keys" ]]; then
  echo "Generating data_keys (v1)..."
  KEY_V1=$(generate_random_base64 32)
  cat > "${SECRETS_DIR}/data_keys" <<EOF
{
  "current_version": 1,
  "keys": {
    "1": "${KEY_V1}"
  }
}
EOF
else
  echo "data_keys already exists. Skipping."
fi

# 5. blind_index_key (HMAC-SHA256 32-byte key)
if [[ ! -f "${SECRETS_DIR}/blind_index_key" ]]; then
  echo "Generating blind_index_key..."
  generate_random_base64 32 > "${SECRETS_DIR}/blind_index_key"
else
  echo "blind_index_key already exists. Skipping."
fi

# 6. password_pepper (Argon2id pepper 32-byte key)
if [[ ! -f "${SECRETS_DIR}/password_pepper" ]]; then
  echo "Generating password_pepper..."
  generate_random_base64 32 > "${SECRETS_DIR}/password_pepper"
else
  echo "password_pepper already exists. Skipping."
fi

# 7. Create empty stubs for optional/externally provided secrets if missing
for opt_file in ai_api_key age_public_key rclone.conf cloudflared.env; do
  if [[ ! -f "${SECRETS_DIR}/${opt_file}" ]]; then
    touch "${SECRETS_DIR}/${opt_file}"
  fi
done

# Set permissions:
# In Docker Compose, bind mounted secret files retain host permissions.
# The app container runs as user 'node' (uid 1000). To protect against local unauthorized reads
# while allowing uid 1000 to read them: owner root, group 1000, mode 440.
if [[ "$(id -u)" -eq 0 ]]; then
  echo "Setting file permissions to 0440 (owner root, group 1000)..."
  chown -R root:1000 "${SECRETS_DIR}"
  chmod 750 "${SECRETS_DIR}"
  find "${SECRETS_DIR}" -type f -exec chmod 440 {} +
else
  echo "Notice: Non-root user detected. Setting chmod 600 on secret files."
  chmod 700 "${SECRETS_DIR}"
  find "${SECRETS_DIR}" -type f -exec chmod 600 {} +
fi

echo ""
echo "=== SECRETS INITIALIZATION COMPLETE ==="
echo "IMPORTANT SECURITY INSTRUCTIONS:"
echo "1. BACK UP YOUR SECRETS NOW: Copy the contents of ./secrets/ to an offline password manager"
echo "   and a printed emergency envelope in a physical safe."
echo "   If data_keys or blind_index_key are lost, encrypted database columns CANNOT be recovered!"
echo "2. Provide TUNNEL_TOKEN in secrets/cloudflared.env (from Cloudflare Zero Trust dashboard)."
echo "3. Generate an age keypair on your trusted personal machine (age-keygen -o devi.key),"
echo "   and place ONLY the public key into secrets/age_public_key."
echo "4. Configure secrets/rclone.conf for off-site backup storage (e.g. Cloudflare R2)."
echo "5. Create your host .env file with PUBLIC_ORIGIN=<your_https_origin> (no trailing slash)."
