import crypto from 'node:crypto';
import config from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts a plaintext string with AES-256-GCM, embedding key version and binding AAD.
 *
 * @param {string} plaintext
 * @param {string} aad - Context identifier e.g. "customers.phone.uuid"
 * @returns {string} Serialized ciphertext in format "v{version}:{iv}:{ciphertext}:{authTag}"
 */
export function encryptField(plaintext, aad) {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return null;
  }

  const version = config.dataKeys.current_version;
  const base64Key = config.dataKeys.keys[version];
  if (!base64Key) {
    throw new Error(`Data key version ${version} not configured`);
  }

  const key = Buffer.from(base64Key, 'base64');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  if (aad) {
    cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  }

  let encrypted = cipher.update(String(plaintext), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag().toString('base64');

  return `v${version}:${iv.toString('base64')}:${encrypted}:${authTag}`;
}

/**
 * Decrypts a ciphertext string verifying authenticity and bound AAD.
 *
 * @param {string} serialized - Ciphertext in format "v{version}:{iv}:{ciphertext}:{authTag}"
 * @param {string} aad - Context identifier e.g. "customers.phone.uuid"
 * @returns {string} Plaintext
 */
export function decryptField(serialized, aad) {
  if (!serialized || typeof serialized !== 'string') {
    return null;
  }

  const parts = serialized.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted field format');
  }

  const [versionTag, b64Iv, b64Ciphertext, b64AuthTag] = parts;
  const version = versionTag.replace(/^v/, '');
  const base64Key = config.dataKeys.keys[version];

  if (!base64Key) {
    throw new Error(`Decryption failed: Unknown key version ${version}`);
  }

  const key = Buffer.from(base64Key, 'base64');
  const iv = Buffer.from(b64Iv, 'base64');
  const authTag = Buffer.from(b64AuthTag, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  if (aad) {
    decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  }

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(b64Ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Computes an HMAC-SHA256 blind index for exact match search.
 *
 * @param {string} value
 * @param {string} type - 'phone', 'gstin', etc.
 * @returns {string} Hex encoded blind index
 */
export function computeBlindIndex(value, type = 'generic') {
  if (!value || typeof value !== 'string') {
    return null;
  }

  let normalized = value.trim();
  if (type === 'phone') {
    // Digits only; if 10 digits in India, drop leading 0 or +91 for consistency
    const digits = normalized.replace(/\D/g, '');
    normalized = digits.length > 10 ? digits.slice(-10) : digits;
  } else if (type === 'gstin') {
    normalized = normalized.toUpperCase().replace(/\s/g, '');
  } else {
    normalized = normalized.toLowerCase();
  }

  const hmac = crypto.createHmac('sha256', Buffer.from(config.blindIndexKey, 'utf8'));
  hmac.update(`${type}:${normalized}`);
  return hmac.digest('hex');
}

/**
 * Constant-time string equality check.
 */
export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare dummy to mitigate length timing leakage
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Encrypts an export JSON object with a user-supplied passphrase using Scrypt & AES-256-GCM.
 */
export async function encryptExport(dataObj, passphrase) {
  const plaintext = JSON.stringify(dataObj);
  const salt = crypto.randomBytes(16);
  
  // Scrypt key derivation (N=2^15=32768, r=8, p=1)
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted
  };
}

/**
 * Decrypts an export package using the user-supplied passphrase.
 */
export async function decryptExport(exportPackage, passphrase) {
  if (exportPackage.version !== 1) {
    throw new Error('Unsupported backup export format version');
  }

  const salt = Buffer.from(exportPackage.salt, 'base64');
  const iv = Buffer.from(exportPackage.iv, 'base64');
  const authTag = Buffer.from(exportPackage.authTag, 'base64');

  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(exportPackage.ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

export default {
  encryptField,
  decryptField,
  computeBlindIndex,
  timingSafeEqualString,
  encryptExport,
  decryptExport
};
