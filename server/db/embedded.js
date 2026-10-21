import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

let embeddedInstance = null;

export function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1200);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Ensures a PostgreSQL instance is running.
 * If running on localhost and no PostgreSQL is listening, spins up Embedded PostgreSQL.
 */
export async function ensurePostgresRunning(config) {
  const host = config.db.host;
  const port = config.db.port;

  // Check if PostgreSQL is already reachable
  const running = await isPortOpen(host, port);
  if (running) {
    console.log(`✓ PostgreSQL detected running on ${host}:${port}.`);
    return null;
  }

  // Only auto-start embedded postgres if host is local
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  if (!isLocal) {
    console.warn(`PostgreSQL is not reachable at ${host}:${port}. Ensure PostgreSQL service or Docker is running.`);
    return null;
  }

  console.log(`Starting local Embedded PostgreSQL on port ${port}...`);
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dataDir = path.resolve(projectRoot, '.local-db');
  const adminPassword = fs.existsSync(path.join(projectRoot, 'secrets/db_admin_password'))
    ? fs.readFileSync(path.join(projectRoot, 'secrets/db_admin_password'), 'utf8').trim()
    : 'de30bcaf6ef4221be8408bc8389507e2c7f1';

  embeddedInstance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'password',
    port: port,
    persistent: true
  });

  if (!fs.existsSync(dataDir)) {
    console.log('Initializing local database cluster...');
    await embeddedInstance.initialise();
  }

  await embeddedInstance.start();
  console.log(`✓ Embedded PostgreSQL started successfully on port ${port}.`);

  // Ensure database and admin/app roles exist
  const client = embeddedInstance.getPgClient();
  await client.connect();
  try {
    const dbCheck = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.db.database]);
    if (dbCheck.rowCount === 0) {
      await client.query(`CREATE DATABASE "${config.db.database}";`);
      console.log(`Database "${config.db.database}" created.`);
    }

    const adminCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'devi_admin'");
    if (adminCheck.rowCount === 0) {
      await client.query(`CREATE ROLE devi_admin WITH SUPERUSER LOGIN PASSWORD '${adminPassword}';`);
    } else {
      await client.query(`ALTER ROLE devi_admin WITH PASSWORD '${adminPassword}';`);
    }

    const appRoleCheck = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [config.db.user]);
    if (appRoleCheck.rowCount === 0) {
      await client.query(`CREATE ROLE "${config.db.user}" WITH LOGIN PASSWORD '${config.db.password}';`);
    } else {
      await client.query(`ALTER ROLE "${config.db.user}" WITH PASSWORD '${config.db.password}';`);
    }
  } finally {
    await client.end();
  }

  // Auto-run schema migrations to ensure all tables, roles, and default admin exist
  try {
    const { runMigrations } = await import('./migrate.js');
    await runMigrations();
  } catch (migErr) {
    console.error('Warning: Automatic migration check failed:', migErr.message);
  }

  return embeddedInstance;
}

export async function stopEmbeddedPostgres() {
  if (embeddedInstance) {
    try {
      console.log('Shutting down Embedded PostgreSQL...');
      await embeddedInstance.stop();
      console.log('Embedded PostgreSQL stopped.');
    } catch (err) {
      console.error('Error shutting down Embedded PostgreSQL:', err.message);
    }
    embeddedInstance = null;
  }
}
