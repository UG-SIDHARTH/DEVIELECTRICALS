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

// --- 1. Dedicated Marketing Application (Port 3164) ---
export const marketingApp = express();
marketingApp.set('trust proxy', config.trustedProxyIp);
marketingApp.disable('x-powered-by');

marketingApp.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      frameSrc: ['https://www.google.com'],
      connectSrc: ["'self'"],
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

marketingApp.use(compression());
marketingApp.use(applyCacheHeaders);

// Health check endpoint for port 3164
marketingApp.use('/api/health', healthRouter);

// Isolate billing from the public marketing site
marketingApp.use('/billing', (req, res) => {
  res.status(404).send('Not Found: Staff billing portal is hosted on port ' + config.billingPort);
});

// Serve Public Marketing Static Assets
marketingApp.use(express.static(publicDir, {
  dotfiles: 'ignore',
  etag: true,
  index: ['index.html']
}));
marketingApp.use(errorHandler);


// --- 2. Dedicated Staff Billing & Inventory Application (Port 3165) ---
export const billingApp = express();
billingApp.set('trust proxy', config.trustedProxyIp);
billingApp.disable('x-powered-by');

billingApp.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
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

billingApp.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  next();
});

billingApp.use(compression());
billingApp.use(cookieParser());
billingApp.use(express.json({ limit: '1mb' }));
billingApp.use(express.urlencoded({ extended: false, limit: '1mb' }));
billingApp.use(applyCacheHeaders);
billingApp.use(verifyCsrf);

// Health check endpoint for port 3165
billingApp.use('/api/health', healthRouter);

// Private Staff & Management API Routes
billingApp.use('/api/auth', authRouter);
billingApp.use('/api/products', apiLimiter, productsRouter);
billingApp.use('/api/customers', apiLimiter, customersRouter);
billingApp.use('/api/suppliers', apiLimiter, suppliersRouter);
billingApp.use('/api/documents', apiLimiter, documentsRouter);
billingApp.use('/api/payments', apiLimiter, paymentsRouter);
billingApp.use('/api/stock', apiLimiter, stockRouter);
billingApp.use('/api/expenses', apiLimiter, expensesRouter);
billingApp.use('/api/reports', apiLimiter, reportsRouter);
billingApp.use('/api/settings', apiLimiter, settingsRouter);
billingApp.use('/api/scan', scanRouter);
billingApp.use('/api/backup', backupRouter);
billingApp.use('/api/admin', adminRouter);

// On port 3165, redirect root / directly to /billing/
billingApp.get('/', (req, res) => {
  res.redirect('/billing/');
});

// Serve Billing Static Assets
billingApp.use(express.static(publicDir, {
  dotfiles: 'ignore',
  etag: true,
  index: false
}));

// Fallback for SPA routing inside /billing/
billingApp.get('/billing/*', (req, res) => {
  res.sendFile(path.join(publicDir, 'billing/index.html'));
});
billingApp.use(errorHandler);


// --- 3. Unified Application (for testing & single-endpoint reverse proxies) ---
export const app = express();
app.set('trust proxy', config.trustedProxyIp);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
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

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  next();
});

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(applyCacheHeaders);
app.use(verifyCsrf);

app.use('/api/health', healthRouter);
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

app.use(express.static(publicDir, {
  dotfiles: 'ignore',
  etag: true,
  index: ['index.html']
}));

app.get('/billing/*', (req, res) => {
  res.sendFile(path.join(publicDir, 'billing/index.html'));
});

app.use(errorHandler);

export default app;
