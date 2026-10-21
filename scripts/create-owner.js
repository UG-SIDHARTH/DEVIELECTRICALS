#!/usr/bin/env node
import readline from 'node:readline';
import db from '../server/db/pool.js';
import { hashPassword, validatePasswordStrength } from '../server/security/passwords.js';
import { logAuditEvent } from '../server/security/audit.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function createOwner() {
  console.log('=== Devi Electrical: Initial Store Owner Account Setup ===');

  try {
    const existingRes = await db.query("SELECT COUNT(*) FROM users WHERE role = 'owner'");
    const ownerCount = parseInt(existingRes.rows[0].count, 10);
    if (ownerCount > 0) {
      console.log(`Note: ${ownerCount} owner account(s) already exist.`);
      if (!process.env.OWNER_USERNAME) {
        const proceed = await ask('Do you wish to create an additional owner account? (y/N): ');
        if (proceed.toLowerCase() !== 'y') {
          console.log('Setup aborted.');
          process.exit(0);
        }
      }
    }

    const usernameInput = process.env.OWNER_USERNAME || (await ask('Enter owner username (letters, numbers, min 3 chars): '));
    const username = usernameInput.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,50}$/.test(username)) {
      console.error('Invalid username format. Must be 3-50 alphanumeric characters.');
      process.exit(1);
    }

    const password = process.env.OWNER_PASSWORD || (await ask('Enter strong password (minimum 12 characters, letters & numbers): '));
    const pwdCheck = validatePasswordStrength(password);
    if (!pwdCheck.valid) {
      console.error(`Password validation error: ${pwdCheck.message}`);
      process.exit(1);
    }

    if (!process.env.OWNER_PASSWORD) {
      const confirmPassword = await ask('Confirm password: ');
      if (password !== confirmPassword) {
        console.error('Passwords do not match.');
        process.exit(1);
      }
    }

    console.log('Hashing password with Argon2id + HMAC pepper...');
    const passwordHash = await hashPassword(password);

    const insertRes = await db.query(
      `INSERT INTO users (username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, 'owner', NOW(), NOW())
       RETURNING id, username, role, created_at`,
      [username, passwordHash]
    );

    const user = insertRes.rows[0];

    await logAuditEvent({
      userId: user.id,
      username: user.username,
      action: 'owner_created_cli',
      entity: 'users',
      entityId: user.id,
      clientIp: '127.0.0.1'
    });

    console.log(`\n✓ Owner account "${user.username}" (ID: ${user.id}) created successfully.`);
    console.log('You may now log in to the billing dashboard at /billing/ and enable 2FA in Settings.');
  } catch (err) {
    if (err.code === '23505') {
      console.error(`Error: User "${err.detail}" already exists.`);
    } else {
      console.error('Failed to create owner user:', err.message);
    }
  } finally {
    rl.close();
    await db.pool.end();
  }
}

createOwner();
