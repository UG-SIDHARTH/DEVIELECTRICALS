import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

// Automatically load .env if available
if (typeof process.loadEnvFile === 'function') {
  const envPath = path.join(projectRoot, '.env');
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore parse warnings on non-fatal env lines
    }
  }
}

function getSecret(fileVar, envVar, defaultSecretFile = null, fallback = null) {
  if (process.env[fileVar] && fs.existsSync(process.env[fileVar])) {
    return fs.readFileSync(process.env[fileVar], 'utf8').trim();
  }
  if (process.env[envVar]) {
    return process.env[envVar].trim();
  }
  if (defaultSecretFile) {
    const localSecretPath = path.join(projectRoot, 'secrets', defaultSecretFile);
    if (fs.existsSync(localSecretPath)) {
      try {
        const content = fs.readFileSync(localSecretPath, 'utf8').trim();
        if (content !== '') {
          return content;
        }
      } catch {
        // Fall back
      }
    }
  }
  return fallback;
}

const adminPassword = getSecret('DB_ADMIN_PASSWORD_FILE', 'DB_ADMIN_PASSWORD', 'db_admin_password', null) ||
                      getSecret('DB_PASSWORD_FILE', 'DB_PASSWORD', 'db_admin_password', 'test_password');
const appPassword = getSecret('DB_APP_PASSWORD_FILE', 'DB_APP_PASSWORD', 'db_app_password', null);
const backupPassword = getSecret('DB_BACKUP_PASSWORD_FILE', 'DB_BACKUP_PASSWORD', 'db_backup_password', null);

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  database: process.env.DB_NAME || 'devi',
  user: process.env.DB_USER || 'devi_admin',
  password: adminPassword
};

const pool = new pg.Pool(dbConfig);

async function runMigrations() {
  console.log('Connecting to database as migration admin...');
  const client = await pool.connect();

  try {
    // 1. Ensure migrations metadata table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Discover migration files
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at ${migrationsDir}`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const appliedRes = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(appliedRes.rows.map(r => r.version));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`- Migration ${file} already applied.`);
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`✓ Migration ${file} successfully applied.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Failed to apply migration ${file}:`, err.message);
        throw err;
      }
    }

    // 3. Ensure runtime roles: devi_app and devi_backup
    if (appPassword) {
      console.log('Provisioning/updating least-privilege role: devi_app...');
      const roleExists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'devi_app'");
      if (roleExists.rowCount === 0) {
        await client.query(`CREATE ROLE devi_app WITH LOGIN PASSWORD '${appPassword.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;`);
      } else {
        await client.query(`ALTER ROLE devi_app WITH PASSWORD '${appPassword.replace(/'/g, "''")}';`);
      }

      // Grant schema usage and table permissions
      await client.query(`GRANT USAGE ON SCHEMA public TO devi_app;`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO devi_app;`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO devi_app;`);
      
      // Enforce append-only on audit_log: revoke UPDATE and DELETE from devi_app
      await client.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM devi_app;`);
    }

    if (backupPassword) {
      console.log('Provisioning/updating least-privilege role: devi_backup...');
      const backupRoleExists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'devi_backup'");
      if (backupRoleExists.rowCount === 0) {
        await client.query(`CREATE ROLE devi_backup WITH LOGIN PASSWORD '${backupPassword.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE;`);
      } else {
        await client.query(`ALTER ROLE devi_backup WITH PASSWORD '${backupPassword.replace(/'/g, "''")}';`);
      }

      // pg_read_all_data allows pg_dump without superuser permissions
      await client.query(`GRANT pg_read_all_data TO devi_backup;`);
    }

    console.log('All migrations and role configurations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
