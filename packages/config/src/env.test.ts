import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { Writable } from 'node:stream';
import { createLogger } from './logger.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  COOKIE_SECRET: 'c'.repeat(32),
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  MYSQL_URL: 'mysql://erp:secret@127.0.0.1:3306/erp_test',
  REDIS_URL: 'redis://127.0.0.1:6379/2',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_BUCKET: 'walmart-erp-test',
  WALMART_CLIENT_ID: 'client-id',
  WALMART_CLIENT_SECRET: 'client-secret',
  WALMART_ENVIRONMENT: 'sandbox',
};

describe('loadEnv', () => {
  it('rejects missing required configuration without exposing secret values', () => {
    expect(() => loadEnv({})).toThrow();
  });

  it('parses service URLs, numeric values, and Walmart sandbox settings', () => {
    const config = loadEnv(validEnv);

    expect(config).toMatchObject({
      nodeEnv: 'test',
      port: 3000,
      mysqlUrl: validEnv.MYSQL_URL,
      redisUrl: validEnv.REDIS_URL,
      s3Endpoint: validEnv.S3_ENDPOINT,
      walmart: {
        clientId: 'client-id',
        environment: 'sandbox',
      },
    });
    expect(config.walmart.clientSecret).toBe('client-secret');
  });

  it('rejects malformed database URLs and encryption keys', () => {
    expect(() => loadEnv({ ...validEnv, MYSQL_URL: 'https://not-mysql.invalid' })).toThrow();
    expect(() => loadEnv({ ...validEnv, CREDENTIAL_ENCRYPTION_KEY: 'too-short' })).toThrow();
  });

  it('redacts secrets from structured logger context and event fields', () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger({ service: 'api', walmart: { clientSecret: 'context-secret' } }, stream);
    logger.info({ accessToken: 'token-value', nested: { password: 'password-value' } }, 'request completed');

    expect(output).toContain('request completed');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('context-secret');
    expect(output).not.toContain('token-value');
    expect(output).not.toContain('password-value');
  });
});
