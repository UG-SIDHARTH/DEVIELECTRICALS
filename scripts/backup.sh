#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/devi"
STATUS_DIR="${BACKUP_DIR}/status"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_DUMP="/tmp/devi_${TIMESTAMP}.dump"
DEST_FILE="${BACKUP_DIR}/devi_${TIMESTAMP}.dump.age"
STATUS_FILE="${STATUS_DIR}/status.json"

mkdir -p "${BACKUP_DIR}" "${STATUS_DIR}"

RECIPIENT_FILE="${AGE_RECIPIENTS_FILE:-/run/secrets/age_public_key}"
RCLONE_CONF="${RCLONE_CONFIG_FILE:-/run/secrets/rclone_conf}"

echo "=== Devi Electrical: Database Backup Routine Started (${TIMESTAMP}) ==="

# 1. Take PostgreSQL dump as devi_backup role
echo "Dumping PostgreSQL database '${PGDATABASE}'..."
export PGPASSWORD=$(cat "${PGPASSWORD_FILE}")
pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -Fc -f "${TEMP_DUMP}"

# 2. Verify archive structure before encryption
echo "Verifying archive integrity with pg_restore --list..."
if ! pg_restore --list "${TEMP_DUMP}" > /dev/null; then
  echo "CRITICAL: Backup archive verification failed! Dump file is corrupted."
  rm -f "${TEMP_DUMP}"
  cat > "${STATUS_FILE}" <<EOF
{
  "lastBackupTime": "$(date -Iseconds)",
  "status": "failed",
  "error": "Archive verification failed"
}
EOF
  exit 1
fi
echo "✓ Archive verification passed."

# 3. Encrypt with Age public key
if [[ ! -s "${RECIPIENT_FILE}" ]]; then
  echo "ERROR: Age public key file missing or empty at ${RECIPIENT_FILE}. Cannot encrypt backup."
  rm -f "${TEMP_DUMP}"
  exit 1
fi

echo "Encrypting backup archive with age..."
age -R "${RECIPIENT_FILE}" -o "${DEST_FILE}" "${TEMP_DUMP}"
rm -f "${TEMP_DUMP}"

# 4. Generate SHA256 checksum
CHECKSUM=$(sha256sum "${DEST_FILE}" | awk '{print $1}')
echo "${CHECKSUM}  $(basename "${DEST_FILE}")" > "${DEST_FILE}.sha256"
FILE_SIZE=$(stat -c%s "${DEST_FILE}")
echo "✓ Encrypted backup created: $(basename "${DEST_FILE}") (${FILE_SIZE} bytes)."

# 5. Run backup pruning
if [[ -f "/scripts/prune-backups.sh" ]]; then
  /scripts/prune-backups.sh "${BACKUP_DIR}"
elif [[ -f "$(dirname "$0")/prune-backups.sh" ]]; then
  "$(dirname "$0")/prune-backups.sh" "${BACKUP_DIR}"
fi

# 6. Off-machine copy via rclone
OFF_MACHINE_STATUS="skipped"
LAST_OFF_MACHINE=""

if [[ -s "${RCLONE_CONF}" ]]; then
  echo "Syncing backup off-machine via rclone..."
  if rclone --config "${RCLONE_CONF}" copy "${DEST_FILE}" remote:devi-backups/ && \
     rclone --config "${RCLONE_CONF}" copy "${DEST_FILE}.sha256" remote:devi-backups/; then
    echo "✓ Off-machine backup sync completed."
    OFF_MACHINE_STATUS="success"
    LAST_OFF_MACHINE="$(date -Iseconds)"
  else
    echo "WARNING: Off-machine backup sync failed."
    OFF_MACHINE_STATUS="failed"
  fi
else
  echo "Notice: rclone configuration not found or empty. Off-machine sync skipped."
fi

# 7. Write status.json for owner System Status dashboard
cat > "${STATUS_FILE}" <<EOF
{
  "lastBackupTime": "$(date -Iseconds)",
  "lastBackupFile": "$(basename "${DEST_FILE}")",
  "archiveSizeBytes": ${FILE_SIZE},
  "sha256": "${CHECKSUM}",
  "status": "ok",
  "offMachineSync": "${OFF_MACHINE_STATUS}",
  "lastOffMachineCopyTime": ${LAST_OFF_MACHINE:+"\"$LAST_OFF_MACHINE\""}
}
EOF

echo "=== Backup routine completed successfully ==="
