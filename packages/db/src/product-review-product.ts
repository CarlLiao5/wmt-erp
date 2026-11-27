export function normalizeReviewProduct(payload: unknown) {
  let raw: any = payload;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
  const itemId = typeof raw?.itemId === 'number' && Number.isSafeInteger(raw.itemId) ? String(raw.itemId) : text(raw?.itemId);
  return {
    itemId: itemId && /^\d{1,30}$/.test(itemId) ? itemId : null,
    name: text(raw?.itemName),
    imageUrl: text(raw?.itemImageUrl),
    features: (Array.isArray(raw?.features) ? raw.features : []).flatMap((feature: any) => text(feature?.name) && text(feature?.value) ? [{ name: feature.name as string, value: feature.value as string }] : []),
  };
}
