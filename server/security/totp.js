import crypto from 'node:crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import db from '../db/pool.js';
import { encryptField, decryptField, timingSafeEqualString } from './crypto.js';

authenticator.options = {
  window: 1 // Allow 1 step (30s) drift backwards/forwards
};

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export async function generateQrCodeSvg(otpauthUrl) {
  return QRCode.toString(otpauthUrl, {
    type: 'svg',
    margin: 2,
    color: {
      dark: '#0F172A',
      light: '#FFFFFF'
    }
  });
}

export function getOtpAuthUrl(username, secret) {
  return authenticator.keyuri(username, 'Devi Electrical', secret);
}

export function verifyTotpToken(token, secret) {
  if (!token || !secret) return false;
  return authenticator.check(token.trim(), secret);
}

export function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // Generate clean 10-character hexadecimal code
    codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
  }
  return codes;
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * Checks if the provided code matches any unused recovery code for the user.
 * If matched, marks the code as used in the database.
 */
export async function verifyAndBurnRecoveryCode(userId, code) {
  if (!code || typeof code !== 'string') return false;

  const codeHash = hashRecoveryCode(code);
  const res = await db.query(
    'SELECT id, code_hash FROM recovery_codes WHERE user_id = $1 AND used = FALSE',
    [userId]
  );

  for (const row of res.rows) {
    if (timingSafeEqualString(row.code_hash, codeHash)) {
      await db.query('UPDATE recovery_codes SET used = TRUE WHERE id = $1', [row.id]);
      return true;
    }
  }

  return false;
}

export default {
  generateTotpSecret,
  generateQrCodeSvg,
  getOtpAuthUrl,
  verifyTotpToken,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyAndBurnRecoveryCode
};
