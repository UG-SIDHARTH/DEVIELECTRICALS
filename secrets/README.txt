SECRETS DIRECTORY INSTRUCTIONS
==============================

This directory holds sensitive cryptographic keys, passwords, and tokens required by the Devi Electrical stack.
Files here are strictly ignored by git and must NEVER be committed to version control.

Files generated automatically by `scripts/generate-secrets.sh`:
1. db_admin_password - Password for PostgreSQL devi_admin user.
2. db_app_password   - Password for PostgreSQL devi_app user.
3. db_backup_password- Password for PostgreSQL devi_backup user.
4. data_keys          - JSON object containing versioned AES-256-GCM data encryption keys.
5. blind_index_key    - 32-byte secret for HMAC-SHA256 blind indexing of phone and GSTIN.
6. password_pepper    - Cryptographic pepper mixed into Argon2id password hashes.

Files to provide manually:
1. cloudflared.env   - Contains TUNNEL_TOKEN=<your-token> from Cloudflare Zero Trust.
2. age_public_key    - Public age key (age1...) generated on owner machine for encrypting backups.
3. rclone.conf       - rclone configuration for off-machine backup sync (e.g., Cloudflare R2 / SFTP).
4. ai_api_key        - (Optional) API key for cloud vision material list parsing.

Host file (.env in project root):
PUBLIC_ORIGIN=<scheme>://<host>
(Ensure no trailing slash).

File Permissions:
Ensure these files have permissions 0440, owner root, group 1000 so the unprivileged container user can read them.
Run `bash scripts/generate-secrets.sh` to generate default cryptographically secure files.
