import http from 'node:http';
import { marketingApp, billingApp, app } from './app.js';
import config from './config.js';
import { pool } from './db/pool.js';
import { purgeExpiredSessions } from './security/sessions.js';

let marketingServer;
let billingServer;

// Periodic cleanup of expired sessions
const sessionCleanupInterval = setInterval(async () => {
  try {
    await purgeExpiredSessions();
  } catch (err) {
    console.error('Session purge error:', err.message);
  }
}, 60 * 60 * 1000);

if (config.marketingPort === config.billingPort) {
  // Fallback if both ports are identical: run single unified app
  const unifiedServer = http.createServer(app);
  unifiedServer.listen(config.port, '0.0.0.0', () => {
    console.log(`=== Devi Electrical Server running on port ${config.port} (${config.env}) ===`);
    console.log(`Database connected to ${config.db.host}:${config.db.port}/${config.db.database}`);
  });
  marketingServer = unifiedServer;
  billingServer = unifiedServer;
} else {
  // Dual-port architecture:
  // Port 3164 -> Public Marketing Website
  // Port 3165 -> Private Staff Billing & Inventory App
  marketingServer = http.createServer(marketingApp);
  marketingServer.listen(config.marketingPort, '0.0.0.0', () => {
    console.log(`=== [PORT ${config.marketingPort}] Devi Electrical Public Website running (${config.env}) ===`);
  });

  billingServer = http.createServer(billingApp);
  billingServer.listen(config.billingPort, '0.0.0.0', () => {
    console.log(`=== [PORT ${config.billingPort}] Devi Electrical Billing & Management App running (${config.env}) ===`);
    console.log(`Database connected to ${config.db.host}:${config.db.port}/${config.db.database}`);
  });
}

// Graceful Shutdown
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Initiating graceful shutdown...`);

  clearInterval(sessionCleanupInterval);

  const closeServer = (srv) => new Promise((resolve) => {
    if (srv && srv.listening) {
      srv.close(() => resolve());
    } else {
      resolve();
    }
  });

  try {
    await Promise.all([closeServer(marketingServer), closeServer(billingServer)]);
    console.log('HTTP servers closed. Terminating database pool...');
    await pool.end();
    console.log('Database pool terminated cleanly. Exiting.');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err.message);
    process.exit(1);
  }

  // Force exit if shutdown hangs over 15 seconds
  setTimeout(() => {
    console.error('Graceful shutdown timeout exceeded. Forcing termination.');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
