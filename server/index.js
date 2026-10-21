import http from 'node:http';
import app from './app.js';
import config from './config.js';
import { pool } from './db/pool.js';
import { purgeExpiredSessions } from './security/sessions.js';

const server = http.createServer(app);

// Periodic cleanup of expired sessions
const sessionCleanupInterval = setInterval(async () => {
  try {
    await purgeExpiredSessions();
  } catch (err) {
    console.error('Session purge error:', err.message);
  }
}, 60 * 60 * 1000);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`=== Devi Electrical App Server running on port ${config.port} (${config.env}) ===`);
  console.log(`Database connected to ${config.db.host}:${config.db.port}/${config.db.database}`);
});

// Graceful Shutdown
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Initiating graceful shutdown...`);

  clearInterval(sessionCleanupInterval);

  server.close(async () => {
    console.log('HTTP server closed. Closing database connections...');
    try {
      await pool.end();
      console.log('Database pool terminated cleanly. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('Error during pool termination:', err.message);
      process.exit(1);
    }
  });

  // Force exit if shutdown hangs over 15 seconds
  setTimeout(() => {
    console.error('Graceful shutdown timeout exceeded. Forcing termination.');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
