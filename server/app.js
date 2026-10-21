import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { applyCacheHeaders } from './middleware/cacheHeaders.js';
import { verifyCsrf } from './security/csrf.js';
import { errorHandler } from './middleware/errors.js';
import { apiLimiter } from './middleware/rateLimits.js';

// Route handlers
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import productsRouter from './routes/products.js';
import customersRouter from './routes/customers.js';
import suppliersRouter from './routes/suppliers.js';
import documentsRouter from './routes/documents.js';
import paymentsRouter from './routes/payments.js';
import stockRouter from './routes/stock.js';
import expensesRouter from './routes/expenses.js';
import reportsRouter from './routes/reports.js';
import settingsRouter from './routes/settings.js';
import scanRouter from './routes/scan.js';
import backupRouter from './routes/backup.js';
import adminRouter from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

export const app = express();

// Trust only the specific internal cloudflared container address
app.set('trust proxy', config.trustedProxyIp);

// Strip server signature
app.disable('x-powered-by');

// Hardened Security Headers with Strict CSP
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"], // wasm-unsafe-eval strictly enables Tesseract WebAssembly
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      frameSrc: ['https://www.google.com'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xContentTypeOptions: true
}));

// Permissions Policy: allow camera for barcode/material scanning on self only
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  next();
});

// Compress HTTP responses
app.use(compression());

// Parse incoming cookies
app.use(cookieParser());

// Standard JSON body parsing (1MB limit); scan uploads use dedicated 8MB limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Apply caching policies and noindex tags
app.use(applyCacheHeaders);

// CSRF validation on all state-changing requests
app.use(verifyCsrf);

// Health check endpoint (probes and compose healthcheck)
app.use('/api/health', healthRouter);

// API Endpoints
app.use('/api/auth', authRouter);
app.use('/api/products', apiLimiter, productsRouter);
app.use('/api/customers', apiLimiter, customersRouter);
app.use('/api/suppliers', apiLimiter, suppliersRouter);
app.use('/api/documents', apiLimiter, documentsRouter);
app.use('/api/payments', apiLimiter, paymentsRouter);
app.use('/api/stock', apiLimiter, stockRouter);
app.use('/api/expenses', apiLimiter, expensesRouter);
app.use('/api/reports', apiLimiter, reportsRouter);
app.use('/api/settings', apiLimiter, settingsRouter);
app.use('/api/scan', scanRouter);
app.use('/api/backup', backupRouter);
app.use('/api/admin', adminRouter);

// Serve Static Frontend Assets
app.use(express.static(publicDir, {
  dotfiles: 'ignore',
  etag: true,
  index: ['index.html']
}));

// Fallback for SPA routing inside /billing/
app.get('/billing/*', (req, res) => {
  res.sendFile(path.join(publicDir, 'billing/index.html'));
});

// Central Error Handler
app.use(errorHandler);

export default app;
