import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { adjustProductStock } from '../services/stock.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

const adjustSchema = z.object({
  productId: z.string().uuid(),
  newStock: z.number().nonnegative(),
  reason: z.string().min(3).max(300)
}).strict();

router.post('/adjust', requireAuth, validateBody(adjustSchema), async (req, res, next) => {
  const { productId, newStock, reason } = req.validatedBody;
  const userId = req.user.id;
  const clientIp = getClientIp(req);

  try {
    const result = await db.withTransaction(async (client) => {
      return await adjustProductStock(client, productId, newStock, reason, userId);
    });

    await logAuditEvent({
      userId,
      username: req.user.username,
      action: 'stock_adjusted',
      entity: 'products',
      entityId: productId,
      clientIp,
      diff: { ...result, reason }
    });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

const movementsQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50')
});

router.get('/movements/:productId', requireAuth, validateParams(z.object({ productId: z.string().uuid() })), validateQuery(movementsQuerySchema), async (req, res, next) => {
  const productId = req.validatedParams.productId;
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;

  try {
    const countRes = await db.query(
      'SELECT COUNT(*) FROM stock_movements WHERE product_id = $1',
      [productId]
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const listRes = await db.query(
      `SELECT sm.*, d.doc_number, d.doc_type, u.username AS created_by_user
       FROM stock_movements sm
       LEFT JOIN documents d ON sm.document_id = d.id
       LEFT JOIN users u ON sm.created_by = u.id
       WHERE sm.product_id = $1
       ORDER BY sm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [productId, limit, offset]
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

export default router;
