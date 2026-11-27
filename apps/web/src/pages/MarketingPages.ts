import { dateRangePickerMarkup, mountDateRangePicker } from '../components/DateRangePicker.js';
import { productImageMarkup } from '../components/ProductImage.js';

type Row = Record<string, unknown>;
const esc = (v: unknown) => String(v ?? '—').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] ?? c));
const val = (v: unknown) => v == null || v === '' ? '暂无数据' : String(v);
async function advertisingJson(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) {
    const body = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`广告接口返回了非 JSON 响应（${response.status}）：${body || '空响应'}`);
  }
  return response.json();
}
const formatDateTime = (v: unknown) => {
  if (v == null || v === '') return null;
  const raw = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw} 00:00`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
function snapshotTime(row: Row) { const value = row.receivedAt ?? row.effectiveAt; const time = value == null ? 0 : new Date(String(value)).getTime(); return Number.isFinite(time) ? time : 0; }
function isActivePromotion(row: Row, now: Date) { const start = row.startDate == null ? null : new Date(String(row.startDate)).getTime(); const end = row.endDate == null ? null : new Date(String(row.endDate)).getTime(); return (start == null || !Number.isFinite(start) || start <= now.getTime()) && (end == null || !Number.isFinite(end) || end >= now.getTime()); }
export function groupPricingRows(rows: Row[], now = new Date()) {
  const groups = new Map<string, { base?: Row; incentive?: Row; promotions: Row[]; fallback: Row }>();
  for (const row of rows) {
    const key = `${String(row.storeId ?? '')}:${String(row.sku ?? '').toLocaleUpperCase('en-US')}`;
    const group = groups.get(key) ?? { promotions: [], fallback: row };
    if (snapshotTime(row) >= snapshotTime(group.fallback)) group.fallback = row;
    if (row.priceType === 'promotion') group.promotions.push(row);
    else if (row.priceType === 'incentive') { if (!group.incentive || snapshotTime(row) >= snapshotTime(group.incentive)) group.incentive = row; }
    else if (!group.base || snapshotTime(row) >= snapshotTime(group.base)) group.base = row;
    groups.set(key, group);
  }
  return [...groups.values()].map(({ base, incentive, promotions, fallback }) => {
    const promotion = promotions.filter(row => isActivePromotion(row, now)).sort((a, b) => snapshotTime(b) - snapshotTime(a))[0];
    const current = base ?? fallback;
    return {
      sku: current.sku, storeId: current.storeId, imageUrl: current.imageUrl,
      currentPrice: current.price, buyBoxBasePrice: current.buyBoxBasePrice, buyBoxTotalPrice: current.buyBoxTotalPrice,
      comparisonPrice: current.comparisonPrice, competitorPrice: current.competitorPrice,
      targetPrice: incentive?.targetPrice ?? current.targetPrice,
      incentiveType: incentive?.incentiveType ?? current.incentiveType,
      incentiveStatus: incentive?.incentiveStatus ?? current.incentiveStatus,
      promotionPrice: promotion?.price ?? null, promotionType: promotion?.promotionType ?? null,
      promotionStart: promotion?.startDate ?? null, promotionEnd: promotion?.endDate ?? null, showStrikethrough: promotion?.showStrikethrough ?? null,
    };
  }).sort((a, b) => {
    const aEnd = a.promotionEnd == null ? Number.POSITIVE_INFINITY : new Date(String(a.promotionEnd)).getTime();
    const bEnd = b.promotionEnd == null ? Number.POSITIVE_INFINITY : new Date(String(b.promotionEnd)).getTime();
    return (Number.isFinite(aEnd) ? aEnd : Number.POSITIVE_INFINITY) - (Number.isFinite(bEnd) ? bEnd : Number.POSITIVE_INFINITY);
  });
}
const filters = (channel = false, pricing = false) => `<div class="marketing-filters"><label class="marketing-global-search">搜索<input type="search" data-sem-global-search placeholder="按 SKU、ITEM 或品名搜索" aria-label="按 SKU、ITEM 或品名搜索"></label><label>店铺<select data-marketing-store><option value="">全部店铺</option></select></label>${channel ? '<label>广告来源<select data-marketing-channel><option value="">全部广告</option><option value="onsite">站内广告</option><option value="sem">SEM</option></select></label>' : ''}${pricing ? '<label>价格来源<select data-marketing-price-type><option value="">全部价格</option><option value="base">基础价格</option><option value="incentive">价格激励</option><option value="promotion">促销价格</option></select></label>' : ''}${channel ? dateRangePickerMarkup('advertising', '', '') : '<label>开始日期<input type="date" data-marketing-from></label><label>结束日期<input type="date" data-marketing-to></label>'}<button class="primary" data-marketing-refresh>查询</button></div>`;
async function stores(select: HTMLSelectElement) { try { const r = await fetch('/api/stores'); const b = await r.json() as { data?: Array<{ id: string; name: string }> }; select.innerHTML = '<option value="">全部店铺</option>' + (b.data ?? []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''); } catch { /* empty state */ } }
function queryOf(main: HTMLElement) { const q = new URLSearchParams(); for (const [s,k] of [['[data-marketing-store]','storeId'],['[data-marketing-channel]','channel'],['[data-marketing-price-type]','priceType'],['[data-marketing-from]','from'],['[data-marketing-to]','to'],['[data-sem-global-search]','q']] as const) { const v = (main.querySelector(s) as HTMLInputElement | null)?.value?.trim(); if (v) q.set(k,v); } return q; }
const performanceFilters = () => '<div class="marketing-filters"><label>店铺<select data-marketing-store><option value="">全部店铺</option></select></label><label>时间范围<select data-performance-period><option value="7DAY">最近 7 天</option><option value="14DAY">最近 14 天</option><option value="30DAY" selected>最近 30 天</option><option value="60DAY">最近 60 天</option><option value="90DAY">最近 90 天</option></select></label><button class="primary" data-marketing-refresh>查询</button></div>';
const PERFORMANCE_METRIC_LABELS: Record<string, { label: string; suffix: string }> = {
  refundRateSellerFault: { label: '卖家责任退款率', suffix: '%' },
  refundRateCustomerFault: { label: '买家责任退款率', suffix: '%' },
  ots: { label: '按时发货率', suffix: '%' },
  otd: { label: '按时送达率', suffix: '%' },
  vtr: { label: '有效追踪率', suffix: '%' },
  cancellationSellerFault: { label: '卖家责任取消率', suffix: '%' },
  cancellationCustomerFault: { label: '买家责任取消率', suffix: '%' },
};
export function performanceMetricLabel(metric: string) { const match = /^(7|14|30|60|90)DAY\.(.+)$/.exec(metric); const definition = PERFORMANCE_METRIC_LABELS[match?.[2] ?? ''] ?? { label: match?.[2] ?? metric, suffix: '' }; return { window: match ? `${match[1]} 天` : '绩效', ...definition }; }
export function groupPerformanceRows(rows: Row[]) { const groups = new Map<string, Row[]>(); for (const row of rows) { const key = String(row.storeId ?? 'unknown'); const list = groups.get(key) ?? []; list.push(row); groups.set(key, list); } return groups; }
export function filterPerformanceRows(rows: Row[], window: string) { return rows.filter(row => String(row.metric ?? '').startsWith(`${window}.`)); }
function renderPerformanceCards(main: HTMLElement, rows: Row[]) { const target = main.querySelector<HTMLElement>('[data-marketing-results]')!; if (!rows.length) { target.innerHTML = '<div class="marketing-empty">暂无绩效数据，请先在 Sync Status 执行同步</div>'; return; } const storeNames = new Map([...main.querySelectorAll<HTMLSelectElement>('[data-marketing-store] option')].map(option => [option.value, option.textContent ?? option.value])); const groups = groupPerformanceRows(rows); target.innerHTML = `<div class="performance-store-grid">${[...groups.entries()].map(([storeId, storeRows]) => { const sorted = [...storeRows].sort((a,b) => String(a.metric ?? '').localeCompare(String(b.metric ?? ''))); return `<article class="performance-store-card"><div class="performance-store-head"><div><span class="eyebrow">店铺</span><h3>${esc(storeNames.get(storeId) ?? storeId)}</h3></div><span class="performance-store-count">${storeRows.length} 项指标</span></div><div class="performance-metric-grid">${sorted.map(row => { const info = performanceMetricLabel(String(row.metric ?? '')); const numeric = row.value == null || row.value === '' ? null : Number(row.value); const value = numeric == null || !Number.isFinite(numeric) ? '暂无数据' : `${numeric.toFixed(2)}${info.suffix}`; return `<div class="performance-metric-card"><span>${esc(info.window)}</span><strong>${esc(value)}</strong><small>${esc(info.label)} · ${row.complete === 1 || row.complete === true ? '完整' : '数据不完整'}</small></div>`; }).join('')}</div></article>`; }).join('')}</div>`; }
async function setup(main: HTMLElement) { await stores(main.querySelector('[data-marketing-store]')!); if (main.querySelector('[data-date-range-picker="advertising"]')) mountDateRangePicker(main, 'advertising', () => void (main as any).__load()); main.querySelector('[data-marketing-refresh]')!.addEventListener('click', () => void (main as any).__load()); }
export function fetchAdvertisingPageResponses(fetcher: typeof fetch, query: URLSearchParams): Promise<[Response, Response]> {
  const suffix = query.toString();
  return Promise.all([
    fetcher('/api/advertising?' + suffix),
    fetcher('/api/advertising/items?' + suffix),
  ]);
}
function detail(row: Row) { const d = document.createElement('div'); d.className = 'pricing-detail-modal'; const fields: Array<[string,unknown]> = [['当前价格',row.currentPrice],['Buy Box基础价格',row.buyBoxBasePrice],['Buy Box总价',row.buyBoxTotalPrice],['比较价格',row.comparisonPrice],['竞品价格',row.competitorPrice],['促销价格',row.promotionPrice],['促销类型',row.promotionType],['促销开始',formatDateTime(row.promotionStart)],['促销结束',formatDateTime(row.promotionEnd)],['显示划线价格',row.showStrikethrough == null ? null : Number(row.showStrikethrough) === 1 || row.showStrikethrough === true ? '是' : '否'],['激励类型',row.incentiveType],['激励状态',row.incentiveStatus],['建议价格',row.targetPrice]]; d.innerHTML = `<div class="pricing-detail-panel"><button class="secondary" data-pricing-close>关闭</button><h3>${esc(row.sku)} 价格详情</h3><dl>${fields.map(([k,v]) => `<dt>${k}</dt><dd>${esc(val(v))}</dd>`).join('')}</dl></div>`; document.body.appendChild(d); d.querySelector('[data-pricing-close]')?.addEventListener('click', () => d.remove()); }
function renderPricingRows(main: HTMLElement, rows: Row[], page: number) { const list=groupPricingRows(rows), size=20, pages=Math.max(1,Math.ceil(list.length/size)), current=Math.min(Math.max(page,0),pages-1), visible=list.slice(current*size,(current+1)*size), target=main.querySelector<HTMLElement>('[data-marketing-results]')!; target.innerHTML=visible.length ? `<div class="marketing-table-wrap pricing-table-scroll"><table><thead><tr><th>图片</th><th>SKU</th><th>Buy Box价格</th><th>比较价格</th><th>促销价格</th><th>促销类型</th><th>促销周期</th><th>划线价格</th></tr></thead><tbody>${visible.map((x,i)=>{ const start = formatDateTime(x.promotionStart); const end = formatDateTime(x.promotionEnd); return `<tr data-price-row="${i}" tabindex="0"><td class="item-thumb-cell">${productImageMarkup(x.imageUrl, x.sku)}</td><td>${esc(x.sku)}</td><td>${esc(val(x.buyBoxTotalPrice ?? x.buyBoxBasePrice))}</td><td>${esc(val(x.comparisonPrice))}</td><td>${esc(val(x.promotionPrice))}</td><td>${esc(val(x.promotionType ?? x.incentiveType))}</td><td>${start || end ? `开始：${esc(start ?? '暂无数据')}<br>结束：${esc(end ?? '暂无数据')}` : '暂无数据'}</td><td>${x.showStrikethrough == null ? '暂无数据' : Number(x.showStrikethrough) === 1 || x.showStrikethrough === true ? '是' : '否'}</td></tr>`; }).join('')}</tbody></table></div><div class="pricing-pagination"><button class="secondary" data-pricing-prev ${current===0?'disabled':''}>上一页</button><span>第 ${current+1} / ${pages} 页 · 共 ${list.length} 个 SKU</span><button class="secondary" data-pricing-next ${current===pages-1?'disabled':''}>下一页</button></div>` : '<div class="marketing-empty">暂无价格数据</div>'; target.querySelectorAll('[data-price-row]').forEach(e=>e.addEventListener('click',()=>detail(visible[Number((e as HTMLElement).dataset.priceRow)]))); target.querySelector('[data-pricing-prev]')?.addEventListener('click',()=>renderPricingRows(main,rows,current-1)); target.querySelector('[data-pricing-next]')?.addEventListener('click',()=>renderPricingRows(main,rows,current+1)); }
export async function renderPricingPage(main: HTMLElement) { main.innerHTML=`<header><div><p class="eyebrow">价格与促销</p><h1>Pricing</h1><p class="muted">Walmart 价格洞察、Buy Box、激励与促销</p></div></header>${filters(false,true)}<section class="panel"><div class="panel-head"><h2>价格仪表盘</h2><span data-marketing-status>加载中...</span></div><div data-marketing-results></div></section>`; const load=async()=>{const r=await fetch('/api/pricing?'+queryOf(main));const b=await r.json() as {data?:{rows?:Row[]};error?:{message?:string}};if(!r.ok)throw new Error(b.error?.message ?? '价格读取失败');const rows=b.data?.rows ?? [];main.querySelector('[data-marketing-status]')!.textContent=rows.length?`${rows.length} 条价格记录`:'暂无数据';renderPricingRows(main,rows,0);};(main as any).__load=()=>void load().catch(e=>{main.querySelector('[data-marketing-results]')!.innerHTML=`<div class="marketing-empty error">${esc(e instanceof Error?e.message:'价格读取失败')}</div>`});await setup(main);await (main as any).__load(); }
export async function renderAdvertisingPage(main: HTMLElement) { main.innerHTML=`<header><div><p class="eyebrow">广告监控</p><h1>Advertising</h1></div></header>${filters(true)}<section class="panel"><div class="panel-head"><h2>日广告事实</h2><span data-marketing-status>加载中...</span></div><div data-marketing-results></div></section><section class="panel"><div class="panel-head"><h2>SEM 商品报告（最近 30 天汇总）</h2><span data-sem-item-status>加载中...</span></div><div data-sem-item-results></div></section>`; const load=async()=>{const q=queryOf(main);const [r,itemResponse]=await fetchAdvertisingPageResponses(fetch,q);const b=await r.json() as {data?:{rows?:Row[]};error?:{message?:string}};if(!r.ok)throw new Error(b.error?.message??'广告读取失败');const rows=b.data?.rows??[];main.querySelector('[data-marketing-status]')!.textContent=rows.length?`${rows.length} 条广告记录`:'暂无数据';const result=main.querySelector<HTMLElement>('[data-marketing-results]')!;result.innerHTML=rows.length?`<div class="marketing-table-wrap"><table><thead><tr><th>日期</th><th>渠道</th><th>Campaign</th><th>花费</th><th>归因销售额</th><th>ACOS</th><th>ROAS</th><th>状态</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(String(row.factDate??'').slice(0,10))}</td><td>${esc(row.channel==='sem'?'SEM':'站内广告')}</td><td>${esc(val(row.campaignId))}</td><td>${row.spend==null?'暂无数据':esc(`$${Number(row.spend).toFixed(2)}`)}</td><td>${row.attributedSales==null?'暂无数据':esc(`$${Number(row.attributedSales).toFixed(2)}`)}</td><td>${row.attributedSales==null?'暂无数据':esc(`${(Number(row.spend)/Number(row.attributedSales)*100).toFixed(2)}%`)}</td><td>${row.spend==null||Number(row.spend)===0||row.attributedSales==null?'暂无数据':esc((Number(row.attributedSales)/Number(row.spend)).toFixed(2))}</td><td>${row.complete===1?'完整':'数据不完整'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="marketing-empty">暂无广告数据</div>';const itemBody=await itemResponse.json() as {data?:{rows?:Row[]};error?:{message?:string}};if(!itemResponse.ok)throw new Error(itemBody.error?.message??'SEM 商品花费读取失败');const itemRows=itemBody.data?.rows??[];main.querySelector('[data-sem-item-status]')!.textContent=itemRows.length?`${itemRows.length} 条商品记录`:'暂无数据';main.querySelector<HTMLElement>('[data-sem-item-results]')!.innerHTML=itemRows.length?`<div class="marketing-table-wrap"><table><thead><tr><th>报告周期</th><th>SKU</th><th>Item ID</th><th>Campaign</th><th>花费</th><th>归因销售额</th><th>展示</th><th>点击</th></tr></thead><tbody>${itemRows.map(row=>`<tr><td>${esc(row.periodStart??row.factDate??'—')} 至 ${esc(row.periodEnd??row.factDate??'—')}</td><td>${esc(row.sku)}</td><td>${esc(val(row.itemId))}</td><td>${esc(row.campaignId)}</td><td>${row.spend==null?'暂无数据':esc(`$${Number(row.spend).toFixed(2)}`)}</td><td>${row.attributedSales==null?'暂无数据':esc(`$${Number(row.attributedSales).toFixed(2)}`)}</td><td>${esc(val(row.impressions))}</td><td>${esc(val(row.clicks))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="marketing-empty">暂无 SEM 商品报告数据</div>';};(main as any).__load=()=>void load().catch(e=>{main.querySelector('[data-marketing-results]')!.innerHTML=`<div class="marketing-empty error">${esc(e instanceof Error?e.message:'广告读取失败')}</div>`});await setup(main);await (main as any).__load(); }
export async function renderPerformancePage(main: HTMLElement) { main.innerHTML=`<header><div><p class="eyebrow">绩效监控</p><h1>Performance</h1><p class="muted">SEM_PERFORMANCE 报表的逐日 SKU 花费</p></div></header>${filters()}<section class="panel"><div class="panel-head"><h2>SEM 商品逐日花费</h2><span data-marketing-status>加载中...</span></div><div data-marketing-results><div class="marketing-empty">暂无绩效数据</div></div></section>`; const load=async()=>{const r=await fetch('/api/advertising/performance?'+queryOf(main));const b=await r.json() as {data?:{rows?:Row[]};error?:{message?:string}};if(!r.ok)throw new Error(b.error?.message ?? '绩效读取失败');const rows=b.data?.rows ?? [];main.querySelector('[data-marketing-status]')!.textContent=rows.length?`${rows.length} 条逐日记录`:'暂无数据';main.querySelector<HTMLElement>('[data-marketing-results]')!.innerHTML=rows.length?`<div class="marketing-table-wrap"><table><thead><tr><th>日期</th><th>SKU</th><th>Item ID</th><th>Campaign</th><th>花费</th><th>销售额</th><th>展示</th><th>点击</th><th>ACOS</th><th>ROAS</th></tr></thead><tbody>${rows.map(row=>{const spend=row.adSpend==null?null:Number(row.adSpend);const sales=row.sales==null?null:Number(row.sales);return `<tr><td>${esc(String(row.reportDate??'').slice(0,10))}</td><td>${esc(val(row.sku))}</td><td>${esc(val(row.itemId))}</td><td>${esc(val(row.campaignName??row.campaignId))}</td><td>${spend==null?'暂无数据':esc(`$${spend.toFixed(2)}`)}</td><td>${sales==null?'暂无数据':esc(`$${sales.toFixed(2)}`)}</td><td>${esc(val(row.impressions))}</td><td>${esc(val(row.clicks))}</td><td>${spend==null||sales==null||sales===0?'暂无数据':esc(`${(spend/sales*100).toFixed(2)}%`)}</td><td>${spend==null||spend===0||sales==null?'暂无数据':esc((sales/spend).toFixed(2))}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="marketing-empty">暂无逐日 SEM 报告数据，请先在 Sync Status 执行同步</div>';};(main as any).__load=()=>void load().catch(e=>{main.querySelector('[data-marketing-results]')!.innerHTML=`<div class="marketing-empty error">${esc(e instanceof Error?e.message:'绩效读取失败')}</div>`});await setup(main);await (main as any).__load(); }

export async function renderSemPerformanceSection(main: HTMLElement) { const q=queryOf(main); const panel=document.createElement('section'); panel.className='panel'; panel.innerHTML='<div class="panel-head"><h2>SEM 商品逐日花费（SEM_PERFORMANCE）</h2><span data-sem-performance-status>加载中...</span></div><div data-sem-performance-results></div>'; main.appendChild(panel); const response=await fetch('/api/advertising/performance?'+q); const body=await response.json() as {data?:{rows?:Row[]};error?:{message?:string}}; if (!response.ok) throw new Error(body.error?.message??'SEM 逐日报表读取失败'); const rows=body.data?.rows??[]; panel.querySelector('[data-sem-performance-status]')!.textContent=rows.length?`${rows.length} 条逐日记录`:'暂无数据'; panel.querySelector<HTMLElement>('[data-sem-performance-results]')!.innerHTML=rows.length?`<div class="marketing-table-wrap"><table><thead><tr><th>日期</th><th>SKU</th><th>Item ID</th><th>Campaign</th><th>花费</th><th>销售额</th><th>展示</th><th>点击</th><th>ACOS</th><th>ROAS</th></tr></thead><tbody>${rows.map(row=>{const spend=row.adSpend==null?null:Number(row.adSpend);const sales=row.sales==null?null:Number(row.sales);return `<tr><td>${esc(String(row.reportDate??'').slice(0,10))}</td><td>${esc(val(row.sku))}</td><td>${esc(val(row.itemId))}</td><td>${esc(val(row.campaignName??row.campaignId))}</td><td>${spend==null?'暂无数据':esc(`$${spend.toFixed(2)}`)}</td><td>${sales==null?'暂无数据':esc(`$${sales.toFixed(2)}`)}</td><td>${esc(val(row.impressions))}</td><td>${esc(val(row.clicks))}</td><td>${spend==null||sales==null||sales===0?'暂无数据':esc(`${(spend/sales*100).toFixed(2)}%`)}</td><td>${spend==null||spend===0||sales==null?'暂无数据':esc((sales/spend).toFixed(2))}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="marketing-empty">暂无逐日 SEM 报告数据，请先在 Sync Status 执行同步</div>'; }

export async function renderPerformanceSummaryPage(main: HTMLElement) { main.innerHTML=`<header><div><p class="eyebrow">绩效监控</p><h1>Performance</h1><p class="muted">按店铺查看 Walmart Seller Performance Report 滚动周期指标</p></div></header>${performanceFilters()}<section class="panel"><div class="panel-head"><h2>店铺绩效</h2><span data-marketing-status>加载中...</span></div><div data-marketing-results></div></section>`; const load=async()=>{const period=(main.querySelector('[data-performance-period]') as HTMLSelectElement).value;const days=Number(period.replace('DAY',''));const end=new Date();const from=new Date(end);from.setDate(end.getDate()-days+1);const query=new URLSearchParams();const store=(main.querySelector('[data-marketing-store]') as HTMLSelectElement).value;if(store)query.set('storeId',store);query.set('from',from.toISOString().slice(0,10));query.set('to',end.toISOString().slice(0,10));const r=await fetch('/api/performance?'+query);const b=await r.json() as {data?:{rows?:Row[]};error?:{message?:string}};if(!r.ok)throw new Error(b.error?.message??'绩效读取失败');const rows=filterPerformanceRows(b.data?.rows??[],period);main.querySelector('[data-marketing-status]')!.textContent=rows.length?`${rows.length} 项${days}天绩效指标`:'暂无数据';renderPerformanceCards(main,rows);};(main as any).__load=()=>void load().catch(e=>{main.querySelector<HTMLElement>('[data-marketing-results]')!.innerHTML=`<div class="marketing-empty error">${esc(e instanceof Error?e.message:'绩效读取失败')}</div>`});await setup(main);await (main as any).__load(); }

function semCampaignState(row: Row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
  const raw = row.status ?? row.campaignStatus ?? row.state ?? payload.status ?? payload.campaignStatus ?? payload.state;
  const normalized = String(raw ?? '').trim().toUpperCase();
  if (['ACTIVE', 'ENABLED', 'RUNNING', 'LIVE'].includes(normalized)) return { rank: 0, label: '激活' };
  if (['PAUSED', 'DISABLED', 'ENDED', 'INACTIVE', 'ARCHIVED'].includes(normalized)) return { rank: 2, label: '未激活' };
  return { rank: 1, label: '未知' };
}

function dateSortValue(row: Row, fields: string[]) {
  for (const field of fields) {
    const value = row[field];
    if (value != null && String(value) !== '') return String(value).slice(0, 10);
  }
  return '';
}

function compareDatesDescending(left: string, right: string) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return right.localeCompare(left);
}

export function sortSemItemRows(rows: Row[]) {
  return rows.map((row, index) => ({ row, index, state: semCampaignState(row) }))
    .sort((a, b) =>
      a.state.rank - b.state.rank ||
      compareDatesDescending(
        dateSortValue(a.row, ['periodEnd', 'reportDate', 'factDate']),
        dateSortValue(b.row, ['periodEnd', 'reportDate', 'factDate']),
      ) ||
      compareDatesDescending(
        dateSortValue(a.row, ['periodStart']),
        dateSortValue(b.row, ['periodStart']),
      ) ||
      a.index - b.index,
    )
    .map(({ row }) => row);
}

export function sortSemSearchTermRows(rows: Row[]) {
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) =>
      compareDatesDescending(
        dateSortValue(a.row, ['reportDate', 'periodEnd', 'factDate']),
        dateSortValue(b.row, ['reportDate', 'periodEnd', 'factDate']),
      ) ||
      String(a.row.campaignName ?? a.row.campaignId ?? '').localeCompare(String(b.row.campaignName ?? b.row.campaignId ?? '')) ||
      String(a.row.searchTerm ?? '').localeCompare(String(b.row.searchTerm ?? '')) ||
      a.index - b.index,
    )
    .map(({ row }) => row);
}

function renderSemItemReport(main: HTMLElement, rows: Row[], searchTerm: string, page = 0) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = rows.filter(row => {
    if (!normalizedSearch) return true;
    return [row.sku, row.itemId, row.campaignId, row.campaignName, row.status, row.campaignStatus]
      .some(value => String(value ?? '').toLowerCase().includes(normalizedSearch));
  });
  const ordered = sortSemItemRows(filtered).map((row, index) => ({ row, index, state: semCampaignState(row) }));
  const status = main.querySelector<HTMLElement>('[data-sem-item-status]');
  if (status) status.textContent = rows.length ? `${filtered.length} / ${rows.length} 条商品记录` : '暂无数据';
  const target = main.querySelector<HTMLElement>('[data-sem-item-results]')!;
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const visible = paginateRows(ordered, currentPage, pageSize);
  target.innerHTML = ordered.length ? `<div class="marketing-table-scroll"><table><thead><tr><th>报告周期</th><th>SKU</th><th>Item ID</th><th>广告组</th><th>状态</th><th>花费</th><th>归因销售额</th><th>展示</th><th>点击</th></tr></thead><tbody>${visible.map(({ row, state }) => `<tr><td>${esc(row.periodStart ?? row.factDate ?? '—')} 至 ${esc(row.periodEnd ?? row.factDate ?? '—')}</td><td>${esc(row.sku)}</td><td>${esc(val(row.itemId))}</td><td>${esc(row.campaignName ?? row.campaignId)}</td><td>${esc(state.label)}</td><td>${row.spend == null ? '暂无数据' : esc(`$${Number(row.spend).toFixed(2)}`)}</td><td>${row.attributedSales == null ? '暂无数据' : esc(`$${Number(row.attributedSales).toFixed(2)}`)}</td><td>${esc(val(row.impressions))}</td><td>${esc(val(row.clicks))}</td></tr>`).join('')}</tbody></table></div>${paginationMarkup('sem-item', currentPage, ordered.length, pageSize)}` : '<div class="marketing-empty">暂无匹配的 SEM 商品报告数据</div>';
  target.querySelector('[data-sem-item-prev]')?.addEventListener('click', () => renderSemItemReport(main, rows, searchTerm, currentPage - 1));
  target.querySelector('[data-sem-item-next]')?.addEventListener('click', () => renderSemItemReport(main, rows, searchTerm, currentPage + 1));
}

export const SEM_SEARCH_CLOUD_GROUPS = [
  { id: 'frequency', title: '高频词组', subtitle: '覆盖报告日期', available: true },
  { id: 'impressions', title: '高展示词', subtitle: '累计展示量', available: true },
  { id: 'spend', title: '高花费词', subtitle: '累计广告花费', available: true },
  { id: 'wordFrequency', title: '高频单词', subtitle: '单词出现频率', available: true },
] as const;

type SearchCloudMetric = 'frequency' | 'impressions' | 'spend' | 'wordFrequency';

export function buildSemSearchCloud(rows: Row[], metric: SearchCloudMetric) {
  if (metric === 'wordFrequency') {
    const words = new Map<string, { term: string; count: number }>();
    for (const row of rows) {
      const tokens = String(row.searchTerm ?? '').trim().toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 1);
      for (const token of tokens) {
        const value = words.get(token) ?? { term: token, count: 0 };
        value.count += 1;
        words.set(token, value);
      }
    }
    const sorted = [...words.values()].sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
    const minimum = Math.min(...sorted.map(row => row.count));
    const maximum = Math.max(...sorted.map(row => row.count));
    return sorted.map(row => ({ term: row.term, value: row.count, hasValue: true, fontSize: minimum === maximum ? 18 : Math.round(14 + ((row.count - minimum) / (maximum - minimum)) * 18) }));
  }
  const grouped = new Map<string, { term: string; impressions: number; spend: number; dates: Set<string>; hasImpressions: boolean; hasSpend: boolean }>();
  for (const row of rows) {
    const term = String(row.searchTerm ?? '').trim().replace(/\s+/g, ' ');
    if (!term) continue;
    const key = term.toLocaleLowerCase();
    const value = grouped.get(key) ?? { term, impressions: 0, spend: 0, dates: new Set<string>(), hasImpressions: false, hasSpend: false };
    const reportDate = String(row.reportDate ?? '').slice(0, 10);
    if (reportDate) value.dates.add(reportDate);
    if (row.impressions != null && Number.isFinite(Number(row.impressions))) {
      value.impressions += Number(row.impressions);
      value.hasImpressions = true;
    }
    if (row.adSpend != null && Number.isFinite(Number(row.adSpend))) {
      value.spend += Number(row.adSpend);
      value.hasSpend = true;
    }
    grouped.set(key, value);
  }
  const metricValue = (row: (typeof grouped extends Map<string, infer Value> ? Value : never)) => metric === 'frequency' ? row.dates.size : metric === 'impressions' ? row.impressions : row.spend;
  const hasMetric = (row: (typeof grouped extends Map<string, infer Value> ? Value : never)) => metric === 'frequency' ? row.dates.size > 0 : metric === 'impressions' ? row.hasImpressions : row.hasSpend;
  const sorted = [...grouped.values()].map(row => ({ ...row, value: metricValue(row), hasValue: hasMetric(row) }))
    .sort((a, b) => b.value - a.value || a.term.localeCompare(b.term));
  const observed = sorted.filter(row => row.hasValue).map(row => row.value);
  const minimum = Math.min(...observed);
  const maximum = Math.max(...observed);
  return sorted.map(row => ({
    term: row.term,
    value: row.value,
    hasValue: row.hasValue,
    fontSize: !row.hasValue || minimum === maximum ? 18 : Math.round(14 + ((row.value - minimum) / (maximum - minimum)) * 18),
  }));
}

export function filterSemSearchTermRows<T extends Row>(rows: T[], selectedTerm: string | null) {
  if (!selectedTerm) return rows;
  const selected = selectedTerm.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return rows.filter(row => String(row.searchTerm ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase() === selected);
}

export function paginateRows<T>(rows: T[], page: number, pageSize = 20) {
  if (page < 0 || page * pageSize >= rows.length) return [];
  return rows.slice(page * pageSize, (page + 1) * pageSize);
}

function paginationMarkup(prefix: string, page: number, total: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="marketing-pagination"><button type="button" data-${prefix}-prev ${page === 0 ? 'disabled' : ''}>上一页</button><span>第 ${page + 1} / ${pages} 页 · 共 ${total} 条</span><button type="button" data-${prefix}-next ${page >= pages - 1 ? 'disabled' : ''}>下一页</button></div>`;
}

async function renderSemSearchTermsSection(main: HTMLElement, query: URLSearchParams) {
  const panel = main.querySelector<HTMLElement>('[data-sem-search-panel]')!;
  const response = await fetch('/api/advertising/search-terms?' + query);
  const cloudQuery = new URLSearchParams(query);
  cloudQuery.set('pageSize', '1000');
  const cloudResponse = await fetch('/api/advertising/search-terms?' + cloudQuery);
  const body = await response.json() as { data?: { rows?: Row[] }; error?: { message?: string } };
  const cloudBody = await cloudResponse.json() as { data?: { rows?: Row[] }; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? 'SEM 搜索词报告读取失败');
  const rows = body.data?.rows ?? [];
  const cloudRows = cloudResponse.ok ? cloudBody.data?.rows ?? rows : rows;
  const status = panel.querySelector<HTMLElement>('[data-sem-search-status]')!;
  const clouds = panel.querySelector<HTMLElement>('[data-sem-search-clouds]')!;
  const results = panel.querySelector<HTMLElement>('[data-sem-search-results]')!;
  const cloudType = panel.querySelector<HTMLSelectElement>('[data-sem-cloud-type]')!;
  const render = (term: string, selectedCloudTerm: string | null, selectedCloudMetric: string | null, page = 0) => {
    const needle = term.trim().toLowerCase();
    const exactMatches = selectedCloudTerm && selectedCloudMetric === 'wordFrequency'
      ? rows.filter(row => String(row.searchTerm ?? '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).includes(selectedCloudTerm.toLocaleLowerCase()))
      : filterSemSearchTermRows(rows, selectedCloudTerm);
    const visible = sortSemSearchTermRows(exactMatches.filter(row => !needle || [row.searchTerm, row.sku, row.itemId, row.campaignName, row.campaignId].some(value => String(value ?? '').toLowerCase().includes(needle))));
    status.textContent = rows.length ? `${visible.length} / ${rows.length} 条搜索词记录${selectedCloudTerm ? ` · 词云：${selectedCloudTerm}` : ''}` : '暂无数据';
    const group = SEM_SEARCH_CLOUD_GROUPS.find(item => item.id === cloudType.value) ?? SEM_SEARCH_CLOUD_GROUPS[0];
    if (!group.available) {
      clouds.innerHTML = `<section class="sem-search-cloud-group is-unavailable"><h3>${group.title}</h3><small>${group.subtitle}</small><div class="sem-cloud-unavailable">${'message' in group ? group.message : '暂无数据'}</div></section>`;
    } else {
      const words = cloudRows.length ? buildSemSearchCloud(cloudRows, group.id).slice(0, 40) : [];
      const wordMarkup = words.map(({ term: cloudTerm, value, fontSize, hasValue }, index) => {
      const selected = selectedCloudTerm?.toLocaleLowerCase() === cloudTerm.toLocaleLowerCase();
        const metricLabel = !hasValue ? '该指标暂无数据' : group.id === 'frequency' ? `${value} 天` : group.id === 'impressions' ? `${value.toLocaleString()} 次展示` : group.id === 'spend' ? `$${value.toFixed(2)} 花费` : `${value} 次出现`;
        const weight = hasValue ? Math.max(0.35, Math.min(1, fontSize / 32)) : 0.35;
        const compactSize = Math.max(11, Math.min(18, Math.round(fontSize * 0.52)));
        const radialProgress = index / Math.max(words.length - 1, 1);
        const tone = 168 + Math.round(radialProgress * 42);
        const saturation = 76 - Math.round(radialProgress * 24);
        const lightness = 27 + Math.round(radialProgress * 31);
        const radius = index === 0 ? 0 : 12 + Math.sqrt(index / Math.max(words.length - 1, 1)) * 41;
        const angle = index * 137.5 - 90;
        const x = 50 + Math.cos(angle * Math.PI / 180) * radius;
        const y = 50 + Math.sin(angle * Math.PI / 180) * radius * 0.72;
        return `<button type="button" class="sem-word${selected ? ' is-selected' : ''}" data-sem-cloud-term="${esc(cloudTerm)}" data-sem-cloud-metric="${group.id}" aria-pressed="${selected}" title="${esc(cloudTerm)} · ${esc(metricLabel)}" style="--cloud-size:${compactSize}px;--cloud-weight:${weight.toFixed(2)};--cloud-delay:${(index * 45) % 900}ms;--cloud-hue:${tone};--cloud-saturation:${saturation}%;--cloud-lightness:${lightness}%;--cloud-x:${x.toFixed(2)}%;--cloud-y:${y.toFixed(2)}%"><span>${esc(cloudTerm)}</span><small>${esc(metricLabel)}</small></button>`;
      }).join('');
      clouds.innerHTML = `<section class="sem-search-cloud-group"><h3>${group.title}</h3><small>${group.subtitle} · 展示 ${words.length} 个词</small><div class="sem-search-cloud">${wordMarkup || '<span class="sem-cloud-empty">暂无搜索词</span>'}</div></section>`;
    }
    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
    const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
    const pageRows = paginateRows(visible, currentPage, pageSize);
    results.innerHTML = visible.length ? `<div class="marketing-table-scroll"><table><thead><tr><th>日期</th><th>广告组</th><th>搜索词</th><th>SKU</th><th>Item ID</th><th>展示</th><th>点击</th><th>CTR</th><th>花费</th></tr></thead><tbody>${pageRows.map(row => `<tr><td>${esc(String(row.reportDate ?? '').slice(0, 10))}</td><td>${esc(row.campaignName ?? row.campaignId)}</td><td>${esc(row.searchTerm)}</td><td>${esc(row.sku)}</td><td>${esc(val(row.itemId))}</td><td>${esc(val(row.impressions))}</td><td>${esc(val(row.clicks))}</td><td>${row.ctr == null ? '暂无数据' : esc(`${Number(row.ctr).toFixed(2)}%`)}</td><td>${row.adSpend == null ? '暂无数据' : esc(`$${Number(row.adSpend).toFixed(2)}`)}</td></tr>`).join('')}</tbody></table></div>${paginationMarkup('sem-search', currentPage, visible.length, pageSize)}` : '<div class="marketing-empty">暂无匹配的 SEM 搜索词数据</div>';
    results.querySelector('[data-sem-search-prev]')?.addEventListener('click', () => render(term, selectedCloudTerm, selectedCloudMetric, currentPage - 1));
    results.querySelector('[data-sem-search-next]')?.addEventListener('click', () => render(term, selectedCloudTerm, selectedCloudMetric, currentPage + 1));
    clouds.querySelectorAll<HTMLButtonElement>('[data-sem-cloud-term]').forEach(button => button.addEventListener('click', () => {
      const clickedTerm = button.dataset.semCloudTerm ?? '';
      render(term, selectedCloudTerm?.toLocaleLowerCase() === clickedTerm.toLocaleLowerCase() ? null : clickedTerm, selectedCloudTerm?.toLocaleLowerCase() === clickedTerm.toLocaleLowerCase() ? null : button.dataset.semCloudMetric ?? null, 0);
    }));
  };
  const search = main.querySelector<HTMLInputElement>('[data-sem-global-search]')!;
  cloudType.onchange = () => render(search.value, null, null);
  render(search.value, null, null);
}

export async function renderAdvertisingChartPage(main: HTMLElement) {
  main.classList.add('advertising-dashboard');
  main.innerHTML = `<header class="advertising-hero"><div><p class="eyebrow">MARKETING INTELLIGENCE</p><h1>广告仪表盘</h1><p class="muted">统一查看站内广告与 SEM 的花费、搜索词和商品表现</p></div><div class="advertising-hero-meta"><span class="status-dot"></span><span>本地数据实时同步</span></div></header>${filters(true)}
    <section class="panel advertising-chart-panel"><div class="panel-head"><div><p class="section-kicker">SPEND OVERVIEW</p><h2>日广告花费</h2></div><span data-marketing-status>加载中...</span></div><div data-ad-spend-chart aria-label="站内广告与 SEM 每日花费图表"></div></section>
    <nav class="advertising-tabs" aria-label="广告数据来源"><button type="button" class="is-active" data-ad-tab="sem" aria-selected="true">SEM</button><button type="button" data-ad-tab="onsite" aria-selected="false">站内广告</button></nav>
    <div class="advertising-view advertising-view-sem" data-ad-view="sem">
      <section class="panel" data-sem-search-panel><div class="panel-head"><div><p class="section-kicker">SEARCH TERMS</p><h2>SEM 搜索词报告</h2></div><div class="panel-actions"><select data-sem-cloud-type aria-label="词云类型">${SEM_SEARCH_CLOUD_GROUPS.map(group => `<option value="${group.id}">${group.title}</option>`).join('')}</select><span data-sem-search-status>加载中...</span></div></div><div class="sem-search-cloud-grid" data-sem-search-clouds aria-label="SEM 搜索词分析词云"></div><div data-sem-search-results></div></section>
      <section class="panel"><div class="panel-head"><h2>SEM 商品报告（最近 30 天汇总）</h2><span data-sem-item-status>加载中...</span></div><div data-sem-item-results></div></section>
    </div>
    <div class="advertising-view advertising-view-onsite" data-ad-view="onsite" hidden>
      <section class="panel"><div class="panel-head"><h2>站内广告关键词</h2><span data-onsite-keywords-status>加载中...</span></div><div data-onsite-keywords-results></div></section>
      <section class="panel"><div class="panel-head"><h2>站内广告花费</h2><span data-onsite-spend-status>加载中...</span></div><div data-onsite-spend-results></div></section>
      <section class="panel"><div class="panel-head"><h2>站内广告位置</h2><span data-onsite-placement-status>加载中...</span></div><div data-onsite-placement-results></div></section>
    </div>`;
  const load = async () => {
    // Keep the chart lightweight and aligned with the dashboard: when the
    // user has not chosen a range, request the latest 30 calendar days.
    const fromInput = main.querySelector<HTMLInputElement>('[data-marketing-from]');
    const toInput = main.querySelector<HTMLInputElement>('[data-marketing-to]');
    if (fromInput && toInput && !fromInput.value && !toInput.value) {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      const iso = (date: Date) => date.toISOString().slice(0, 10);
      fromInput.value = iso(start);
      toInput.value = iso(end);
    }
    const query = queryOf(main);
    query.set('page', '1'); query.set('pageSize', '20');
    const [trendResponse, itemResponse, keywordResponse, spendResponse, placementResponse, searchResponse] = await Promise.all([
      fetch('/api/advertising/onsite/spend-trend?' + query),
      fetch('/api/advertising/items?' + query),
      fetch('/api/advertising/onsite/keywords?' + query),
      fetch('/api/advertising/onsite/spend?' + query),
      fetch('/api/advertising/onsite/placement?' + query),
      fetch('/api/advertising/search-terms?' + query),
    ]);
    const trendBody = await advertisingJson(trendResponse) as { data?: { rows?: Row[] }; error?: { message?: string } };
    const itemBody = await advertisingJson(itemResponse) as { data?: { rows?: Row[]; total?: number; page?: number; pageSize?: number }; error?: { message?: string } };
    if (!trendResponse.ok) throw new Error(trendBody.error?.message ?? '广告读取失败');
    if (!itemResponse.ok) throw new Error(itemBody.error?.message ?? 'SEM 商品花费读取失败');

    const totals = new Map<string, { onsite: number; sem: number }>();
    const add = (date: string, channel: 'onsite' | 'sem', value: unknown) => {
      if (!date) return;
      const key = date.slice(0, 10);
      const total = totals.get(key) ?? { onsite: 0, sem: 0 };
      const amount = value == null ? 0 : Number(value);
      if (Number.isFinite(amount)) total[channel] += amount;
      totals.set(key, total);
    };
    for (const row of trendBody.data?.rows ?? []) add(String(row.date ?? ''), row.channel === 'sem' ? 'sem' : 'onsite', row.spend);
    const dates = [...totals.keys()].sort((a, b) => a.localeCompare(b));
    const max = Math.max(1, ...dates.map(date => Math.max(totals.get(date)!.onsite, totals.get(date)!.sem)));
    const onsiteTotal = dates.reduce((sum, date) => sum + totals.get(date)!.onsite, 0);
    const semTotal = dates.reduce((sum, date) => sum + totals.get(date)!.sem, 0);
    const chart = main.querySelector<HTMLElement>('[data-ad-spend-chart]')!;
    chart.innerHTML = dates.length ? `<div class="ad-spend-chart"><div class="ad-spend-summary"><span class="ad-spend-total onsite"><i></i><b>站内广告</b><strong>$${onsiteTotal.toFixed(2)}</strong></span><span class="ad-spend-total sem"><i></i><b>SEM</b><strong>$${semTotal.toFixed(2)}</strong></span></div><div class="ad-spend-legend" aria-hidden="true"><span class="onsite">站内广告</span><span class="sem">SEM</span></div><div class="ad-spend-grid" aria-hidden="true"></div><div class="ad-spend-bars">${dates.map(date => {
      const total = totals.get(date)!;
      return `<div class="ad-spend-day"><div class="ad-spend-columns"><div class="ad-spend-bar onsite" style="height:${Math.max(2, total.onsite / max * 150)}px" title="${date} 站内广告 $${total.onsite.toFixed(2)}"></div><div class="ad-spend-bar sem" style="height:${Math.max(2, total.sem / max * 150)}px" title="${date} SEM $${total.sem.toFixed(2)}"></div></div><span>${date.slice(5)}</span></div>`;
    }).join('')}</div></div>` : '<div class="marketing-empty">当前日期范围暂无广告数据</div>';
    main.querySelector('[data-marketing-status]')!.textContent = dates.length ? `${dates.length} 天` : '暂无数据';

    const itemRows = itemBody.data?.rows ?? [];
    const renderPage = (prefix: string, rows: Row[], total: number, page: number, target: string, status: string, table: string, loadPage: (next: number) => Promise<void>) => {
      main.querySelector<HTMLElement>(status)!.textContent = total ? `${total} 条记录` : '暂无数据';
      const box = main.querySelector<HTMLElement>(target)!; const pages = Math.max(1, Math.ceil(total / 20));
      box.innerHTML = rows.length ? `<div class="marketing-table-scroll"><table>${table}</table></div><div class="marketing-pagination"><button type="button" data-prev ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} / ${pages} 页 · 共 ${total} 条</span><button type="button" data-next ${page >= pages ? 'disabled' : ''}>下一页</button></div>` : '<div class="marketing-empty">暂无匹配数据</div>';
      box.querySelector('[data-prev]')?.addEventListener('click', () => void loadPage(page - 1)); box.querySelector('[data-next]')?.addEventListener('click', () => void loadPage(page + 1));
    };
    const itemTotal = Number(itemBody.data?.total ?? itemRows.length);
    const loadItems = async (page: number) => { const q = new URLSearchParams(query); q.set('page', String(page)); const r = await fetch('/api/advertising/items?' + q); const b = await advertisingJson(r) as typeof itemBody; const rows = b.data?.rows ?? []; renderPage('item', rows, Number(b.data?.total ?? rows.length), page, '[data-sem-item-results]', '[data-sem-item-status]', `<thead><tr><th>报告周期</th><th>SKU</th><th>Item ID</th><th>广告组</th><th>花费</th><th>归因销售额</th><th>展示</th><th>点击</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.periodStart ?? row.factDate ?? '—')} 至 ${esc(row.periodEnd ?? row.factDate ?? '—')}</td><td>${esc(row.sku)}</td><td>${esc(val(row.itemId))}</td><td>${esc(row.campaignName ?? row.campaignId)}</td><td>${row.spend == null ? '暂无数据' : esc(`$${Number(row.spend).toFixed(2)}`)}</td><td>${row.attributedSales == null ? '暂无数据' : esc(`$${Number(row.attributedSales).toFixed(2)}`)}</td><td>${esc(val(row.impressions))}</td><td>${esc(val(row.clicks))}</td></tr>`).join('')}</tbody>`, loadItems); };
    await loadItems(1);
    const renderOnsite = async (endpoint: string, response: Response, target: string, status: string, columns: (row: Row) => string, loadPage?: (page: number) => Promise<void>) => { const body = await advertisingJson(response) as { data?: { rows?: Row[]; total?: number }; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? `${endpoint} 请求失败（${response.status}）`); const rows = body.data?.rows ?? []; const total = Number(body.data?.total ?? rows.length); const loader = loadPage ?? (async (page: number) => { const q = new URLSearchParams(query); q.set('page', String(page)); const next = await fetch(endpoint + '?' + q); await renderOnsite(endpoint, next, target, status, columns, loadPage); }); renderPage(endpoint, rows, total, Number(query.get('page') ?? 1), target, status, `<thead><tr><th>日期</th><th>店铺</th><th>SKU/Item</th><th>主要指标</th></tr></thead><tbody>${rows.map(row => `<tr>${columns(row)}</tr>`).join('')}</tbody>`, loader); };
    await renderOnsite('/api/advertising/onsite/keywords', keywordResponse, '[data-onsite-keywords-results]', '[data-onsite-keywords-status]', row => `<td>${esc(String(row.Date ?? row.date ?? '').slice(0, 10))}</td><td>${esc(row.storeName)}</td><td>${esc(row.itemId ?? row.productName)}</td><td>${esc(row.searchTerm ?? row.spend ?? '暂无数据')}</td>`);
    await renderOnsite('/api/advertising/onsite/spend', spendResponse, '[data-onsite-spend-results]', '[data-onsite-spend-status]', row => `<td>${esc(String(row.report_date ?? row.reportDate ?? '').slice(0, 10))}</td><td>${esc(row.storeName)}</td><td>${esc(row.sku ?? row.itemId)}</td><td>花费 ${esc(row.spend ?? '暂无数据')} · 销售额 ${esc(row.sales ?? row.attributedSales ?? '暂无数据')}</td>`);
    await renderOnsite('/api/advertising/onsite/placement', placementResponse, '[data-onsite-placement-results]', '[data-onsite-placement-status]', row => `<td>${esc(String(row.date ?? '').slice(0, 10))}</td><td>${esc(row.storeName)}</td><td>${esc(row.itemId)}</td><td>${esc(row.placement)} · 花费 ${esc(row.spend ?? '暂无数据')} · 展示 ${esc(row.impressions ?? '暂无数据')}</td>`);
    await renderSemSearchTermsSection(main, query);
  };
  (main as any).__load = () => void load().catch(error => {
    const message = esc(error instanceof Error ? error.message : '广告读取失败');
    const panels = ['[data-ad-spend-chart]','[data-sem-search-results]','[data-sem-item-results]','[data-onsite-keywords-results]','[data-onsite-spend-results]','[data-onsite-placement-results]'];
    for (const selector of panels) { const target = main.querySelector<HTMLElement>(selector); if (target) target.innerHTML = `<div class="marketing-empty error">${message}</div>`; }
  });
  await setup(main);
  main.querySelectorAll<HTMLButtonElement>('[data-ad-tab]').forEach(button => button.addEventListener('click', () => {
    const tab = button.dataset.adTab ?? 'sem';
    main.querySelectorAll<HTMLButtonElement>('[data-ad-tab]').forEach(item => { const active = item === button; item.classList.toggle('is-active', active); item.setAttribute('aria-selected', String(active)); });
    main.querySelectorAll<HTMLElement>('[data-ad-view]').forEach(view => { view.hidden = view.dataset.adView !== tab; });
  }));
  main.querySelector('[data-sem-global-search]')?.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') void (main as any).__load(); });
  await (main as any).__load();
}
