import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

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

function readSecret(envVar, fileVar, defaultSecretFile = null, fallback = undefined) {
  if (process.env[fileVar]) {
    try {
      const filePath = process.env[fileVar];
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8').trim();
      }
    } catch (err) {
      console.error(`CRITICAL: Failed to read secret file from ${process.env[fileVar]}: ${err.message}`);
      process.exit(1);
    }
  }
  if (process.env[envVar] !== undefined && process.env[envVar] !== '') {
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
        // Fall back to default
      }
    }
  }
  return fallback;
}

const isTestEnv = (process.env.NODE_ENV || '').trim() === 'test';
const testDataKeys = JSON.stringify({
  current_version: '1',
  keys: {
    '1': Buffer.alloc(32, 1).toString('base64')
  }
});

const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.MARKETING_PORT ? parseInt(process.env.MARKETING_PORT, 10) : 3164);
const marketingPort = process.env.MARKETING_PORT ? parseInt(process.env.MARKETING_PORT, 10) : 3164;
const billingPort = process.env.BILLING_PORT ? parseInt(process.env.BILLING_PORT, 10) : 3165;

const rawConfig = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: defaultPort,
  MARKETING_PORT: marketingPort,
  BILLING_PORT: billingPort,
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ? process.env.PUBLIC_ORIGIN.trim() : (isTestEnv ? 'http://127.0.0.1:3164' : `http://localhost:${marketingPort}`),
  TRUSTED_PROXY_IP: process.env.TRUSTED_PROXY_IP || '127.0.0.1',

  DB_HOST: process.env.DB_HOST || (isTestEnv ? 'localhost' : 'db'),
  DB_PORT: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  DB_NAME: process.env.DB_NAME || 'devi',
  DB_USER: process.env.DB_USER || 'devi_app',
  DB_PASSWORD: readSecret('DB_PASSWORD', 'DB_PASSWORD_FILE', 'db_app_password', isTestEnv ? 'test_db_password_12chars' : undefined),

  DATA_KEYS_RAW: readSecret('DATA_KEYS', 'DATA_KEYS_FILE', 'data_keys', isTestEnv ? testDataKeys : undefined),
  BLIND_INDEX_KEY_RAW: readSecret('BLIND_INDEX_KEY', 'BLIND_INDEX_KEY_FILE', 'blind_index_key', isTestEnv ? 'test_blind_index_key_32_characters_long' : undefined),
  PASSWORD_PEPPER: readSecret('PASSWORD_PEPPER', 'PASSWORD_PEPPER_FILE', 'password_pepper', isTestEnv ? 'test_password_pepper_32_characters_long' : undefined),

  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  AI_MODEL: process.env.AI_MODEL || 'gemini-1.5-flash',
  AI_API_KEY: readSecret('AI_API_KEY', 'AI_API_KEY_FILE', 'ai_api_key', null),

  BACKUP_STATUS_DIR: process.env.BACKUP_STATUS_DIR || '/var/backups/devi/status'
};

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.number().int().positive(),
  MARKETING_PORT: z.number().int().positive(),
  BILLING_PORT: z.number().int().positive(),
  PUBLIC_ORIGIN: z.string().url().refine((val) => {
    try {
      const u = new URL(val);
      const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0';
      if (rawConfig.NODE_ENV === 'production' && u.protocol !== 'https:' && !isLocalhost) {
        return false;
      }
      return u.pathname === '/' || u.pathname === '';
    } catch {
      return false;
    }
  }, { message: 'PUBLIC_ORIGIN must be a valid URL without subpath' }),
  TRUSTED_PROXY_IP: z.string().ip(),

  DB_HOST: z.string().min(1),
  DB_PORT: z.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(12, { message: 'Database password must be at least 12 characters' }),

  DATA_KEYS_RAW: z.string().min(10, { message: 'DATA_KEYS secret is required' }),
  BLIND_INDEX_KEY_RAW: z.string().min(32, { message: 'BLIND_INDEX_KEY must be at least 32 characters/bytes' }),
  PASSWORD_PEPPER: z.string().min(32, { message: 'PASSWORD_PEPPER must be at least 32 characters/bytes' }),

  AI_PROVIDER: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().nullable().optional(),

  BACKUP_STATUS_DIR: z.string()
}).strict();

const parsedResult = configSchema.safeParse(rawConfig);

if (!parsedResult.success) {
  console.error('FATAL CONFIGURATION ERROR: Invalid environment or secrets.');
  for (const err of parsedResult.error.errors) {
    console.error(` - ${err.path.join('.')}: ${err.message}`);
  }
  process.exit(1);
}

// Parse and validate DATA_KEYS JSON format
let parsedDataKeys;
try {
  parsedDataKeys = JSON.parse(parsedResult.data.DATA_KEYS_RAW);
  if (!parsedDataKeys.current_version || !parsedDataKeys.keys || !parsedDataKeys.keys[parsedDataKeys.current_version]) {
    throw new Error('data_keys must specify "current_version" and matching key in "keys" object');
  }
  for (const [ver, b64Key] of Object.entries(parsedDataKeys.keys)) {
    const buf = Buffer.from(b64Key, 'base64');
    if (buf.length !== 32) {
      throw new Error(`Key version ${ver} is not 32 bytes (got ${buf.length} bytes)`);
    }
  }
} catch (err) {
  console.error(`FATAL CONFIGURATION ERROR in DATA_KEYS: ${err.message}`);
  process.exit(1);
}

// Validate blind_index_key length
const blindIndexBuf = Buffer.from(parsedResult.data.BLIND_INDEX_KEY_RAW, 'base64');
if (blindIndexBuf.length < 32) {
  // Check if raw utf8 string has 32 bytes
  const utf8Buf = Buffer.from(parsedResult.data.BLIND_INDEX_KEY_RAW, 'utf8');
  if (utf8Buf.length < 32) {
    console.error('FATAL CONFIGURATION ERROR: BLIND_INDEX_KEY must be at least 32 bytes');
    process.exit(1);
  }
}

export const config = {
  env: parsedResult.data.NODE_ENV,
  isProd: parsedResult.data.NODE_ENV === 'production',
  isTest: parsedResult.data.NODE_ENV === 'test',
  port: parsedResult.data.PORT,
  marketingPort: parsedResult.data.MARKETING_PORT,
  billingPort: parsedResult.data.BILLING_PORT,
  publicOrigin: parsedResult.data.PUBLIC_ORIGIN.replace(/\/$/, ''),
  trustedProxyIp: parsedResult.data.TRUSTED_PROXY_IP,
  db: {
    host: parsedResult.data.DB_HOST,
    port: parsedResult.data.DB_PORT,
    database: parsedResult.data.DB_NAME,
    user: parsedResult.data.DB_USER,
    password: parsedResult.data.DB_PASSWORD
  },
  dataKeys: parsedDataKeys,
  blindIndexKey: parsedResult.data.BLIND_INDEX_KEY_RAW,
  passwordPepper: parsedResult.data.PASSWORD_PEPPER,
  ai: {
    provider: parsedResult.data.AI_PROVIDER,
    model: parsedResult.data.AI_MODEL,
    apiKey: parsedResult.data.AI_API_KEY
  },
  backupStatusDir: parsedResult.data.BACKUP_STATUS_DIR
};

export default config;
