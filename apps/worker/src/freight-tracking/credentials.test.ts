import { describe, expect, it } from 'vitest';
import { readFreightCarrierCredentials } from './credentials.js';

describe('freight carrier credentials', () => {
  it('loads a single requested brand from WuLiulogin without exposing the query values', async () => {
    let queryText = '';
    let queryValues: unknown[] = [];
    const credentials = await readFreightCarrierCredentials('qitexp', async (sql, values) => {
      queryText = sql;
      queryValues = values;
      return [[{
        displayName: 'Qitexp', loginUrl: 'https://qitexp.nextsls.com/login', searchUrl: 'https://qitexp.nextsls.com/search',
        username: 'user', password: 'not-for-logs', prefixPatterns: 'QT', extrasJson: '{"tenant":"main"}',
      }], []];
    });

    expect(queryText).toContain('WuLiulogin');
    expect(queryValues).toEqual(['qitexp']);
    expect(credentials).toMatchObject({ brand: 'qitexp', username: 'user', password: 'not-for-logs', extras: { tenant: 'main' } });
  });

  it('returns a sanitized error when a brand row is absent', async () => {
    await expect(readFreightCarrierCredentials('desu', async () => [[], []])).rejects.toThrow('No credentials configured for carrier desu');
  });

  it('does not echo a stored password when required fields are missing', async () => {
    const credentials = { username: '', password: 'sensitive-value' };
    let message = '';
    try {
      await readFreightCarrierCredentials('depaex', async () => [[credentials], []]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('Incomplete credentials for carrier depaex');
    expect(message).not.toContain('sensitive-value');
  });

  it('sanitizes database errors so query details cannot leak credential fields', async () => {
    await expect(readFreightCarrierCredentials('skytuo', async () => { throw new Error('SQL error including sensitive-value'); }))
      .rejects.toThrow('Unable to read credentials for carrier skytuo');
  });
});
