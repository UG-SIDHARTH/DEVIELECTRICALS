import express from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import { Jimp } from 'jimp';
import db from '../db/pool.js';
import config from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateBody } from '../middleware/validate.js';
import { scanLimiter } from '../middleware/rateLimits.js';
import { parseMaterialList } from '../services/scanParser.js';
import { matchScannedItems } from '../services/matcher.js';
import { parseWithAiVision } from '../services/aiScan.js';
import { encryptField } from '../security/crypto.js';
import { logAuditEvent } from '../security/audit.js';
import { getClientIp } from '../security/clientIp.js';

const router = express.Router();

// Startup self-test for sharp to detect illegal instruction on older Pentium CPUs
let useJimpFallback = false;
async function testSharpEngine() {
  try {
    const testBuf = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    await sharp(testBuf).webp().toBuffer();
    console.log('✓ Image processing engine: Sharp (libvips) active.');
  } catch (err) {
    console.warn(`WARNING: Sharp engine test failed (${err.message}). Activating Jimp fallback for older CPU compatibility.`);
    useJimpFallback = true;
  }
}
testSharpEngine();

/**
 * Validates magic bytes for image/jpeg, image/png, and image/webp
 */
function validateImageMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return 'image/png';
  }

  // WEBP: 'RIFF' .... 'WEBP'
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  if (riff === 'RIFF' && webp === 'WEBP') {
    return 'image/webp';
  }

  return false;
}

/**
 * Re-encodes image to WebP (max 1600px, quality 70) and strips all EXIF/GPS metadata
 */
async function processAndSanitizeImage(buffer) {
  if (!useJimpFallback) {
    try {
      return await sharp(buffer)
        .rotate() // auto-orient from EXIF before stripping
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 70 })
        .withMetadata(false) // Strip all EXIF and GPS tags
        .toBuffer();
    } catch (err) {
      console.warn(`Sharp processing error (${err.message}), falling back to Jimp`);
      useJimpFallback = true;
    }
  }

  // Fallback using Jimp
  const image = await Jimp.read(buffer);
  if (image.bitmap.width > 1600 || image.bitmap.height > 1600) {
    image.scaleToFit({ w: 1600, h: 1600 });
  }
  return await image.getBuffer('image/png');
}

// 1. Parse client-recognized OCR text and match against product catalog
const parseTextSchema = z.object({
  rawText: z.string().min(1).max(50000)
}).strict();

router.post('/parse', requireAuth, scanLimiter, validateBody(parseTextSchema), async (req, res, next) => {
  const { rawText } = req.validatedBody;

  try {
    const parsedItems = parseMaterialList(rawText);

    const [prodsRes, aliasesRes] = await Promise.all([
      db.query('SELECT * FROM products'),
      db.query('SELECT * FROM product_aliases')
    ]);

    const matched = matchScannedItems(parsedItems, prodsRes.rows, aliasesRes.rows);

    res.json({
      items: matched,
      rawItemCount: parsedItems.length
    });
  } catch (err) {
    next(err);
  }
});

// 2. Upload Material Image (Sanitized, stripped of EXIF, stored encrypted)
router.post('/upload', requireAuth, scanLimiter, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), async (req, res, next) => {
  const clientIp = getClientIp(req);

  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Image file required (JPEG, PNG, or WebP up to 8MB)' });
    }

    const mime = validateImageMagicBytes(req.body);
    if (!mime) {
      return res.status(400).json({ error: 'Invalid image format. Magic bytes do not match JPEG, PNG, or WebP.' });
    }

    // Sanitize, strip GPS, resize, and re-encode
    const sanitizedBuffer = await processAndSanitizeImage(req.body);

    // Encrypt stored image with AAD
    const historyIdRes = await db.query('SELECT gen_random_uuid() AS id');
    const historyId = historyIdRes.rows[0].id;
    const encryptedImage = encryptField(sanitizedBuffer.toString('base64'), `scan_history.image.${historyId}`);

    await db.query(
      `INSERT INTO scan_history (id, image_enc, created_by, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [historyId, encryptedImage, req.user.id]
    );

    res.json({
      historyId,
      processedSize: sanitizedBuffer.length,
      format: 'webp'
    });
  } catch (err) {
    next(err);
  }
});

// 3. Optional Server-Side AI Scan
router.post('/ai', requireAuth, scanLimiter, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), async (req, res, next) => {
  if (!config.ai.apiKey) {
    return res.status(404).json({ error: 'AI scan feature is not configured on this server' });
  }

  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Image file required for AI scan' });
    }

    const mime = validateImageMagicBytes(req.body);
    if (!mime) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const sanitizedBuffer = await processAndSanitizeImage(req.body);
    const matchedItems = await parseWithAiVision(sanitizedBuffer);

    res.json({
      items: matchedItems,
      provider: config.ai.provider,
      model: config.ai.model
    });
  } catch (err) {
    next(err);
  }
});

// 4. Remember product alias for OCR learning
const aliasSchema = z.object({
  productId: z.string().uuid(),
  alias: z.string().min(2).max(200)
}).strict();

router.post('/remember-alias', requireAuth, validateBody(aliasSchema), async (req, res, next) => {
  const { productId, alias } = req.validatedBody;
  try {
    await db.query(
      'INSERT INTO product_aliases (product_id, alias, created_at) VALUES ($1, $2, NOW())',
      [productId, alias.trim()]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 5. Clear Scan History
router.post('/clear-history', requireAuth, requireOwner, async (req, res, next) => {
  try {
    const delRes = await db.query('DELETE FROM scan_history');
    await logAuditEvent({
      userId: req.user.id,
      username: req.user.username,
      action: 'scan_history_cleared',
      entity: 'scan_history',
      clientIp: getClientIp(req),
      diff: { deletedCount: delRes.rowCount }
    });
    res.json({ success: true, deletedCount: delRes.rowCount });
  } catch (err) {
    next(err);
  }
});

// Nightly in-process scan retention cleanup
async function cleanupOldScans() {
  try {
    const setRes = await db.query('SELECT scan_retention_days FROM settings WHERE id = 1');
    const days = setRes.rows[0]?.scan_retention_days || 30;
    await db.query(
      "DELETE FROM scan_history WHERE created_at < NOW() - (interval '1 day' * $1)",
      [days]
    );
  } catch (err) {
    console.error('Scan retention cleanup error:', err.message);
  }
}
setInterval(cleanupOldScans, 24 * 60 * 60 * 1000);

export default router;
