function isApprovedPost(path: string, body?: BodyInit | null) {
  const url = new URL(path, 'https://walmart.invalid');
  if (url.pathname === '/v3/token' || url.pathname === '/v3/price/getPricingInsights' || url.pathname === '/v3/fulfillment/inbound-preview') return url.search === '';
  if (/^\/v3\/advertising\/sem\/campaigns\/[^/]+\/item-level-summary$/.test(url.pathname)) return url.search === '';
  if (url.pathname === '/v3/advertising/sem/campaigns/performance-summary') return url.search === '';
  if (url.pathname !== '/v3/reports/reportRequests') return false;
  const entries = [...url.searchParams.entries()];
  if (url.searchParams.get('reportType') === 'INVENTORY_RECON') {
    if (entries.length !== 2 || url.searchParams.getAll('reportType').length !== 1 || url.searchParams.getAll('reportVersion').length !== 1 || url.searchParams.get('reportVersion') !== 'v1' || typeof body !== 'string') return false;
    try {
      const parsed = JSON.parse(body);
      if (Object.keys(parsed).sort().join(',') !== 'dataEndTime,dataStartTime') return false;
      const valid = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
      return valid(parsed.dataStartTime) && valid(parsed.dataEndTime)
        && Date.parse(parsed.dataStartTime) <= Date.parse(parsed.dataEndTime)
        && Date.parse(parsed.dataEndTime) - Date.parse(parsed.dataStartTime) < 32 * 86400000;
    } catch { return false; }
  }
  if (url.searchParams.get('reportType') === 'ITEM') {
    if (entries.length !== 2 || url.searchParams.getAll('reportType').length !== 1 || url.searchParams.getAll('reportVersion').length !== 1 || url.searchParams.get('reportVersion') !== 'v1' || typeof body !== 'string') return false;
    try {
      const parsed = JSON.parse(body) as { format?: unknown };
      return parsed.format === 'CSV' && Object.keys(parsed).length === 1;
    } catch { return false; }
  }
  return entries.length === 2
    && url.searchParams.getAll('reportType').length === 1
    && url.searchParams.getAll('reportVersion').length === 1
    && ['SEM_PERFORMANCE', 'SEM_SEARCH_TERMS'].includes(url.searchParams.get('reportType') ?? '')
    && url.searchParams.get('reportVersion') === 'v1';
}

export function assertReadOnly(method: string, path: string, body?: BodyInit | null): void {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'GET' || (normalizedMethod === 'POST' && isApprovedPost(path, body))) return;
  throw new Error(`Walmart integration is read-only: ${method} ${path}`);
}
