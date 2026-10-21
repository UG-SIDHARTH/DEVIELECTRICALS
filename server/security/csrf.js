import crypto from 'node:crypto';
import config from '../config.js';
import db from '../db/pool.js';
import { timingSafeEqualString } from './crypto.js';

export function verifyCsrf(req, res, next) {
  // Safe HTTP methods do not change state
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 1. Strict Origin Header Verification
  const origin = req.headers['origin'];
  if (!origin) {
    return res.status(403).json({ error: 'Forbidden: Missing Origin header' });
  }

  if (origin !== config.publicOrigin) {
    return res.status(403).json({ error: 'Forbidden: Cross-origin request rejected' });
  }

  // 2. CSRF Token Verification
  // Exclude login endpoint which operates prior to session creation
  if (req.path === '/api/auth/login') {
    return next();
  }

  const clientToken = req.headers['x-csrf-token'];
  if (!clientToken || typeof clientToken !== 'string') {
    return res.status(403).json({ error: 'Forbidden: Missing or invalid CSRF token' });
  }

  if (!req.session || !req.session.csrfHash) {
    return res.status(403).json({ error: 'Forbidden: No active session for CSRF validation' });
  }

  const clientHash = crypto.createHash('sha256').update(clientToken).digest('hex');

  if (!timingSafeEqualString(clientHash, req.session.csrfHash)) {
    return res.status(403).json({ error: 'Forbidden: CSRF token mismatch' });
  }

  next();
}

/**
 * Regenerates the CSRF token for an existing session row.
 */
export async function rotateCsrfToken(sessionId) {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const csrfHash = crypto.createHash('sha256').update(csrfToken).digest('hex');

  await db.query('UPDATE sessions SET csrf_hash = $1 WHERE id = $2', [csrfHash, sessionId]);

  return csrfToken;
}

export default {
  verifyCsrf,
  rotateCsrfToken
};
