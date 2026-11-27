import { createDb } from '../../../../packages/db/index.js';
import type { FreightCarrierBrand } from './brands.js';

export interface FreightCarrierCredentials {
  brand: FreightCarrierBrand;
  displayName: string;
  loginUrl: string;
  searchUrl: string;
  username: string;
  password: string;
  prefixPatterns: string[];
  extras: Record<string, unknown>;
}

export type CredentialQuery = (sql: string, values: unknown[]) => Promise<unknown>;

function rowsFrom(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  const rows = Array.isArray(result[0]) ? result[0] : result;
  return rows.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row));
}

function parseExtras(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    throw new Error('Invalid carrier configuration for configured brand');
  }
}

function requiredText(row: Record<string, unknown>, column: string, brand: FreightCarrierBrand): string {
  const value = row[column];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Incomplete credentials for carrier ${brand}`);
  return value.trim();
}

export async function readFreightCarrierCredentials(brand: FreightCarrierBrand, query: CredentialQuery): Promise<FreightCarrierCredentials> {
  let rows: Record<string, unknown>[];
  try {
    const result = await query(
      'SELECT display_name AS displayName, login_url AS loginUrl, search_url AS searchUrl, username, password, prefix_patterns AS prefixPatterns, extras_json AS extrasJson FROM WuLiulogin WHERE brand = ? LIMIT 1',
      [brand],
    );
    rows = rowsFrom(result);
  } catch {
    throw new Error(`Unable to read credentials for carrier ${brand}`);
  }

  const row = rows[0];
  if (!row) throw new Error(`No credentials configured for carrier ${brand}`);
  const loginUrl = requiredText(row, 'loginUrl', brand);
  const searchUrl = typeof row.searchUrl === 'string' ? row.searchUrl.trim() : '';
  const prefixPatterns = typeof row.prefixPatterns === 'string'
    ? row.prefixPatterns.split(',').map((prefix) => prefix.trim()).filter(Boolean)
    : [];
  return {
    brand,
    displayName: typeof row.displayName === 'string' && row.displayName.trim() ? row.displayName.trim() : brand,
    loginUrl,
    searchUrl,
    username: requiredText(row, 'username', brand),
    password: requiredText(row, 'password', brand),
    prefixPatterns,
    extras: parseExtras(row.extrasJson),
  };
}

export async function loadFreightCarrierCredentials(brand: FreightCarrierBrand): Promise<FreightCarrierCredentials> {
  const { pool } = createDb();
  return readFreightCarrierCredentials(brand, (sql, values) => pool.query(sql, values));
}
