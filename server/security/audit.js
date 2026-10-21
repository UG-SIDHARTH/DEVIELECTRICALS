import db from '../db/pool.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'totp_secret',
  'totp_secret_enc',
  'session_hash',
  'csrf_hash',
  'token',
  'secret',
  'key',
  'authorization',
  'cookie',
  'phone_enc',
  'email_enc',
  'gstin_enc',
  'address_enc',
  'bank_account_enc',
  'upi_id_enc',
  'image_enc'
]);

function sanitizeDiffObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeDiffObject);

  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase()) || key.endsWith('_enc') || key.endsWith('_hash')) {
      clean[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      clean[key] = sanitizeDiffObject(val);
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Records an immutable event in the append-only audit_log table.
 */
export async function logAuditEvent({
  userId = null,
  username = null,
  action,
  entity,
  entityId = null,
  clientIp,
  diff = null
}) {
  try {
    const cleanDiff = diff ? sanitizeDiffObject(diff) : null;

    await db.query(
      `INSERT INTO audit_log (user_id, username, action, entity, entity_id, client_ip, diff, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        userId,
        username,
        action,
        entity,
        entityId ? String(entityId) : null,
        clientIp || '127.0.0.1',
        cleanDiff ? JSON.stringify(cleanDiff) : null
      ]
    );
  } catch (err) {
    // Non-blocking catch to ensure core transactions don't fail, but log to stderr
    console.error('Audit log insertion failed:', err.message);
  }
}

export default {
  logAuditEvent
};
