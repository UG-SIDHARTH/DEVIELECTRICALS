# Devi Electrical - Production System & Operations Manual

Production-grade, secure management, billing, inventory, and public web system for **Devi Electrical**, Bypass Junction, Kazhakkoottam, Thiruvananthapuram, Kerala.

---

## 1. System Architecture Overview

```
                                [ Public Internet ]
                                         │
                                         │ (TLS 1.3 / HTTPS)
                                         ▼
                         [ Cloudflare Global Edge ]
                                         │
                                         │ (Outbound QUIC Tunnel - zero inbound ports)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Debian Host (Intel Pentium, 4 GB RAM, 500 GB HDD) - UFW Default Deny Incoming   │
│                                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │ Docker Network: edge (172.28.0.0/24)                                    │   │
│   │                                                                         │   │
│   │   [ cloudflared ] (172.28.0.10) ────► [ express-app ] (172.28.0.20)     │   │
│   │   (Fixed IP, tunnel client)          (Helmet CSP, Auth, Rate Limits)    │   │
│   └───────────────────────────────────────────────┬─────────────────────────┘   │
│                                                   │                             │
│   ┌───────────────────────────────────────────────┴─────────────────────────┐   │
│   │ Docker Network: backend (172.29.0.0/24, internal: true)                 │   │
│   │                                                                         │   │
│   │   [ express-app ] ──────────────────► [ postgres-db ] (172.29.0.10)     │   │
│   │   (Field Encryption AES-256-GCM)       (SCRAM-SHA-256, Audit Logs)      │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│   System Services:                                                              │
│   - smartmontools (Continuous SMART drive monitoring for single 500GB HDD)      │
│   - devi-backup.timer (Daily 02:00 AM Age-encrypted backup & rclone offsite)    │
│   - NUT (Network UPS Tools - Clean shutdown on power failure)                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **Part A (Public Marketing Website)**: Mobile-first landing site optimized for local discoverability in Kazhakkoottam, Technopark, Karyavattom, and Menamkulam. Built with vanilla CSS/JS, semantic schema.org markup, localized product listings, and instant WhatsApp / phone inquiry links.
- **Part B (Billing, Quotations & Inventory SPA)**: Fast single-page application at `/billing/` designed for counter staff and shop owner. Features fast product search, dual cash-bill/tax-invoice generation, GSTR-1 multi-slab tax grouping, Indian number-to-words conversion, and on-device / AI-assisted handwritten material scan parsing.
- **Part C (Hardened API & Cryptographic Database)**: Express ES module backend on Node.js 24 LTS. PostgreSQL 16 with row-bound AES-256-GCM field-level encryption (`${table}.${column}.${rowId}` context binding), HMAC-SHA256 blind indexing for phone and GSTIN lookups, Argon2id with server pepper, TOTP 2FA, and append-only tamper-evident audit logging.
- **Part D (Debian Host & Container Orchestration)**: Optimized for an older Intel Pentium system with 4 GB RAM and a single spinning 500 GB mechanical HDD. Exposed to the internet exclusively via an outbound Cloudflare Tunnel (no open inbound ports).

---

## 2. Production Deployment Runbook

Follow this ordered checklist precisely to deploy the system on the Debian host.

### Step 1: Hardware & Architecture Pre-flight Check
Log in to the Debian server via local console or local network SSH:

```bash
# Verify 64-bit x86 architecture
uname -m
# Expected: x86_64

# Inspect CPU flags and SSE support
grep -m1 '^flags' /proc/cpuinfo

# Check physical RAM
free -h
```

### Step 2: Run Host Hardening Script
Navigate to the deployment directory and execute the host installation script:

```bash
cd /srv/devi/deploy
sudo bash install-host.sh
```

This automated script configures:
1. System timezone to `Asia/Kolkata` and time synchronization via `chrony`.
2. A 2 GB swapfile (`/swapfile`) with `vm.swappiness=10` to protect the 4 GB RAM ceiling.
3. Systemd journald log limits capped to 200 MB to prevent disk fill-up.
4. Official Docker CE and Compose plugin with `daemon.json` memory/log limits.
5. UFW firewall rules: **Default deny incoming**, allowing only LAN SSH.
6. `smartmontools` drive monitoring and `fail2ban`.

Verify the listening network sockets to confirm that **no public HTTP/HTTPS ports are listening**:

```bash
sudo ss -tlnp
```
*Expected: Only `sshd` on port 22 (or your custom SSH port). No ports 80, 443, or 5432 should be listening publicly.*

### Step 3: Cloudflare Zero Trust Tunnel Setup
1. Open the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/).
2. Navigate to **Networks** -> **Tunnels** -> **Create a Tunnel**.
3. Select **Cloudflared** as the connector type and name the tunnel (e.g., `devi-electrical-prod`).
4. Copy the generated **Tunnel Token** (a base64 string).
5. In the **Public Hostnames** tab of your tunnel in Cloudflare:
   - **Path / Subdomain**: Point your designated hostname (referenced as `PUBLIC_ORIGIN`) to:
     - **Service**: `HTTP`
     - **URL**: `172.28.0.20:3164` (or `app:3164` for public marketing; `app:3165` for staff billing)
   - **HTTP Settings**:
     - Enable **HTTP/2** and **HTTP/3 (QUIC)**.
     - Set **No TLS Verify** (since traffic within the local Docker bridge is plain HTTP).

### Step 4: Cryptographic Secret Generation & Environment Configuration
1. Initialize application secrets on the host:
   ```bash
   cd /srv/devi
   sudo bash scripts/generate-secrets.sh
   ```
   *This automatically creates AES-256-GCM data encryption keys, HMAC blind index keys, password pepper, and PostgreSQL passwords inside `/srv/devi/secrets/` with mode `0440` owned by `root:1000`.*

2. Store your Cloudflare Tunnel Token:
   ```bash
   sudo nano /srv/devi/secrets/cloudflared.env
   ```
   Add:
   ```env
   TUNNEL_TOKEN=<your_cloudflare_tunnel_token_here>
   ```

3. Configure your Age Public Key for offsite backup encryption:
   ```bash
   # On your personal trusted workstation (NOT on the server):
   age-keygen -o devi_backup_owner.key
   # Extract the public key (starts with age1...)
   age-keygen -y devi_backup_owner.key
   ```
   Place **ONLY** the public key string into `/srv/devi/secrets/age_public_key`:
   ```bash
   echo "age1yourpublickey..." | sudo tee /srv/devi/secrets/age_public_key
   ```
   *Keep `devi_backup_owner.key` safely in your personal password manager and on an encrypted USB drive.*

4. Configure your host `.env` file:
   ```bash
   sudo nano /srv/devi/.env
   ```
   Add the following variables (replacing `<PUBLIC_ORIGIN>` with your actual HTTPS origin without a trailing slash):
   ```env
   PUBLIC_ORIGIN=https://<your-custom-subdomain-or-domain>
   MARKETING_PORT=3164
   BILLING_PORT=3165
   NODE_ENV=production
   TZ=Asia/Kolkata
   AI_PROVIDER=gemini
   AI_MODEL=gemini-1.5-flash
   ```

5. (Optional) If using AI OCR handwriting extraction, add your API key:
   ```bash
   echo "your_gemini_api_key" | sudo tee /srv/devi/secrets/ai_api_key
   ```

### Step 5: Build Container Images & Run Database Migrations
1. Build the production Docker images:
   ```bash
   cd /srv/devi
   sudo docker compose build --no-cache
   ```

2. Start the database service:
   ```bash
   sudo docker compose up -d db
   ```
   *Wait 10 seconds for PostgreSQL healthcheck to report healthy.*

3. Execute idempotent database migrations:
   ```bash
   sudo docker compose run --rm migrate
   ```
   *This initializes the database schema, installs extensions, creates roles (`devi_app`, `devi_backup`), and provisions gapless invoice numbering series.*

4. Launch the application and tunnel services:
   ```bash
   sudo docker compose up -d app cloudflared
   ```

5. Verify service health:
   ```bash
   sudo docker compose ps
   sudo docker compose logs app
   ```

### Step 6: Create the Initial Store Owner Account
Run the interactive CLI account creator:

```bash
sudo docker compose run --rm cli node scripts/create-owner.js
```
- Enter the desired username (e.g., `owner`).
- Enter a strong passphrase (minimum 12 characters containing letters and numbers).
- The password will be hashed using Argon2id combined with the system pepper.

### Step 7: Log In & Configure Two-Factor Authentication (2FA)
1. Open your browser and navigate to `https://<PUBLIC_ORIGIN>/billing/`.
2. Enter your owner username and password.
3. Upon first login, navigate to **Settings** -> **Security & Two-Factor Authentication**.
4. Click **Enable 2FA**.
5. Scan the generated QR code using Google Authenticator, Aegis, or 1Password.
6. Enter the 6-digit confirmation code.
7. **CRITICAL**: Copy the 8 emergency one-time recovery codes displayed on screen and store them in a secure physical location.

### Step 8: Perform Initial Backup & Off-Machine Restore Drill
1. Enable the automated systemd backup timer on the Debian host:
   ```bash
   sudo cp /srv/devi/deploy/devi-backup.service /etc/systemd/system/
   sudo cp /srv/devi/deploy/devi-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now devi-backup.timer
   ```

2. Trigger a manual backup to test the full encryption pipeline:
   ```bash
   sudo bash /srv/devi/scripts/backup.sh
   ```
   - Verifies PostgreSQL dump creation using `devi_backup` role.
   - Verifies archive integrity with `pg_restore --list`.
   - Encrypts archive with `age` public key.
   - Generates SHA-256 checksum file.
   - Updates `/var/backups/devi/status/status.json`.

3. Test Restoration on a safe test instance:
   ```bash
   # Usage: restore.sh <path_to_age_private_key> <path_to_dump.age>
   sudo bash /srv/devi/scripts/restore.sh ~/.keys/devi_backup_owner.key /var/backups/devi/devi_<timestamp>.dump.age
   ```

---

## 3. Go-Live Verification Checklist

Before opening the store to customer traffic, verify each of the following points:

- [ ] **Public Site Functionality**:
  - Visit `https://<PUBLIC_ORIGIN>/`.
  - Confirm that the hero section, store address (Bypass Junction, Kazhakkoottam), and store hours display accurately.
  - Click the **WhatsApp Us** button on a mobile device and verify that the pre-filled enquiry text appears in WhatsApp.
  - Click the **Call Store** button and verify that the dialer opens `0471 241 8282` or `094472 20411`.
- [ ] **Security Headers & CSP Verification**:
  - Open browser DevTools Network tab.
  - Inspect response headers on `/`:
    - `content-security-policy` contains `default-src 'self'`.
    - `x-content-type-options: nosniff`.
    - `referrer-policy: strict-origin-when-cross-origin`.
    - `x-powered-by` is absent.
- [ ] **Billing SPA Verification**:
  - Visit `https://<PUBLIC_ORIGIN>/billing/`.
  - Confirm that unauthenticated access redirects cleanly to the login screen.
  - Log in with 2FA enabled.
  - Create a test Cash Bill and a test GST Invoice. Verify gapless numbering (`DE/26-27/0001`).
  - Click **Print A4 Invoice** and confirm that taxes (CGST 9% + SGST 9%) sum correctly to nearest rupee.
  - Cancel the test document to verify stock reversal and audit logging.
- [ ] **Material Scan OCR Verification**:
  - In Billing -> **Material Scan**, upload a sample handwritten electrician material list.
  - Confirm that lines are recognized, matched to inventory products with matching specs, and converted to draft bill lines.
- [ ] **Staff Permissions Verification**:
  - Create a test staff account in **Settings** -> **Staff Accounts**.
  - Log in as staff.
  - Verify that staff **cannot** see product purchase prices or access `/api/reports/profit` or system admin controls.

---

## 4. Routine Operations & Maintenance

### Daily Automated Backups
- The backup routine runs every morning at **02:00 AM IST** via `devi-backup.timer`.
- Retention policy automatically managed by `scripts/prune-backups.sh`:
  - 14 daily backups.
  - 8 weekly backups.
  - 6 monthly backups.
- Backups older than the retention schedule are automatically purged to prevent filling the 500 GB HDD.

### Hard Drive Health Monitoring (smartmontools)
The Debian server uses a single mechanical HDD. SMART health attributes are checked every 30 minutes:
```bash
# Check current drive health
sudo smartctl -H /dev/sda

# View detailed error log and temperature
sudo smartctl -a /dev/sda
```
If reallocated sectors or uncorrectable errors increase, replace the drive immediately and restore from the latest Age backup.

### Power Outage & UPS Management
Read `deploy/devi-power.md` for full instructions on configuring Network UPS Tools (NUT) to automatically trigger a clean shutdown when battery capacity drops below 15% during extended power cuts.

### Field-Level Encryption Key Rotation
When rotating data encryption keys, update `/srv/devi/secrets/data_keys` with the new key version and execute:
```bash
sudo docker compose exec app node scripts/rotate-keys.js
```
The script re-encrypts all database records in atomic batches without service downtime.
