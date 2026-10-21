import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { calculateDocumentTotals } from '../services/gst.js';
import { allocateDocumentNumber, getCurrentFinancialYear } from '../services/numbering.js';
import { applyDocumentStockChange, restoreDocumentStock } from '../services/stock.js';
import { encryptField, decryptField } from '../security/crypto.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

const lineSchema = z.object({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().min(1).max(300),
  hsn: z.string().max(8).nullable().optional(),
  qty: z.number().positive(),
  unit: z.string().max(20).default('Nos'),
  rate: z.number().int().nonnegative(), // paise
  discountType: z.enum(['amount', 'percent']).default('amount'),
  discountValue: z.number().nonnegative().default(0),
  gstRate: z.number().nonnegative().default(18.00)
});

const documentCreateSchema = z.object({
  docType: z.enum(['invoice', 'quotation', 'challan', 'purchase']),
  customerId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  placeOfSupply: z.string().length(2).default('32'),
  pricesIncludeGst: z.boolean().default(false),
  extraCharges: z.number().int().nonnegative().default(0), // paise
  notes: z.string().max(1000).nullable().optional(),
  terms: z.string().max(1000).nullable().optional(),
  lines: z.array(lineSchema).min(1)
}).strict();

const documentQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  type: z.enum(['invoice', 'quotation', 'challan', 'purchase', 'all']).optional().default('all'),
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional()
});

router.get('/', requireAuth, validateQuery(documentQuerySchema), async (req, res, next) => {
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  let pIdx = 1;

  if (req.validatedQuery.type && req.validatedQuery.type !== 'all') {
    conditions.push(`d.doc_type = $${pIdx++}`);
    params.push(req.validatedQuery.type);
  }

  if (req.validatedQuery.status && req.validatedQuery.status !== 'all') {
    conditions.push(`d.status = $${pIdx++}`);
    params.push(req.validatedQuery.status);
  }

  if (req.validatedQuery.customerId) {
    conditions.push(`d.customer_id = $${pIdx++}`);
    params.push(req.validatedQuery.customerId);
  }

  if (req.validatedQuery.startDate) {
    conditions.push(`d.doc_date >= $${pIdx++}`);
    params.push(req.validatedQuery.startDate);
  }

  if (req.validatedQuery.endDate) {
    conditions.push(`d.doc_date <= $${pIdx++}`);
    params.push(req.validatedQuery.endDate);
  }

  if (req.validatedQuery.search) {
    conditions.push(`d.doc_number ILIKE $${pIdx++}`);
    params.push(`%${req.validatedQuery.search.trim()}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await db.query(`SELECT COUNT(*) FROM documents d ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const listRes = await db.query(
      `SELECT d.*, c.name AS customer_name, s.name AS supplier_name
       FROM documents d
       LEFT JOIN customers c ON d.customer_id = c.id
       LEFT JOIN suppliers s ON d.supplier_id = s.id
       ${where}
       ORDER BY d.doc_date DESC, d.created_at DESC
       LIMIT $${pIdx++} OFFSET $${pIdx++}`,
      params
    );

    res.json({
      items: listRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requireAuth, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const docId = req.validatedParams.id;
  const isOwner = req.user.role === 'owner';

  try {
    const docRes = await db.query(
      `SELECT d.*, c.name AS customer_name, s.name AS supplier_name
       FROM documents d
       LEFT JOIN customers c ON d.customer_id = c.id
       LEFT JOIN suppliers s ON d.supplier_id = s.id
       WHERE d.id = $1`,
      [docId]
    );

    if (docRes.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = docRes.rows[0];

    // Decrypt customer snapshot if present
    if (doc.customer_snapshot) {
      try {
        const snap = doc.customer_snapshot;
        if (snap.phone_enc) snap.phone = decryptField(snap.phone_enc, `documents.customer_phone.${docId}`);
        if (snap.gstin_enc) snap.gstin = decryptField(snap.gstin_enc, `documents.customer_gstin.${docId}`);
        if (snap.address_enc) snap.address = decryptField(snap.address_enc, `documents.customer_address.${docId}`);
      } catch (err) {
        console.warn('Customer snapshot decryption notice:', err.message);
      }
    }

    const linesRes = await db.query(
      'SELECT * FROM document_lines WHERE document_id = $1 ORDER BY sl_no ASC',
      [docId]
    );

    const lines = linesRes.rows.map(line => {
      const item = { ...line };
      if (!isOwner) {
        delete item.purchase_price;
      }
      return item;
    });

    const paymentsRes = await db.query(
      'SELECT * FROM payments WHERE document_id = $1 ORDER BY payment_date DESC, created_at DESC',
      [docId]
    );

    res.json({
      ...doc,
      lines,
      payments: paymentsRes.rows
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireAuth, validateBody(documentCreateSchema), async (req, res, next) => {
  const data = req.validatedBody;
  const userId = req.user.id;
  const clientIp = getClientIp(req);

  try {
    const settingsRes = await db.query('SELECT gst_registered, quotation_validity_days FROM settings WHERE id = 1');
    const settings = settingsRes.rows[0] || {};
    const isGstRegistered = settings.gst_registered || false;

    // Attach purchase price from product table for lines
    const enrichedLines = await Promise.all(
      data.lines.map(async (l) => {
        let pPrice = 0;
        if (l.productId) {
          const prodRes = await db.query('SELECT purchase_price FROM products WHERE id = $1', [l.productId]);
          if (prodRes.rows.length > 0) {
            pPrice = prodRes.rows[0].purchase_price;
          }
        }
        return { ...l, purchasePrice: pPrice };
      })
    );

    // Recompute totals on the server
    const calculated = calculateDocumentTotals({
      lines: enrichedLines,
      pricesIncludeGst: data.pricesIncludeGst,
      placeOfSupply: data.placeOfSupply,
      isGstRegistered,
      extraCharges: data.extraCharges
    });

    const fy = getCurrentFinancialYear();

    const createdDoc = await db.withTransaction(async (client) => {
      // Build snapshot for customer if applicable
      let customerSnapshot = null;
      if (data.customerId) {
        const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [data.customerId]);
        if (custRes.rows.length > 0) {
          const c = custRes.rows[0];
          customerSnapshot = {
            id: c.id,
            name: c.name,
            phone_enc: c.phone_enc,
            gstin_enc: c.gstin_enc,
            address_enc: c.address_enc,
            state_code: c.state_code
          };
        }
      }

      const docDate = data.docDate || new Date().toISOString().split('T')[0];
      let dueDate = data.dueDate || null;
      if (!dueDate && data.docType === 'quotation') {
        const validityDays = settings.quotation_validity_days || 15;
        const d = new Date(docDate);
        d.setDate(d.getDate() + validityDays);
        dueDate = d.toISOString().split('T')[0];
      }

      const insertDocRes = await client.query(
        `INSERT INTO documents (
           doc_type, doc_number, fy, status, customer_id, supplier_id,
           customer_snapshot, doc_date, due_date, place_of_supply, is_interstate,
           subtotal_gross, total_discount, taxable_amount, cgst_amount, sgst_amount,
           igst_amount, extra_charges, round_off, grand_total, paid_amount,
           notes, terms, created_by, created_at
         ) VALUES (
           $1, NULL, $2, 'draft', $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14,
           $15, $16, $17, $18, 0,
           $19, $20, $21, NOW()
         ) RETURNING *`,
        [
          data.docType,
          fy,
          data.customerId || null,
          data.supplierId || null,
          customerSnapshot ? JSON.stringify(customerSnapshot) : null,
          docDate,
          dueDate,
          data.placeOfSupply,
          calculated.isInterstate,
          calculated.subtotalGross,
          calculated.totalDiscount,
          calculated.taxableAmount,
          calculated.cgstAmount,
          calculated.sgstAmount,
          calculated.igstAmount,
          calculated.extraCharges,
          calculated.roundOff,
          calculated.grandTotal,
          data.notes || null,
          data.terms || null,
          userId
        ]
      );

      const docId = insertDocRes.rows[0].id;

      // Insert line items
      for (const line of calculated.lines) {
        await client.query(
          `INSERT INTO document_lines (
             document_id, product_id, sl_no, description, hsn, qty, unit, rate,
             purchase_price, discount_type, discount_value, discount_amount,
             taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18
           )`,
          [
            docId,
            line.productId,
            line.slNo,
            line.description,
            line.hsn,
            line.qty,
            line.unit,
            line.rate,
            line.purchasePrice,
            line.discountType,
            line.discountValue,
            line.discountAmount,
            line.taxableAmount,
            line.gstRate,
            line.cgstAmount,
            line.sgstAmount,
            line.igstAmount,
            line.lineTotal
          ]
        );
      }

      return insertDocRes.rows[0];
    });

    await logAuditEvent({
      userId,
      username: req.user.username,
      action: 'document_created_draft',
      entity: 'documents',
      entityId: createdDoc.id,
      clientIp,
      diff: { doc_type: createdDoc.doc_type, grand_total: createdDoc.grand_total }
    });

    res.status(201).json(createdDoc);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/finalize', requireAuth, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const docId = req.validatedParams.id;
  const userId = req.user.id;
  const clientIp = getClientIp(req);

  try {
    const finalized = await db.withTransaction(async (client) => {
      const docRes = await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [docId]);
      if (docRes.rows.length === 0) {
        throw new Error('Document not found');
      }

      const doc = docRes.rows[0];
      if (doc.status !== 'draft') {
        throw new Error(`Cannot finalize document in status "${doc.status}"`);
      }

      // Fetch prefix setting
      const settingsRes = await client.query('SELECT invoice_prefix, quotation_prefix, challan_prefix, purchase_prefix FROM settings WHERE id = 1');
      const settings = settingsRes.rows[0] || {};

      let prefix = 'DE';
      if (doc.doc_type === 'quotation') prefix = settings.quotation_prefix || 'QT';
      else if (doc.doc_type === 'challan') prefix = settings.challan_prefix || 'DC';
      else if (doc.doc_type === 'purchase') prefix = settings.purchase_prefix || 'PO';
      else prefix = settings.invoice_prefix || 'DE';

      // Allocate next gapless document number atomically
      const { docNumber } = await allocateDocumentNumber(client, doc.doc_type, prefix);

      let nextStatus = 'unpaid';
      if (doc.doc_type === 'quotation') nextStatus = 'sent';
      else if (doc.doc_type === 'challan') nextStatus = 'delivered';
      else if (doc.doc_type === 'purchase') nextStatus = 'paid';

      // Load lines and execute stock changes
      const linesRes = await client.query('SELECT * FROM document_lines WHERE document_id = $1', [docId]);
      const mappedLines = linesRes.rows.map(r => ({ productId: r.product_id, qty: r.qty }));

      await applyDocumentStockChange(client, docId, doc.doc_type, mappedLines, userId);

      const updateRes = await client.query(
        `UPDATE documents
         SET doc_number = $1, status = $2, finalized_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [docNumber, nextStatus, docId]
      );

      return updateRes.rows[0];
    });

    await logAuditEvent({
      userId,
      username: req.user.username,
      action: 'document_finalized',
      entity: 'documents',
      entityId: docId,
      clientIp,
      diff: { doc_type: finalized.doc_type, doc_number: finalized.doc_number, status: finalized.status }
    });

    res.json(finalized);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const docId = req.validatedParams.id;
  const userId = req.user.id;
  const clientIp = getClientIp(req);

  try {
    const cancelled = await db.withTransaction(async (client) => {
      const docRes = await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [docId]);
      if (docRes.rows.length === 0) {
        throw new Error('Document not found');
      }

      const doc = docRes.rows[0];
      if (doc.status === 'cancelled') {
        throw new Error('Document is already cancelled');
      }

      // Restore physical stock if document had stock movements
      if (doc.finalized_at) {
        await restoreDocumentStock(client, docId, userId);
      }

      const updateRes = await client.query(
        'UPDATE documents SET status = $1, cancelled_at = NOW() WHERE id = $2 RETURNING *',
        ['cancelled', docId]
      );

      return updateRes.rows[0];
    });

    await logAuditEvent({
      userId,
      username: req.user.username,
      action: 'document_cancelled',
      entity: 'documents',
      entityId: docId,
      clientIp,
      diff: { doc_type: cancelled.doc_type, doc_number: cancelled.doc_number }
    });

    res.json(cancelled);
  } catch (err) {
    next(err);
  }
});

// Convert Quotation to Invoice Draft
router.post('/:id/convert', requireAuth, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const quoteId = req.validatedParams.id;
  const userId = req.user.id;

  try {
    const invoice = await db.withTransaction(async (client) => {
      const qRes = await client.query('SELECT * FROM documents WHERE id = $1', [quoteId]);
      if (qRes.rows.length === 0 || qRes.rows[0].doc_type !== 'quotation') {
        throw new Error('Valid quotation not found');
      }
      const quote = qRes.rows[0];

      const linesRes = await client.query('SELECT * FROM document_lines WHERE document_id = $1 ORDER BY sl_no ASC', [quoteId]);

      const fy = getCurrentFinancialYear();

      const newDocRes = await client.query(
        `INSERT INTO documents (
           doc_type, doc_number, fy, status, customer_id, customer_snapshot,
           doc_date, place_of_supply, is_interstate, subtotal_gross, total_discount,
           taxable_amount, cgst_amount, sgst_amount, igst_amount, extra_charges,
           round_off, grand_total, paid_amount, notes, terms, created_by, created_at
         ) VALUES (
           'invoice', NULL, $1, 'draft', $2, $3,
           CURRENT_DATE, $4, $5, $6, $7,
           $8, $9, $10, $11, $12,
           $13, $14, 0, $15, $16, $17, NOW()
         ) RETURNING *`,
        [
          fy,
          quote.customer_id,
          quote.customer_snapshot,
          quote.place_of_supply,
          quote.is_interstate,
          quote.subtotal_gross,
          quote.total_discount,
          quote.taxable_amount,
          quote.cgst_amount,
          quote.sgst_amount,
          quote.igst_amount,
          quote.extra_charges,
          quote.round_off,
          quote.grand_total,
          `Converted from quotation ${quote.doc_number || ''}`,
          quote.terms,
          userId
        ]
      );

      const newId = newDocRes.rows[0].id;

      for (const line of linesRes.rows) {
        await client.query(
          `INSERT INTO document_lines (
             document_id, product_id, sl_no, description, hsn, qty, unit, rate,
             purchase_price, discount_type, discount_value, discount_amount,
             taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18
           )`,
          [
            newId,
            line.product_id,
            line.sl_no,
            line.description,
            line.hsn,
            line.qty,
            line.unit,
            line.rate,
            line.purchase_price,
            line.discount_type,
            line.discount_value,
            line.discount_amount,
            line.taxable_amount,
            line.gst_rate,
            line.cgst_amount,
            line.sgst_amount,
            line.igst_amount,
            line.line_total
          ]
        );
      }

      // Mark quote accepted
      await client.query("UPDATE documents SET status = 'accepted' WHERE id = $1", [quoteId]);

      return newDocRes.rows[0];
    });

    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
});

// Payments
const paymentSchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amount: z.number().int().positive(), // paise
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque']),
  reference: z.string().max(100).nullable().optional(),
  notes: z.string().max(300).nullable().optional()
}).strict();

router.post('/:id/payments', requireAuth, validateParams(z.object({ id: z.string().uuid() })), validateBody(paymentSchema), async (req, res, next) => {
  const docId = req.validatedParams.id;
  const data = req.validatedBody;
  const userId = req.user.id;
  const clientIp = getClientIp(req);

  try {
    const updated = await db.withTransaction(async (client) => {
      const docRes = await client.query('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [docId]);
      if (docRes.rows.length === 0) {
        throw new Error('Document not found');
      }

      const doc = docRes.rows[0];
      if (doc.status === 'cancelled') {
        throw new Error('Cannot add payment to a cancelled document');
      }

      await client.query(
        `INSERT INTO payments (document_id, payment_date, amount, payment_mode, reference, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          docId,
          data.paymentDate || new Date().toISOString().split('T')[0],
          data.amount,
          data.paymentMode,
          data.reference || null,
          data.notes || null,
          userId
        ]
      );

      // Recompute total payments
      const sumRes = await client.query('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE document_id = $1', [docId]);
      const totalPaid = parseInt(sumRes.rows[0].total, 10);

      let newStatus = doc.status;
      if (totalPaid >= doc.grand_total) {
        newStatus = 'paid';
      } else if (totalPaid > 0) {
        newStatus = 'partially_paid';
      }

      const upDoc = await client.query(
        'UPDATE documents SET paid_amount = $1, status = $2 WHERE id = $3 RETURNING *',
        [totalPaid, newStatus, docId]
      );

      return upDoc.rows[0];
    });

    await logAuditEvent({
      userId,
      username: req.user.username,
      action: 'payment_recorded',
      entity: 'payments',
      entityId: docId,
      clientIp,
      diff: { amount: data.amount, paymentMode: data.paymentMode, status: updated.status }
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
