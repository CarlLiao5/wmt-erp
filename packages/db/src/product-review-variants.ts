import { normalizeReviewProduct } from './product-review-product.js';

type Features = Array<{ name: string; value: string }>;
export interface ReviewVariant {
  itemId: string | null;
  name: string | null;
  names: string[];
  imageUrl: string | null;
  count: number;
  features: Features;
  featureSets: Array<{ features: Features; count: number }>;
  conflictingFeatures: boolean;
}

// SQL groups compact product metadata, never the full review bodies/JSON payloads.
export function groupReviewVariants(rows: Array<{ itemId?: string | null; name?: string | null; imageUrl?: string | null; features?: unknown; count: number | string }>): ReviewVariant[] {
  const groups = new Map<string | null, ReviewVariant>();
  for (const row of rows) {
    let features = row.features;
    if (typeof features === 'string') { try { features = JSON.parse(features); } catch { features = []; } }
    const product = normalizeReviewProduct({ itemId: row.itemId, itemName: row.name, itemImageUrl: row.imageUrl, features });
    const group = groups.get(product.itemId) ?? { itemId: product.itemId, name: null, names: [], imageUrl: null, count: 0, features: [], featureSets: [], conflictingFeatures: false };
    group.name ??= product.name;
    if (product.name && !group.names.includes(product.name)) group.names.push(product.name);
    group.imageUrl ??= product.imageUrl;
    const count = Number(row.count);
    group.count += count;
    const sorted = [...product.features].sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value));
    const existing = group.featureSets.find(set => JSON.stringify(set.features) === JSON.stringify(sorted));
    if (existing) existing.count += count;
    else group.featureSets.push({ features: sorted, count });
    groups.set(product.itemId, group);
  }
  for (const group of groups.values()) {
    group.featureSets.sort((a, b) => b.count - a.count);
    const specified = group.featureSets.filter(set => set.features.length);
    group.conflictingFeatures = specified.length > 1;
    group.features = specified.length === 1 ? specified[0].features : [];
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.itemId ?? '').localeCompare(b.itemId ?? ''));
}
