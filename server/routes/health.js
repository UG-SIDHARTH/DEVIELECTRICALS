import express from 'express';
import db from '../db/pool.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

export default router;
