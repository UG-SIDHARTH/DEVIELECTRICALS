import rateLimit from 'express-rate-limit';
import { getClientIp } from '../security/clientIp.js';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' }
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { error: 'Rate limit exceeded. Please slow down.' }
});

export const scanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { error: 'Material scan limit reached. Please wait a minute.' }
});

export const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  message: { error: 'Backup request limit reached. Please wait.' }
});

export default {
  loginLimiter,
  apiLimiter,
  scanLimiter,
  backupLimiter
};
