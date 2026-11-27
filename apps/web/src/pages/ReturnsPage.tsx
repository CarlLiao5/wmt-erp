import { dateRangePickerMarkup, mountDateRangePicker } from '../components/DateRangePicker.js';
import { productImageMarkup } from '../components/ProductImage.js';
const returnTrendObservers = new WeakMap<HTMLElement, ResizeObserver>();
export function renderReturnTrend(rows: Array<{date:string;count:number}>, width:number):string {
      const max = Math.max(1, ...rows.map((item) => item.count));
      const days = rows.filter((item) => item.count > 0);
      const chartWidth = Math.max(220, Math.round(width)); const chartHeight = 190; const padX = 28; const padY = 24; const plotW = chartWidth - padX * 2; const plotH = chartHeight - padY * 2;
      const points = days.map((item, index) => `${(padX + (days.length === 1 ? plotW / 2 : index / (days.length - 1) * plotW)).toFixed(1)},${(padY + plotH - item.count / max * plotH).toFixed(1)}`);
      const area = points.length ? `${points[0]} ${points.join(' ')} ${points[points.length - 1].split(',')[0]},${chartHeight - padY}` : '';
      return days.length
        ? `<div class="return-trend-chart"><svg viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="退货数量趋势"><line x1="${padX}" y1="${chartHeight-padY}" x2="${chartWidth-padX}" y2="${chartHeight-padY}" class="return-chart-axis"/><line x1="${padX}" y1="${padY}" x2="${padX}" y2="${chartHeight-padY}" class="return-chart-axis"/><polygon points="${area}" class="return-trend-area"/><polyline points="${points.join(' ')}" class="return-trend-line"/>${days.map((item,index)=>{const [x,y]=points[index].split(',');return `<g class="return-trend-point" data-trend-date="${item.date}" tabindex="0" role="button" aria-label="${escapeHtml(item.date)}：${item.count} 条"><circle cx="${x}" cy="${y}" r="4"/><text x="${x}" y="${Number(y)-10}" text-anchor="middle">${item.count}</text><title>${escapeHtml(item.date)}：${item.count} 条</title></g>`;}).join('')}</svg><div class="return-trend-labels">${days.filter((_,i)=>days.length<12||i%Math.ceil(days.length/6)===0).map(item=>`<span>${escapeHtml(item.date.slice(5))}</span>`).join('')}</div></div>`
        : '<div class="empty">当前时间范围暂无退货</div>';

}

type Reconciliation = { refundDebit: number; commissionCredit: number; returnFees: number; compensation: number; netDebit: number; currency: string | null; status: string; transactions: { sourceId?: string; transactionDate?: string; transactionType?: string; amountType?: string; description: string; amount: number; currency: string }[] };
type ReturnRow = { refundCoveredBy?: string; reconciliation?: Reconciliation; id: string; returnId?: string; orderId: string; storeId: string; sku: string; imageUrl?: string; status: string; amount: number | null; reason?: string; returnedAt?: string };
type ProductRate = { storeId: string; sku: string; productName?: string; chineseName?: string; imageUrl?: string; orderCount: number; returnedOrderCount: number; returnRate: number | null };
type ReturnAnalytics = { topProducts?: { sku: string; count: number }[]; todayNew: number; monthReturnRate: number | null; returnedOrderCount?: number; orderedOrderCount?: number; monthRefundAmount: number | null; reasonDistribution: { reason: string; count: number }[]; responsibilityDistribution?: { responsibility: string; count: number }[]; dailyTrend: { date: string; count: number }[] };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const dateValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const displayRecordId = (value: string, storeId: string) => (value.startsWith(`${storeId}:`) ? value.slice(storeId.length + 1) : value).replace(/:1$/, '');
const pieColors = ['#16856d', '#2b6cb0', '#d97706', '#c2410c', '#7c3aed', '#0891b2', '#64748b', '#be185d', '#4d7c0f', '#9333ea', '#0f766e', '#b45309'];
const returnViews = [
  { id: 'details', title: '退货明细', description: '订单与退货记录' },
  { id: 'reconciliation', title: 'WFS 扣款异常', description: '核对账单扣款' },
  { id: 'product-rates', title: '产品退货率', description: '按 SKU 查看退货率' },
];
export function renderReturnViewSwitch(activeView: string) {
  return `<div class="return-view-switch" role="group" aria-label="退货数据视图">${returnViews.map((view) => `<button type="button" data-return-view="${view.id}" aria-pressed="${activeView === view.id}"><span>${view.title}</span><small>${view.description}</small></button>`).join('')}</div>`;
}
function piePath(start: number, end: number): string {
  const point = (angle: number) => { const radians = (angle - 90) * Math.PI / 180; return [100 + 82 * Math.cos(radians), 100 + 82 * Math.sin(radians)]; };
  if (end - start >= 359.99) return '';
  const [sx, sy] = point(start); const [ex, ey] = point(end);
  return `M 100 100 L ${sx.toFixed(3)} ${sy.toFixed(3)} A 82 82 0 ${end - start > 180 ? 1 : 0} 1 ${ex.toFixed(3)} ${ey.toFixed(3)} Z`;
}
export async function renderReturnsPage(main: HTMLElement): Promise<void> {
  main.classList.remove('returns-reconciliation');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const firstDay = new Date(today); firstDay.setDate(firstDay.getDate() - 29);
  const metrics = '<section class="return-metrics metrics"><article><span>今日新增退货量</span><strong data-metric="today">-</strong><small>按退货日期统计</small></article><article><span>当月整体退货率</span><strong data-metric="rate">-</strong><small>卖家归属退货订单数 ÷ 当月订单数</small></article><article><span>本月累计退货金额</span><strong data-metric="amount">-</strong><small>当前可见范围内退款金额</small></article></section><section class="return-charts"><div class="chart"><div class="return-chart-heading"><div><h3>退货原因分布</h3><p>仅统计卖家归属 · 点击扇区或图例筛选明细</p></div><span class="chart-context" data-reason-context>全量</span></div><div data-chart="pie"></div></div><div class="chart"><div class="return-chart-heading"><div><h3>责任归属占比</h3><p>Seller 计卖家 · Walmart 计 WFS · 其他单列</p></div><span class="chart-context">占比</span></div><div class="return-responsibility-chart" data-chart="responsibility"></div></div><div class="chart return-trend-panel"><div class="return-chart-heading"><div><h3>退货数量趋势</h3><p>近 30 天 · 按退货日期</p></div><span class="chart-context">件数</span></div><div data-chart="line"></div></div><div class="chart return-products-chart"><div class="return-chart-heading"><div><h3>产品退货数量 Top 20</h3><p>点击柱体按 SKU 筛选明细</p></div><span class="chart-context">SKU</span></div><div data-chart="products"></div></div></section>';
  main.innerHTML = '<header><div><p class="eyebrow">退货管理</p><h1>Returns</h1><p class="muted">从原因、趋势和 SKU 三个维度定位退货异常</p></div></header><section class="panel return-filter-panel"><form class="return-filters"><label>订单号<input name="orderNumber" placeholder="输入订单号"></label><label>Item ID<input name="itemId" placeholder="输入 Item ID"></label><label>店铺 ID<input name="storeId" placeholder="输入店铺 ID"></label><label>SKU<input name="sku" placeholder="输入 SKU"></label><label>状态<select name="status"><option value="">全部状态</option><option>REFUNDED</option><option>REQUESTED</option><option>REJECTED</option></select></label>' + dateRangePickerMarkup('returns', dateValue(firstDay), dateValue(today)) + '<div class="return-filter-actions"><button class="primary">应用筛选</button><button type="button" class="secondary" data-reset-filters>重置</button></div></form></section>' + metrics + '<section class="panel return-results-panel"><div class="return-view-controls">' + renderReturnViewSwitch('details') + '<button type="button" data-export-reconciliation hidden>导出 Excel</button></div><p class="muted" data-audit-note hidden>仅列出 WFS 责任且账单出现商品退款扣款或退货费用的订单，按店铺 + 订单 + SKU 合并。已返还或补偿的仍保留扣款记录及净额，便于核查。日期筛选用于退货日期。</p><div class="return-results">加载中...</div><div class="pagination"><button type="button" data-page="previous" aria-label="上一页">‹</button><span class="page-label"></span><button type="button" data-page="next" aria-label="下一页">›</button></div></section>';
  const form = main.querySelector<HTMLFormElement>('.return-filters')!;
  mountDateRangePicker(main, 'returns', () => form.requestSubmit());
  let currentPage = 1;
  let returnView = 'details';
  let productRateSort = 'returnRate';
  let productRateDirection = 'desc';
  let selectedReason: string | undefined;
  const pageCache = new Map<string, { ok: boolean; body: any }>();
  let loadSequence = 0;
  const load = async () => {
    const sequence = ++loadSequence;
    const params = new URLSearchParams(); for (const [key, value] of new FormData(form)) if (value) params.set(key, String(value));
    params.set('page', String(currentPage));
    if (returnView === 'reconciliation') { params.set('view', 'reconciliation'); params.set('responsibility', 'wfs'); }
    if (returnView === 'product-rates') { params.set('view','product-rates'); params.set('sort',productRateSort); params.set('direction',productRateDirection); }
    if (selectedReason && returnView === 'details') params.set('reason', selectedReason);
    const key = params.toString();
    let cached = pageCache.get(key);
    if (!cached) main.querySelector<HTMLElement>('.return-results')!.textContent = returnView === 'reconciliation' ? '正在核对账单...' : returnView === 'product-rates' ? '正在统计产品退货率...' : '正在加载退货...';
    try {
      if (!cached) { const fetched = await fetch(`http://localhost:3000/api/returns?${params}`, { credentials: 'include' }); cached = { ok: fetched.ok, body: await fetched.json() }; pageCache.set(key, cached); }
    } catch { if (sequence === loadSequence) main.querySelector<HTMLElement>('.return-results')!.textContent = '退货读取失败，请重新应用筛选重试'; return; }
    if (sequence !== loadSequence) return;
    const response = cached;
    const body = cached.body as { data?: { rows: ReturnRow[]; productRates?: ProductRate[]; total: number; pageSize: number; analytics?: ReturnAnalytics }; error?: { message: string } };
    const target = main.querySelector<HTMLElement>('.return-results')!;
    if (!response.ok) { target.textContent = body.error?.message ?? '退货读取失败'; return; }
    const rows = body.data?.rows ?? [];
    const analytics = body.data?.analytics;
    if (returnView === 'product-rates') target.innerHTML = renderProductRateRows(body.data?.productRates ?? [], body.data?.total ?? 0, productRateSort, productRateDirection);
    if (analytics && returnView === 'details') {
      const hasAnalyticsData = analytics.reasonDistribution.length > 0;
      main.querySelector<HTMLElement>('[data-metric="today"]')!.textContent = hasAnalyticsData ? String(analytics.todayNew) : '暂无数据';
      main.querySelector<HTMLElement>('[data-metric="rate"]')!.textContent = analytics.monthReturnRate == null ? '暂无数据' : `${(analytics.monthReturnRate * 100).toFixed(1)}%`;
      const rateHint = main.querySelector<HTMLElement>('[data-metric="rate"]')?.parentElement?.querySelector('small');
      if (rateHint && analytics.orderedOrderCount != null) rateHint.textContent = `${analytics.returnedOrderCount ?? 0} / ${analytics.orderedOrderCount} 个订单`;
      main.querySelector<HTMLElement>('[data-metric="amount"]')!.textContent = analytics.monthRefundAmount == null ? '暂无数据' : `$${analytics.monthRefundAmount.toFixed(2)}`;
      const trendHost = main.querySelector<HTMLElement>('[data-chart="line"]')!;
      returnTrendObservers.get(trendHost)?.disconnect();
      let trendWidth = 0;
      const drawTrend = (width:number) => {
        const nextWidth = Math.max(220, Math.round(width));
        if (nextWidth === trendWidth) return;
        trendWidth = nextWidth;
        trendHost.innerHTML = renderReturnTrend(analytics.dailyTrend, trendWidth);
      main.querySelectorAll<HTMLElement>('[data-trend-date]').forEach((point) => { const selectDate = () => { const date = point.dataset.trendDate ?? ''; const from = form.elements.namedItem('from'); const to = form.elements.namedItem('to'); if (from instanceof HTMLInputElement && to instanceof HTMLInputElement) { from.value = date; to.value = date; currentPage = 1; selectedReason = undefined; pageCache.clear(); void load(); } }; point.onclick = selectDate; point.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectDate(); } }; });
      };
      drawTrend(trendHost.getBoundingClientRect().width || 720);
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(entries => {
          if (!trendHost.isConnected) { observer.disconnect(); return; }
          const width = entries[0]?.contentRect.width;
          if (width && width > 0) drawTrend(width);
        });
        observer.observe(trendHost);
        returnTrendObservers.set(trendHost,observer);
      }
      const products = analytics.topProducts ?? [];
      const responsibilities = analytics.responsibilityDistribution ?? [];
      const responsibilityTotal = responsibilities.reduce((sum, item) => sum + item.count, 0);
      const responsibilityColors: Record<string, string> = { '卖家责任': '#16856d', 'WFS责任': '#397bb8', '其他/未提供': '#c88a2b' };
      main.querySelector<HTMLElement>('[data-chart="responsibility"]')!.innerHTML = responsibilityTotal
        ? `<div class="return-responsibility-list" role="img" aria-label="退货责任归属占比">${responsibilities.map((item) => { const percent = item.count / responsibilityTotal * 100; return `<div class="return-responsibility-row"><div><span><i style="--responsibility-color:${responsibilityColors[item.responsibility] ?? '#7b8792'}"></i>${escapeHtml(item.responsibility)}</span><strong>${percent.toFixed(1)}%</strong></div><div class="return-responsibility-track"><i style="width:${percent}%;--responsibility-color:${responsibilityColors[item.responsibility] ?? '#7b8792'}"></i></div><small>${item.count.toLocaleString()} 条 · ${percent.toFixed(1)}%</small></div>`; }).join('')}</div>`
        : '<div class="empty">当前筛选范围暂无责任数据</div>';
      const productMax = Math.max(1, ...products.map((item) => item.count));
      main.querySelector<HTMLElement>('[data-chart="products"]')!.innerHTML = products.length
        ? `<div class="return-bars return-product-bars">${products.map((item, index) => `<button type="button" class="return-bar rank-${index + 1}${form.elements.namedItem('sku') instanceof HTMLInputElement && (form.elements.namedItem('sku') as HTMLInputElement).value === item.sku ? ' is-selected' : ''}" data-sku="${escapeHtml(item.sku)}" aria-pressed="${form.elements.namedItem('sku') instanceof HTMLInputElement && (form.elements.namedItem('sku') as HTMLInputElement).value === item.sku}" title="${escapeHtml(item.sku)}：${item.count} 条"><span class="return-rank">${String(index + 1).padStart(2, '0')}</span><span class="return-product-sku">${escapeHtml(item.sku)}</span><i style="width:${Math.max(4, item.count / productMax * 100)}%"></i><strong>${item.count}</strong></button>`).join('')}</div>`
        : '<div class="empty">当前筛选范围暂无退货产品</div>';
      main.querySelectorAll<HTMLButtonElement>('.return-product-bars .return-bar').forEach((bar) => {
        bar.onclick = () => {
          const sku = form.elements.namedItem('sku');
          if (!(sku instanceof HTMLInputElement)) return;
          sku.value = sku.value === bar.dataset.sku ? '' : (bar.dataset.sku ?? '');
          currentPage = 1;
          selectedReason = undefined;
          void load();
        };
      });
      const distribution = analytics.reasonDistribution;
      const reasonContext = main.querySelector<HTMLElement>('[data-reason-context]');
      if (reasonContext) reasonContext.textContent = selectedReason ? `已选：${selectedReason}` : '全量';
      const total = distribution.reduce((sum, item) => sum + item.count, 0);
      const slices = distribution.map((item, index) => ({ ...item, key: item.reason, color: pieColors[index % pieColors.length] }));
      let angle = 0;
      const sliceMarkup = slices.map((item) => {
        const start = angle; angle += total ? item.count / total * 360 : 0;
        const selected = selectedReason === item.key;
        const path = slices.length === 1 ? '<circle cx="100" cy="100" r="82" />' : `<path d="${piePath(start, angle)}" />`;
        const markup = `<g class="return-pie-slice${selected ? ' is-selected' : ''}" data-reason="${escapeHtml(item.key)}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${escapeHtml(item.reason)}，${item.count} 条，占 ${(item.count / Math.max(1, total) * 100).toFixed(1)}%" style="--slice-color:${item.color}">${path}<title>${escapeHtml(item.reason)}：${item.count} 条（${(item.count / Math.max(1, total) * 100).toFixed(1)}%）</title></g>`;
        return markup;
      }).join('');
      const pie = main.querySelector<HTMLElement>('[data-chart="pie"]')!;
      pie.innerHTML = total ? `<svg class="return-pie-svg" viewBox="0 0 200 200" role="group" aria-label="退货原因分布，点击扇区筛选退货明细">${sliceMarkup}</svg><div class="pie-legend">${slices.map((item) => `<button type="button" class="return-pie-legend${selectedReason === item.key ? ' is-selected' : ''}" data-reason="${escapeHtml(item.key)}" aria-pressed="${selectedReason === item.key}"><i style="background:${item.color}"></i><span>${escapeHtml(item.reason)}</span><strong>${item.count}</strong></button>`).join('')}</div>` : '<div class="empty">当前筛选范围暂无退货原因</div>';
      const selectReason = (reason: string) => {
        selectedReason = selectedReason === reason ? undefined : reason;
        if (returnView !== 'details') {
          returnView = 'details';
          main.querySelectorAll<HTMLButtonElement>('[data-return-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.returnView === 'details')));
          main.querySelector<HTMLElement>('[data-audit-note]')!.hidden = true;
          main.querySelector<HTMLButtonElement>('[data-export-reconciliation]')!.hidden = true;
        }
        currentPage = 1;
        void load();
      };
      pie.querySelectorAll<SVGGElement>('.return-pie-slice').forEach((slice) => {
        slice.onclick = () => selectReason(slice.dataset.reason ?? '');
        slice.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectReason(slice.dataset.reason ?? ''); } };
      });
      pie.querySelectorAll<HTMLButtonElement>('.return-pie-legend').forEach((button) => { button.onclick = () => selectReason(button.dataset.reason ?? ''); });
      if (selectedReason) {
        const active = slices.find((item) => item.key === selectedReason);
        pie.insertAdjacentHTML('beforeend', `<div class="return-reason-filter">已筛选：${escapeHtml(active?.reason ?? selectedReason)} <button type="button" aria-label="清除原因筛选">清除</button></div>`);
        pie.querySelector<HTMLButtonElement>('.return-reason-filter button')!.onclick = () => { selectedReason = undefined; currentPage = 1; void load(); };
      }
    }
    if (returnView === 'reconciliation') target.innerHTML = renderReconciliationRows(rows, body.data?.total ?? 0);
    else if (returnView === 'details') target.innerHTML = `<p>${body.data?.total ?? 0} 条退货明细</p>${rows.length ? `<table><thead><tr><th>退货号</th><th>订单号</th><th>店铺</th><th>图片</th><th>SKU</th><th>退货原因</th><th>退款</th><th>状态</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.returnId || displayRecordId(row.id, row.storeId))}</td><td>${escapeHtml(displayRecordId(row.orderId, row.storeId))}</td><td>${escapeHtml(row.storeId)}</td><td class="item-thumb-cell">${productImageMarkup(row.imageUrl, row.sku)}</td><td>${escapeHtml(row.sku)}</td><td>${escapeHtml(row.reason || '未提供原因')}</td><td>${row.amount == null ? '—' : row.amount.toFixed(2)}</td><td>${escapeHtml(row.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无退货</div>'}`;
    const pageCount = Math.max(1, Math.ceil((body.data?.total ?? 0) / (body.data?.pageSize ?? 20)));
    main.querySelector<HTMLElement>('.page-label')!.textContent = `${currentPage} / ${pageCount}`;
    main.querySelector<HTMLButtonElement>('[data-page="previous"]')!.disabled = currentPage <= 1;
    main.querySelector<HTMLButtonElement>('[data-page="next"]')!.disabled = currentPage >= pageCount;
  };
  main.querySelectorAll<HTMLButtonElement>('[data-return-view]').forEach(button => { button.onclick = () => { returnView = button.dataset.returnView!; currentPage = 1; main.querySelectorAll<HTMLButtonElement>('[data-return-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); main.querySelector<HTMLElement>('[data-audit-note]')!.hidden = returnView !== 'reconciliation'; main.querySelector<HTMLButtonElement>('[data-export-reconciliation]')!.hidden = returnView !== 'reconciliation'; void load(); }; });
  main.querySelector<HTMLButtonElement>('[data-export-reconciliation]')!.onclick = async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true; button.textContent = '正在导出...';
    try {
      const params = new URLSearchParams(); for (const [key,value] of new FormData(form)) if(value) params.set(key,String(value));
      const response = await fetch(`/api/returns/reconciliation/export?${params}`, { credentials: 'include' });
      if(!response.ok) throw new Error('导出失败，请重试');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = `WFS扣款异常-${params.get('from') ?? '全部'}-${params.get('to') ?? '全部'}.xlsx`;
      document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) { alert(error instanceof Error ? error.message : '导出失败'); }
    finally { button.disabled=false; button.textContent='导出 Excel'; }
  };
  main.querySelector<HTMLElement>('.return-results')!.onclick = event => { const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-product-rate-sort]'); if(!button)return; const key=button.dataset.productRateSort!; if(productRateSort===key)productRateDirection=productRateDirection==='asc'?'desc':'asc';else{productRateSort=key;productRateDirection='desc';}currentPage=1;pageCache.clear();void load(); };
  form.onsubmit = (event) => { event.preventDefault(); currentPage = 1; selectedReason = undefined; pageCache.clear(); void load(); };
  main.querySelector<HTMLButtonElement>('[data-reset-filters]')!.onclick = () => { form.reset(); currentPage = 1; selectedReason = undefined; pageCache.clear(); void load(); };
  main.querySelector<HTMLButtonElement>('[data-page="previous"]')!.onclick = () => { currentPage--; void load(); };
  main.querySelector<HTMLButtonElement>('[data-page="next"]')!.onclick = () => { currentPage++; void load(); };
  await load();
}

export function renderReconciliationRows(rows: ReturnRow[], total: number) {
  const money = (value: number, currency: string | null) => currency ? `${escapeHtml(currency)} ${value.toFixed(2)}` : '—';
  return `<p>${total} 条 WFS 扣款异常 · 按店铺 + 订单 + SKU 合并</p><div class="return-audit-table"><table><thead><tr>${['退货号 / 订单','SKU / 责任','退款扣款','佣金返还','退货费用','明确补偿','净扣款','核对状态 / 账单'].map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(row => {
    const a = row.reconciliation;
    return `<tr><td>${escapeHtml(row.returnId || displayRecordId(row.id,row.storeId))}<small>${escapeHtml(displayRecordId(row.orderId,row.storeId))}</small></td><td>${escapeHtml(row.sku)}<small>${escapeHtml(row.storeId)}</small><small>${escapeHtml(row.refundCoveredBy || '责任未提供')}</small></td>${a ? [a.refundDebit,a.commissionCredit,a.returnFees,a.compensation,a.netDebit].map(v => `<td>${a.transactions.length ? money(v,a.currency) : '—'}</td>`).join('') : '<td colspan="5">—</td>'}<td><span class="return-audit-status${a?.status === '已扣款' ? ' has-debit' : ''}">${escapeHtml(a?.status || '待核对')}</span>${a?.transactions.length ? `<details><summary>查看 ${a.transactions.length} 条账单</summary><ul>${a.transactions.map(t => `<li><b>${money(t.amount,t.currency)}</b> · ${escapeHtml(t.transactionType)} · ${escapeHtml(t.amountType)}<br>${escapeHtml(t.description)}<small>${escapeHtml(String(t.transactionDate ?? '').slice(0,10))} · ${escapeHtml(t.sourceId)}</small></li>`).join('')}</ul></details>` : '<small>尚未匹配相关账单</small>'}</td></tr>`;
  }).join('')}</tbody></table>${rows.length ? '' : '<div class="empty">当前范围未发现 WFS 责任扣款异常</div>'}</div>`;
}

export function renderProductRateRows(rows: ProductRate[], total: number, sort: string, direction: string) {
  const headers: Array<[string,string]> = [['sku','SKU'],['productName','中文品名'],['orderCount','订单数'],['returnedOrderCount','卖家责任退货订单'],['returnRate','卖家责任退货率']];
  return `<p>${total.toLocaleString()} 个产品 · 仅 Seller / Seller Keep-It 计入退货</p><div class="return-product-rate-table"><table><thead><tr>${headers.map(([key,label])=>`<th><button type="button" data-product-rate-sort="${key}" aria-label="按${label}排序">${label}${sort===key?(direction==='asc'?' ↑':' ↓'):' ↕'}</button></th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${escapeHtml(row.sku)}</strong></td><td><div class="return-product-info">${productImageMarkup(row.imageUrl,row.chineseName || row.productName || row.sku)}<div class="return-product-names"><strong title="${escapeHtml(row.chineseName)}">${escapeHtml(row.chineseName || '未提供中文名')}</strong>${row.productName ? `<small title="${escapeHtml(row.productName)}">${escapeHtml(row.productName)}</small>` : ''}</div></div></td><td>${row.orderCount.toLocaleString()}</td><td>${row.returnedOrderCount.toLocaleString()}</td><td>${row.returnRate==null?'—':`${(row.returnRate*100).toFixed(2)}%`}</td></tr>`).join('')}</tbody></table>${rows.length?'':'<div class="empty">当前筛选范围暂无订单</div>'}</div>`;
}
