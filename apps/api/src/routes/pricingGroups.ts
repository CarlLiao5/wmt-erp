/** Slice one page out of the already-summarised pricing rows. */
export function paginatePricing<T>(rows: T[], page: unknown, pageSize: unknown) {
  const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize)) || 20));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pageSize: size, pages, total: rows.length };
}

type PricingSummaryRow = {
  storeId?: unknown;
  sku?: unknown;
  promotionPrice?: unknown;
  promotionEnd?: unknown;
  showStrikethrough?: unknown;
};

/** Apply filters and a stable expiry order before slicing pages. Missing flags remain unknown. */
export function filterAndSortPricing<T extends PricingSummaryRow>(rows: T[], promotion?: unknown, strikethrough?: unknown): T[] {
  const endTime = (value: unknown) => {
    if (value == null || value === '') return Infinity;
    const time = new Date(String(value)).getTime();
    return Number.isFinite(time) ? time : Infinity;
  };
  return rows.filter((row) => {
    const hasPromotion = row.promotionPrice != null && row.promotionPrice !== '';
    if (promotion === 'yes' && !hasPromotion || promotion === 'no' && hasPromotion) return false;
    const flag = row.showStrikethrough;
    const enabled = flag === true || flag === 1 || flag === '1';
    const disabled = flag === false || flag === 0 || flag === '0';
    if (strikethrough === 'yes' && !enabled || strikethrough === 'no' && !disabled) return false;
    if (strikethrough === 'unknown' && (enabled || disabled)) return false;
    return true;
  }).sort((a, b) => {
    const left = endTime(a.promotionEnd);
    const right = endTime(b.promotionEnd);
    if (left !== right) return left < right ? -1 : 1;
    return String(a.storeId ?? '').localeCompare(String(b.storeId ?? ''))
      || String(a.sku ?? '').localeCompare(String(b.sku ?? ''));
  });
}

/** A summary row carries all price types at once, so the selected type keeps only rows that actually have one. */
export function filterPricingByType<T extends { promotionPrice?: unknown; incentiveType?: unknown }>(rows: T[], priceType?: string): T[] {
  if (priceType === 'promotion') return rows.filter((row) => row.promotionPrice != null);
  if (priceType === 'incentive') return rows.filter((row) => row.incentiveType != null);
  return rows;
}
