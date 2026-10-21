import crypto from 'node:crypto';
import argon2 from 'argon2';
import config from '../config.js';

// Concurrency queue to protect memory budget on a 4 GB RAM server
// Argon2 with 64 MB per hash means 2 concurrent hashes use at most ~128 MB RAM
class ConcurrencyQueue {
  constructor(limit = 2) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.running >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

const hashQueue = new ConcurrencyQueue(2);

// Pre-computed dummy hash using same pepper and argon2id settings for timing attack mitigation
let dummyHash = null;

function getPepperedPassword(password) {
  return crypto.createHmac('sha256', Buffer.from(config.passwordPepper, 'utf8'))
    .update(password)
    .digest('hex');
}

export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return { valid: false, message: 'Password must be at least 12 characters long.' };
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  if (!hasLetter || !hasDigit) {
    return { valid: false, message: 'Password must contain both letters and numbers.' };
  }
  return { valid: true };
}

export async function hashPassword(password) {
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    throw new Error(strength.message);
  }

  const peppered = getPepperedPassword(password);

  return hashQueue.run(() =>
    argon2.hash(peppered, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 1
    })
  );
}

export async function verifyPassword(hash, password) {
  const peppered = getPepperedPassword(password);

  return hashQueue.run(() =>
    argon2.verify(hash, peppered)
  );
}

/**
 * Runs a dummy verification against a valid Argon2 hash to prevent username enumeration timing attacks.
 */
export async function dummyVerify(password) {
  if (!dummyHash) {
    const dummyPeppered = getPepperedPassword('DeviElectricalDummyPassword123');
    dummyHash = await hashQueue.run(() =>
      argon2.hash(dummyPeppered, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1
      })
    );
  }
  await verifyPassword(dummyHash, password);
  return false;
}

export default {
  validatePasswordStrength,
  hashPassword,
  verifyPassword,
  dummyVerify
};
