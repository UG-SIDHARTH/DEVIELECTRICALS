import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { encryptField, decryptField, computeBlindIndex } from '../security/crypto.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

function decryptCustomer(c) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    phone: decryptField(c.phone_enc, `customers.phone.${c.id}`) || '',
    email: decryptField(c.email_enc, `customers.email.${c.id}`) || '',
    gstin: decryptField(c.gstin_enc, `customers.gstin.${c.id}`) || '',
    address: decryptField(c.address_enc, `customers.address.${c.id}`) || '',
    state_code: c.state_code,
    created_at: c.created_at,
    updated_at: c.updated_at
  };
}

const customerQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  search: z.string().optional()
});

router.get('/', requireAuth, validateQuery(customerQuerySchema), async (req, res, next) => {
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;

  try {
    let whereClause = '';
    const params = [];

    if (req.validatedQuery.search) {
      const search = req.validatedQuery.search.trim();
      const phoneBidx = computeBlindIndex(search, 'phone');
      const gstinBidx = computeBlindIndex(search, 'gstin');
      const namePattern = `%${search}%`;

      whereClause = 'WHERE name ILIKE $1 OR phone_bidx = $2 OR gstin_bidx = $3';
      params.push(namePattern, phoneBidx, gstinBidx);
    }

    const countRes = await db.query(`SELECT COUNT(*) FROM customers ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const paramIdx = params.length + 1;
    params.push(limit, offset);

    const listRes = await db.query(
      `SELECT * FROM customers ${whereClause} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    const decryptedItems = listRes.rows.map(decryptCustomer);

    res.json({
      items: decryptedItems,
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
  try {
    const custRes = await db.query('SELECT * FROM customers WHERE id = $1', [req.validatedParams.id]);
    if (custRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(decryptCustomer(custRes.rows[0]));
  } catch (err) {
    next(err);
  }
});

const customerSchema = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().regex(/^$|^\+?[0-9]{10,13}$/, { message: 'Valid 10-digit phone number required' }).nullable().optional(),
  email: z.string().email().nullable().optional(),
  gstin: z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, { message: 'Invalid 15-character GSTIN format' }).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  state_code: z.string().length(2).default('32')
}).strict();

router.post('/', requireAuth, validateBody(customerSchema), async (req, res, next) => {
  const data = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    // Generate new UUID beforehand to bind to AAD
    const uuidRes = await db.query('SELECT gen_random_uuid() AS id');
    const custId = uuidRes.rows[0].id;

    const phoneEnc = data.phone ? encryptField(data.phone, `customers.phone.${custId}`) : null;
    const phoneBidx = data.phone ? computeBlindIndex(data.phone, 'phone') : null;

    const emailEnc = data.email ? encryptField(data.email, `customers.email.${custId}`) : null;

    const gstinEnc = data.gstin ? encryptField(data.gstin, `customers.gstin.${custId}`) : null;
    const gstinBidx = data.gstin ? computeBlindIndex(data.gstin, 'gstin') : null;

    const addressEnc = data.address ? encryptField(data.address, `customers.address.${custId}`) : null;

    const insertRes = await db.query(
      `INSERT INTO customers (id, name, phone_enc, phone_bidx, email_enc, gstin_enc, gstin_bidx, address_enc, state_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [custId, data.name, phoneEnc, phoneBidx, emailEnc, gstinEnc, gstinBidx, addressEnc, data.state_code]
    );

    const decrypted = decryptCustomer(insertRes.rows[0]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'customer_created',
      entity: 'customers',
      entityId: custId,
      clientIp,
      diff: { name: data.name, state_code: data.state_code }
    });

    res.status(201).json(decrypted);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAuth, validateParams(z.object({ id: z.string().uuid() })), validateBody(customerSchema), async (req, res, next) => {
  const custId = req.validatedParams.id;
  const data = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    const existing = await db.query('SELECT * FROM customers WHERE id = $1', [custId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const phoneEnc = data.phone ? encryptField(data.phone, `customers.phone.${custId}`) : null;
    const phoneBidx = data.phone ? computeBlindIndex(data.phone, 'phone') : null;

    const emailEnc = data.email ? encryptField(data.email, `customers.email.${custId}`) : null;

    const gstinEnc = data.gstin ? encryptField(data.gstin, `customers.gstin.${custId}`) : null;
    const gstinBidx = data.gstin ? computeBlindIndex(data.gstin, 'gstin') : null;

    const addressEnc = data.address ? encryptField(data.address, `customers.address.${custId}`) : null;

    const updateRes = await db.query(
      `UPDATE customers
       SET name = $1, phone_enc = $2, phone_bidx = $3, email_enc = $4, gstin_enc = $5,
           gstin_bidx = $6, address_enc = $7, state_code = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [data.name, phoneEnc, phoneBidx, emailEnc, gstinEnc, gstinBidx, addressEnc, data.state_code, custId]
    );

    const decrypted = decryptCustomer(updateRes.rows[0]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'customer_updated',
      entity: 'customers',
      entityId: custId,
      clientIp,
      diff: { name: data.name, state_code: data.state_code }
    });

    res.json(decrypted);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const custId = req.validatedParams.id;
  try {
    const delRes = await db.query('DELETE FROM customers WHERE id = $1 RETURNING name', [custId]);
    if (delRes.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'customer_deleted',
      entity: 'customers',
      entityId: custId,
      clientIp: getClientIp(req),
      diff: delRes.rows[0]
    });

    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete customer with existing documents.' });
    }
    next(err);
  }
});

export default router;
