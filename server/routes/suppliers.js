import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { encryptField, decryptField, computeBlindIndex } from '../security/crypto.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

function decryptSupplier(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    phone: decryptField(s.phone_enc, `suppliers.phone.${s.id}`) || '',
    gstin: decryptField(s.gstin_enc, `suppliers.gstin.${s.id}`) || '',
    address: decryptField(s.address_enc, `suppliers.address.${s.id}`) || '',
    state_code: s.state_code,
    created_at: s.created_at,
    updated_at: s.updated_at
  };
}

const supplierQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  search: z.string().optional()
});

router.get('/', requireAuth, validateQuery(supplierQuerySchema), async (req, res, next) => {
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

    const countRes = await db.query(`SELECT COUNT(*) FROM suppliers ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    const paramIdx = params.length + 1;
    params.push(limit, offset);

    const listRes = await db.query(
      `SELECT * FROM suppliers ${whereClause} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({
      items: listRes.rows.map(decryptSupplier),
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
    const suppRes = await db.query('SELECT * FROM suppliers WHERE id = $1', [req.validatedParams.id]);
    if (suppRes.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json(decryptSupplier(suppRes.rows[0]));
  } catch (err) {
    next(err);
  }
});

const supplierSchema = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().regex(/^$|^\+?[0-9]{10,13}$/, { message: 'Valid 10-digit phone number required' }).nullable().optional(),
  gstin: z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, { message: 'Invalid 15-character GSTIN format' }).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  state_code: z.string().length(2).default('32')
}).strict();

router.post('/', requireAuth, validateBody(supplierSchema), async (req, res, next) => {
  const data = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    const uuidRes = await db.query('SELECT gen_random_uuid() AS id');
    const suppId = uuidRes.rows[0].id;

    const phoneEnc = data.phone ? encryptField(data.phone, `suppliers.phone.${suppId}`) : null;
    const phoneBidx = data.phone ? computeBlindIndex(data.phone, 'phone') : null;

    const gstinEnc = data.gstin ? encryptField(data.gstin, `suppliers.gstin.${suppId}`) : null;
    const gstinBidx = data.gstin ? computeBlindIndex(data.gstin, 'gstin') : null;

    const addressEnc = data.address ? encryptField(data.address, `suppliers.address.${suppId}`) : null;

    const insertRes = await db.query(
      `INSERT INTO suppliers (id, name, phone_enc, phone_bidx, gstin_enc, gstin_bidx, address_enc, state_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [suppId, data.name, phoneEnc, phoneBidx, gstinEnc, gstinBidx, addressEnc, data.state_code]
    );

    const decrypted = decryptSupplier(insertRes.rows[0]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'supplier_created',
      entity: 'suppliers',
      entityId: suppId,
      clientIp,
      diff: { name: data.name, state_code: data.state_code }
    });

    res.status(201).json(decrypted);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireAuth, validateParams(z.object({ id: z.string().uuid() })), validateBody(supplierSchema), async (req, res, next) => {
  const suppId = req.validatedParams.id;
  const data = req.validatedBody;
  const clientIp = getClientIp(req);

  try {
    const existing = await db.query('SELECT * FROM suppliers WHERE id = $1', [suppId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const phoneEnc = data.phone ? encryptField(data.phone, `suppliers.phone.${suppId}`) : null;
    const phoneBidx = data.phone ? computeBlindIndex(data.phone, 'phone') : null;

    const gstinEnc = data.gstin ? encryptField(data.gstin, `suppliers.gstin.${suppId}`) : null;
    const gstinBidx = data.gstin ? computeBlindIndex(data.gstin, 'gstin') : null;

    const addressEnc = data.address ? encryptField(data.address, `suppliers.address.${suppId}`) : null;

    const updateRes = await db.query(
      `UPDATE suppliers
       SET name = $1, phone_enc = $2, phone_bidx = $3, gstin_enc = $4,
           gstin_bidx = $5, address_enc = $6, state_code = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [data.name, phoneEnc, phoneBidx, gstinEnc, gstinBidx, addressEnc, data.state_code, suppId]
    );

    const decrypted = decryptSupplier(updateRes.rows[0]);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'supplier_updated',
      entity: 'suppliers',
      entityId: suppId,
      clientIp,
      diff: { name: data.name, state_code: data.state_code }
    });

    res.json(decrypted);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const suppId = req.validatedParams.id;
  try {
    const delRes = await db.query('DELETE FROM suppliers WHERE id = $1 RETURNING name', [suppId]);
    if (delRes.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'supplier_deleted',
      entity: 'suppliers',
      entityId: suppId,
      clientIp: getClientIp(req),
      diff: delRes.rows[0]
    });

    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete supplier with existing purchase orders.' });
    }
    next(err);
  }
});

export default router;
