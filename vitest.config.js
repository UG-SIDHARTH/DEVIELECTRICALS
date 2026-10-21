import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
      TRUSTED_PROXY_IP: '172.28.0.10',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_NAME: 'devi',
      DB_USER: 'devi_app',
      DB_PASSWORD: 'test_db_password_12chars',
      DATA_KEYS: JSON.stringify({
        current_version: '1',
        keys: {
          '1': Buffer.alloc(32, 1).toString('base64')
        }
      }),
      BLIND_INDEX_KEY: 'test_blind_index_key_32_characters_long',
      PASSWORD_PEPPER: 'test_password_pepper_32_characters_long'
    }
  }
});
