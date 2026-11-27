import { afterEach, expect, it } from 'vitest';
import { decryptCredential, encryptCredential } from './credentials.js';

afterEach(() => { delete process.env.CREDENTIAL_ENCRYPTION_KEY; });

it('encrypts and decrypts a credential with a 256-bit hex key', () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  const encrypted = encryptCredential('sandbox-test-secret');
  expect(encrypted).not.toContain('sandbox-test-secret');
  expect(decryptCredential(encrypted)).toBe('sandbox-test-secret');
});

it('rejects missing encryption key instead of using a built-in default', () => {
  expect(() => encryptCredential('secret')).toThrow('CREDENTIAL_ENCRYPTION_KEY');
});
