import { dateRangePickerMarkup, mountDateRangePicker } from '../components/DateRangePicker.js';
import { productImageMarkup } from '../components/ProductImage.js';

type OrderLine = { id?: string; orderId: string; orderNumber?: string; storeId: string; sku: string; imageUrl?: string; quantity: number; amount: number; status?: string; orderedAt?: string; region?: string };
type SkuSales = { storeId: string; sku: string; itemId?: string; imageUrl?: string; chineseName?: string; units: number | null; orders: number; revenue: number | null };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
function pacificDateValue(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftDate(value: string, days: number) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export async function renderOrdersPage(main: HTMLElement, openDetail: (id: string) => void): Promise<void> {
  const today = pacificDateValue(new Date());
  const from = shiftDate(today, -29);
  main.innerHTML = '<header><div><p class="eyebrow">订单管理</p><h1>Orders</h1></div></header><section class="panel"><form class="order-filters"><input name="orderNumber" placeholder="订单号"><input name="sku" placeholder="SKU"><input name="storeId" placeholder="店铺 ID"><select name="status"><option value="">全部状态</option><option value="Created">Created</option><option value="Shipped">Shipped</option><option value="Cancelled">Cancelled</option></select>' + dateRangePickerMarkup('orders', from, today) + '<div class="order-filter-actions"><button class="primary" type="submit">筛选</button><button type="button" data-order-reset>重置</button></div></form><div class="order-charts"></div><div class="order-view-toggle" role="tablist" aria-label="订单视图"><button type="button" role="tab" aria-selected="true" data-order-view="details">订单明细</button><button type="button" role="tab" aria-selected="false" data-order-view="sales">销量统计</button></div><div class="order-results">加载中...</div><div class="pagination"><button type="button" data-page="previous" aria-label="上一页">‹</button><span class="page-label"></span><button type="button" data-page="next" aria-label="下一页">›</button></div></section>';
  const form = main.querySelector<HTMLFormElement>('.order-filters')!;
  mountDateRangePicker(main, 'orders', () => form.requestSubmit());
  let currentPage = 1;
  let activeView: 'details' | 'sales' = 'details';
  let dateRangeCustomized = false;
  const pageCache = new Map<string, { ok: boolean; body: any }>();
  const load = async () => {
    const params = new URLSearchParams(); for (const [key, value] of new FormData(form)) if (value) params.set(key, String(value));
    if (activeView === 'sales' && !dateRangeCustomized) { params.set('from', today); params.set('to', today); }
    if (activeView === 'sales') params.set('view', 'sales');
    params.set('page', String(currentPage));
    const key = params.toString();
    let cached = pageCache.get(key);
    if (!cached) { const fetched = await fetch(`http://localhost:3000/api/orders?${params}`, { credentials: 'include' }); cached = { ok: fetched.ok, body: await fetched.json() }; pageCache.set(key, cached); }
    const response = cached;
    const body = response.body as { data?: { lines: OrderLine[]; salesBySku?: SkuSales[]; metrics?: { units: number | null; orders: number; revenue: number | null }; total: number; pageSize: number; dailyOrderTrend?: {date:string;count:number}[]; hourlyOrderTrend?: {hour:number;count:number}[]; chinaHourlyOrderTrend?: {hour:number;count:number}[]; regionDistribution?: {region:string;count:number}[] }; error?: { message: string } };
    const target = main.querySelector<HTMLElement>('.order-results')!;
    if (!response.ok) { target.textContent = body.error?.message ?? '订单读取失败'; return; }
    const lines = body.data?.lines ?? [];
    const charts = main.querySelector<HTMLElement>('.order-charts')!;
    const bars = (items: {label:string;count:number}[]) => { const max=Math.max(1,...items.map(x=>x.count)); return items.slice(0,12).map(x=>'<div class="chart-bar"><span>'+escapeHtml(x.label)+'</span><i style="width:'+Math.max(x.count ? 3 : 0, Math.round(x.count/max*100))+'%"></i><b>'+x.count+'</b></div>').join(''); };
    const barsChart = (items: {label:string;count:number;color?:string}[]) => { const max=Math.max(1,...items.map(x=>x.count)); return '<div class="bars-chart">'+items.map(x=>'<div class="bar-item"><div class="bar-value">'+x.count+'</div><i style="height:'+Math.max(x.count ? 4 : 0, Math.round(x.count/max*100))+'%;background:'+(x.color??'#16856d')+'" title="'+escapeHtml(x.label)+'：'+x.count+' 单"></i><span>'+escapeHtml(x.label)+'</span></div>').join('')+'</div>'; };
    const dailyItems=(body.data?.dailyOrderTrend??[]).filter(x=>x.count>0).map(x=>({label:x.date.slice(5).replace('-', '/'),count:x.count}));
    const chinaByHour = new Map((body.data?.chinaHourlyOrderTrend??[]).map(x => [x.hour, x.count]));
    const hourBars = (body.data?.hourlyOrderTrend??[]).map(x => ({
      label:String(x.hour).padStart(2,'0'),
      count:x.count,
      chinaCount:chinaByHour.get(x.hour) ?? 0,
    }));
    const groupedBars = (items: {label:string;count:number;chinaCount:number}[]) => { const max=Math.max(1,...items.flatMap(x=>[x.count,x.chinaCount])); return '<div class="bars-chart grouped-bars">'+items.map(x=>'<div class="bar-group"><div class="bar-item"><div class="bar-value">'+x.count+'</div><i style="height:'+Math.max(x.count ? 4 : 0, Math.round(x.count/max*100))+'%;background:#16856d" title="'+x.label+':00 美国太平洋时间：'+x.count+' 单"></i></div><div class="bar-item"><div class="bar-value">'+x.chinaCount+'</div><i style="height:'+Math.max(x.chinaCount ? 4 : 0, Math.round(x.chinaCount/max*100))+'%;background:#2b6cb0" title="'+x.label+':00 北京时间：'+x.chinaCount+' 单"></i></div><span>'+x.label+'</span></div>').join('')+'</div>'; };
    charts.innerHTML = '<div class="chart chart-wide"><h3>所选日期出单（美国太平洋时间）</h3>'+(dailyItems.length?barsChart(dailyItems.map(x=>({...x,color:'#16856d'}))):'<div class="empty">当前日期范围暂无订单</div>')+'</div><div class="chart chart-wide"><h3>24小时出单（美国太平洋时间 / 北京时间）</h3>'+(lines.length?groupedBars(hourBars):'<div class="empty">当前日期范围暂无订单</div>')+(lines.length?'<div class="hour-legend"><span><i class="legend-dot china"></i>美国太平洋时间（自动切换夏/冬令时）</span><span><i class="legend-dot utc"></i>中国时间（北京时间，UTC+8）</span></div>':'')+'</div><div class="chart"><h3>出单地区（主要地区）</h3>'+((body.data?.regionDistribution?.length??0)?bars((body.data?.regionDistribution??[]).map(x=>({label:x.region,count:x.count}))):'<div class="empty">当前日期范围暂无订单</div>')+'</div>';
    if (activeView === 'sales') {
      const rows = body.data?.salesBySku ?? [];
      const metrics = body.data?.metrics;
      target.innerHTML = `<div class="sales-summary"><article><span>销量</span><strong>${metrics?.units ?? '—'} 件</strong></article><article><span>订单数</span><strong>${metrics?.orders ?? 0}</strong></article><article><span>销售额</span><strong>${metrics?.revenue == null ? '—' : `$${metrics.revenue.toFixed(2)}`}</strong></article></div><p>${rows.length} 个 SKU · ${dateRangeCustomized ? `${escapeHtml(String(new FormData(form).get('from') || ''))} 至 ${escapeHtml(String(new FormData(form).get('to') || ''))}` : escapeHtml(today)}（美国太平洋时间）</p>${rows.length ? `<table><thead><tr><th>图片</th><th>SKU</th><th>中文品名</th><th>Item ID</th><th>销量</th><th>订单数</th><th>销售额</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="item-thumb-cell">${productImageMarkup(row.imageUrl, row.chineseName || row.sku)}</td><td><strong>${escapeHtml(row.sku)}</strong></td><td>${escapeHtml(row.chineseName ?? '—')}</td><td>${escapeHtml(row.itemId ?? '—')}</td><td>${row.units ?? '—'}</td><td>${row.orders}</td><td>${row.revenue == null ? '—' : `$${row.revenue.toFixed(2)}`}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">当前筛选条件暂无销量</div>'}`;
    } else {
      target.innerHTML = `<p>${body.data?.total ?? 0} 条订单明细</p>${lines.length ? `<table><thead><tr><th>订单号</th><th>店铺</th><th>图片</th><th>SKU</th><th>数量</th><th>金额</th><th>UTC时间</th><th>中国时间</th><th>状态</th></tr></thead><tbody>${lines.map((line) => { const utc=line.orderedAt ? new Date(line.orderedAt).toISOString().replace('T',' ').replace('Z',' UTC') : ''; const cn=line.orderedAt ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}).format(new Date(line.orderedAt)) : ''; return `<tr><td><button class="link" data-order-id="${escapeHtml(line.orderId)}">${escapeHtml(line.orderNumber ?? line.orderId)}</button></td><td>${escapeHtml(line.storeId)}</td><td class="item-thumb-cell">${productImageMarkup(line.imageUrl, line.sku)}</td><td>${escapeHtml(line.sku)}</td><td>${line.quantity}</td><td>${line.amount.toFixed(2)}</td><td>${utc}</td><td>${cn}</td><td>${escapeHtml(line.status)}</td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">暂无订单</div>'}`;
    }
    target.querySelectorAll<HTMLButtonElement>('[data-order-id]').forEach((button) => button.onclick = () => openDetail(button.dataset.orderId!));
    const pageCount = Math.max(1, Math.ceil((body.data?.total ?? 0) / (body.data?.pageSize ?? 20)));
    main.querySelector<HTMLElement>('.page-label')!.textContent = `${currentPage} / ${pageCount}`;
    main.querySelector<HTMLButtonElement>('[data-page="previous"]')!.disabled = currentPage <= 1;
    main.querySelector<HTMLButtonElement>('[data-page="next"]')!.disabled = currentPage >= pageCount;
  };
  form.onsubmit = (event) => { event.preventDefault(); const values = new FormData(form); dateRangeCustomized = String(values.get('from') ?? '') !== from || String(values.get('to') ?? '') !== today; currentPage = 1; pageCache.clear(); void load(); };
  form.querySelector<HTMLButtonElement>('[data-order-reset]')!.onclick = () => { form.reset(); dateRangeCustomized = false; currentPage = 1; pageCache.clear(); void load(); };
  main.querySelectorAll<HTMLButtonElement>('[data-order-view]').forEach((button) => button.onclick = () => { activeView = button.dataset.orderView as 'details' | 'sales'; currentPage = 1; main.querySelectorAll<HTMLButtonElement>('[data-order-view]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === button))); void load(); });
  main.querySelector<HTMLButtonElement>('[data-page="previous"]')!.onclick = () => { currentPage--; void load(); };
  main.querySelector<HTMLButtonElement>('[data-page="next"]')!.onclick = () => { currentPage++; void load(); };
  await load();
}
