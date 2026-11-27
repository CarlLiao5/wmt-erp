import { dateRangePickerMarkup, mountDateRangePicker } from '../components/DateRangePicker.js';

export interface DashboardView { metrics: { revenue: number; orders: number; units: number; refunds: number; profit: number; profitAvailable?: boolean; estimated: boolean }; trend: DashboardTrendRow[]; freshness: string | null; stores?: Array<{ storeId: string; storeName: string; revenue: number; orders: number; units: number }>; stockoutRisk?: Array<{ sku: string; title: string; inventory: number; units30d: number; daysLeft: number | null }>; adSpend?: { today: number | null; month: number | null; trend: Array<{ date: string; onsite: number; sem: number }> }; highAcos?: Array<{ sku: string; storeName: string; spend: number; sales: number; acos: number }>; }
export interface StorageCardData { month?: string | null; amount: number | null; currency: string | null; period?: { startDate: string | null; endDate: string | null } }
export function formatStorageCard(data: StorageCardData): { value: string; period: string } {
  const value = data.amount == null ? '暂无数据' : `${data.currency ?? 'USD'} ${Number(data.amount).toFixed(2)}`;
  const startDate = data.period?.startDate;
  const endDate = data.period?.endDate;
  const month = data.month ? `最新账期 ${data.month}` : '最新账期';
  return { value, period: startDate && endDate ? `${month} · ${startDate.replaceAll('-', '/')} - ${endDate.replaceAll('-', '/')}` : `${month} · 费用周期待账单返回` };
}
const dashboardTrendObservers = new WeakMap<HTMLElement, ResizeObserver>();
const dashboardRenderVersions = new WeakMap<object, number>();
export function beginDashboardRender(host: object): () => boolean {
  const version = (dashboardRenderVersions.get(host) ?? 0) + 1;
  dashboardRenderVersions.set(host, version);
  return () => dashboardRenderVersions.get(host) === version;
}
export function last30Days<T extends { date: string }>(rows: T[]): T[] { return rows.map((row) => ({ ...row, date: normalizeTrendDate(row.date) })).sort((a, b) => a.date.localeCompare(b.date)).slice(-30); }
export function trendBarHeight(revenue: number, maxRevenue: number, maxHeight = 150): number { return maxRevenue > 0 ? Math.max(4, revenue / maxRevenue * maxHeight) : 0; }
export function trendLinePoints(rows: Array<{ units: number }>, width = 900, height = 150): string { const max = Math.max(1, ...rows.map((row) => row.units)); return rows.map((row, index) => `${rows.length < 2 ? width / 2 : index / (rows.length - 1) * width},${height - row.units / max * (height - 12)}`).join(' '); }
export type DashboardTrendRow = { date: string; revenue: number; units: number; orders: number; profit?: number | null };
export type DashboardTrendOptions = { days: 7 | 14 | 30; showRevenue: boolean; showUnits: boolean };
const dashboardTrendOptions: DashboardTrendOptions = { days: 30, showRevenue: true, showUnits: true };
const TREND_CHART = { width: 1000, height: 300, left: 66, right: 66, top: 22, bottom: 234 };
export function dashboardTrendSvg(rows: DashboardTrendRow[], options: DashboardTrendOptions, width = TREND_CHART.width): string {
  const { height, top, bottom } = TREND_CHART;
  const left = Math.min(76, Math.max(54, width * 0.13));
  const right = left;
  const plotWidth = width - left - right;
  const plotHeight = bottom - top;
  const niceMax = (value: number) => {
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
    const fraction = value / magnitude;
    const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
    return step * magnitude;
  };
  const minMoney = -niceMax(Math.max(0, ...rows.map(row => -(row.profit ?? 0))));
  const lower = rows.some(row => (row.profit ?? 0) < 0) ? minMoney : 0;
  const maxRevenue = niceMax(Math.max(1, ...rows.map(row => Math.max(row.revenue, row.profit ?? 0))));
  const maxUnits = niceMax(Math.max(1, ...rows.map((row) => row.units)));
  const step = plotWidth / Math.max(1, rows.length);
  const barWidth = Math.min(22, step * 0.56);
  const x = (index: number) => left + step * (index + 0.5);
  const yRevenue = (value: number) => bottom - (value - lower) / (maxRevenue - lower) * plotHeight;
  const yUnits = (value: number) => bottom - value / maxUnits * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const grid = ticks.map((ratio) => {
    const y = bottom - ratio * plotHeight;
    const revenue = (lower + (maxRevenue - lower) * ratio).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const units = (maxUnits * ratio).toLocaleString(undefined, { maximumFractionDigits: 1 });
    return `<g class="dashboard-trend-tick"><line x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text x="${left - 8}" y="${y + 4}" text-anchor="end">${revenue}</text><text x="${width - right + 8}" y="${y + 4}">${units}</text></g>`;
  }).join('');
  const bars = options.showRevenue ? rows.map((row, index) => {
    const barY = yRevenue(row.revenue);
    const barHeight = Math.max(1, yRevenue(0) - barY);
    return `<rect class="dashboard-trend-bar" x="${x(index) - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="3"/>`;
  }).join('') : '';
  const profitBars = rows.map((row,index) => {
    if (row.profit == null) return '';
    const y = yRevenue(row.profit), zero = yRevenue(0);
    const color = row.profit < 0 ? '#b45348' : '#087f73';
    return `<rect fill="${color}" x="${x(index)+barWidth/2}" y="${Math.min(y,zero)}" width="${barWidth/2}" height="${Math.max(1,Math.abs(y-zero))}" rx="2"/>`;
  }).join('');
  const linePoints = rows.map((row, index) => `${x(index)},${yUnits(row.units)}`).join(' ');
  const line = options.showUnits && rows.length > 1 ? `<polyline class="dashboard-trend-line" points="${linePoints}"/>` : '';
  const labels = rows.map((row, index) => {
    const labelStride = Math.max(1, Math.ceil(rows.length / Math.max(2, Math.floor(plotWidth / 70))));
    if (index % labelStride !== 0 && index !== rows.length - 1) return '';
    return `<text class="dashboard-trend-date" x="${x(index)}" y="${bottom + 23}" text-anchor="middle">${shortTrendDate(row.date)}</text>`;
  }).join('');
  const points = rows.map((row, index) => {
    const detail = `${row.date}｜销售额 ${row.revenue.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })}｜销量 ${row.units} 件｜订单量 ${row.orders} 单`;
    const aria = detail.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `<rect class="dashboard-trend-hit${options.showUnits ? '' : ' is-no-line'}" x="${left + step * index}" y="${top}" width="${step}" height="${bottom - top}" tabindex="0" role="button" aria-label="${aria}，按此日期筛选" data-trend-index="${index}"/>`;
  }).join('');
  return `<svg class="dashboard-trend-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="group" aria-label="最近 ${rows.length} 天销售额、销量和可用利润趋势图">${grid}<line class="dashboard-trend-axis" x1="${left}" x2="${width - right}" y1="${bottom}" y2="${bottom}"/>${bars}${profitBars}${line}${points}${labels}</svg>`;
}
export function normalizeTrendDate(value: string): string { const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`; const legacy = value.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/); if (legacy) { const month = new Date(`${legacy[1]} 1, 2000`).getMonth() + 1; return `${legacy[3]}-${String(month).padStart(2, '0')}-${legacy[2].padStart(2, '0')}`; } const date = new Date(value); if (Number.isNaN(date.getTime())) return value; const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const fields = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${fields.year}-${fields.month}-${fields.day}`; }
export function shortTrendDate(value: string): string { const normalized = normalizeTrendDate(value); const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/); return match ? `${match[2]}/${match[3]}` : normalized; }
function latestThirtyDayAdRows<T extends { date: string }>(rows: T[]): T[] { const end = new Date(); end.setHours(0, 0, 0, 0); const start = new Date(end); start.setDate(start.getDate() - 29); const iso = (value: Date) => value.toISOString().slice(0, 10); const from = iso(start); const to = iso(end); return rows.filter((row) => row.date >= from && row.date <= to); }
export function formatFreshness(value: string | null): string { if (!value) return '等待首次同步'; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${shortTrendDate(value)}（Pacific）`; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date); const fields = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${fields.month}/${fields.day} ${fields.hour}:${fields.minute}（Pacific）`; }
export async function renderDashboardPage(main: HTMLElement): Promise<void> {
  dashboardTrendObservers.get(main)?.disconnect();
  const isCurrentRender = beginDashboardRender(main);
  const dashboardIsMounted = () => isCurrentRender() && Boolean(main.querySelector('[data-dashboard-metrics]'));
  const previousStore = main.querySelector<HTMLSelectElement>('[data-dashboard-store]')?.value ?? '';
  const previousSku = main.querySelector<HTMLInputElement>('[data-dashboard-sku]')?.value ?? '';
  const previousFrom = main.querySelector<HTMLInputElement>('[data-date-range-from]')?.value ?? '';
  const previousTo = main.querySelector<HTMLInputElement>('[data-date-range-to]')?.value ?? '';
  main.innerHTML = '<header><div><p class="eyebrow">经营概览</p><h1>Dashboard</h1><p class="muted">销售、退货、利润与目标完成度</p></div><div class="fresh">最新销售日（美国太平洋时间）<br><strong>读取中...</strong></div></header><section class="dashboard-filters"><label>店铺 <select data-dashboard-store><option value="">全部店铺</option></select></label><label>SKU <input data-dashboard-sku placeholder="SKU ID"></label>' + dateRangePickerMarkup('dashboard', previousFrom, previousTo) + '<button class="secondary" data-dashboard-apply>筛选</button></section><section class="metrics" data-dashboard-metrics>加载中...</section><section class="panel dashboard-trend-panel"><div class="panel-head"><div><h2>日趋势</h2><span class="muted">按美国太平洋时间聚合 · 数据未估算</span></div></div><div data-dashboard-trend class="dashboard-trend">加载中...</div></section><section class="dashboard-chart-grid"><article class="panel dashboard-chart"><h2>利润趋势</h2><div class="dashboard-empty">暂无成本数据</div></article><article class="panel dashboard-chart"><h2>站内广告和 SEM 花费</h2><div class="dashboard-empty">暂无广告花费数据</div></article><article class="panel dashboard-chart" data-dashboard-stores><h2>多店铺销售信息</h2><div class="dashboard-empty">加载中...</div></article><article class="panel dashboard-chart" data-dashboard-risk><h2>库存告急 Top 10</h2><p class="muted">30天内断货风险</p><div class="dashboard-empty">加载中...</div></article><article class="panel dashboard-chart"><h2>广告 ACOS 过高 Top 10</h2><div class="dashboard-empty">暂无广告数据</div></article><article class="panel dashboard-chart"><h2>搜索排名下降榜</h2><div class="dashboard-empty">暂无搜索排名数据</div></article></section>';
  main.querySelector<HTMLInputElement>('[data-dashboard-sku]')!.value = previousSku;
  mountDateRangePicker(main, 'dashboard', () => { void renderDashboardPage(main); });
  const query = new URLSearchParams(); const store = previousStore; const sku = previousSku; const from = previousFrom; const to = previousTo; if (store) query.set('storeId', store); if (sku) query.set('skuId', sku); if (from) query.set('from', from); if (to) query.set('to', to);
  const response = await fetch('http://localhost:3000/api/dashboard/overview?' + query.toString(), { credentials: 'include' });
  if (!dashboardIsMounted()) return;
  if (!response.ok) { main.querySelector('[data-dashboard-metrics]')!.textContent = '经营概览读取失败'; return; }
  const body = await response.json() as { data: DashboardView }; const data = body.data;
  if (!dashboardIsMounted()) return;
  const storeSelect = main.querySelector<HTMLSelectElement>('[data-dashboard-store]'); if (storeSelect && data.stores) { storeSelect.innerHTML = '<option value="">全部店铺</option>' + data.stores.map((item) => '<option value="' + item.storeId + '">' + item.storeName + '</option>').join(''); storeSelect.value = previousStore; }
  main.querySelector<HTMLElement>('[data-dashboard-stores]')!.innerHTML = '<h2>多店铺销售信息</h2>' + (data.stores?.length ? '<table class="data-table"><tbody>' + data.stores.map((item) => '<tr><td>' + item.storeName + '</td><td>$' + item.revenue.toFixed(2) + '</td><td>' + item.units + ' 件</td><td>' + item.orders + ' 单</td></tr>').join('') + '</tbody></table>' : '<div class="dashboard-empty">暂无多店铺聚合数据</div>');
  // Keep the dashboard light by defaulting the ad chart to the latest 30 days;
  // an explicit date filter must be allowed to reveal older spend data.
  const adTrend = from || to ? (data.adSpend?.trend ?? []) : latestThirtyDayAdRows(data.adSpend?.trend ?? []);
  const maxAdSpend = Math.max(1, ...adTrend.map((row) => row.onsite + row.sem));
  const adChart = adTrend.length ? `<div class="dashboard-ad-legend"><span><i class="onsite"></i>站内广告</span><span><i class="sem"></i>SEM</span></div><div class="dashboard-ad-bars">${adTrend.slice(-30).map((row) => { const onsiteHeight = row.onsite / maxAdSpend * 132; const semHeight = row.sem / maxAdSpend * 132; return `<div class="dashboard-ad-day" tabindex="0" title="${row.date} · 站内广告 $${row.onsite.toFixed(2)} · SEM $${row.sem.toFixed(2)}"><div class="dashboard-ad-columns"><i class="onsite" style="height:${Math.max(row.onsite ? 3 : 0, onsiteHeight)}px"></i><i class="sem" style="height:${Math.max(row.sem ? 3 : 0, semHeight)}px"></i></div><span>${shortTrendDate(row.date)}</span></div>`; }).join('')}</div>` : '<div class="dashboard-empty">暂无广告花费数据</div>';
  const adSpendPanel = main.querySelector<HTMLElement>('.dashboard-chart:nth-child(2)');
  if (adSpendPanel) adSpendPanel.innerHTML = '<h2>站内广告和 SEM 花费</h2>' + adChart;
  const acosPanel = main.querySelector<HTMLElement>('.dashboard-chart:nth-child(5)');
  if (acosPanel) acosPanel.innerHTML = '<h2>广告 ACOS 过高 Top 10</h2>' + (data.highAcos?.length ? '<table class="data-table dashboard-acos-table"><thead><tr><th>SKU</th><th>花费</th><th>销售额</th><th>ACOS</th></tr></thead><tbody>' + data.highAcos.map((item) => '<tr title="' + item.storeName + '"><td>' + item.sku + '</td><td>$' + item.spend.toFixed(2) + '</td><td>$' + item.sales.toFixed(2) + '</td><td><strong>' + (item.acos * 100).toFixed(2) + '%</strong></td></tr>').join('') + '</tbody></table>' : '<div class="dashboard-empty">暂无可计算 ACOS 的站内广告数据</div>');
  main.querySelector<HTMLElement>('[data-dashboard-risk]')!.innerHTML = '<h2>库存告急 Top 10</h2><p class="muted">30天内断货风险</p>' + (data.stockoutRisk?.length ? '<table class="data-table"><tbody>' + data.stockoutRisk.map((item) => '<tr><td>' + item.title + '</td><td>' + item.inventory + '</td><td>' + (item.daysLeft == null ? '—' : item.daysLeft + ' 天') + '</td></tr>').join('') + '</tbody></table>' : '<div class="dashboard-empty">暂无库存风险数据</div>');
  main.querySelector<HTMLButtonElement>('[data-dashboard-apply]')!.onclick = () => { void renderDashboardPage(main); };
  const currentPacificMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date());
  const monthTrendRevenue = data.trend.filter((row) => normalizeTrendDate(row.date).startsWith(currentPacificMonth)).reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  let target = '读取中...'; let completed = '$' + monthTrendRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 });
  let storageCard = { value: '读取中...', period: '账单读取中...' };
  const renderMetricCards = () => {
    if (!dashboardIsMounted()) return;
    const noDateData = data.trend.length === 0;
    const cards: Array<[string, string, string?]> = [
      ['销售额', noDateData ? '暂无数据' : '$' + data.metrics.revenue.toFixed(2)],
      ['销量', noDateData ? '暂无数据' : String(data.metrics.units)],
      ['订单量', noDateData ? '暂无数据' : String(data.metrics.orders)],
      ['利润', noDateData ? '暂无数据' : !data.metrics.profitAvailable ? '暂无数据' : '$' + data.metrics.profit.toFixed(2), data.metrics.profitAvailable && data.metrics.estimated ? '粗算 · 部分费用或日期待补' : undefined],
      ['广告花费（今日）', data.adSpend?.today == null ? '暂无数据' : '$' + data.adSpend.today.toFixed(2)],
      ['站内广告花费（本月）', data.adSpend?.month == null ? '暂无数据' : '$' + data.adSpend.month.toFixed(2)],
      ['最新仓储账单', storageCard.value, storageCard.period],
      ['本月目标', target],
      ['本月已完成', completed],
    ];
    main.querySelector('[data-dashboard-metrics]')!.innerHTML = cards.map(([label, value, detail]) => '<article><span>' + label + '</span><strong>' + value + '</strong>' + (detail ? '<small class="muted">' + detail + '</small>' : '') + '</article>').join('');
  };
  renderMetricCards();
  void Promise.all([
    (async () => {
      try {
        const targetMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(new Date());
        const targetResponse = await fetch(`http://localhost:3000/api/targets/performance?month=${targetMonth}${store ? `&storeId=${encodeURIComponent(store)}` : ''}`, { credentials: 'include' });
        const targetBody = await targetResponse.json() as { data?: { rows?: Array<{ amountTarget?: string | number | null; completedSales?: number | null }> } };
        if (targetResponse.ok && targetBody.data) {
          const rows = targetBody.data.rows ?? [];
          const amountTarget = rows.reduce((sum, row) => sum + Number(row.amountTarget ?? 0), 0);
          // Use the same per-SKU performance rows rendered by Targets. The
          // summary endpoint has a separate aggregation path and can include
          // rows outside a member's visible SKU scope.
          const completedSales = rows.reduce((sum, row) => sum + Number(row.completedSales ?? 0), 0);
          target = rows.length ? '$' + amountTarget.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '暂无目标';
          completed = '$' + completedSales.toLocaleString(undefined, { maximumFractionDigits: 2 });
        } else target = '暂无数据';
      } catch { target = '暂无数据'; }
      if (dashboardIsMounted()) renderMetricCards();
    })(),
    (async () => {
      try {
        const storageQuery = new URLSearchParams();
        if (store) storageQuery.set('storeId', store);
        const storageResponse = await fetch('http://localhost:3000/api/inventory/storage-fees?' + storageQuery.toString(), { credentials: 'include' });
        const storageBody = await storageResponse.json() as { data?: StorageCardData };
        if (storageResponse.ok && storageBody.data) storageCard = formatStorageCard(storageBody.data);
        else storageCard = { value: '暂无数据', period: '费用周期待账单返回' };
      } catch { storageCard = { value: '暂无数据', period: '费用周期待账单返回' }; }
      if (dashboardIsMounted()) renderMetricCards();
    })(),
  ]);
  const trend = from || to ? data.trend.map((row) => ({ ...row, date: normalizeTrendDate(row.date) })).sort((a, b) => a.date.localeCompare(b.date)) : last30Days(data.trend);
  const trendHost = main.querySelector<HTMLElement>('[data-dashboard-trend]')!;
  // Measure again after attachment through ResizeObserver; transient shell widths
  // must not become the permanent chart dimensions.
  let chartWidth = Math.max(220, Math.round(trendHost.getBoundingClientRect().width) || TREND_CHART.width);
  trendHost.innerHTML = trend.length ? `<div class="dashboard-trend-controls"><div class="dashboard-trend-legend" role="group" aria-label="切换图表指标"><button type="button" class="${dashboardTrendOptions.showRevenue ? 'is-active' : ''}" data-trend-series="revenue" aria-pressed="${dashboardTrendOptions.showRevenue}"><i class="is-revenue"></i>销售额 <small>USD</small></button><button type="button" class="${dashboardTrendOptions.showUnits ? 'is-active' : ''}" data-trend-series="units" aria-pressed="${dashboardTrendOptions.showUnits}"><i class="is-units"></i>销量 <small>件</small></button>${trend.some(row=>row.profit!=null)?'<span style="color:#087f73">● 粗算利润 USD</span>':''}</div><span class="dashboard-trend-source">${trend.length} 天 · 按美国太平洋时间</span></div>${dashboardTrendSvg(trend, dashboardTrendOptions, chartWidth)}<div class="dashboard-trend-readout" aria-live="polite"><div><span data-trend-label>数据详情</span><strong data-trend-detail>聚焦或悬停任一日期查看详情</strong></div><button type="button" class="secondary" data-trend-filter disabled>按日期筛选</button></div>` : '<div class="dashboard-empty">当前筛选条件下暂无日事实</div>';
  let focusedTrend: DashboardTrendRow | undefined;
  let pointNodes = [...trendHost.querySelectorAll<SVGRectElement>('[data-trend-index]')];
  const detail = trendHost.querySelector<HTMLElement>('[data-trend-detail]');
  const detailLabel = trendHost.querySelector<HTMLElement>('[data-trend-label]');
  const filterButton = trendHost.querySelector<HTMLButtonElement>('[data-trend-filter]');
  const showPoint = (node: SVGRectElement) => {
    const row = trend[Number(node.dataset.trendIndex)];
    if (!row || !detail || !filterButton) return;
    focusedTrend = row;
    pointNodes.forEach((point) => point.classList.toggle('is-current', point === node));
    if (detailLabel) detailLabel.textContent = `${row.date}（PT）`;
    detail.textContent = `销售额 ${row.revenue.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })} · 销量 ${row.units} 件 · 订单量 ${row.orders} 单${row.profit==null?'':' · 粗算利润 $'+row.profit.toFixed(2)}`;
    filterButton.disabled = false;
  };
  const filterToPoint = () => {
    if (!focusedTrend) return;
    const fromInput = main.querySelector<HTMLInputElement>('[data-date-range-from]')!;
    const toInput = main.querySelector<HTMLInputElement>('[data-date-range-to]')!;
    fromInput.value = focusedTrend.date;
    toInput.value = focusedTrend.date;
    void renderDashboardPage(main);
  };
  const bindPoints = () => pointNodes.forEach((node) => {
    node.addEventListener('pointerenter', () => showPoint(node));
    node.addEventListener('focus', () => showPoint(node));
    node.addEventListener('click', filterToPoint);
    node.addEventListener('keydown', (event) => {
      const index = Number(node.dataset.trendIndex);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        pointNodes[Math.max(0, Math.min(pointNodes.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); filterToPoint(); }
    });
  });
  bindPoints();
  const svg = trendHost.querySelector<SVGSVGElement>('.dashboard-trend-svg');
  if (svg && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (!dashboardIsMounted() || !trendHost.isConnected) { observer.disconnect(); return; }
      const width = svg.clientWidth;
      if (width < 220 || width === chartWidth) return;
      chartWidth = width;
      const template = document.createElement('template');
      template.innerHTML = dashboardTrendSvg(trend, dashboardTrendOptions, chartWidth);
      const nextSvg = template.content.firstElementChild!;
      svg.setAttribute('viewBox', nextSvg.getAttribute('viewBox')!);
      const activeIndex = pointNodes.indexOf(document.activeElement as SVGRectElement);
      svg.innerHTML = nextSvg.innerHTML;
      pointNodes = [...svg.querySelectorAll<SVGRectElement>('[data-trend-index]')];
      bindPoints();
      if (focusedTrend) {
        const point = pointNodes.find(node => trend[Number(node.dataset.trendIndex)]?.date === focusedTrend?.date);
        if (point) showPoint(point);
      }
      if (activeIndex >= 0) pointNodes[activeIndex]?.focus();
    });
    observer.observe(trendHost);
    dashboardTrendObservers.set(main, observer);
  }
  let touchStartPoint: { x: number; y: number } | undefined;
  svg?.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') return;
    touchStartPoint = { x: event.clientX, y: event.clientY };
    const bounds = svg.getBoundingClientRect();
    const chartX = (event.clientX - bounds.left) / bounds.width * chartWidth;
    const left = Math.min(76, Math.max(54, chartWidth * 0.13));
    const step = (chartWidth - left * 2) / Math.max(1, trend.length);
    const index = Math.max(0, Math.min(trend.length - 1, Math.floor((chartX - left) / step)));
    const point = pointNodes[index];
    if (point) showPoint(point);
  });
  svg?.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch' && focusedTrend && touchStartPoint && Math.hypot(event.clientX - touchStartPoint.x, event.clientY - touchStartPoint.y) <= 8) filterToPoint();
    touchStartPoint = undefined;
  });
  if (filterButton) filterButton.onclick = filterToPoint;
  trendHost.querySelectorAll<HTMLButtonElement>('[data-trend-series]').forEach((button) => {
    button.disabled = button.dataset.trendSeries === 'revenue' ? dashboardTrendOptions.showRevenue && !dashboardTrendOptions.showUnits : dashboardTrendOptions.showUnits && !dashboardTrendOptions.showRevenue;
    button.onclick = () => {
      const series = button.dataset.trendSeries;
      if (series === 'revenue') dashboardTrendOptions.showRevenue = !dashboardTrendOptions.showRevenue;
      if (series === 'units') dashboardTrendOptions.showUnits = !dashboardTrendOptions.showUnits;
      const selectedDate = focusedTrend?.date;
      void renderDashboardPage(main).then(() => {
        if (selectedDate) {
          const point = [...main.querySelectorAll<SVGRectElement>('[data-trend-index]')].find((item) => trend[Number(item.dataset.trendIndex)]?.date === selectedDate);
          if (point) point.focus();
        }
      });
    };
  });
  const fresh = main.querySelector('.fresh strong'); if (fresh) fresh.textContent = formatFreshness(data.freshness);
}
