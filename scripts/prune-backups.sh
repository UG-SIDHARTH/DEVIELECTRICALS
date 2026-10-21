#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-/var/backups/devi}"

if [[ ! -d "${BACKUP_DIR}" ]]; then
  exit 0
fi

echo "Pruning older backups in ${BACKUP_DIR}..."

# Find all backup files sorted newest first
mapfile -t FILES < <(find "${BACKUP_DIR}" -maxdepth 1 -name "devi_*.dump.age" -printf "%T@ %p\n" | sort -nr | awk '{print $2}')

TOTAL=${#FILES[@]}
if [[ "${TOTAL}" -le 14 ]]; then
  echo "Total backups (${TOTAL}) within retention budget (14). No pruning needed."
  exit 0
fi

# Keep first 14 daily backups unconditionally
KEEP_SET=()
for ((i=0; i<14 && i<TOTAL; i++)); do
  KEEP_SET+=("${FILES[i]}")
done

# Collect weekly snapshots (one per calendar week for 8 weeks)
declare -A WEEKS_SEEN
for FILE in "${FILES[@]}"; do
  WEEK_TAG=$(date -r "${FILE}" +"%Y-W%V")
  if [[ -z "${WEEKS_SEEN[$WEEK_TAG]:-}" && ${#WEEKS_SEEN[@]} -lt 8 ]]; then
    WEEKS_SEEN[$WEEK_TAG]="${FILE}"
    KEEP_SET+=("${FILE}")
  fi
done

# Collect monthly snapshots (one per month for 6 months)
declare -A MONTHS_SEEN
for FILE in "${FILES[@]}"; do
  MONTH_TAG=$(date -r "${FILE}" +"%Y-%m")
  if [[ -z "${MONTHS_SEEN[$MONTH_TAG]:-}" && ${#MONTHS_SEEN[@]} -lt 6 ]]; then
    MONTHS_SEEN[$MONTH_TAG]="${FILE}"
    KEEP_SET+=("${FILE}")
  fi
done

# Convert keep list to lookup table
declare -A KEEP_LOOKUP
for K in "${KEEP_SET[@]}"; do
  KEEP_LOOKUP["${K}"]=1
done

# Prune files not in keep table
for FILE in "${FILES[@]}"; do
  if [[ -z "${KEEP_LOOKUP[$FILE]:-}" ]]; then
    echo "Pruning expired backup: $(basename "${FILE}")"
    rm -f "${FILE}" "${FILE}.sha256"
  fi
done

echo "Backup pruning finished."
