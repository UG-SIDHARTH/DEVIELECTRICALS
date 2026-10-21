import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

const expenseQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  category: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional()
});

router.get('/', requireAuth, validateQuery(expenseQuerySchema), async (req, res, next) => {
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  let pIdx = 1;

  if (req.validatedQuery.category && req.validatedQuery.category !== 'all') {
    conditions.push(`category = $${pIdx++}`);
    params.push(req.validatedQuery.category);
  }

  if (req.validatedQuery.startDate) {
    conditions.push(`expense_date >= $${pIdx++}`);
    params.push(req.validatedQuery.startDate);
  }

  if (req.validatedQuery.endDate) {
    conditions.push(`expense_date <= $${pIdx++}`);
    params.push(req.validatedQuery.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await db.query(`SELECT COUNT(*) FROM expenses ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const listRes = await db.query(
      `SELECT e.*, u.username AS created_by_user
       FROM expenses e
       LEFT JOIN users u ON e.created_by = u.id
       ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC
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

const expenseSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().min(1).max(100),
  amount: z.number().int().positive(), // paise
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque']),
  description: z.string().min(1).max(500),
  reference: z.string().max(100).nullable().optional()
}).strict();

router.post('/', requireAuth, validateBody(expenseSchema), async (req, res, next) => {
  const data = req.validatedBody;
  const userId = req.user.id;
  const clientIp = getClientIp(req);

  try {
    const insertRes = await db.query(
      `INSERT INTO expenses (expense_date, category, amount, payment_mode, description, reference, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        data.expenseDate || new Date().toISOString().split('T')[0],
        data.category,
        data.amount,
        data.paymentMode,
        data.description,
        data.reference || null,
        userId
      ]
    );

    const expense = insertRes.rows[0];

    await logAuditEvent({
      userId,
      username: req.user.username,
      action: 'expense_created',
      entity: 'expenses',
      entityId: expense.id,
      clientIp,
      diff: { category: expense.category, amount: expense.amount }
    });

    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const expenseId = req.validatedParams.id;
  const clientIp = getClientIp(req);

  try {
    const delRes = await db.query('DELETE FROM expenses WHERE id = $1 RETURNING *', [expenseId]);
    if (delRes.rows.length === 0) {
      return res.status(404).json({ error: 'Expense record not found' });
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'expense_deleted',
      entity: 'expenses',
      entityId: expenseId,
      clientIp,
      diff: delRes.rows[0]
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
