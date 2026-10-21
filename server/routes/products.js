import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

const productQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  search: z.string().optional(),
  category: z.string().optional(),
  stockFilter: z.enum(['all', 'low', 'out']).optional().default('all')
});

router.get('/', requireAuth, validateQuery(productQuerySchema), async (req, res, next) => {
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;
  const isOwner = req.user.role === 'owner';

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (req.validatedQuery.search) {
    const term = `%${req.validatedQuery.search.trim()}%`;
    conditions.push(`(name ILIKE $${paramIdx} OR sku ILIKE $${paramIdx} OR barcode ILIKE $${paramIdx} OR spec ILIKE $${paramIdx} OR keywords ILIKE $${paramIdx})`);
    params.push(term);
    paramIdx++;
  }

  if (req.validatedQuery.category && req.validatedQuery.category !== 'all') {
    conditions.push(`category = $${paramIdx}`);
    params.push(req.validatedQuery.category);
    paramIdx++;
  }

  if (req.validatedQuery.stockFilter === 'low') {
    conditions.push('current_stock <= min_stock AND current_stock > 0');
  } else if (req.validatedQuery.stockFilter === 'out') {
    conditions.push('current_stock <= 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await db.query(`SELECT COUNT(*) FROM products ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    // If staff, omit purchase_price from SELECT
    const selectCols = isOwner
      ? 'id, sku, barcode, name, brand, category, spec, hsn, unit, purchase_price, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at'
      : 'id, sku, barcode, name, brand, category, spec, hsn, unit, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at';

    params.push(limit, offset);
    const listRes = await db.query(
      `SELECT ${selectCols} FROM products ${whereClause} ORDER BY name ASC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
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
  const isOwner = req.user.role === 'owner';
  const selectCols = isOwner
    ? 'id, sku, barcode, name, brand, category, spec, hsn, unit, purchase_price, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at'
    : 'id, sku, barcode, name, brand, category, spec, hsn, unit, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at';

  try {
    const prodRes = await db.query(`SELECT ${selectCols} FROM products WHERE id = $1`, [req.validatedParams.id]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(prodRes.rows[0]);
  } catch (err) {
    next(err);
  }
});

const productSchema = z.object({
  sku: z.string().min(1).max(50),
  barcode: z.string().max(100).nullable().optional(),
  name: z.string().min(1).max(200),
  brand: z.string().max(100).nullable().optional(),
  category: z.string().min(1).max(100),
  spec: z.string().max(200).nullable().optional(),
  hsn: z.string().regex(/^$|^\d{4}$|^\d{6}$|^\d{8}$/, { message: 'HSN must be 4, 6, or 8 digits' }).nullable().optional(),
  unit: z.string().min(1).max(20).default('Nos'),
  purchase_price: z.number().int().nonnegative().optional().default(0), // paise
  selling_price: z.number().int().nonnegative(), // paise
  gst_rate: z.number().nonnegative().default(18.00),
  current_stock: z.number().default(0),
  min_stock: z.number().nonnegative().default(0),
  rack_location: z.string().max(100).nullable().optional(),
  keywords: z.string().nullable().optional()
}).strict();

router.post('/', requireAuth, validateBody(productSchema), async (req, res, next) => {
  const data = req.validatedBody;
  const isOwner = req.user.role === 'owner';
  const purchasePrice = isOwner ? data.purchase_price : 0;

  try {
    const insertRes = await db.query(
      `INSERT INTO products (sku, barcode, name, brand, category, spec, hsn, unit, purchase_price, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
       RETURNING *`,
      [
        data.sku,
        data.barcode || null,
        data.name,
        data.brand || null,
        data.category,
        data.spec || null,
        data.hsn || null,
        data.unit,
        purchasePrice,
        data.selling_price,
        data.gst_rate,
        data.current_stock,
        data.min_stock,
        data.rack_location || null,
        data.keywords || null
      ]
    );

    const product = insertRes.rows[0];
    if (!isOwner) delete product.purchase_price;

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'product_created',
      entity: 'products',
      entityId: product.id,
      clientIp: getClientIp(req),
      diff: { name: product.name, sku: product.sku, selling_price: product.selling_price }
    });

    res.status(201).json(product);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A product with this SKU already exists.' });
    }
    next(err);
  }
});

router.put('/:id', requireAuth, validateParams(z.object({ id: z.string().uuid() })), validateBody(productSchema), async (req, res, next) => {
  const data = req.validatedBody;
  const isOwner = req.user.role === 'owner';
  const prodId = req.validatedParams.id;

  try {
    const existingRes = await db.query('SELECT * FROM products WHERE id = $1', [prodId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const prev = existingRes.rows[0];
    const purchasePrice = isOwner ? data.purchase_price : prev.purchase_price;

    const updateRes = await db.query(
      `UPDATE products
       SET sku = $1, barcode = $2, name = $3, brand = $4, category = $5, spec = $6,
           hsn = $7, unit = $8, purchase_price = $9, selling_price = $10, gst_rate = $11,
           current_stock = $12, min_stock = $13, rack_location = $14, keywords = $15,
           updated_at = NOW()
       WHERE id = $16
       RETURNING *`,
      [
        data.sku,
        data.barcode || null,
        data.name,
        data.brand || null,
        data.category,
        data.spec || null,
        data.hsn || null,
        data.unit,
        purchasePrice,
        data.selling_price,
        data.gst_rate,
        data.current_stock,
        data.min_stock,
        data.rack_location || null,
        data.keywords || null,
        prodId
      ]
    );

    const updated = updateRes.rows[0];
    if (!isOwner) delete updated.purchase_price;

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'product_updated',
      entity: 'products',
      entityId: prodId,
      clientIp: getClientIp(req),
      diff: {
        priceChange: prev.selling_price !== data.selling_price ? { from: prev.selling_price, to: data.selling_price } : undefined,
        stockChange: prev.current_stock !== data.current_stock ? { from: prev.current_stock, to: data.current_stock } : undefined
      }
    });

    res.json(updated);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another product with this SKU already exists.' });
    }
    next(err);
  }
});

router.delete('/:id', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const prodId = req.validatedParams.id;
  try {
    const delRes = await db.query('DELETE FROM products WHERE id = $1 RETURNING name, sku', [prodId]);
    if (delRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'product_deleted',
      entity: 'products',
      entityId: prodId,
      clientIp: getClientIp(req),
      diff: delRes.rows[0]
    });

    res.json({ success: true, deleted: delRes.rows[0] });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete product because it has associated invoice history or stock movements.' });
    }
    next(err);
  }
});

// CSV Import
router.post('/import', requireAuth, async (req, res, next) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invalid payload: array of items required' });
  }

  const isOwner = req.user.role === 'owner';
  let importedCount = 0;
  const errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const validation = productSchema.safeParse({
      sku: item.sku ? String(item.sku).trim() : `SKU-${Date.now()}-${i}`,
      barcode: item.barcode ? String(item.barcode).trim() : null,
      name: item.name ? String(item.name).trim() : 'Unnamed Item',
      brand: item.brand ? String(item.brand).trim() : null,
      category: item.category ? String(item.category).trim() : 'Wires & Cables',
      spec: item.spec ? String(item.spec).trim() : null,
      hsn: item.hsn ? String(item.hsn).trim() : null,
      unit: item.unit ? String(item.unit).trim() : 'Nos',
      purchase_price: isOwner && item.purchase_price ? Math.round(Number(item.purchase_price) * 100) : 0,
      selling_price: Math.round(Number(item.selling_price || 0) * 100),
      gst_rate: Number(item.gst_rate) || 18.00,
      current_stock: Number(item.current_stock) || 0,
      min_stock: Number(item.min_stock) || 0,
      rack_location: item.rack_location ? String(item.rack_location).trim() : null,
      keywords: item.keywords ? String(item.keywords).trim() : null
    });

    if (!validation.success) {
      errors.push({ row: i + 1, errors: validation.error.errors.map(e => e.message) });
      continue;
    }

    const d = validation.data;
    try {
      await db.query(
        `INSERT INTO products (sku, barcode, name, brand, category, spec, hsn, unit, purchase_price, selling_price, gst_rate, current_stock, min_stock, rack_location, keywords, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name,
           selling_price = EXCLUDED.selling_price,
           gst_rate = EXCLUDED.gst_rate,
           current_stock = EXCLUDED.current_stock,
           updated_at = NOW()`,
        [d.sku, d.barcode, d.name, d.brand, d.category, d.spec, d.hsn, d.unit, d.purchase_price, d.selling_price, d.gst_rate, d.current_stock, d.min_stock, d.rack_location, d.keywords]
      );
      importedCount++;
    } catch (err) {
      errors.push({ row: i + 1, error: err.message });
    }
  }

  await logAuditEvent({
    userId: req.user.id,
    username: req.user.username,
    action: 'products_imported_csv',
    entity: 'products',
    clientIp: getClientIp(req),
    diff: { importedCount, errorCount: errors.length }
  });

  res.json({ importedCount, errors });
});

// CSV Export
router.get('/export/csv', requireAuth, async (req, res, next) => {
  const isOwner = req.user.role === 'owner';
  try {
    const listRes = await db.query('SELECT * FROM products ORDER BY name ASC');
    
    // Build CSV safely with header and escaped fields
    const headers = isOwner
      ? ['sku', 'barcode', 'name', 'brand', 'category', 'spec', 'hsn', 'unit', 'purchase_price_inr', 'selling_price_inr', 'gst_rate', 'current_stock', 'min_stock', 'rack_location']
      : ['sku', 'barcode', 'name', 'brand', 'category', 'spec', 'hsn', 'unit', 'selling_price_inr', 'gst_rate', 'current_stock', 'min_stock', 'rack_location'];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = [headers.join(',')];
    for (const p of listRes.rows) {
      const row = isOwner ? [
        escapeCsv(p.sku),
        escapeCsv(p.barcode),
        escapeCsv(p.name),
        escapeCsv(p.brand),
        escapeCsv(p.category),
        escapeCsv(p.spec),
        escapeCsv(p.hsn),
        escapeCsv(p.unit),
        (p.purchase_price / 100).toFixed(2),
        (p.selling_price / 100).toFixed(2),
        p.gst_rate,
        p.current_stock,
        p.min_stock,
        escapeCsv(p.rack_location)
      ] : [
        escapeCsv(p.sku),
        escapeCsv(p.barcode),
        escapeCsv(p.name),
        escapeCsv(p.brand),
        escapeCsv(p.category),
        escapeCsv(p.spec),
        escapeCsv(p.hsn),
        escapeCsv(p.unit),
        (p.selling_price / 100).toFixed(2),
        p.gst_rate,
        p.current_stock,
        p.min_stock,
        escapeCsv(p.rack_location)
      ];
      rows.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="devi_products.csv"');
    res.send(rows.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

export default router;
