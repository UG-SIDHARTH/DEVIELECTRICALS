import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { verifyPassword, dummyVerify } from '../security/passwords.js';
import { createSession, destroySession, COOKIE_NAME } from '../security/sessions.js';
import { rotateCsrfToken } from '../security/csrf.js';
import { getClientIp } from '../security/clientIp.js';
import { logAuditEvent } from '../security/audit.js';
import { encryptField, decryptField } from '../security/crypto.js';
import {
  generateTotpSecret,
  getOtpAuthUrl,
  generateQrCodeSvg,
  verifyTotpToken,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyAndBurnRecoveryCode
} from '../security/totp.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { loginLimiter } from '../middleware/rateLimits.js';

const router = express.Router();

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200),
  totp_code: z.string().optional()
}).strict();

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res, next) => {
  const { username, password, totp_code } = req.validatedBody;
  const clientIp = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  try {
    const userRes = await db.query(
      `SELECT id, username, password_hash, role, totp_secret_enc, totp_enabled,
              failed_attempts, locked_until, disabled
       FROM users WHERE username = $1`,
      [username]
    );

    if (userRes.rows.length === 0) {
      await dummyVerify(password);
      await logAuditEvent({
        action: 'login_failed',
        entity: 'auth',
        clientIp,
        diff: { reason: 'unknown_user', username }
      });
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = userRes.rows[0];

    if (user.disabled) {
      await logAuditEvent({
        userId: user.id,
        username: user.username,
        action: 'login_blocked',
        entity: 'auth',
        clientIp,
        diff: { reason: 'account_disabled' }
      });
      return res.status(403).json({ error: 'Account is disabled. Contact store administrator.' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await logAuditEvent({
        userId: user.id,
        username: user.username,
        action: 'login_blocked',
        entity: 'auth',
        clientIp,
        diff: { reason: 'account_locked', locked_until: user.locked_until }
      });
      return res.status(429).json({ error: 'Account temporarily locked due to failed attempts. Please try again in 15 minutes.' });
    }

    const isValidPassword = await verifyPassword(user.password_hash, password);
    if (!isValidPassword) {
      const attempts = user.failed_attempts + 1;
      let lockUntil = null;
      if (attempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lock
      }

      await db.query(
        'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
        [attempts, lockUntil, user.id]
      );

      await logAuditEvent({
        userId: user.id,
        username: user.username,
        action: 'login_failed',
        entity: 'auth',
        clientIp,
        diff: { reason: 'wrong_password', attempts }
      });

      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // 2FA Verification
    if (user.totp_enabled) {
      if (!totp_code) {
        return res.status(200).json({ requireTotp: true });
      }

      const totpSecret = decryptField(user.totp_secret_enc, `users.totp_secret_enc.${user.id}`);
      let totpValid = verifyTotpToken(totp_code, totpSecret);

      if (!totpValid) {
        // Try recovery codes
        const recoveryValid = await verifyAndBurnRecoveryCode(user.id, totp_code);
        if (!recoveryValid) {
          const attempts = user.failed_attempts + 1;
          let lockUntil = null;
          if (attempts >= 5) {
            lockUntil = new Date(Date.now() + 15 * 60 * 1000);
          }
          await db.query(
            'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
            [attempts, lockUntil, user.id]
          );

          await logAuditEvent({
            userId: user.id,
            username: user.username,
            action: 'login_failed',
            entity: 'auth',
            clientIp,
            diff: { reason: 'invalid_2fa' }
          });
          return res.status(401).json({ error: 'Invalid two-factor authentication code or recovery code.' });
        }
      }
    }

    // Reset failed attempts on successful verification
    await db.query(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Create secure session and set cookie
    const { csrfToken } = await createSession(user.id, clientIp, userAgent, res);

    await logAuditEvent({
      userId: user.id,
      username: user.username,
      action: 'login_success',
      entity: 'auth',
      clientIp
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        totpEnabled: user.totp_enabled
      },
      csrfToken
    });
  } catch (err) {
    next(err);
  }
});

router.get('/csrf', requireAuth, async (req, res, next) => {
  try {
    const csrfToken = await rotateCsrfToken(req.session.sessionId);
    res.json({ csrfToken });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const userRes = await db.query(
      'SELECT id, username, role, totp_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = userRes.rows[0];
    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        totpEnabled: user.totp_enabled
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME] || req.cookies?.devi_session || req.cookies?.['__Host-devi_session'];
    await destroySession(token, res);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'logout',
      entity: 'auth',
      clientIp: getClientIp(req)
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 2FA Setup
router.post('/2fa/setup', requireAuth, async (req, res, next) => {
  try {
    const secret = generateTotpSecret();
    const otpauth = getOtpAuthUrl(req.user.username, secret);
    const qrSvg = await generateQrCodeSvg(otpauth);

    res.json({ secret, qrSvg });
  } catch (err) {
    next(err);
  }
});

const enable2FaSchema = z.object({
  secret: z.string().min(16),
  code: z.string().length(6)
}).strict();

router.post('/2fa/enable', requireAuth, validateBody(enable2FaSchema), async (req, res, next) => {
  const { secret, code } = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    const isValid = verifyTotpToken(code, secret);
    if (!isValid) {
      return res.status(400).json({ error: 'Verification code is invalid. Check your authenticator app.' });
    }

    const encryptedSecret = encryptField(secret, `users.totp_secret_enc.${req.user.id}`);
    const recoveryCodes = generateRecoveryCodes(8);

    await db.withTransaction(async (client) => {
      await client.query(
        'UPDATE users SET totp_secret_enc = $1, totp_enabled = TRUE, updated_at = NOW() WHERE id = $2',
        [encryptedSecret, req.user.id]
      );

      // Clean existing unused recovery codes and insert new ones
      await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [req.user.id]);
      for (const rc of recoveryCodes) {
        const hash = hashRecoveryCode(rc);
        await client.query(
          'INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)',
          [req.user.id, hash]
        );
      }
    });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: '2fa_enabled',
      entity: 'users',
      entityId: req.user.id,
      clientIp
    });

    res.json({
      success: true,
      recoveryCodes
    });
  } catch (err) {
    next(err);
  }
});

const disable2FaSchema = z.object({
  password: z.string().min(1)
}).strict();

router.post('/2fa/disable', requireAuth, validateBody(disable2FaSchema), async (req, res, next) => {
  const { password } = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    const userRes = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await verifyPassword(userRes.rows[0].password_hash, password);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password confirmation' });
    }

    await db.withTransaction(async (client) => {
      await client.query(
        'UPDATE users SET totp_secret_enc = NULL, totp_enabled = FALSE, updated_at = NOW() WHERE id = $1',
        [req.user.id]
      );
      await client.query('DELETE FROM recovery_codes WHERE user_id = $1', [req.user.id]);
    });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: '2fa_disabled',
      entity: 'users',
      entityId: req.user.id,
      clientIp
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
