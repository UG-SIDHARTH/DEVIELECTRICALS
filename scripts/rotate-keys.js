#!/usr/bin/env node
import db from '../server/db/pool.js';
import config from '../server/config.js';
import { encryptField, decryptField } from '../server/security/crypto.js';
import { logAuditEvent } from '../server/security/audit.js';

async function rotateTableKeys(tableName, columns, idCol = 'id') {
  const currentVersion = config.dataKeys.current_version;
  const currentPrefix = `v${currentVersion}:`;
  console.log(`Checking table "${tableName}" for encrypted columns using versions older than ${currentPrefix}...`);

  const selectCols = [idCol, ...columns].join(', ');
  const res = await db.query(`SELECT ${selectCols} FROM ${tableName}`);

  let updatedCount = 0;

  for (const row of res.rows) {
    const rowId = row[idCol];
    let needsUpdate = false;
    const updates = {};

    for (const col of columns) {
      const val = row[col];
      if (typeof val === 'string' && val.startsWith('v') && !val.startsWith(currentPrefix)) {
        needsUpdate = true;
        const aad = `${tableName}.${col}.${rowId}`;
        const decrypted = decryptField(val, aad);
        updates[col] = encryptField(decrypted, aad);
      }
    }

    if (needsUpdate) {
      const setClauses = Object.keys(updates).map((col, idx) => `${col} = $${idx + 1}`);
      const params = [...Object.values(updates), rowId];

      await db.query(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE ${idCol} = $${params.length}`,
        params
      );
      updatedCount++;
    }
  }

  console.log(`✓ Table "${tableName}": Re-encrypted ${updatedCount} rows to key version ${currentVersion}.`);
  return updatedCount;
}

async function runKeyRotation() {
  console.log('=== Devi Electrical: Data Key Re-encryption / Rotation Tool ===');
  console.log(`Current active key version: ${config.dataKeys.current_version}`);

  try {
    let totalUpdated = 0;

    // 1. Customers
    totalUpdated += await rotateTableKeys('customers', ['phone_enc', 'email_enc', 'gstin_enc', 'address_enc']);

    // 2. Suppliers
    totalUpdated += await rotateTableKeys('suppliers', ['phone_enc', 'gstin_enc', 'address_enc']);

    // 3. Settings
    totalUpdated += await rotateTableKeys('settings', [
      'gstin_enc', 'bank_name_enc', 'bank_account_enc', 'bank_ifsc_enc', 'bank_branch_enc', 'upi_id_enc'
    ]);

    // 4. Scan History
    totalUpdated += await rotateTableKeys('scan_history', ['image_enc']);

    await logAuditEvent({
      action: 'keys_rotated',
      entity: 'crypto',
      clientIp: '127.0.0.1',
      diff: { currentVersion: config.dataKeys.current_version, rowsReencrypted: totalUpdated }
    });

    console.log(`\n✓ Key rotation complete. Total rows updated: ${totalUpdated}.`);
  } catch (err) {
    console.error('Key rotation failed:', err.message);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

runKeyRotation();
