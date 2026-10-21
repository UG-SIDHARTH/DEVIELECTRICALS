import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateQuery } from '../middleware/validate.js';
import { decryptField } from '../security/crypto.js';

const router = express.Router();

const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

function getDefaultDateRange(query) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const defaultStart = `${year}-${month}-01`;
  const defaultEnd = now.toISOString().split('T')[0];

  return {
    startDate: query.startDate || defaultStart,
    endDate: query.endDate || defaultEnd
  };
}

// 1. Sales Register
router.get('/sales', requireAuth, validateQuery(dateRangeSchema), async (req, res, next) => {
  const { startDate, endDate } = getDefaultDateRange(req.validatedQuery);

  try {
    const listRes = await db.query(
      `SELECT d.id, d.doc_number, d.doc_date, d.status, d.taxable_amount, d.cgst_amount,
              d.sgst_amount, d.igst_amount, d.extra_charges, d.round_off, d.grand_total,
              d.paid_amount, c.name AS customer_name
       FROM documents d
       LEFT JOIN customers c ON d.customer_id = c.id
       WHERE d.doc_type = 'invoice' AND d.status != 'cancelled'
         AND d.doc_date >= $1 AND d.doc_date <= $2
       ORDER BY d.doc_date ASC, d.doc_number ASC`,
      [startDate, endDate]
    );

    const totalsRes = await db.query(
      `SELECT COALESCE(SUM(taxable_amount), 0) AS total_taxable,
              COALESCE(SUM(cgst_amount), 0) AS total_cgst,
              COALESCE(SUM(sgst_amount), 0) AS total_sgst,
              COALESCE(SUM(igst_amount), 0) AS total_igst,
              COALESCE(SUM(grand_total), 0) AS total_grand,
              COALESCE(SUM(paid_amount), 0) AS total_paid
       FROM documents
       WHERE doc_type = 'invoice' AND status != 'cancelled'
         AND doc_date >= $1 AND doc_date <= $2`,
      [startDate, endDate]
    );

    res.json({
      startDate,
      endDate,
      invoices: listRes.rows,
      totals: totalsRes.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

// 2. Purchase Register
router.get('/purchases', requireAuth, validateQuery(dateRangeSchema), async (req, res, next) => {
  const { startDate, endDate } = getDefaultDateRange(req.validatedQuery);

  try {
    const listRes = await db.query(
      `SELECT d.id, d.doc_number, d.doc_date, d.taxable_amount, d.cgst_amount,
              d.sgst_amount, d.igst_amount, d.grand_total, s.name AS supplier_name
       FROM documents d
       LEFT JOIN suppliers s ON d.supplier_id = s.id
       WHERE d.doc_type = 'purchase'
         AND d.doc_date >= $1 AND d.doc_date <= $2
       ORDER BY d.doc_date ASC`,
      [startDate, endDate]
    );

    const totalsRes = await db.query(
      `SELECT COALESCE(SUM(taxable_amount), 0) AS total_taxable,
              COALESCE(SUM(cgst_amount), 0) AS total_cgst,
              COALESCE(SUM(sgst_amount), 0) AS total_sgst,
              COALESCE(SUM(igst_amount), 0) AS total_igst,
              COALESCE(SUM(grand_total), 0) AS total_grand
       FROM documents
       WHERE doc_type = 'purchase'
         AND doc_date >= $1 AND doc_date <= $2`,
      [startDate, endDate]
    );

    res.json({
      startDate,
      endDate,
      purchases: listRes.rows,
      totals: totalsRes.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

// 3. GST Summary Report
router.get('/gst-summary', requireAuth, validateQuery(dateRangeSchema), async (req, res, next) => {
  const { startDate, endDate } = getDefaultDateRange(req.validatedQuery);

  try {
    const summaryRes = await db.query(
      `SELECT dl.gst_rate,
              COALESCE(SUM(dl.taxable_amount), 0) AS total_taxable,
              COALESCE(SUM(dl.cgst_amount), 0) AS total_cgst,
              COALESCE(SUM(dl.sgst_amount), 0) AS total_sgst,
              COALESCE(SUM(dl.igst_amount), 0) AS total_igst,
              COALESCE(SUM(dl.cgst_amount + dl.sgst_amount + dl.igst_amount), 0) AS total_tax
       FROM document_lines dl
       JOIN documents d ON dl.document_id = d.id
       WHERE d.doc_type = 'invoice' AND d.status != 'cancelled'
         AND d.doc_date >= $1 AND d.doc_date <= $2
       GROUP BY dl.gst_rate
       ORDER BY dl.gst_rate ASC`,
      [startDate, endDate]
    );

    res.json({
      startDate,
      endDate,
      rateBreakdown: summaryRes.rows
    });
  } catch (err) {
    next(err);
  }
});

// 4. Outstanding Receivables with Ageing Buckets (0-30, 31-60, 60+ days)
router.get('/outstanding', requireAuth, async (req, res, next) => {
  try {
    const listRes = await db.query(
      `SELECT d.id, d.doc_number, d.doc_date, d.due_date, d.grand_total, d.paid_amount,
              (d.grand_total - d.paid_amount) AS balance_due,
              (CURRENT_DATE - d.doc_date) AS days_outstanding,
              c.id AS customer_id, c.name AS customer_name, c.phone_enc
       FROM documents d
       JOIN customers c ON d.customer_id = c.id
       WHERE d.doc_type = 'invoice' AND d.status IN ('unpaid', 'partially_paid')
       ORDER BY days_outstanding DESC, d.doc_date ASC`
    );

    let bucket0_30 = 0;
    let bucket31_60 = 0;
    let bucket60Plus = 0;
    let totalOutstanding = 0;

    const invoices = listRes.rows.map(row => {
      const balance = parseInt(row.balance_due, 10);
      const days = parseInt(row.days_outstanding, 10);
      totalOutstanding += balance;

      if (days <= 30) bucket0_30 += balance;
      else if (days <= 60) bucket31_60 += balance;
      else bucket60Plus += balance;

      let phone = '';
      if (row.phone_enc) {
        phone = decryptField(row.phone_enc, `customers.phone.${row.customer_id}`) || '';
      }

      return {
        id: row.id,
        docNumber: row.doc_number,
        docDate: row.doc_date,
        dueDate: row.due_date,
        grandTotal: parseInt(row.grand_total, 10),
        paidAmount: parseInt(row.paid_amount, 10),
        balanceDue: balance,
        daysOutstanding: days,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerPhone: phone
      };
    });

    res.json({
      totalOutstanding,
      ageing: {
        bucket0_30,
        bucket31_60,
        bucket60Plus
      },
      invoices
    });
  } catch (err) {
    next(err);
  }
});

// 5. Stock Summary
router.get('/stock', requireAuth, async (req, res, next) => {
  const isOwner = req.user.role === 'owner';
  try {
    const selectCols = isOwner
      ? 'id, sku, barcode, name, category, spec, unit, purchase_price, selling_price, current_stock, min_stock, rack_location'
      : 'id, sku, barcode, name, category, spec, unit, selling_price, current_stock, min_stock, rack_location';

    const prodRes = await db.query(`SELECT ${selectCols} FROM products ORDER BY category ASC, name ASC`);

    let totalStockValueSelling = 0;
    let totalStockValuePurchase = 0;

    for (const p of prodRes.rows) {
      const stock = Number(p.current_stock);
      const sell = parseInt(p.selling_price, 10);
      totalStockValueSelling += Math.round(stock * sell);

      if (isOwner && p.purchase_price) {
        const pur = parseInt(p.purchase_price, 10);
        totalStockValuePurchase += Math.round(stock * pur);
      }
    }

    res.json({
      products: prodRes.rows,
      summary: {
        totalProducts: prodRes.rows.length,
        totalStockValueSelling,
        totalStockValuePurchase: isOwner ? totalStockValuePurchase : undefined
      }
    });
  } catch (err) {
    next(err);
  }
});

// 6. Low Stock Reorder List
router.get('/low-stock', requireAuth, async (req, res, next) => {
  try {
    const lowRes = await db.query(
      `SELECT id, sku, name, brand, category, spec, unit, selling_price, current_stock, min_stock, rack_location
       FROM products
       WHERE current_stock <= min_stock
       ORDER BY (min_stock - current_stock) DESC, name ASC`
    );

    res.json({
      count: lowRes.rows.length,
      items: lowRes.rows
    });
  } catch (err) {
    next(err);
  }
});

// 7. Profit & Margin Report (STRICTLY OWNER ONLY)
router.get('/profit', requireAuth, requireOwner, validateQuery(dateRangeSchema), async (req, res, next) => {
  const { startDate, endDate } = getDefaultDateRange(req.validatedQuery);

  try {
    const profitRes = await db.query(
      `SELECT dl.description,
              dl.qty,
              dl.rate,
              dl.taxable_amount,
              dl.purchase_price,
              (dl.taxable_amount - (dl.qty * dl.purchase_price)) AS gross_profit,
              d.doc_number,
              d.doc_date
       FROM document_lines dl
       JOIN documents d ON dl.document_id = d.id
       WHERE d.doc_type = 'invoice' AND d.status != 'cancelled'
         AND d.doc_date >= $1 AND d.doc_date <= $2
       ORDER BY d.doc_date ASC`,
      [startDate, endDate]
    );

    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;

    for (const item of profitRes.rows) {
      const rev = parseInt(item.taxable_amount, 10);
      const cost = Math.round(Number(item.qty) * parseInt(item.purchase_price, 10));
      const prof = rev - cost;

      totalRevenue += rev;
      totalCost += cost;
      totalProfit += prof;
    }

    const marginPercent = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(2) : '0.00';

    res.json({
      startDate,
      endDate,
      totalRevenue,
      totalCost,
      totalProfit,
      marginPercent,
      items: profitRes.rows
    });
  } catch (err) {
    next(err);
  }
});

// 8. Expense Summary
router.get('/expenses', requireAuth, validateQuery(dateRangeSchema), async (req, res, next) => {
  const { startDate, endDate } = getDefaultDateRange(req.validatedQuery);

  try {
    const catRes = await db.query(
      `SELECT category, COUNT(*) as count, COALESCE(SUM(amount), 0) AS total_amount
       FROM expenses
       WHERE expense_date >= $1 AND expense_date <= $2
       GROUP BY category
       ORDER BY total_amount DESC`,
      [startDate, endDate]
    );

    const totalRes = await db.query(
      'SELECT COALESCE(SUM(amount), 0) AS grand_total FROM expenses WHERE expense_date >= $1 AND expense_date <= $2',
      [startDate, endDate]
    );

    res.json({
      startDate,
      endDate,
      byCategory: catRes.rows,
      grandTotal: parseInt(totalRes.rows[0].grand_total, 10)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
