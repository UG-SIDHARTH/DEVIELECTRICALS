import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateQuery, validateParams } from '../middleware/validate.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

const paymentListQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  documentId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

router.get('/', requireAuth, validateQuery(paymentListQuerySchema), async (req, res, next) => {
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  let pIdx = 1;

  if (req.validatedQuery.documentId) {
    conditions.push(`p.document_id = $${pIdx++}`);
    params.push(req.validatedQuery.documentId);
  }

  if (req.validatedQuery.startDate) {
    conditions.push(`p.payment_date >= $${pIdx++}`);
    params.push(req.validatedQuery.startDate);
  }

  if (req.validatedQuery.endDate) {
    conditions.push(`p.payment_date <= $${pIdx++}`);
    params.push(req.validatedQuery.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await db.query(`SELECT COUNT(*) FROM payments p ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const listRes = await db.query(
      `SELECT p.*, d.doc_number, d.doc_type, c.name AS customer_name
       FROM payments p
       JOIN documents d ON p.document_id = d.id
       LEFT JOIN customers c ON d.customer_id = c.id
       ${where}
       ORDER BY p.payment_date DESC, p.created_at DESC
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

router.delete('/:id', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const paymentId = req.validatedParams.id;
  const clientIp = getClientIp(req);

  try {
    const updated = await db.withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
      if (pRes.rows.length === 0) {
        throw new Error('Payment not found');
      }

      const payment = pRes.rows[0];
      const docId = payment.document_id;

      await client.query('DELETE FROM payments WHERE id = $1', [paymentId]);

      // Recalculate document paid amount and status
      const sumRes = await client.query('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE document_id = $1', [docId]);
      const totalPaid = parseInt(sumRes.rows[0].total, 10);

      const docRes = await client.query('SELECT grand_total, status FROM documents WHERE id = $1', [docId]);
      const doc = docRes.rows[0];

      let newStatus = doc.status;
      if (doc.status !== 'cancelled') {
        if (totalPaid >= doc.grand_total) {
          newStatus = 'paid';
        } else if (totalPaid > 0) {
          newStatus = 'partially_paid';
        } else {
          newStatus = 'unpaid';
        }
      }

      await client.query(
        'UPDATE documents SET paid_amount = $1, status = $2 WHERE id = $3',
        [totalPaid, newStatus, docId]
      );

      return { payment, totalPaid, newStatus };
    });

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'payment_deleted',
      entity: 'payments',
      entityId: paymentId,
      clientIp,
      diff: updated.payment
    });

    res.json({ success: true, updatedDocStatus: updated.newStatus });
  } catch (err) {
    next(err);
  }
});

export default router;
