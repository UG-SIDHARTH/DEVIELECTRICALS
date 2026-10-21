import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const secretsDir = path.join(projectRoot, 'secrets');

if (!fs.existsSync(secretsDir)) {
  fs.mkdirSync(secretsDir, { recursive: true });
}

function writeSecretIfMissing(filename, content, desc) {
  const targetPath = path.join(secretsDir, filename);
  if (!fs.existsSync(targetPath) || fs.readFileSync(targetPath, 'utf8').trim() === '') {
    fs.writeFileSync(targetPath, content, { mode: 0o644 });
    console.log(`✓ Created ${filename} (${desc})`);
    return true;
  }
  return false;
}

console.log('=== Devi Electrical: Secret Initialization for Localhost / Production ===');

// 1. db passwords (min 12 chars)
writeSecretIfMissing('db_admin_password', crypto.randomBytes(18).toString('hex'), 'Database Admin Password');
writeSecretIfMissing('db_app_password', crypto.randomBytes(18).toString('hex'), 'Database Application Password');
writeSecretIfMissing('db_backup_password', crypto.randomBytes(18).toString('hex'), 'Database Backup Password');

// 2. data_keys (AES-256-GCM 32-byte key in JSON envelope)
const defaultDataKey = crypto.randomBytes(32).toString('base64');
const dataKeysJson = JSON.stringify({
  current_version: '1',
  keys: {
    '1': defaultDataKey
  }
}, null, 2);
writeSecretIfMissing('data_keys', dataKeysJson, 'Data Encryption Keys');

// 3. blind_index_key (HMAC-SHA256 32-byte key)
writeSecretIfMissing('blind_index_key', crypto.randomBytes(32).toString('base64'), 'Blind Index Key');

// 4. password_pepper (Argon2id pepper min 32 chars)
writeSecretIfMissing('password_pepper', crypto.randomBytes(32).toString('hex'), 'Password Pepper');

// 5. cloudflared.env (stub for optional Cloudflare Tunnel)
writeSecretIfMissing('cloudflared.env', '# Optional Cloudflare Tunnel token for remote access\n# TUNNEL_TOKEN=\n', 'Cloudflared Environment Stub');

// 6. optional stubs
writeSecretIfMissing('ai_api_key', '', 'Optional AI API Key');
writeSecretIfMissing('age_public_key', '# Optional age public key for encrypted backups\n', 'Optional Age Public Key');
writeSecretIfMissing('rclone.conf', '# Optional rclone config for remote off-site backups\n', 'Optional RClone Config');

// 7. Ensure .env exists with localhost defaults
const envPath = path.join(projectRoot, '.env');
if (!fs.existsSync(envPath)) {
  const defaultEnv = `# Devi Electrical - Localhost Environment Configuration
PUBLIC_ORIGIN=http://localhost:3164
MARKETING_PORT=3164
BILLING_PORT=3165
NODE_ENV=production
TZ=Asia/Kolkata
AI_PROVIDER=gemini
AI_MODEL=gemini-1.5-flash
`;
  fs.writeFileSync(envPath, defaultEnv, 'utf8');
  console.log('✓ Created .env file configured for http://localhost:3164 and port 3165');
}

console.log('Secret and environment initialization complete.\n');
