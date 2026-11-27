import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyBytes(): Buffer {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!value) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be configured');
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'utf8');
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes or 64 hexadecimal characters');
  return key;
}

export function encryptCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptCredential(value: string): string {
  const [ivPart, tagPart, ciphertextPart] = value.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) throw new Error('Invalid encrypted credential format');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
}
