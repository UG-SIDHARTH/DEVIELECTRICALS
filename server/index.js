import http from 'node:http';
import { marketingApp, billingApp, app } from './app.js';
import config from './config.js';
import { pool } from './db/pool.js';
import { ensurePostgresRunning, stopEmbeddedPostgres } from './db/embedded.js';
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

async function startServer() {
  try {
    // 1. Ensure PostgreSQL is running (spins up local Embedded PostgreSQL if needed)
    await ensurePostgresRunning(config);

    // 2. Verify database connection
    try {
      await pool.query('SELECT 1');
      console.log(`✓ PostgreSQL connection established (${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database})`);
    } catch (dbErr) {
      console.error(`CRITICAL DATABASE ERROR: Could not connect to PostgreSQL at ${config.db.host}:${config.db.port}`);
      console.error(dbErr.message);
      process.exit(1);
    }

    // 3. Start dual-port HTTP listeners
    if (config.marketingPort === config.billingPort) {
      const unifiedServer = http.createServer(app);
      unifiedServer.listen(config.port, '0.0.0.0', () => {
        console.log(`=== Devi Electrical Server running on port ${config.port} (${config.env}) ===`);
      });
      marketingServer = unifiedServer;
      billingServer = unifiedServer;
    } else {
      marketingServer = http.createServer(marketingApp);
      marketingServer.listen(config.marketingPort, '0.0.0.0', () => {
        console.log(`=== [PORT ${config.marketingPort}] Devi Electrical Public Website running (${config.env}) ===`);
      });

      billingServer = http.createServer(billingApp);
      billingServer.listen(config.billingPort, '0.0.0.0', () => {
        console.log(`=== [PORT ${config.billingPort}] Devi Electrical Billing & Management App running (${config.env}) ===`);
      });
    }
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
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
    await stopEmbeddedPostgres();
    console.log('Database and servers terminated cleanly. Exiting.');
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

startServer();
