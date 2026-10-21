import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import db from '../db/pool.js';
import config from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../middleware/roles.js';
import { validateQuery } from '../middleware/validate.js';

const router = express.Router();

router.get('/status', requireAuth, requireOwner, async (req, res, next) => {
  try {
    // 1. Memory stats
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = process.memoryUsage();

    // 2. Disk usage (via statfs on Linux)
    let diskStats = { total: 0, free: 0, usedPercent: 0 };
    try {
      if (fs.statfsSync) {
        const stat = fs.statfsSync('/');
        const total = stat.bsize * stat.blocks;
        const free = stat.bsize * stat.bfree;
        const used = total - free;
        diskStats = {
          totalBytes: total,
          freeBytes: free,
          usedPercent: Math.round((used / total) * 100)
        };
      }
    } catch (e) {
      console.warn('statfs unavailable:', e.message);
    }

    // 3. Database Size
    const dbSizeRes = await db.query(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS formatted, pg_database_size(current_database()) AS bytes"
    );
    const dbSize = dbSizeRes.rows[0] || { formatted: '0 MB', bytes: 0 };

    // 4. Host Backup Status (read-only mount)
    let backupStatus = {
      available: false,
      lastBackupTime: null,
      lastOffMachineCopyTime: null,
      status: 'unknown',
      archiveSize: 0,
      staleWarning: false
    };

    const statusFilePath = path.join(config.backupStatusDir, 'status.json');
    if (fs.existsSync(statusFilePath)) {
      try {
        const raw = fs.readFileSync(statusFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        backupStatus = {
          available: true,
          ...parsed,
          staleWarning: parsed.lastBackupTime
            ? (Date.now() - new Date(parsed.lastBackupTime).getTime()) > 48 * 3600 * 1000
            : true
        };
      } catch (err) {
        console.warn('Failed to parse backup status file:', err.message);
      }
    }

    // 5. Host SMART Health Status (if populated by host smartd hook)
    let smartStatus = { healthy: true, details: 'Self-monitoring active' };
    const smartFilePath = path.join(config.backupStatusDir, 'smart_health.json');
    if (fs.existsSync(smartFilePath)) {
      try {
        smartStatus = JSON.parse(fs.readFileSync(smartFilePath, 'utf8'));
      } catch {
        // fallback
      }
    }

    res.json({
      uptimeSeconds: Math.floor(process.uptime()),
      systemTime: new Date().toISOString(),
      memory: {
        totalMb: Math.round(totalMem / (1024 * 1024)),
        freeMb: Math.round(freeMem / (1024 * 1024)),
        rssMb: Math.round(memUsage.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memUsage.heapUsed / (1024 * 1024))
      },
      disk: diskStats,
      database: dbSize,
      backup: backupStatus,
      smart: smartStatus,
      warnings: {
        highDiskUsage: diskStats.usedPercent > 80,
        backupStale: backupStatus.staleWarning
      }
    });
  } catch (err) {
    next(err);
  }
});

const auditQuerySchema = z.object({
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('50'),
  entity: z.string().optional(),
  action: z.string().optional(),
  username: z.string().optional()
});

router.get('/audit', requireAuth, requireOwner, validateQuery(auditQuerySchema), async (req, res, next) => {
  const page = Math.max(1, parseInt(req.validatedQuery.page, 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.validatedQuery.limit, 10)));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  let pIdx = 1;

  if (req.validatedQuery.entity && req.validatedQuery.entity !== 'all') {
    conditions.push(`entity = $${pIdx++}`);
    params.push(req.validatedQuery.entity);
  }

  if (req.validatedQuery.action && req.validatedQuery.action !== 'all') {
    conditions.push(`action = $${pIdx++}`);
    params.push(req.validatedQuery.action);
  }

  if (req.validatedQuery.username) {
    conditions.push(`username = $${pIdx++}`);
    params.push(req.validatedQuery.username);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await db.query(`SELECT COUNT(*) FROM audit_log ${where}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const listRes = await db.query(
      `SELECT id, user_id, username, action, entity, entity_id, client_ip, diff, created_at
       FROM audit_log ${where}
       ORDER BY created_at DESC
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

export default router;
