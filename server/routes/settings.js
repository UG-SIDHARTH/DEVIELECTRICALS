import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { encryptField, decryptField, computeBlindIndex } from '../security/crypto.js';
import { hashPassword, validatePasswordStrength } from '../security/passwords.js';
import { destroyAllUserSessions } from '../security/sessions.js';
import { validatePrefix } from '../services/numbering.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

function decryptSettings(row) {
  if (!row) return null;
  return {
    businessName: row.business_name,
    address: row.address,
    phone: row.phone,
    stateCode: row.state_code,
    stateName: row.state_name,
    gstin: decryptField(row.gstin_enc, 'settings.gstin.1') || '',
    gstRegistered: row.gst_registered,
    bankName: decryptField(row.bank_name_enc, 'settings.bank_name.1') || '',
    bankAccount: decryptField(row.bank_account_enc, 'settings.bank_account.1') || '',
    bankIfsc: decryptField(row.bank_ifsc_enc, 'settings.bank_ifsc.1') || '',
    bankBranch: decryptField(row.bank_branch_enc, 'settings.bank_branch.1') || '',
    upiId: decryptField(row.upi_id_enc, 'settings.upi_id.1') || '',
    openingTime: row.opening_time || '',
    logoData: row.logo_data || '',
    invoicePrefix: row.invoice_prefix,
    quotationPrefix: row.quotation_prefix,
    challanPrefix: row.challan_prefix,
    purchasePrefix: row.purchase_prefix,
    defaultGstRate: Number(row.default_gst_rate),
    quotationValidityDays: row.quotation_validity_days,
    allowNegativeStock: row.allow_negative_stock,
    scanRetentionDays: row.scan_retention_days,
    termsAndConditions: row.terms_and_conditions || '',
    updatedAt: row.updated_at
  };
}

// 1. Get Store Settings
router.get('/', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const resRow = await db.query('SELECT * FROM settings WHERE id = 1');
    if (resRow.rows.length === 0) {
      await db.query('INSERT INTO settings (id) VALUES (1) ON CONFLICT DO NOTHING');
      const fresh = await db.query('SELECT * FROM settings WHERE id = 1');
      return res.json(decryptSettings(fresh.rows[0]));
    }
    res.json(decryptSettings(resRow.rows[0]));
  } catch (err) {
    next(err);
  }
});

const settingsUpdateSchema = z.object({
  businessName: z.string().min(1).max(100),
  address: z.string().min(5).max(300),
  phone: z.string().min(10).max(20),
  stateCode: z.string().length(2).default('32'),
  stateName: z.string().min(1).max(50).default('Kerala'),
  gstin: z.string().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).nullable().optional(),
  gstRegistered: z.boolean().default(false),
  bankName: z.string().max(100).nullable().optional(),
  bankAccount: z.string().max(50).nullable().optional(),
  bankIfsc: z.string().regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/).nullable().optional(),
  bankBranch: z.string().max(100).nullable().optional(),
  upiId: z.string().max(100).nullable().optional(),
  openingTime: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  logoData: z.string().max(250000).nullable().optional(), // 200KB base64 cap
  invoicePrefix: z.string().min(1).max(6),
  quotationPrefix: z.string().min(1).max(6),
  challanPrefix: z.string().min(1).max(6),
  purchasePrefix: z.string().min(1).max(6),
  defaultGstRate: z.number().nonnegative().default(18.00),
  quotationValidityDays: z.number().int().positive().default(15),
  allowNegativeStock: z.boolean().default(false),
  scanRetentionDays: z.number().int().positive().default(30),
  termsAndConditions: z.string().max(1000).nullable().optional()
}).strict();

// 2. Update Store Settings
router.put('/', requireAuth, requireOwner, validateBody(settingsUpdateSchema), async (req, res, next) => {
  const d = req.validatedBody;
  const clientIp = getClientIp(req);

  // Validate prefixes
  for (const [key, pfx] of [
    ['invoicePrefix', d.invoicePrefix],
    ['quotationPrefix', d.quotationPrefix],
    ['challanPrefix', d.challanPrefix],
    ['purchasePrefix', d.purchasePrefix]
  ]) {
    const v = validatePrefix(pfx);
    if (!v.valid) {
      return res.status(400).json({ error: `${key}: ${v.message}` });
    }
  }

  try {
    const gstinEnc = d.gstin ? encryptField(d.gstin, 'settings.gstin.1') : null;
    const gstinBidx = d.gstin ? computeBlindIndex(d.gstin, 'gstin') : null;

    const bankNameEnc = d.bankName ? encryptField(d.bankName, 'settings.bank_name.1') : null;
    const bankAccountEnc = d.bankAccount ? encryptField(d.bankAccount, 'settings.bank_account.1') : null;
    const bankIfscEnc = d.bankIfsc ? encryptField(d.bankIfsc, 'settings.bank_ifsc.1') : null;
    const bankBranchEnc = d.bankBranch ? encryptField(d.bankBranch, 'settings.bank_branch.1') : null;
    const upiIdEnc = d.upiId ? encryptField(d.upiId, 'settings.upi_id.1') : null;

    const upRes = await db.query(
      `UPDATE settings
       SET business_name = $1, address = $2, phone = $3, state_code = $4, state_name = $5,
           gstin_enc = $6, gstin_bidx = $7, gst_registered = $8,
           bank_name_enc = $9, bank_account_enc = $10, bank_ifsc_enc = $11, bank_branch_enc = $12, upi_id_enc = $13,
           opening_time = $14, logo_data = $15,
           invoice_prefix = $16, quotation_prefix = $17, challan_prefix = $18, purchase_prefix = $19,
           default_gst_rate = $20, quotation_validity_days = $21, allow_negative_stock = $22,
           scan_retention_days = $23, terms_and_conditions = $24, updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        d.businessName, d.address, d.phone, d.stateCode, d.stateName,
        gstinEnc, gstinBidx, d.gstRegistered,
        bankNameEnc, bankAccountEnc, bankIfscEnc, bankBranchEnc, upiIdEnc,
        d.openingTime || null, d.logoData || null,
        d.invoicePrefix, d.quotationPrefix, d.challanPrefix, d.purchasePrefix,
        d.defaultGstRate, d.quotationValidityDays, d.allowNegativeStock,
        d.scanRetentionDays, d.termsAndConditions || null
      ]
    );

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'settings_updated',
      entity: 'settings',
      entityId: '1',
      clientIp,
      diff: { gst_registered: d.gstRegistered, allow_negative_stock: d.allowNegativeStock }
    });

    res.json(decryptSettings(upRes.rows[0]));
  } catch (err) {
    next(err);
  }
});

// 3. User Management (Owner Only)
router.get('/users', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const usersRes = await db.query(
      `SELECT id, username, role, disabled, totp_enabled, failed_attempts, locked_until, created_at, updated_at
       FROM users
       ORDER BY created_at ASC`
    );
    res.json({ users: usersRes.rows });
  } catch (err) {
    next(err);
  }
});

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/, { message: 'Username may only contain letters, numbers, underscores, and dashes' }),
  password: z.string().min(12),
  role: z.enum(['staff', 'owner']).default('staff')
}).strict();

router.post('/users', requireAuth, requireOwner, validateBody(createUserSchema), async (req, res, next) => {
  const { username, password, role } = req.validatedBody;
  const clientIp = getClientIp(req);

  const pwdCheck = validatePasswordStrength(password);
  if (!pwdCheck.valid) {
    return res.status(400).json({ error: pwdCheck.message });
  }

  try {
    const passwordHash = await hashPassword(password);

    const insertRes = await db.query(
      `INSERT INTO users (username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, username, role, disabled, totp_enabled, created_at`,
      [username.toLowerCase().trim(), passwordHash, role]
    );

    const newUser = insertRes.rows[0];

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'user_created',
      entity: 'users',
      entityId: newUser.id,
      clientIp,
      diff: { username: newUser.username, role: newUser.role }
    });

    res.status(201).json(newUser);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already in use' });
    }
    next(err);
  }
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(12)
}).strict();

router.put('/users/:id/password', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), validateBody(resetPasswordSchema), async (req, res, next) => {
  const targetUserId = req.validatedParams.id;
  const { newPassword } = req.validatedBody;
  const clientIp = getClientIp(req);

  const pwdCheck = validatePasswordStrength(newPassword);
  if (!pwdCheck.valid) {
    return res.status(400).json({ error: pwdCheck.message });
  }

  try {
    const hash = await hashPassword(newPassword);
    await db.query('UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $2', [hash, targetUserId]);
    
    // Invalidate existing sessions for the target user
    await destroyAllUserSessions(targetUserId);

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'user_password_reset',
      entity: 'users',
      entityId: targetUserId,
      clientIp
    });

    res.json({ success: true, message: 'Password updated and all user sessions terminated' });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:id/toggle-disabled', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const targetUserId = req.validatedParams.id;
  const clientIp = getClientIp(req);

  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'You cannot disable your own user account' });
  }

  try {
    const userRes = await db.query('SELECT disabled, username FROM users WHERE id = $1', [targetUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const nextState = !userRes.rows[0].disabled;
    await db.query('UPDATE users SET disabled = $1, updated_at = NOW() WHERE id = $2', [nextState, targetUserId]);

    if (nextState) {
      await destroyAllUserSessions(targetUserId);
    }

    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: nextState ? 'user_disabled' : 'user_enabled',
      entity: 'users',
      entityId: targetUserId,
      clientIp
    });

    res.json({ success: true, disabled: nextState });
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/logout-all', requireAuth, requireOwner, validateParams(z.object({ id: z.string().uuid() })), async (req, res, next) => {
  const targetUserId = req.validatedParams.id;
  try {
    await destroyAllUserSessions(targetUserId);
    res.json({ success: true, message: 'All active sessions for this user have been revoked' });
  } catch (err) {
    next(err);
  }
});

export default router;
