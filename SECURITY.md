# Devi Electrical Security Architecture & Incident Response Plan

This document details the security posture, cryptographic controls, threat boundaries, and emergency response procedures implemented for Devi Electrical (Kazhakkoottam, Thiruvananthapuram).

---

## 1. Threat Model & Security Boundaries

```
[ Customer / Staff Browser ]
          │ (TLS 1.3 via HTTPS)
          ▼
[ Cloudflare Global Anycast Edge ]  <-- DDoS mitigation, TLS termination, WAF
          │
          │ (Outbound QUIC Tunnel, zero open inbound host ports)
          ▼
[ cloudflared Container ] (172.28.0.10 on "edge" bridge)
          │
          │ (HTTP over Docker Bridge: 172.28.0.0/24)
          ▼
[ express-app Container ] (172.28.0.20 on "edge", 172.29.0.20 on "internal")
          │
          │ (PostgreSQL wire protocol: 172.29.0.0/24)
          ▼
[ postgres-db Container ] (172.29.0.10 on "internal" isolated network)
```

### Threat Boundaries:
1. **The Public Perimeter (Cloudflare Edge)**:
   - The host system runs UFW with a default policy dropping all inbound connections (`ufw default deny incoming`). No ports (including 80, 443, or 22) are exposed to the public internet.
   - Ingress occurs solely via an outbound Cloudflare Tunnel connection established by the `cloudflared` container.
2. **Reverse Proxy & Client IP Verification**:
   - The Express application runs behind `cloudflared`.
   - Client IP addresses are extracted from `CF-Connecting-IP` **strictly** when the immediate TCP peer matches `172.28.0.10` (the fixed IP of `cloudflared` on the `edge` Docker bridge).
   - Spoofed external proxy headers from any other peer are rejected.
3. **Compromised Host vs. Compromised Edge**:
   - *If the Cloudflare Tunnel token is compromised*: An attacker could reroute edge traffic, but cannot decrypt database backups or crack passwords without the host secrets.
   - *If the database file is exfiltrated (stolen disk or physical server theft)*: All customer PII (phone numbers, addresses, GSTINs, emails), 2FA secrets, and export files remain encrypted under AES-256-GCM. Passwords cannot be cracked without the out-of-database `PASSWORD_PEPPER`.

---

## 2. Field-Level Encryption & Row-Binding

Sensitive personal identifiable information (PII) and authentication secrets stored in PostgreSQL are encrypted at the application layer using AES-256-GCM prior to SQL insertion.

### Row-Bound Additional Authenticated Data (AAD)
To prevent ciphertext transplant attacks (where an attacker swaps ciphertexts between different rows or columns), every encrypted field binds a deterministic context string as AAD:

```
AAD Format: ${tableName}.${columnName}.${rowId}
```

If an attacker copies an encrypted customer phone number from row `cust-1` to `cust-2`, AES-256-GCM authentication verification fails with an authentication tag error and refuses decryption.

### Ciphertext Storage Format
All encrypted database columns store text strings structured as:
```
v{key_version}:{iv_base64}:{ciphertext_base64}:{authTag_base64}
```
- `key_version`: Identifier corresponding to an entry in `DATA_KEYS` (e.g., `1`).
- `iv_base64`: 96-bit cryptographically secure random IV generated per write.
- `ciphertext_base64`: AES-256-GCM encrypted payload.
- `authTag_base64`: 128-bit authentication tag validating integrity and AAD.

---

## 3. Blind Indexing Architecture

Because encrypted columns cannot be searched with SQL equality operators (`WHERE phone = ...`), deterministic HMAC-SHA256 blind indexes are generated using a dedicated 32-byte secret (`BLIND_INDEX_KEY`).

### Canonical Normalization
Before computing the HMAC, inputs are normalized to guarantee consistent matching:
- **Phone Numbers**: All formatting, punctuation, spaces, and country codes are removed; the trailing 10 digits are extracted (`09447220411` and `+91 94472 20411` produce identical blind indexes).
- **GSTIN**: Converted to uppercase with all whitespace stripped.
- **Email / Names**: Converted to lowercase and trimmed.

Blind indexes prevent frequency analysis attacks across different fields because the HMAC incorporates the field type prefix (e.g. `phone:9447220411`).

---

## 4. Unencrypted Columns & Operational Rationale

To maintain fast SQL reporting and sub-millisecond stock search without loading entire tables into memory, specific business fields remain unencrypted in plaintext:

| Table | Unencrypted Columns | Architectural Rationale |
|---|---|---|
| `products` | `sku`, `name`, `brand`, `category`, `spec`, `selling_price`, `current_stock` | Required for instant ILIKE multi-keyword search, barcode lookups, and inventory low-stock alerts. |
| `products` | `purchase_price` | Required for stock valuation calculations. Restricted by API middleware: never sent to non-owner staff sessions. |
| `documents` | `doc_number`, `doc_date`, `status`, `taxable_amount`, `grand_total` | Required for aggregate date-range queries, financial year tracking, and GSTR-1 tax slab grouping. |
| `document_lines` | `qty`, `rate`, `taxable_amount`, `cgst_amount`, `sgst_amount`, `purchase_price` | Required for aggregate invoice generation, line-item tax calculations, and profit analysis. |
| `customers` / `suppliers` | `name` | Required for bill customer search and autocomplete suggestions. |

---

## 5. Password Hashing & 2FA Architecture

### Argon2id with System Pepper
User passwords are treated with an HMAC-SHA256 pre-hash using `PASSWORD_PEPPER` before undergoing Argon2id hashing:
- **Variant**: `argon2id` (resistant to both GPU side-channel and tradeoff attacks).
- **Time Cost**: 3 iterations.
- **Memory Cost**: 65,536 KB (64 MB).
- **Parallelism**: 1 thread.
- **Concurrency Throttling**: The server enforces a concurrency bottleneck of at most 2 simultaneous Argon2id operations to prevent CPU starvation on low-power Intel Pentium processors.
- **Timing Defense**: Unknown usernames trigger an identical dummy Argon2id verification pass (`dummyVerify`), eliminating username enumeration via timing analysis.

### Two-Factor Authentication (TOTP)
- Implements RFC 6238 standard TOTP (6-digit, 30-second window, SHA-1).
- QR codes are generated server-side as pure SVG strings without third-party web services.
- TOTP secrets are encrypted in the database under `users.totp_secret_enc` using row-bound AES-256-GCM.
- 8 single-use recovery codes are hashed via SHA-256 and burned upon first use.

---

## 6. Session Security & CSRF Defense

### Session Cookies
- Cookie name: `__Host-devi_session` (enforces HTTPS only, root path, no subdomains).
- Flags: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`.
- Lifetime: 30-minute idle inactivity timeout, 12-hour absolute expiration.
- Tokens: 256-bit cryptographic random tokens stored as SHA-256 hashes in `sessions` table.

### CSRF Defense
1. **Origin Header Check**: Every state-changing HTTP request (`POST`, `PUT`, `DELETE`, `PATCH`) must contain an `Origin` header matching `PUBLIC_ORIGIN`. Requests with missing or mismatching origins are rejected with HTTP 403.
2. **Double-Submit Token**: Authenticated sessions generate a 32-byte cryptographic CSRF token. State-changing requests must include this token in the `x-csrf-token` header, verified via constant-time SHA-256 hash comparison against `sessions.csrf_hash`.

---

## 7. Append-Only Tamper-Evident Audit Logging

The `audit_log` table tracks all security-critical and financial operations:
- Authentication events (logins, failures, lockouts, 2FA setup).
- Stock modifications and manual adjustments.
- Invoices and cash bills created, printed, or cancelled.
- Expense entries, supplier payments, and customer receipts.
- Automatic redacting filter cleans passwords, secrets, recovery codes, and tokens before committing logs.

---

## 8. Cryptographic Key Rotation Protocol

When rotating data encryption keys:
1. Generate a new 32-byte random key encoded as base64.
2. Update the `DATA_KEYS` JSON file in `/opt/devi/secrets/data_keys.json` by adding the new key under version `2` and updating `current_version`:
   ```json
   {
     "current_version": "2",
     "keys": {
       "1": "<old-key-base64>",
       "2": "<new-key-base64>"
     }
   }
   ```
3. Execute the automated re-encryption script:
   ```bash
   cd /opt/devi
   docker compose exec app node scripts/rotate-keys.js
   ```
4. The script decrypts fields encrypted under older key versions and re-encrypts them using the `current_version` in batches of 100 within atomic transactions.
5. Once all rows report key version `2`, version `1` can be safely retired.

---

## 9. Emergency Incident Response Runbooks

### Runbook A: Compromised Cloudflare Tunnel Token
*Scenario: Tunnel token leaked in logs or compromised repository.*
1. Log in to the Cloudflare Zero Trust Dashboard.
2. Navigate to **Networks** -> **Tunnels**.
3. Delete the compromised tunnel.
4. Create a new tunnel, copy the new token.
5. On the Debian server, update `/opt/devi/secrets/tunnel_token.txt`:
   ```bash
   sudo nano /opt/devi/secrets/tunnel_token.txt
   sudo chmod 0440 /opt/devi/secrets/tunnel_token.txt
   sudo systemctl restart docker-compose@devi # or restart cloudflared container
   docker compose restart tunnel
   ```
6. Verify tunnel status in Cloudflare dashboard.

### Runbook B: Leaked Database Password
*Scenario: `db_password.txt` exposed.*
1. Generate a new password:
   ```bash
   NEW_PW=$(openssl rand -hex 24)
   ```
2. Log into PostgreSQL as `postgres` superuser and change the password:
   ```bash
   docker compose exec -it db psql -U postgres -c "ALTER USER devi_app WITH PASSWORD '$NEW_PW';"
   ```
3. Update `/opt/devi/secrets/db_password.txt`:
   ```bash
   echo -n "$NEW_PW" | sudo tee /opt/devi/secrets/db_password.txt > /dev/null
   sudo chmod 0440 /opt/devi/secrets/db_password.txt
   ```
4. Restart the app container:
   ```bash
   docker compose restart app migrate
   ```

### Runbook C: Leaked Age Backup Private Key
*Scenario: Private key used for offsite backup encryption is exposed.*
1. Generate a new Age keypair on the secure host:
   ```bash
   age-keygen -o /opt/devi/secrets/backup_age_new.key
   ```
2. Extract the new public key:
   ```bash
   NEW_PUB=$(age-keygen -y /opt/devi/secrets/backup_age_new.key)
   ```
3. Update `BACKUP_AGE_RECIPIENT` in `/opt/devi/.env` with `NEW_PUB`.
4. Move the new private key to an encrypted off-machine storage device. Remove it from the live server.
5. Trigger an immediate new full backup:
   ```bash
   sudo /opt/devi/scripts/backup.sh
   ```

### Runbook D: Compromised Staff Account
*Scenario: Staff password or phone stolen.*
1. Log into the Devi Electrical billing app as Owner.
2. Navigate to **Settings** -> **Staff Accounts**.
3. Click **Disable Account** on the affected user.
4. All active sessions for that user are immediately invalidated from the `sessions` table.
5. If the account had 2FA configured, reset the user credentials or assign a new temporary password.
