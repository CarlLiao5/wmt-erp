import { and, createDb, eq, or, skus, sql } from '@walmart-erp/db';

export interface ProductImageKey { storeId: string; sku: string; }
export const PRODUCT_IMAGE_QUERY_BATCH_SIZE = 200;

export function productImageQueryBatches<T>(products: T[], size = PRODUCT_IMAGE_QUERY_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < products.length; i += size) batches.push(products.slice(i, i + size));
  return batches;
}

function imageUrlFromValue(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = imageUrlFromValue(entry);
      if (image) return image;
    }
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const preferred = ['url', 'src', 'href', 'imageUrl', 'imageURL', 'large', 'medium', 'small'].map((key) => object[key]);
    for (const candidate of [...preferred, ...Object.values(object)]) {
      const image = imageUrlFromValue(candidate);
      if (image) return image;
    }
  }
  return undefined;
}

export function productImageUrl(imageUrl: unknown, details: unknown): string | undefined {
  const data = details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {};
  const report = data.itemReport && typeof data.itemReport === 'object' && !Array.isArray(data.itemReport)
    ? data.itemReport as Record<string, unknown>
    : {};
  const candidates = [imageUrl, data.imageUrl, data.image, data.mainImageUrl, data.productImage, data.primaryImage, data.imageURL, ...Object.values(report)];
  const nested = [data.images, data.imageUrls, data.productImages];
  for (const value of [...candidates, ...nested]) {
    const image = imageUrlFromValue(value);
    if (image) return image;
  }
  return undefined;
}

export function mysqlProductImageResolver() {
  const { db } = createDb();
  return async (tenantId: string, products: ProductImageKey[]): Promise<Map<string, string>> => {
    const pairs = [...new Map(products
      .map((product) => ({ storeId: product.storeId.trim(), sku: product.sku.trim() }))
      .filter((product) => product.storeId && product.sku)
      .map((product) => [`${product.storeId}:${product.sku.toLocaleUpperCase('en-US')}`, product] as const)).values()];
    if (!pairs.length) return new Map();
    const rows: Array<{ storeId: string; sku: string; imageUrl: string | null }> = [];
    for (const batch of productImageQueryBatches(pairs)) {
      const batchRows = await db.select({ storeId: skus.storeId, sku: skus.externalId, imageUrl: skus.imageUrl })
        .from(skus)
        .where(and(eq(skus.tenantId, tenantId), or(...batch.map((product) => and(eq(skus.storeId, product.storeId), sql`upper(${skus.externalId}) = ${product.sku.toLocaleUpperCase('en-US')}`)!))));
      rows.push(...batchRows);
    }
    const requested = new Set(pairs.map((product) => `${product.storeId}:${product.sku.toLocaleUpperCase('en-US')}`));
    return new Map(rows.flatMap((row) => {
      const key = `${row.storeId}:${row.sku.trim().toLocaleUpperCase('en-US')}`;
      const image = productImageUrl(row.imageUrl, undefined);
      return requested.has(key) && image ? [[key, image] as const] : [];
    }));
  };
}
