export interface AllSkuOwnerSourceRow { payload?: unknown; sku?: string | null; storeName?: string | null; productName?: string | null; ownerName?: string | null; itemId?: string | null; }
export interface AllSkuOwnerStore { id: string; name: string; }
export interface AllSkuOwnerCatalogSku { id: string; storeId: string; externalId: string; }
export interface AllSkuOwnerMember { id: string; displayName: string | null; }
export interface AllSkuOwnerEntry {
  storeId: string;
  skuId: string;
  sku: string;
  ownerName: string;
  ownerUserId?: string;
}

export function buildCatalogSkuMatcher(catalog: AllSkuOwnerCatalogSku[]) {
  const byStoreAndSku = new Map<string, AllSkuOwnerCatalogSku | null>();
  for (const sku of catalog) {
    const key = `${sku.storeId}\u0000${normalizeSku(sku.externalId)}`;
    if (byStoreAndSku.has(key)) byStoreAndSku.set(key, null);
    else byStoreAndSku.set(key, sku);
  }
  return (storeId: string, externalId: string) => byStoreAndSku.get(`${storeId}\u0000${normalizeSku(externalId)}`) ?? undefined;
}

export interface AllSkuChineseNameSourceRow extends AllSkuOwnerSourceRow {}

export function buildAllSkuChineseNameMap(
  rows: AllSkuChineseNameSourceRow[],
  stores: AllSkuOwnerStore[],
): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    const values = sourceValues(row);
    const store = resolveStore(storeName(values), stores);
    const sku = normalizeSku(cellText(values.SKU));
    const name = cellText(values['品名']);
    if (!store || !sku || !name) continue;
    const key = `${store.id}:${sku}`;
    const names = candidates.get(key) ?? new Set<string>();
    names.add(name);
    candidates.set(key, names);
  }
  return new Map([...candidates].flatMap(([key, names]) => names.size === 1 ? [[key, [...names][0]] as const] : []));
}

function cellText(value: unknown): string {
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(' ').trim();
  if (value && typeof value === 'object') {
    const cell = value as Record<string, unknown>;
    return cellText(cell.text ?? cell.userName ?? cell.value ?? '');
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function valuesOf(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const values = (payload as Record<string, unknown>).values;
  return values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : {};
}

function normalizeSku(value: string): string { return value.trim().toLocaleUpperCase('en-US'); }
function storeName(values: Record<string, unknown>): string { return cellText(values['店铺'] ?? values['店铺名称']); }

function resolveStore(sourceName: string, stores: AllSkuOwnerStore[]): AllSkuOwnerStore | undefined {
  const exact = stores.filter((store) => store.name.trim() === sourceName);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const alias = sourceName.replace(/沃尔玛$/, '').trim();
  if (!alias || alias === sourceName) return undefined;
  const matches = stores.filter((store) => store.name.trim() === alias);
  return matches.length === 1 ? matches[0] : undefined;
}

export function buildAllSkuOwnerMap(
  rows: AllSkuOwnerSourceRow[],
  stores: AllSkuOwnerStore[],
  catalog: AllSkuOwnerCatalogSku[],
  members: AllSkuOwnerMember[],
): Map<string, AllSkuOwnerEntry> {
  const parsed = rows.map((row) => {
    const values = sourceValues(row);
    const sourceStoreName = storeName(values);
    const sku = cellText(values.SKU);
    const ownerName = cellText(values['当前负责人']);
    return { sourceStoreName, sku, ownerName };
  }).filter((row) => row.sourceStoreName && row.sku);

  const duplicateSourceKeys = new Set<string>();
  const seenSourceKeys = new Set<string>();
  for (const row of parsed) {
    const key = `${row.sourceStoreName}\u0000${normalizeSku(row.sku)}`;
    if (seenSourceKeys.has(key)) duplicateSourceKeys.add(key);
    seenSourceKeys.add(key);
  }

  const ownersByName = new Map<string, AllSkuOwnerMember[]>();
  for (const member of members) {
    if (!member.displayName?.trim()) continue;
    const matches = ownersByName.get(member.displayName) ?? [];
    matches.push(member);
    ownersByName.set(member.displayName, matches);
  }

  const findCatalogSku = buildCatalogSkuMatcher(catalog);
  const map = new Map<string, AllSkuOwnerEntry>();
  const ambiguousResolvedKeys = new Set<string>();
  for (const row of parsed) {
    const sourceKey = `${row.sourceStoreName}\u0000${normalizeSku(row.sku)}`;
    if (duplicateSourceKeys.has(sourceKey)) continue;
    if (!row.ownerName) continue;
    const store = resolveStore(row.sourceStoreName, stores);
    if (!store) continue;
    const sku = findCatalogSku(store.id, row.sku);
    if (!sku) continue;
    const key = `${store.id}:${normalizeSku(sku.externalId)}`;
    if (ambiguousResolvedKeys.has(key)) continue;
    if (map.has(key)) { map.delete(key); ambiguousResolvedKeys.add(key); continue; }
    const matchingOwners = ownersByName.get(row.ownerName) ?? [];
    map.set(key, {
      storeId: store.id,
      skuId: sku.id,
      sku: sku.externalId,
      ownerName: row.ownerName,
      ...(matchingOwners.length === 1 ? { ownerUserId: matchingOwners[0].id } : {}),
    });
  }
  return map;
}

export function allSkuProductFields(row: AllSkuOwnerSourceRow) {
  const values = sourceValues(row);
  return {
    sku: cellText(values.SKU),
    storeName: storeName(values),
    productName: cellText(values['品名'] ?? values['产品名称']),
    ownerName: cellText(values['当前负责人']),
    itemId: cellText(values['Item ID'] ?? values['Item ID（商品ID）']),
  };
}

function sourceValues(row: AllSkuOwnerSourceRow): Record<string,unknown> {
  if ('sku' in row || 'storeName' in row) return { SKU: row.sku, 店铺: row.storeName, 品名: row.productName, 当前负责人: row.ownerName, 'Item ID': row.itemId };
  return valuesOf(row.payload);
}
