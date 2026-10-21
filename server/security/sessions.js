import crypto from 'node:crypto';
import db from '../db/pool.js';
import config from '../config.js';
export const COOKIE_NAME = (config.publicOrigin && config.publicOrigin.startsWith('https://')) ? '__Host-devi_session' : 'devi_session';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a new secure session and attaches cookie to response.
 */
export async function createSession(userId, clientIp, userAgent, res) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionHash = hashToken(sessionToken);
  const csrfToken = crypto.randomBytes(32).toString('hex');
  const csrfHash = hashToken(csrfToken);

  const expiresAt = new Date(Date.now() + IDLE_TIMEOUT_MS);

  await db.query(
    `INSERT INTO sessions (session_hash, user_id, csrf_hash, ip_address, user_agent, expires_at, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [sessionHash, userId, csrfHash, clientIp, userAgent || null, expiresAt]
  );

  const isSecure = config.publicOrigin.startsWith('https://');

  res.cookie(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: ABSOLUTE_TIMEOUT_MS
  });

  return { sessionToken, csrfToken };
}

/**
 * Validates the session cookie against the database, enforcing idle & absolute timeouts.
 */
export async function validateSession(token, clientIp) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const sessionHash = hashToken(token);
  const res = await db.query(
    `SELECT s.id, s.user_id, s.csrf_hash, s.ip_address, s.expires_at, s.created_at, s.last_seen_at,
            u.username, u.role, u.disabled, u.locked_until
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.session_hash = $1`,
    [sessionHash]
  );

  if (res.rows.length === 0) {
    return null;
  }

  const row = res.rows[0];

  // Check if user is disabled or locked
  if (row.disabled || (row.locked_until && new Date(row.locked_until) > new Date())) {
    await destroySessionByHash(sessionHash);
    return null;
  }

  const now = Date.now();
  const expiresAt = new Date(row.expires_at).getTime();
  const createdAt = new Date(row.created_at).getTime();

  // Enforce idle timeout and absolute timeout (12h)
  if (now > expiresAt || now - createdAt > ABSOLUTE_TIMEOUT_MS) {
    await destroySessionByHash(sessionHash);
    return null;
  }

  // Slide idle timeout forward
  const newExpiresAt = new Date(now + IDLE_TIMEOUT_MS);
  await db.query(
    'UPDATE sessions SET expires_at = $1, last_seen_at = NOW() WHERE id = $2',
    [newExpiresAt, row.id]
  );

  return {
    sessionId: row.id,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    csrfHash: row.csrf_hash
  };
}

export async function destroySession(token, res) {
  if (token) {
    const sessionHash = hashToken(token);
    await destroySessionByHash(sessionHash);
  }
  if (res) {
    const isSecure = config.publicOrigin.startsWith('https://');
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/'
    });
  }
}

export async function destroySessionByHash(sessionHash) {
  await db.query('DELETE FROM sessions WHERE session_hash = $1', [sessionHash]);
}

export async function destroyAllUserSessions(userId) {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function purgeExpiredSessions() {
  await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
}

export default {
  COOKIE_NAME,
  createSession,
  validateSession,
  destroySession,
  destroyAllUserSessions,
  purgeExpiredSessions,
  hashToken
};
