export interface BrightDataInventory {
  id: string;
  itemId: string;
  productName?: string | null;
  availableQuantity?: number | null;
  queriedAt: string | Date;
  price?: string | number | null;
  rating?: string | number | null;
  reviewCount?: number | null;
  rawPayload?: unknown;
}

export interface BrightDataItem {
  id: string;
  itemId: string;
  productName?: string | null;
  rawPayload?: unknown;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface BrightDataInventorySummary {
  snapshots: number;
  products: number;
  inStock: number;
  outOfStock: number;
  unknownStock: number;
  averageRating: number;
  reviews: number;
}

export const brightDataTabs = ['库存数据看板', '产品管理'] as const;
export interface BrightDataScheduleView { enabled: boolean; timezone: string; nextRunAt: string | null; lastRunAt: string | null; }
export interface BrightDataImportRow { productName: string; itemId: string; category: string; error?: string; duplicate?: boolean; }
export function parseBrightDataImport(text: string, existing: BrightDataItem[] = []): BrightDataImportRow[] {
  const seen = new Set(existing.map((item) => item.itemId.trim().toLocaleLowerCase()));
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [productName = '', itemId = '', category = ''] = line.split(',').map((value) => value.trim()); const key = itemId.toLocaleLowerCase(); const duplicate = Boolean(key) && seen.has(key); if (key) seen.add(key); return { productName, itemId, category, duplicate, error: !productName || !itemId || !category ? '字段不完整' : duplicate ? 'Item ID 已存在' : undefined }; });
}

const escapeHtml = (value: unknown): string => String(value ?? '—').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
const dateText = (value: unknown): string => value ? new Date(String(value)).toLocaleString('zh-CN') : '—';

function payloadRecord(item: BrightDataItem): Record<string, unknown> {
  return item.rawPayload && typeof item.rawPayload === 'object' && !Array.isArray(item.rawPayload) ? item.rawPayload as Record<string, unknown> : {};
}

export function brightDataItemCategory(item: BrightDataItem): string {
  const payload = payloadRecord(item);
  const aliases = new Set(['category', '品类', '类别', '分类', '产品分类', 'producttype', 'department', 'productcategory']);
  const category = Object.entries(payload).find(([key, value]) => aliases.has(key.toLocaleLowerCase().replace(/[\s_-]/g, '')) && value != null && String(value).trim());
  return category ? String(category[1]).trim() : '未分类';
}

export function brightDataCategories(items: BrightDataItem[]): string[] {
  return [...new Set(items.map(brightDataItemCategory))].sort((a, b) => a.localeCompare(b));
}

export function filterBrightDataItemsByCategory(items: BrightDataItem[], category: string): BrightDataItem[] {
  return category === 'all' ? items : items.filter((item) => brightDataItemCategory(item) === category);
}

export function brightDataItemName(item: BrightDataItem): string {
  const payload = payloadRecord(item);
  return String(item.productName ?? payload.productName ?? payload.name ?? payload.title ?? '未提供');
}

export function summarizeBrightDataInventory(rows: BrightDataInventory[]): BrightDataInventorySummary {
  const latest = latestInventoryByItem(rows);
  const products = latest.length;
  const ratings = rows.map((row) => brightDataMetricValue(row, 'rating')).filter((value): value is number => value != null);
  return {
    snapshots: rows.length,
    products,
    inStock: latest.filter((row) => Number(row.availableQuantity) > 0).length,
    outOfStock: latest.filter((row) => row.availableQuantity != null && Number(row.availableQuantity) <= 0).length,
    unknownStock: latest.filter((row) => row.availableQuantity == null).length,
    averageRating: ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : 0,
    reviews: rows.reduce((sum, row) => sum + Number(row.reviewCount ?? 0), 0),
  };
}

export function latestInventoryByItem(rows: BrightDataInventory[]): BrightDataInventory[] {
  const latest = new Map<string, BrightDataInventory>();
  for (const row of rows) {
    const prior = latest.get(row.itemId);
    if (!prior || new Date(row.queriedAt).getTime() > new Date(prior.queriedAt).getTime()) latest.set(row.itemId, row);
  }
  return [...latest.values()].sort((a, b) => new Date(b.queriedAt).getTime() - new Date(a.queriedAt).getTime());
}

/** Keep one inventory snapshot per item and calendar day: the last crawl of that day wins. */
export function dailyLatestInventoryByItem(rows: BrightDataInventory[]): Map<string, BrightDataInventory[]> {
  const groups = new Map<string, Map<string, BrightDataInventory>>();
  for (const row of rows) {
    const timestamp = new Date(row.queriedAt).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const days = groups.get(row.itemId) ?? new Map<string, BrightDataInventory>();
    const prior = days.get(day);
    if (!prior || new Date(prior.queriedAt).getTime() < timestamp) days.set(day, row);
    groups.set(row.itemId, days);
  }
  return new Map([...groups].map(([itemId, days]) => [
    itemId,
    [...days.values()].sort((a, b) => new Date(b.queriedAt).getTime() - new Date(a.queriedAt).getTime()),
  ]));
}

export function stockChangeByItem(rows: BrightDataInventory[]): Map<string, { current: number | null; previous: number | null; change: number | null }> {
  return new Map([...dailyLatestInventoryByItem(rows)].map(([itemId, values]) => {
    const current = values[0]?.availableQuantity ?? null;
    const previous = values[1]?.availableQuantity ?? null;
    return [itemId, { current, previous, change: current != null && previous != null ? current - previous : null }];
  }));
}

/** Estimate units sold from the latest two daily inventory snapshots. Inventory increases are not sales. */
export function brightDataEstimatedSalesByItem(rows: BrightDataInventory[]): Map<string, number | null> {
  return new Map([...dailyLatestInventoryByItem(rows)].map(([itemId, values]) => {
    const sorted = values.filter((row) => row.availableQuantity != null);
    if (sorted.length < 2) return [itemId, null];
    const current = Number(sorted[0].availableQuantity);
    const previous = Number(sorted[1].availableQuantity);
    return [itemId, Math.max(0, previous - current)];
  }));
}

export function filterBrightDataInventory(rows: BrightDataInventory[], query: string, category: string, items: BrightDataItem[]): BrightDataInventory[] {
  const categories = new Map(items.map((item) => [item.itemId, brightDataItemCategory(item)]));
  const normalized = query.trim().toLocaleLowerCase();
  return latestInventoryByItem(rows).filter((row) => (!normalized || `${row.itemId} ${row.productName ?? ''}`.toLocaleLowerCase().includes(normalized)) && (category === 'all' || categories.get(row.itemId) === category));
}

export function brightDataTrendText(change: number | null | undefined): string {
  return change == null ? '无历史' : change > 0 ? `+${change}` : String(change);
}

export function brightDataTrendSeries(rows: BrightDataInventory[], itemId: string): number[] {
  return (dailyLatestInventoryByItem(rows).get(itemId) ?? []).filter((row) => row.availableQuantity != null).reverse().map((row) => Number(row.availableQuantity));
}

export type BrightDataMetric = 'availableQuantity' | 'rating' | 'price';
export interface BrightDataMetricPoint { value: number; queriedAt: string | Date; }

function brightDataMetricValue(row: BrightDataInventory, metric: BrightDataMetric): number | null {
  const normalized = row[metric] == null ? Number.NaN : Number(row[metric]);
  if (Number.isFinite(normalized)) return normalized;
  if (metric !== 'rating' || !row.rawPayload) return null;
  let payload: unknown = row.rawPayload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) as unknown; } catch { return null; }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const keyOf = (value: string) => value.toLocaleLowerCase().replace(/[\s_-]/g, '');
  const find = (source: Record<string, unknown>, aliases: string[]): unknown => {
    const aliasSet = new Set(aliases.map(keyOf));
    const entry = Object.entries(source).find(([key, value]) => aliasSet.has(keyOf(key)) && value != null);
    return entry?.[1];
  };
  const aggregate = find(record, ['aggregateRating']);
  const value = find(record, ['rating', 'ratingValue', 'averageRating', '星级', '评分'])
    ?? (aggregate && typeof aggregate === 'object' && !Array.isArray(aggregate) ? find(aggregate as Record<string, unknown>, ['ratingValue', 'rating', 'averageRating']) : null);
  const parsed = typeof value === 'string' ? Number(value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0]) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function brightDataMetricSeries(rows: BrightDataInventory[], itemId: string, metric: BrightDataMetric): BrightDataMetricPoint[] {
  const byDay = new Map<string, BrightDataMetricPoint>();
  for (const row of rows.filter((candidate) => candidate.itemId === itemId)) {
    const value = brightDataMetricValue(row, metric);
    const timestamp = new Date(row.queriedAt).getTime();
    if (value == null || !Number.isFinite(timestamp)) continue;
    const point = { value, queriedAt: row.queriedAt };
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const prior = byDay.get(day);
    if (!prior || new Date(prior.queriedAt).getTime() < timestamp) byDay.set(day, point);
  }
  return [...byDay.values()].sort((a, b) => new Date(a.queriedAt).getTime() - new Date(b.queriedAt).getTime());
}

function smoothMetricPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  // Keep the curve smooth without allowing cubic control points to overshoot observations.
  return points.slice(1).reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${points[0].x} ${points[0].y}`);
}

export function brightDataMetricSvg(rows: BrightDataInventory[], itemId: string, metric: BrightDataMetric, label: string, color: string): string {
  const series = brightDataMetricSeries(rows, itemId, metric);
  if (!series.length) return `<div class="brightdata-trend-empty">暂无${escapeHtml(label)}数据</div>`;
  const max = Math.max(...series.map((point) => point.value));
  const min = Math.min(...series.map((point) => point.value));
  const span = max - min || 1;
  const xFor = (index: number): number => series.length === 1 ? 50 : 6 + (index / (series.length - 1)) * 88;
  const yFor = (value: number): number => 48 - ((value - min) / span) * 34;
  const coordinates = series.map((point, index) => ({ x: xFor(index), y: yFor(point.value) }));
  const baseline = 55;
  const path = smoothMetricPath(coordinates);
  const nodeIndices = new Set<number>();
  if (series.length <= 8) series.forEach((_, index) => nodeIndices.add(index));
  else {
    nodeIndices.add(0);
    nodeIndices.add(series.length - 1);
    const minGap = 11;
    let lastX = xFor(0);
    for (let index = 1; index < series.length - 1; index += 1) {
      const x = xFor(index);
      if (x - lastX >= minGap) {
        nodeIndices.add(index);
        lastX = x;
      }
    }
  }
  const circles = series.map((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    const value = metric === 'price' ? `$${point.value.toFixed(2)}` : metric === 'rating' ? point.value.toFixed(1) : String(point.value);
    const title = `${escapeHtml(label)} · ${escapeHtml(dateText(point.queriedAt))} · ${escapeHtml(value)}`;
    const visibleNode = nodeIndices.has(index) ? `<circle class="brightdata-data-point" cx="${x}" cy="${y}" r="0.9" fill="${color}" aria-hidden="true" />` : '';
    return `<circle class="brightdata-hit-point" cx="${x}" cy="${y}" r="3.5" fill="transparent" tabindex="0" aria-label="${title}" data-value="${escapeHtml(value)}" data-date="${escapeHtml(dateText(point.queriedAt))}" data-x="${x}" data-y="${y}"><title>${title}</title></circle>${visibleNode}`;
  }).join('');
  const area = series.length > 1 ? `<path class="brightdata-area-fill" d="${path} L ${coordinates[coordinates.length - 1].x} ${baseline} L ${coordinates[0].x} ${baseline} Z" fill="url(#brightdata-gradient-${metric})" />` : '';
  const line = series.length > 1 ? `<path class="brightdata-series-line" d="${path}" fill="none" stroke="${color}" stroke-width="1.7" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round" />` : '';
  const highlightedIndex = series.length - 1;
  const highlighted = coordinates[highlightedIndex];
  const indicator = `<g class="brightdata-active-indicator" opacity="0" pointer-events="none"><line class="brightdata-active-guide" x1="${highlighted.x}" y1="${highlighted.y}" x2="${highlighted.x}" y2="${baseline}" stroke="${color}" stroke-opacity=".4" stroke-dasharray="1 1"/><circle class="brightdata-active-dot" cx="${highlighted.x}" cy="${highlighted.y}" r="1.45" fill="${color}" stroke="#121923" stroke-width=".55"/></g>`;
  return `<svg viewBox="0 0 100 64" preserveAspectRatio="none" aria-label="${escapeHtml(label)}${series.length > 1 ? '趋势' : '快照'}" data-point-count="${series.length}" role="group"><defs><linearGradient id="brightdata-gradient-${metric}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".23"/><stop offset="100%" stop-color="${color}" stop-opacity=".015"/></linearGradient></defs><g class="brightdata-chart-grid" aria-hidden="true"><line x1="6" y1="14" x2="94" y2="14" /><line x1="6" y1="31" x2="94" y2="31" /><line x1="6" y1="48" x2="94" y2="48" /></g>${area}${line}${circles}${indicator}</svg>`;
}

function setBrightDataActivePoint(svg: SVGSVGElement, index: number): void {
  const points = svg.querySelectorAll<SVGCircleElement>('.brightdata-hit-point');
  const point = points[Math.max(0, Math.min(points.length - 1, index))];
  const indicator = svg.querySelector<SVGGElement>('.brightdata-active-indicator');
  const guide = svg.querySelector<SVGLineElement>('.brightdata-active-guide');
  const dot = svg.querySelector<SVGCircleElement>('.brightdata-active-dot');
  if (!point || !indicator || !guide || !dot) return;
  const x = point.getAttribute('cx') ?? '0';
  const y = point.getAttribute('cy') ?? '0';
  guide.setAttribute('x1', x);
  guide.setAttribute('x2', x);
  guide.setAttribute('y1', y);
  dot.setAttribute('cx', x);
  dot.setAttribute('cy', y);
  indicator.setAttribute('opacity', '1');
}

function floatingBrightDataTooltip(): HTMLDivElement {
  let tooltip = document.querySelector<HTMLDivElement>('.brightdata-floating-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'brightdata-chart-tooltip brightdata-floating-tooltip';
    tooltip.setAttribute('role', 'status');
    tooltip.setAttribute('aria-live', 'polite');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function showBrightDataTooltip(tooltip: HTMLDivElement, clientX: number, clientY: number, text: string, color: string): void {
  tooltip.textContent = text;
  tooltip.style.borderColor = color;
  tooltip.hidden = false;
  const bounds = tooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - bounds.width - 8, clientX - bounds.width / 2));
  const above = clientY - bounds.height - 14;
  const top = above >= 8 ? above : Math.min(window.innerHeight - bounds.height - 8, clientY + 16);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideBrightDataTooltip(tooltip: HTMLDivElement): void {
  tooltip.hidden = true;
}

export function brightDataTrendControlsMarkup(itemId: string, active: BrightDataMetric = 'availableQuantity'): string {
  const options: Array<[BrightDataMetric, string]> = [['availableQuantity', '库存'], ['rating', '评分'], ['price', '价格']];
  return `<div class="brightdata-trend-controls" role="group" aria-label="${escapeHtml(itemId)} 趋势切换">${options.map(([metric, label]) => `<button type="button" class="brightdata-trend-control${metric === active ? ' is-active' : ''}" data-brightdata-metric="${metric}" aria-pressed="${metric === active}">${label}</button>`).join('')}</div>`;
}

export function brightDataActionMarkup(itemId: string): string {
  return `<button type="button" class="brightdata-action" data-brightdata-action="view" data-item-id="${escapeHtml(itemId)}">查看</button>`;
}

export function brightDataScheduleControlsMarkup(schedule: BrightDataScheduleView, loading = false): string {
  return `<div class="brightdata-schedule"><div><strong data-brightdata-schedule-status>${schedule.enabled ? '每日 16:00 已开启' : '每日 16:00 未开启'}</strong><small data-brightdata-schedule-next>${schedule.nextRunAt ? `下次运行 ${escapeHtml(scheduleDateText(schedule.nextRunAt))}` : '北京时间 · Asia/Shanghai'}</small></div><button type="button" class="brightdata-filter-button" data-brightdata-schedule-toggle aria-pressed="${schedule.enabled}" ${loading ? 'disabled' : ''}>${loading ? '读取中' : schedule.enabled ? '暂停定时' : '开启定时'}</button></div>`;
}

function scheduleDateText(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function filterBrightDataItems(items: BrightDataItem[], query: string, category: string): BrightDataItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    const matchesQuery = !normalized || `${item.itemId} ${brightDataItemName(item)}`.toLocaleLowerCase().includes(normalized);
    return matchesQuery && (category === 'all' || brightDataItemCategory(item) === category);
  });
}

export function paginateBrightDataRows<T>(rows: T[], requestedPage: number, pageSize: number): { rows: T[]; page: number; totalPages: number } {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage) || 1));
  return { rows: rows.slice((page - 1) * safePageSize, page * safePageSize), page, totalPages };
}

async function readRows<T>(url: string): Promise<T[]> {
  const firstUrl = new URL(url, window.location.origin);
  const firstPage = Number(firstUrl.searchParams.get('page') ?? 1);
  const pageSize = Number(firstUrl.searchParams.get('pageSize') ?? 100);
  const rows: T[] = [];
  let page = firstPage;
  let totalPages = page;
  do {
    firstUrl.searchParams.set('page', String(page));
    const response = await fetch(firstUrl.pathname + firstUrl.search, { credentials: 'include' });
  const body = await response.json() as { data?: { rows?: T[] } | T[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? '数据读取失败');
    if (Array.isArray(body.data)) rows.push(...body.data); else rows.push(...(body.data?.rows ?? []));
    const pagination = Array.isArray(body.data) ? undefined : (body.data as { pagination?: { totalPages?: number } } | undefined)?.pagination;
    totalPages = pagination?.totalPages ?? (rows.length < pageSize ? page : page + 1);
    page += 1;
  } while (page <= totalPages);
  return rows;
}

async function readBrightDataInventoryByItems(items: BrightDataItem[]): Promise<BrightDataInventory[]> {
  const batches: BrightDataItem[][] = [];
  for (let start = 0; start < items.length; start += 50) batches.push(items.slice(start, start + 50));
  const rows: BrightDataInventory[] = [];
  for (let start = 0; start < batches.length; start += 4) {
    const chunk = await Promise.all(batches.slice(start, start + 4).map((batch) => {
      const query = new URLSearchParams({ itemIds: batch.map((item) => item.itemId).join(','), page: '1', pageSize: '100' });
      return readRows<BrightDataInventory>(`/api/brightdata/inventory?${query}`);
    }));
    rows.push(...chunk.flat());
  }
  return rows;
}

function renderInventoryDashboard(main: HTMLElement, rows: BrightDataInventory[], query = '', category = 'all', items: BrightDataItem[] = []): void {
  const summary = summarizeBrightDataInventory(rows);
  const latest = filterBrightDataInventory(rows, query, category, items);
  const changes = stockChangeByItem(rows);
  const estimatedSales = brightDataEstimatedSalesByItem(rows);
  const estimatedSalesTotal = [...estimatedSales.values()].reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const cards: Array<[string, string, string]> = [
    ['库存快照', String(summary.snapshots), 'Bright Data 采集记录'],
    ['覆盖产品', String(summary.products), '去重 Item ID'],
    ['有库存', String(summary.inStock), '最新快照数量大于 0'],
    ['缺货记录', String(summary.outOfStock), '最新快照数量为 0'],
    ['平均评分', summary.averageRating.toFixed(1), `${summary.reviews} 条评价`],
    ['最近推断出单', String(estimatedSalesTotal), '按最新两次库存减少估算'],
  ];
  main.querySelector<HTMLElement>('[data-brightdata-content]')!.innerHTML = `<div class="brightdata-metrics">${cards.map(([label, value, detail]) => `<article class="brightdata-card"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`).join('')}</div><section class="brightdata-panel"><div class="brightdata-panel-head"><div><p class="eyebrow">库存数据看板</p><h2>竞品监控 · 库存变化推断出单</h2></div><span>${latest.length} 个产品 · 并发抓取 10</span></div>${latest.length ? `<div class="brightdata-product-grid">${latest.map((row) => { const change = changes.get(row.itemId)?.change; const sales = estimatedSales.get(row.itemId); const stockSeries = brightDataMetricSeries(rows, row.itemId, 'availableQuantity'); const ratingSeries = brightDataMetricSeries(rows, row.itemId, 'rating'); const priceSeries = brightDataMetricSeries(rows, row.itemId, 'price'); const rating = brightDataMetricValue(row, 'rating'); const stockClass = row.availableQuantity == null ? 'is-unknown' : Number(row.availableQuantity) > 0 ? 'is-in-stock' : 'is-out-stock'; const trendCaption = (label: string, count: number) => count > 1 ? `${label}趋势 · ${count} 次采集 · 点击趋势可放大` : `${label}快照 · ${count} 次采集 · 暂无趋势`; return `<article class="brightdata-product-card" data-brightdata-trend-card="${escapeHtml(row.itemId)}"><div class="brightdata-product-head"><div><h3>${escapeHtml(row.productName ?? '未提供')}</h3><span class="brightdata-category">${escapeHtml(row.itemId)}</span></div><span class="brightdata-stock ${stockClass}">${row.availableQuantity == null ? '未知库存' : `库存 ${row.availableQuantity}`}</span></div><div class="brightdata-product-meta"><span>库存变化 <strong class="${change != null && change < 0 ? 'is-down' : change != null && change > 0 ? 'is-up' : ''}">${escapeHtml(brightDataTrendText(change))}</strong></span><span>推断出单 <strong class="brightdata-sales-value">${sales == null ? '—' : sales}</strong></span><span>评分 <strong>${rating == null ? '—' : escapeHtml(rating)}</strong></span><span>价格 <strong>${row.price == null ? '—' : `$${escapeHtml(Number(row.price).toFixed(2))}`}</strong></span></div>${brightDataTrendControlsMarkup(row.itemId)}<div class="brightdata-trend-focus" data-brightdata-trend-focus>${brightDataMetricSvg(rows, row.itemId, 'availableQuantity', '库存', '#f59e0b')}<div class="brightdata-chart-tooltip" data-brightdata-tooltip hidden></div><span>${trendCaption('库存', stockSeries.length)}</span></div><div class="brightdata-trends"><div class="brightdata-sparkline">${brightDataMetricSvg(rows, row.itemId, 'availableQuantity', '库存', '#f59e0b')}<span>库存</span></div><div class="brightdata-sparkline">${brightDataMetricSvg(rows, row.itemId, 'rating', '评分', '#22c55e')}<span>评分</span></div><div class="brightdata-sparkline">${brightDataMetricSvg(rows, row.itemId, 'price', '价格', '#60a5fa')}<span>价格</span></div></div><small class="muted">最近采集 ${escapeHtml(dateText(row.queriedAt))}</small></article>`; }).join('')}</div>` : '<div class="empty">暂无匹配库存记录</div>'}</section>`;
  main.querySelectorAll<HTMLElement>('[data-brightdata-trend-card]').forEach((card) => {
    const itemId = card.dataset.brightdataTrendCard ?? '';
    const focus = card.querySelector<HTMLElement>('[data-brightdata-trend-focus]');
    card.querySelectorAll<HTMLButtonElement>('[data-brightdata-metric]').forEach((button) => button.addEventListener('click', () => {
      const metric = button.dataset.brightdataMetric as BrightDataMetric;
      const config: Record<BrightDataMetric, { label: string; color: string }> = { availableQuantity: { label: '库存', color: '#f59e0b' }, rating: { label: '评分', color: '#22c55e' }, price: { label: '价格', color: '#60a5fa' } };
      const selected = config[metric];
      const count = brightDataMetricSeries(rows, itemId, metric).length;
      if (focus) focus.dataset.brightdataMetric = metric;
      card.querySelectorAll<HTMLButtonElement>('[data-brightdata-metric]').forEach((control) => { const active = control === button; control.classList.toggle('is-active', active); control.setAttribute('aria-pressed', String(active)); });
      if (focus) focus.innerHTML = `${brightDataMetricSvg(rows, itemId, metric, selected.label, selected.color)}<div class="brightdata-chart-tooltip" data-brightdata-tooltip hidden></div><span>${count > 1 ? `${selected.label}趋势 · ${count} 次采集 · 点击趋势可放大` : `${selected.label}快照 · ${count} 次采集 · 暂无趋势`}</span>`;
    }));
    card.querySelectorAll<HTMLElement>('.brightdata-sparkline').forEach((preview, index) => preview.addEventListener('click', () => {
      const metric = (['availableQuantity', 'rating', 'price'] as BrightDataMetric[])[index];
      const button = card.querySelector<HTMLButtonElement>(`[data-brightdata-metric="${metric}"]`);
      button?.click();
      card.querySelectorAll<HTMLElement>('.brightdata-sparkline').forEach((item) => item.classList.toggle('is-active', item === preview));
    }));
    card.querySelectorAll<HTMLElement>('.brightdata-sparkline').forEach((preview, index) => preview.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const metric = (['availableQuantity', 'rating', 'price'] as BrightDataMetric[])[index];
      card.querySelector<HTMLButtonElement>(`[data-brightdata-metric="${metric}"]`)?.click();
    }));
    card.querySelectorAll<HTMLElement>('.brightdata-sparkline').forEach((preview, index) => {
      const metric = (['availableQuantity', 'rating', 'price'] as BrightDataMetric[])[index];
      const config = { availableQuantity: { label: '库存', color: '#f59e0b' }, rating: { label: '评分', color: '#22c55e' }, price: { label: '价格', color: '#60a5fa' } }[metric];
      const tooltip = floatingBrightDataTooltip();
      preview.addEventListener('pointermove', (event) => {
        const svg = preview.querySelector('svg');
        const series = brightDataMetricSeries(rows, itemId, metric);
        if (!svg || !series.length) return;
        const rect = svg.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
        const index = Math.min(series.length - 1, Math.round(ratio * (series.length - 1)));
        const point = series[index];
        setBrightDataActivePoint(svg, index);
        const value = metric === 'price' ? `$${point.value.toFixed(2)}` : metric === 'rating' ? point.value.toFixed(1) : point.value.toLocaleString('zh-CN');
        const target = svg.querySelectorAll<SVGCircleElement>('.brightdata-hit-point')[index];
        const pointRect = target?.getBoundingClientRect();
        showBrightDataTooltip(tooltip, pointRect ? pointRect.left + pointRect.width / 2 : event.clientX, pointRect ? pointRect.top : event.clientY, `${dateText(point.queriedAt).split(' ')[0]}\n${config.label}: ${value}`, config.color);
      });
      preview.addEventListener('pointerleave', () => { hideBrightDataTooltip(tooltip); const indicator = preview.querySelector<SVGGElement>('.brightdata-active-indicator'); indicator?.setAttribute('opacity', '0'); });
      preview.querySelectorAll<SVGCircleElement>('.brightdata-hit-point').forEach((point, index) => point.addEventListener('focus', () => { const svg = preview.querySelector('svg'); if (svg) setBrightDataActivePoint(svg, index); }));
    });
    if (focus) {
      focus.setAttribute('tabindex', '0');
      focus.setAttribute('role', 'button');
      focus.setAttribute('aria-label', `${itemId} 趋势图，点击放大`);
      const toggleExpanded = () => focus.classList.toggle('is-expanded');
      focus.addEventListener('click', toggleExpanded);
      focus.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpanded(); } });
      const showTooltip = (event: PointerEvent) => {
        const svg = focus.querySelector('svg');
        const tooltip = floatingBrightDataTooltip();
        const metric = (focus.dataset.brightdataMetric as BrightDataMetric | undefined) ?? 'availableQuantity';
        const config: Record<BrightDataMetric, string> = { availableQuantity: '库存', rating: '评分', price: '价格' };
        const series = brightDataMetricSeries(rows, itemId, metric);
        if (!svg || !tooltip || !series.length) return;
        const rect = svg.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
        const index = Math.min(series.length - 1, Math.round(ratio * (series.length - 1)));
        const point = series[index];
        setBrightDataActivePoint(svg, index);
        const value = metric === 'price' ? `$${point.value.toFixed(2)}` : metric === 'rating' ? point.value.toFixed(1) : point.value.toLocaleString('zh-CN');
        const target = svg.querySelectorAll<SVGCircleElement>('.brightdata-hit-point')[index];
        const pointRect = target?.getBoundingClientRect();
        showBrightDataTooltip(tooltip, pointRect ? pointRect.left + pointRect.width / 2 : event.clientX, pointRect ? pointRect.top : event.clientY, `${dateText(point.queriedAt).split(' ')[0]}\n${config[metric]}: ${value}`, ({ availableQuantity: '#f59e0b', rating: '#22c55e', price: '#60a5fa' })[metric]);
      };
      focus.addEventListener('pointermove', showTooltip);
      focus.addEventListener('pointerleave', () => { hideBrightDataTooltip(floatingBrightDataTooltip()); const indicator = focus.querySelector<SVGGElement>('.brightdata-active-indicator'); indicator?.setAttribute('opacity', '0'); });
      focus.querySelectorAll<SVGCircleElement>('.brightdata-hit-point').forEach((point, index) => point.addEventListener('focus', () => { const svg = focus.querySelector('svg'); if (svg) setBrightDataActivePoint(svg, index); }));
    }
  });
}

function renderItemsManagement(main: HTMLElement, items: BrightDataItem[], state: { query: string; category: string; page: number }): void {
  const filtered = filterBrightDataItems(items, state.query, state.category);
  const paginated = paginateBrightDataRows(filtered, state.page, 12);
  state.page = paginated.page;
  const categories = [...new Set(items.map(brightDataItemCategory))].sort((a, b) => a.localeCompare(b));
  main.querySelector<HTMLElement>('[data-brightdata-content]')!.innerHTML = `<section class="brightdata-panel"><div class="brightdata-panel-head"><div><p class="eyebrow">产品管理</p><h2>Bright Data 产品目录</h2></div><div class="brightdata-panel-actions"><span>${filtered.length} 个产品</span><button type="button" class="brightdata-filter-button" data-brightdata-add>新增产品</button></div></div>${paginated.rows.length ? `<div class="brightdata-table-wrap"><table class="brightdata-table"><thead><tr><th>Item ID</th><th>产品名称</th><th>品类</th><th>创建人</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${paginated.rows.map((item) => { const payload = payloadRecord(item); const creator = payload.creator ?? payload.createdBy ?? payload.owner ?? '未提供'; const productName = brightDataItemName(item); return `<tr><td><strong>${escapeHtml(item.itemId)}</strong></td><td class="brightdata-product-name" title="${escapeHtml(productName)}">${escapeHtml(productName)}</td><td><span class="brightdata-category">${escapeHtml(brightDataItemCategory(item))}</span></td><td>${escapeHtml(creator)}</td><td>${escapeHtml(dateText(item.createdAt))}</td><td>${brightDataActionMarkup(item.itemId)}</td></tr>`; }).join('')}</tbody></table></div><nav class="brightdata-pagination" aria-label="产品分页"><button type="button" data-brightdata-prev ${paginated.page === 1 ? 'disabled' : ''}>上一页</button><span>第 ${paginated.page} / ${paginated.totalPages} 页 · 共 ${filtered.length} 个产品</span><button type="button" data-brightdata-next ${paginated.page === paginated.totalPages ? 'disabled' : ''}>下一页</button></nav>` : '<div class="empty">暂无匹配产品</div>'}</section>`;
  main.querySelector<HTMLElement>('.brightdata-panel-actions')?.insertAdjacentHTML('beforeend', '<button type="button" class="brightdata-filter-button" data-brightdata-import>批量导入</button>');
  main.querySelector<HTMLButtonElement>('[data-brightdata-prev]')?.addEventListener('click', () => { state.page -= 1; renderItemsManagement(main, items, state); });
  main.querySelector<HTMLButtonElement>('[data-brightdata-next]')?.addEventListener('click', () => { state.page += 1; renderItemsManagement(main, items, state); });
  main.querySelectorAll<HTMLButtonElement>('[data-brightdata-action="view"]').forEach((button) => button.addEventListener('click', () => { button.textContent = '已查看'; button.setAttribute('aria-label', `已查看 ${button.dataset.itemId ?? ''}`); }));
  main.querySelector<HTMLButtonElement>('[data-brightdata-add]')?.addEventListener('click', () => {
    const modal = document.createElement('div');
    modal.className = 'brightdata-modal-backdrop';
    modal.innerHTML = `<form class="brightdata-modal" role="dialog" aria-modal="true" aria-labelledby="brightdata-add-title"><button type="button" class="brightdata-modal-close" aria-label="关闭">×</button><h2 id="brightdata-add-title">新增产品</h2><label>产品名称 *<input name="productName" placeholder="请输入产品名称" required maxlength="1000"></label><label>Item ID *<input name="itemId" placeholder="请输入 Item ID" required maxlength="191"><span class="brightdata-field-error" data-item-id-error role="alert"></span></label><label>产品分类 *<input name="category" placeholder="请输入产品分类" required maxlength="255"></label><p class="brightdata-form-error" role="alert"></p><div class="brightdata-modal-actions"><button type="button" data-cancel>取消</button><button type="submit" class="brightdata-filter-button">保存</button></div></form>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector<HTMLButtonElement>('.brightdata-modal-close')!.onclick = close;
    modal.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = close;
    modal.onclick = (event) => { if (event.target === modal) close(); };
    const form = modal.querySelector('form')! as HTMLFormElement;
    const itemIdInput = form.querySelector<HTMLInputElement>('input[name="itemId"]')!;
    const itemIdError = form.querySelector<HTMLElement>('[data-item-id-error]')!;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const checkItemId = () => { const value = itemIdInput.value.trim().toLocaleLowerCase(); const duplicate = Boolean(value) && items.some((item) => item.itemId.trim().toLocaleLowerCase() === value); itemIdError.textContent = duplicate ? '⚠ 已存在' : ''; itemIdInput.setAttribute('aria-invalid', String(duplicate)); submit.disabled = duplicate; return duplicate; };
    itemIdInput.addEventListener('input', checkItemId);
    form.addEventListener('submit', async (event) => { event.preventDefault(); if (checkItemId() || !form.reportValidity()) return; const values = new FormData(form); const error = form.querySelector<HTMLElement>('.brightdata-form-error')!; submit.disabled = true; error.textContent = ''; try { const response = await fetch('/api/brightdata/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ productName: values.get('productName'), itemId: values.get('itemId'), category: values.get('category') }) }); const body = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? '保存失败'); close(); await renderBrightDataPanel(main); } catch (err) { error.textContent = err instanceof Error ? err.message : '保存失败'; submit.disabled = false; } });
  });
  main.querySelector<HTMLButtonElement>('[data-brightdata-import]')?.addEventListener('click', () => {
    const modal = document.createElement('div'); modal.className = 'brightdata-modal-backdrop'; modal.innerHTML = `<form class="brightdata-modal brightdata-import-modal" role="dialog" aria-modal="true"><button type="button" class="brightdata-modal-close" aria-label="关闭">×</button><h2>批量导入产品</h2><div class="brightdata-import-tabs"><button type="button" class="is-active" data-import-mode="paste">粘贴数据</button><label>上传文件<input type="file" accept=".csv,text/csv" data-import-file hidden></label></div><p class="muted">每行一条产品，格式：产品名称, Item ID, 分类（逗号分隔）</p><textarea name="bulk" rows="8" placeholder="蓝牙耳机,SKU001,电子产品\n机械键盘,SKU002,电子产品" required></textarea><div class="brightdata-import-preview" data-import-preview></div><p class="brightdata-form-error" role="alert"></p><div class="brightdata-modal-actions"><button type="button" data-cancel>取消</button><button type="button" data-preview>预览</button><button type="submit" class="brightdata-filter-button" disabled>导入</button></div></form>`; document.body.appendChild(modal); const close = () => modal.remove(); modal.querySelector<HTMLButtonElement>('.brightdata-modal-close')!.onclick = close; modal.querySelector<HTMLButtonElement>('[data-cancel]')!.onclick = close; const form = modal.querySelector('form') as HTMLFormElement; const textarea = form.querySelector('textarea')!; const preview = form.querySelector<HTMLElement>('[data-import-preview]')!; const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!; let parsed: BrightDataImportRow[] = []; const renderPreview = () => { parsed = parseBrightDataImport(textarea.value, items); preview.innerHTML = parsed.length ? parsed.map((row, index) => `<div class="brightdata-import-row ${row.error ? 'is-error' : ''}">${index + 1}. ${escapeHtml(row.productName)} · ${escapeHtml(row.itemId)} · ${escapeHtml(row.category)} ${row.error ? `<span>${escapeHtml(row.error)}</span>` : '✓'}</div>`).join('') : ''; submit.disabled = !parsed.length || parsed.some((row) => row.error); }; form.querySelector<HTMLButtonElement>('[data-preview]')!.onclick = renderPreview; form.querySelector<HTMLInputElement>('[data-import-file]')!.onchange = async (event) => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) { textarea.value = await file.text(); renderPreview(); } }; form.onsubmit = async (event) => { event.preventDefault(); renderPreview(); if (submit.disabled) return; submit.disabled = true; const error = form.querySelector<HTMLElement>('.brightdata-form-error')!; try { const response = await fetch('/api/brightdata/items/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ items: parsed }) }); const body = await response.json() as { data?: { created?: unknown[]; skipped?: string[] }; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? '导入失败'); close(); await renderBrightDataPanel(main); } catch (err) { error.textContent = err instanceof Error ? err.message : '导入失败'; submit.disabled = false; } };
  });
}

export async function renderBrightDataPanel(main: HTMLElement): Promise<void> {
  main.innerHTML = `<header class="brightdata-header"><div><p class="eyebrow">Bright Data</p><h1>面板</h1><p class="muted">搜索后查看竞品库存与历史趋势</p></div>${brightDataScheduleControlsMarkup({ enabled: false, timezone: 'Asia/Shanghai', nextRunAt: null, lastRunAt: null }, true)}</header><form class="brightdata-filters brightdata-shared-filters"><input name="query" type="search" placeholder="输入 Item ID 或产品名称后搜索" aria-label="搜索 Bright Data 数据"><select name="category" aria-label="按品类筛选"><option value="all">全部品类</option></select><button class="brightdata-filter-button" type="submit">搜索</button></form><div class="brightdata-tabs" role="tablist">${brightDataTabs.map((label, index) => `<button type="button" class="brightdata-tab${index === 0 ? ' is-active' : ''}" data-brightdata-tab="${index === 0 ? 'inventory' : 'items'}" role="tab" aria-selected="${index === 0}">${label}</button>`).join('')}</div><div data-brightdata-content><section class="brightdata-panel brightdata-search-empty"><strong>输入 Item ID 或产品名称开始查询</strong><span>库存快照和趋势将在搜索后加载</span></section></div>`;
  const content = main.querySelector<HTMLElement>('[data-brightdata-content]')!;
  const queryInput = main.querySelector<HTMLInputElement>('[name="query"]')!;
  const categorySelect = main.querySelector<HTMLSelectElement>('[name="category"]')!;
  let currentTab: 'inventory' | 'items' = 'inventory';
  let activeQuery = '';
  let inventory: BrightDataInventory[] = [];
  let items: BrightDataItem[] = [];
  let allItems: BrightDataItem[] | null = null;
  let allItemsRequest: Promise<BrightDataItem[]> | null = null;
  let requestId = 0;
  const itemState = { query: '', category: 'all', page: 1 };
  const updateCategories = (rows: BrightDataItem[]) => {
    const selected = categorySelect.value;
    categorySelect.innerHTML = '<option value="all">全部品类</option>';
    brightDataCategories(allItems ?? rows).forEach((category) => categorySelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`));
    categorySelect.value = [...categorySelect.options].some((option) => option.value === selected) ? selected : 'all';
  };
  const getAllItems = (): Promise<BrightDataItem[]> => {
    if (allItems) return Promise.resolve(allItems);
    if (!allItemsRequest) allItemsRequest = readRows<BrightDataItem>('/api/brightdata/items?page=1&pageSize=100').then((rows) => { allItems = rows; return rows; }).finally(() => { allItemsRequest = null; });
    return allItemsRequest;
  };
  const showSearchPrompt = (message = '输入 Item ID 或产品名称开始查询') => {
    content.innerHTML = `<section class="brightdata-panel brightdata-search-empty"><strong>${escapeHtml(message)}</strong><span>未搜索时不会加载库存历史</span></section>`;
  };
  const searchRows = async (query: string, tab = currentTab) => {
    activeQuery = query.trim();
    itemState.query = activeQuery;
    itemState.page = 1;
    const selectedCategory = categorySelect.value;
    if (!activeQuery && selectedCategory === 'all') { inventory = []; items = []; showSearchPrompt(); return; }
    const currentRequest = ++requestId;
    content.innerHTML = '<section class="brightdata-panel"><div class="empty">正在搜索产品目录…</div></section>';
    try {
      if (tab === 'inventory') {
        if (activeQuery) {
          const response = await fetch(`/api/brightdata/search?q=${encodeURIComponent(activeQuery)}`, { credentials: 'include' });
          const body = await response.json() as { data?: { items: BrightDataItem[]; inventory: BrightDataInventory[] }; error?: { message?: string } };
          if (!response.ok || !body.data) throw new Error(body.error?.message ?? '商品查询失败');
          items = body.data.items;
          inventory = body.data.inventory;
        } else {
          items = filterBrightDataItemsByCategory(await getAllItems(), selectedCategory);
          if (currentRequest !== requestId) return;
          inventory = await readBrightDataInventoryByItems(items);
        }
        if (currentRequest !== requestId) return;
        updateCategories(items);
        if (!items.length && !inventory.length) { content.innerHTML = '<section class="brightdata-panel"><div class="empty">没有找到匹配的产品</div></section>'; return; }
        renderInventoryDashboard(main, inventory, activeQuery, categorySelect.value, items);
      } else {
        const matchedItems = activeQuery ? allItems ? allItems.filter((item) => `${item.itemId} ${brightDataItemName(item)}`.toLocaleLowerCase().includes(activeQuery.toLocaleLowerCase())) : await readRows<BrightDataItem>(`/api/brightdata/items?q=${encodeURIComponent(activeQuery)}&page=1&pageSize=100`) : filterBrightDataItemsByCategory(await getAllItems(), selectedCategory);
        if (currentRequest !== requestId) return;
        items = matchedItems;
        updateCategories(items);
        renderItemsManagement(main, items, itemState);
      }
    } catch (error) {
      if (currentRequest === requestId) content.innerHTML = `<section class="brightdata-panel"><div class="empty error">${escapeHtml(error instanceof Error ? error.message : 'Bright Data 数据读取失败')}</div></section>`;
    }
  };
  const loadAllItems = async () => {
    if (allItems) { items = allItems; updateCategories(items); renderItemsManagement(main, items, itemState); return; }
    const currentRequest = ++requestId;
    content.innerHTML = '<section class="brightdata-panel"><div class="empty">正在读取产品目录…</div></section>';
    try {
      const rows = await getAllItems();
      if (currentRequest !== requestId) return;
      allItems = rows;
      items = activeQuery ? rows.filter((item) => `${item.itemId} ${brightDataItemName(item)}`.toLocaleLowerCase().includes(activeQuery.toLocaleLowerCase())) : rows;
      updateCategories(items);
      renderItemsManagement(main, items, itemState);
    } catch (error) {
      if (currentRequest === requestId) content.innerHTML = `<section class="brightdata-panel"><div class="empty error">${escapeHtml(error instanceof Error ? error.message : '产品目录读取失败')}</div></section>`;
    }
  };
  main.querySelector<HTMLFormElement>('.brightdata-shared-filters')!.onsubmit = (event) => {
    event.preventDefault();
    itemState.category = categorySelect.value;
    void searchRows(queryInput.value, currentTab);
  };
  main.querySelectorAll<HTMLButtonElement>('.brightdata-tab').forEach((button) => button.addEventListener('click', () => {
    currentTab = button.dataset.brightdataTab as 'inventory' | 'items';
    main.querySelectorAll<HTMLButtonElement>('.brightdata-tab').forEach((tab) => { const selected = tab === button; tab.classList.toggle('is-active', selected); tab.setAttribute('aria-selected', String(selected)); });
    if (currentTab === 'items') { itemState.query = activeQuery; if (allItems) { items = activeQuery ? allItems.filter((item) => `${item.itemId} ${brightDataItemName(item)}`.toLocaleLowerCase().includes(activeQuery.toLocaleLowerCase())) : allItems; renderItemsManagement(main, items, itemState); } else void loadAllItems(); }
    else if (activeQuery) void searchRows(activeQuery, 'inventory');
    else showSearchPrompt();
  }));
  void getAllItems().then((rows) => updateCategories(rows)).catch(() => {});
  try {
    const scheduleResponse = await fetch('/api/brightdata/schedule', { credentials: 'include' });
    const scheduleBody = await scheduleResponse.json() as { data?: BrightDataScheduleView; error?: { message?: string } };
    if (!scheduleResponse.ok || !scheduleBody.data) throw new Error(scheduleBody.error?.message ?? '定时设置读取失败');
    let schedule = scheduleBody.data;
    const updateScheduleView = (message?: string) => {
      const button = main.querySelector<HTMLButtonElement>('[data-brightdata-schedule-toggle]')!;
      const status = main.querySelector<HTMLElement>('[data-brightdata-schedule-status]')!;
      const next = main.querySelector<HTMLElement>('[data-brightdata-schedule-next]')!;
      button.disabled = false;
      button.textContent = schedule.enabled ? '暂停定时' : '开启定时';
      button.setAttribute('aria-pressed', String(schedule.enabled));
      status.textContent = message ?? (schedule.enabled ? '每日 16:00 已开启' : '每日 16:00 未开启');
      next.textContent = schedule.nextRunAt ? `下次运行 ${scheduleDateText(schedule.nextRunAt)}` : schedule.lastRunAt ? `上次触发 ${scheduleDateText(schedule.lastRunAt)} · Asia/Shanghai` : '北京时间 · Asia/Shanghai';
    };
    updateScheduleView();
    main.querySelector<HTMLButtonElement>('[data-brightdata-schedule-toggle]')!.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = '保存中…';
      try {
        const response = await fetch('/api/brightdata/schedule', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ enabled: !schedule.enabled }) });
        const body = await response.json() as { data?: BrightDataScheduleView; error?: { message?: string } };
        if (!response.ok || !body.data) throw new Error(body.error?.message ?? '定时设置保存失败');
        schedule = body.data;
        updateScheduleView();
      } catch (error) {
        updateScheduleView(error instanceof Error ? error.message : '定时设置保存失败');
      }
    });
  } catch (error) { content.innerHTML = `<section class="brightdata-panel"><div class="empty error">${escapeHtml(error instanceof Error ? error.message : 'Bright Data 定时状态读取失败')}</div></section>`; }
}
