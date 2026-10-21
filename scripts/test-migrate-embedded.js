import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function testMigrate() {
  const dataDir = path.resolve(projectRoot, '.local-db');
  const adminPassword = fs.readFileSync(path.join(projectRoot, 'secrets/db_admin_password'), 'utf8').trim();

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'password',
    port: 5432,
    persistent: true
  });

  console.log('1. Starting Embedded PostgreSQL on port 5432...');
  if (!fs.existsSync(dataDir)) {
    console.log('Initializing cluster...');
    await pg.initialise();
  }
  await pg.start();
  console.log('PostgreSQL started!');

  const client = pg.getPgClient();
  await client.connect();

  console.log('2. Creating database "devi" if not exists...');
  const dbCheck = await client.query("SELECT 1 FROM pg_database WHERE datname = 'devi'");
  if (dbCheck.rowCount === 0) {
    await client.query("CREATE DATABASE devi;");
    console.log('Database "devi" created.');
  }

  console.log('3. Creating role "devi_admin"...');
  const roleCheck = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'devi_admin'");
  if (roleCheck.rowCount === 0) {
    await client.query(`CREATE ROLE devi_admin WITH SUPERUSER LOGIN PASSWORD '${adminPassword}';`);
    console.log('Role devi_admin created.');
  } else {
    await client.query(`ALTER ROLE devi_admin WITH PASSWORD '${adminPassword}';`);
  }

  await client.end();

  console.log('4. Running migrations...');
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '5432';
  process.env.DB_USER = 'devi_admin';
  process.env.DB_PASSWORD = adminPassword;

  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const p = spawn('node', ['server/db/migrate.js'], { cwd: projectRoot, stdio: 'inherit', env: { ...process.env, DB_HOST: '127.0.0.1' } });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(`Migration exited with code ${code}`)));
  });

  console.log('5. Stopping Embedded Postgres for test completion...');
  await pg.stop();
  console.log('SUCCESS!');
}

testMigrate().catch(err => {
  console.error('Test migration failed:', err);
  process.exit(1);
});
