import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateBody } from '../middleware/validate.js';
import { backupLimiter } from '../middleware/rateLimits.js';
import { encryptExport, decryptExport } from '../security/crypto.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

const exportSchema = z.object({
  passphrase: z.string().min(12, { message: 'Passphrase must be at least 12 characters' })
}).strict();

router.post('/export', requireAuth, requireOwner, backupLimiter, validateBody(exportSchema), async (req, res, next) => {
  const { passphrase } = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    // Gather system datasets
    const [
      products,
      productAliases,
      customers,
      suppliers,
      documents,
      documentLines,
      payments,
      expenses,
      settings
    ] = await Promise.all([
      db.query('SELECT * FROM products'),
      db.query('SELECT * FROM product_aliases'),
      db.query('SELECT * FROM customers'),
      db.query('SELECT * FROM suppliers'),
      db.query('SELECT * FROM documents'),
      db.query('SELECT * FROM document_lines'),
      db.query('SELECT * FROM payments'),
      db.query('SELECT * FROM expenses'),
      db.query('SELECT * FROM settings WHERE id = 1')
    ]);

    const exportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      store: 'Devi Electrical',
      data: {
        settings: settings.rows[0] || null,
        products: products.rows,
        productAliases: productAliases.rows,
        customers: customers.rows,
        suppliers: suppliers.rows,
        documents: documents.rows,
        documentLines: documentLines.rows,
        payments: payments.rows,
        expenses: expenses.rows
      }
    };

    // Encrypt with owner passphrase via scrypt and AES-256-GCM
    const encryptedPackage = await encryptExport(exportPayload, passphrase);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'backup_exported',
      entity: 'backup',
      clientIp
    });

    res.json(encryptedPackage);
  } catch (err) {
    next(err);
  }
});

const restoreSchema = z.object({
  passphrase: z.string().min(12),
  package: z.object({
    version: z.number().int(),
    salt: z.string(),
    iv: z.string(),
    authTag: z.string(),
    ciphertext: z.string()
  }).strict()
}).strict();

router.post('/restore', requireAuth, requireOwner, backupLimiter, validateBody(restoreSchema), async (req, res, next) => {
  const { passphrase, package: encryptedPackage } = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    let decryptedData;
    try {
      decryptedData = await decryptExport(encryptedPackage, passphrase);
    } catch {
      return res.status(400).json({ error: 'Decryption failed: Invalid passphrase or corrupted backup package.' });
    }

    if (!decryptedData || decryptedData.version !== 1 || !decryptedData.data) {
      return res.status(400).json({ error: 'Invalid backup structure.' });
    }

    const { data } = decryptedData;

    // Execute atomic restoration within a single transaction
    await db.withTransaction(async (client) => {
      // Clean target tables in reverse foreign-key order
      await client.query('DELETE FROM payments');
      await client.query('DELETE FROM document_lines');
      await client.query('DELETE FROM stock_movements');
      await client.query('DELETE FROM documents');
      await client.query('DELETE FROM expenses');
      await client.query('DELETE FROM product_aliases');
      await client.query('DELETE FROM products');
      await client.query('DELETE FROM customers');
      await client.query('DELETE FROM suppliers');

      // Re-insert products
      if (Array.isArray(data.products)) {
        for (const p of data.products) {
          await client.query(
            `INSERT INTO products (id, sku, barcode, name, brand, category, spec, hsn, unit, purchase_price, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [p.id, p.sku, p.barcode, p.name, p.brand, p.category, p.spec, p.hsn, p.unit, p.purchase_price, p.selling_price, p.gst_rate, p.current_stock, p.min_stock, p.rack_location, p.keywords, p.created_at, p.updated_at]
          );
        }
      }

      // Re-insert customers
      if (Array.isArray(data.customers)) {
        for (const c of data.customers) {
          await client.query(
            `INSERT INTO customers (id, name, phone_enc, phone_bidx, email_enc, gstin_enc, gstin_bidx, address_enc, state_code, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [c.id, c.name, c.phone_enc, c.phone_bidx, c.email_enc, c.gstin_enc, c.gstin_bidx, c.address_enc, c.state_code, c.created_at, c.updated_at]
          );
        }
      }

      // Re-insert suppliers
      if (Array.isArray(data.suppliers)) {
        for (const s of data.suppliers) {
          await client.query(
            `INSERT INTO suppliers (id, name, phone_enc, phone_bidx, gstin_enc, gstin_bidx, address_enc, state_code, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [s.id, s.name, s.phone_enc, s.phone_bidx, s.gstin_enc, s.gstin_bidx, s.address_enc, s.state_code, s.created_at, s.updated_at]
          );
        }
      }

      // Re-insert documents
      if (Array.isArray(data.documents)) {
        for (const d of data.documents) {
          await client.query(
            `INSERT INTO documents (
               id, doc_type, doc_number, fy, status, customer_id, supplier_id,
               customer_snapshot, doc_date, due_date, place_of_supply, is_interstate,
               subtotal_gross, total_discount, taxable_amount, cgst_amount, sgst_amount,
               igst_amount, extra_charges, round_off, grand_total, paid_amount,
               notes, terms, created_by, created_at, finalized_at, cancelled_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7,
               $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17,
               $18, $19, $20, $21, $22,
               $23, $24, $25, $26, $27, $28
             )`,
            [
              d.id, d.doc_type, d.doc_number, d.fy, d.status, d.customer_id, d.supplier_id,
              d.customer_snapshot, d.doc_date, d.due_date, d.place_of_supply, d.is_interstate,
              d.subtotal_gross, d.total_discount, d.taxable_amount, d.cgst_amount, d.sgst_amount,
              d.igst_amount, d.extra_charges, d.round_off, d.grand_total, d.paid_amount,
              d.notes, d.terms, d.created_by, d.created_at, d.finalized_at, d.cancelled_at
            ]
          );
        }
      }

      // Re-insert document lines
      if (Array.isArray(data.documentLines)) {
        for (const dl of data.documentLines) {
          await client.query(
            `INSERT INTO document_lines (
               id, document_id, product_id, sl_no, description, hsn, qty, unit, rate,
               purchase_price, discount_type, discount_value, discount_amount,
               taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19
             )`,
            [
              dl.id, dl.document_id, dl.product_id, dl.sl_no, dl.description, dl.hsn, dl.qty, dl.unit, dl.rate,
              dl.purchase_price, dl.discount_type, dl.discount_value, dl.discount_amount,
              dl.taxable_amount, dl.gst_rate, dl.cgst_amount, dl.sgst_amount, dl.igst_amount, dl.line_total
            ]
          );
        }
      }

      // Re-insert payments
      if (Array.isArray(data.payments)) {
        for (const pm of data.payments) {
          await client.query(
            `INSERT INTO payments (id, document_id, payment_date, amount, payment_mode, reference, notes, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [pm.id, pm.document_id, pm.payment_date, pm.amount, pm.payment_mode, pm.reference, pm.notes, pm.created_by, pm.created_at]
          );
        }
      }

      // Re-insert expenses
      if (Array.isArray(data.expenses)) {
        for (const ex of data.expenses) {
          await client.query(
            `INSERT INTO expenses (id, expense_date, category, amount, payment_mode, description, reference, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [ex.id, ex.expense_date, ex.category, ex.amount, ex.payment_mode, ex.description, ex.reference, ex.created_by, ex.created_at]
          );
        }
      }
    });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'backup_restored',
      entity: 'backup',
      clientIp
    });

    res.json({ success: true, message: 'Database successfully restored from encrypted package.' });
  } catch (err) {
    next(err);
  }
});

export default router;
