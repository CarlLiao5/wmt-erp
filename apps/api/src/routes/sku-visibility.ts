import type { OrderVisibility } from './orders.js';

export function canViewStore(
  visibility: Pick<OrderVisibility, 'role' | 'storeIds' | 'skus'> | undefined,
  storeId: string,
): boolean {
  if (!visibility) return false;
  if (visibility.role === 'admin' || visibility.storeIds.has(storeId)) return true;
  for (const grant of visibility.skus) if (grant.startsWith(`${storeId}:`)) return true;
  return false;
}

export function canViewStoreSku(
  visibility: Pick<OrderVisibility, 'role' | 'storeIds' | 'skus'> | undefined,
  storeId: string,
  sku: string,
): boolean {
  if (!visibility) return false;
  if (visibility.role === 'admin' || visibility.storeIds.has(storeId)) return true;
  const normalizedSku = sku.trim().toLocaleUpperCase('en-US');
  for (const grant of visibility.skus) {
    const separator = grant.indexOf(':');
    if (separator >= 0 && grant.slice(0, separator) === storeId && grant.slice(separator + 1).trim().toLocaleUpperCase('en-US') === normalizedSku) return true;
  }
  return false;
}

export function filterVisibleSkuRows<T extends { storeId: string; sku: string }>(
  rows: T[],
  visibility: Pick<OrderVisibility, 'role' | 'storeIds' | 'skus'> | undefined,
): T[] {
  if (!visibility) return [];
  if (visibility.role === 'admin') return rows;
  return rows.filter((row) => canViewStoreSku(visibility, row.storeId, row.sku));
}
