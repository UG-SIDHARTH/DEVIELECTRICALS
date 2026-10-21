#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <path_to_age_private_key> <path_to_backup.dump.age>"
  echo "Example: $0 ~/.keys/devi_owner.key /var/backups/devi/devi_20261021_020000.dump.age"
  exit 1
fi

KEY_FILE="$1"
ARCHIVE_FILE="$2"

if [[ ! -f "${KEY_FILE}" ]]; then
  echo "Error: Private key file not found at ${KEY_FILE}"
  exit 1
fi

if [[ ! -f "${ARCHIVE_FILE}" ]]; then
  echo "Error: Backup archive file not found at ${ARCHIVE_FILE}"
  exit 1
fi

# Verify SHA256 if .sha256 file exists alongside
if [[ -f "${ARCHIVE_FILE}.sha256" ]]; then
  echo "Verifying SHA256 checksum..."
  EXPECTED=$(awk '{print $1}' "${ARCHIVE_FILE}.sha256")
  ACTUAL=$(sha256sum "${ARCHIVE_FILE}" | awk '{print $1}')
  if [[ "${EXPECTED}" != "${ACTUAL}" ]]; then
    echo "CRITICAL: Checksum verification mismatch! File may be damaged."
    exit 1
  fi
  echo "✓ Checksum verified successfully."
fi

echo "=== Devi Electrical: Disaster Recovery Restoration Routine ==="
echo "WARNING: This will restore database contents from ${ARCHIVE_FILE}."
read -p "Are you sure you wish to proceed? (Type 'RESTORE' to confirm): " CONFIRM
if [[ "${CONFIRM}" != "RESTORE" ]]; then
  echo "Restoration aborted."
  exit 0
fi

TEMP_RESTORE_DUMP="/tmp/restore_temp_$$.dump"

echo "Decrypting archive with age private key..."
age -d -i "${KEY_FILE}" -o "${TEMP_RESTORE_DUMP}" "${ARCHIVE_FILE}"

echo "Restoring database into '${PGDATABASE:-devi}' using pg_restore..."
export PGPASSWORD=$(cat "${PGPASSWORD_FILE:-/run/secrets/db_admin_password}")

# Restore cleanly with --clean --if-exists
pg_restore -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-devi_admin}" -d "${PGDATABASE:-devi}" --clean --if-exists "${TEMP_RESTORE_DUMP}"

rm -f "${TEMP_RESTORE_DUMP}"

echo ""
echo "✓ Database restored successfully."
echo "CRITICAL REMINDER: Customer and settings sensitive columns are encrypted at the field level."
echo "Ensure that the secrets/data_keys and secrets/blind_index_key match the keys in place when the backup was taken."
