import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  console.log('Testing EmbeddedPostgres...');
  const dataDir = path.resolve(__dirname, '../.local-db');
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'password',
    port: 5433,
    persistent: false
  });

  console.log('Initialising...');
  await pg.initialise();
  console.log('Starting...');
  await pg.start();
  console.log('Connected! Creating test database...');
  await pg.createDatabase('test_db');
  console.log('Database created successfully!');
  await pg.stop();
  console.log('Stopped successfully!');
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
