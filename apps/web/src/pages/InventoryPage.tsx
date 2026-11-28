import { recentReceiptAnomalies, type WfsReceiptShipment } from './wfsShipmentAnomalies.js';
import { productImageMarkup } from '../components/ProductImage.js';
import './InventoryPage.css';
type InventoryRow = { storeId: string; sku: string; productName?: string; chineseName?: string; imageUrl?: string; nodeId?: string; quantity: number; reservedQuantity?: number; risk?: string; updatedAt: string; firstInStockDate?: string; ageDistribution?: Record<string, number>; transitQuantity?: number; transitDetails?: Array<{ shipmentId: string; shippedAt: string; shipped: number | null; received: number; remaining: number | null; needsReview: boolean }> };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const fmtInt = (value: number) => Math.round(value).toLocaleString('en-US');
// Risk codes come straight from the API; stock-out is the one that needs action, so it gets the stamp.
export function inventoryRiskMarkup(risk?: string): string {
  const key = String(risk ?? '').trim().toLowerCase();
  if (key === 'stockout') return '<span class="stamp">断货风险</span>';
  if (key === 'overstock') return '<span class="status-pill warn">滞销冗余</span>';
  if (!key || key === 'normal') return '<span class="muted">正常</span>';
  return `<span class="status-pill neutral">${escapeHtml(risk)}</span>`;
}
export function inventoryAgeRowsMarkup(bins: Array<{ label: string; count: number }>): string {
  const freshCount = Number(bins[0]?.count ?? 0) + Number(bins[1]?.count ?? 0);
  const agedCount = Number(bins[2]?.count ?? 0) + Number(bins[3]?.count ?? 0) + Number(bins[4]?.count ?? 0);
  const total = freshCount + agedCount;
  const freshShare = total ? Math.round(freshCount / total * 100) : 0;
  const agedShare = total ? Math.round(agedCount / total * 100) : 0;
  const max = Math.max(1, ...bins.map((bin) => Number(bin.count || 0)));
  const rowsMarkup = (group: Array<{ label: string; count: number }>, groupTotal: number) => group.map((bin) => { const pct = groupTotal ? Math.round(bin.count / groupTotal * 100) : 0; return `<div class="age-row" title="${escapeHtml(bin.label)}：${fmtInt(bin.count)} 件"><span class="age-row-label">${escapeHtml(bin.label)}</span><span class="age-row-track"><i style="width:${bin.count ? Math.max(2, bin.count / max * 100) : 0}%"></i></span><strong>${fmtInt(bin.count)}</strong><small>${pct}%</small></div>`; }).join('');
  const freshCard = `<article class="age-card"><h4>新鲜库存</h4><p class="age-desc">0-180 天</p><div class="age-stat"><strong>${fmtInt(freshCount)}</strong><small>${freshShare}%</small></div><div class="age-breakdown">${rowsMarkup(bins.slice(0, 2), freshCount)}</div></article>`;
  const agedCard = `<article class="age-card is-aged"><h4>老库存</h4><p class="age-desc">180+ 天</p><div class="age-stat"><strong>${fmtInt(agedCount)}</strong><small>${agedShare}%</small></div><div class="age-breakdown">${rowsMarkup(bins.slice(2), agedCount)}</div></article>`;
  return `<div class="inventory-age-cards">${freshCard}${agedCard}</div>`;
}
const closeOnOutside = (modal: HTMLElement) => {
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') modal.remove(); };
  document.addEventListener('keydown', onKey);
  new MutationObserver((_, observer) => { if (!modal.isConnected) { document.removeEventListener('keydown', onKey); observer.disconnect(); } }).observe(modal.parentElement ?? document.body, { childList: true });
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
};
const AGED_KEYS = ['181To270days', '271To365days', '365PlusDays', '365To450days', '450PlusDays'];
// Units that have sat in a WFS warehouse for more than 180 days, from the reported age bands or, failing that, the first in-stock date.
export function agedQuantity(row: Pick<InventoryRow, 'quantity' | 'ageDistribution' | 'firstInStockDate'>, now = new Date()): number {
  const bands = row.ageDistribution;
  const reported = bands ? Object.values(bands).reduce((sum, value) => sum + Number(value || 0), 0) : 0;
  if (reported > 0) return AGED_KEYS.reduce((sum, key) => sum + Number(bands?.[key] || 0), 0);
  if (!row.firstInStockDate) return 0;
  const ageDays = Math.floor((now.getTime() - new Date(row.firstInStockDate).getTime()) / 86400000);
  return ageDays > 180 ? Number(row.quantity || 0) : 0;
}
export function inventoryAgeInsightMarkup(rows: InventoryRow[], now = new Date()): string {
  const total = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const byProduct = new Map<string, { sku: string; storeId: string; name: string; aged: number }>();
  for (const row of rows) {
    const aged = agedQuantity(row, now);
    if (aged <= 0) continue;
    const key = `${row.storeId}\u0000${row.sku}`;
    const entry = byProduct.get(key) ?? { sku: row.sku, storeId: row.storeId, name: row.chineseName || row.productName || '', aged: 0 };
    entry.aged += aged;
    byProduct.set(key, entry);
  }
  const top = [...byProduct.values()].sort((a, b) => b.aged - a.aged).slice(0, 5);
  const agedTotal = [...byProduct.values()].reduce((sum, entry) => sum + entry.aged, 0);
  const share = total ? Math.round(agedTotal / total * 100) : 0;
  const list = top.length
    ? `<ol class="age-insight-list">${top.map((entry) => `<li><button type="button" data-age-sku="${escapeHtml(entry.sku)}" title="点击在下方表格中查看 ${escapeHtml(entry.sku)}"><span class="age-insight-sku">${escapeHtml(entry.sku)}</span><span class="age-insight-name">${escapeHtml(entry.name)}</span><strong>${fmtInt(entry.aged)} 件</strong></button></li>`).join('')}</ol>`
    : '<p class="age-insight-ok">没有超过 180 天的库存。</p>';
  return `<div class="inventory-age-insight"><div class="age-insight-stat"><span>超过 180 天的库存</span><strong>${fmtInt(agedTotal)} 件</strong><small>占在库库存 ${share}%</small></div>${top.length ? '<h4>库龄偏高的商品 Top 5</h4>' : ''}${list}</div>`;
}
export function inventoryLoadErrorMarkup(message: string): string { return `<div class="empty error">${escapeHtml(message)} <button type="button" class="secondary" data-retry-inventory>重试</button></div>`; }
type InventoryLogPage = { rows?: Array<Record<string, unknown>>; total?: number; page?: number; pageSize?: number; summary?: { monthlyNet?: number; outbound?: number; salesQuantity?: number; inbound?: number; salesOutboundDifference?: number } };
export function inventoryLogPageMarkup(data: InventoryLogPage, currentInventory: number): string {
  const rows = data.rows ?? [];
  const total = Number(data.total ?? 0);
  const page = Number(data.page ?? 1);
  const pageSize = Number(data.pageSize ?? 50);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const summary = data.summary ?? {};
  const metrics = [['月初库存', currentInventory - Number(summary.monthlyNet ?? 0)], ['出库数量', Number(summary.outbound ?? 0)], ['销售数量', Number(summary.salesQuantity ?? 0)], ['上架数量', Number(summary.inbound ?? 0)], ['当前库存', currentInventory], ['销售出库差异', Number(summary.salesOutboundDifference ?? 0)]];
  const table = rows.length ? '<table><thead><tr><th>时间</th><th>仓库</th><th class="num">变化</th><th>类型</th><th>原因</th><th>货件号</th></tr></thead><tbody>'+rows.map((log) => '<tr><td>'+escapeHtml(log.transactionTime)+'</td><td>'+escapeHtml(log.fcName)+'</td><td class="num'+(Number(log.changedUnits) < 0 ? ' neg' : '')+'">'+escapeHtml(log.changedUnits)+'</td><td>'+escapeHtml(log.transactionType)+'</td><td>'+escapeHtml(log.reasonDescription)+'</td><td>'+escapeHtml(log.shipmentId)+'</td></tr>').join('')+'</tbody></table>' : '<div class="empty">暂无库存变动日志</div>';
  return '<div class="inventory-log-metrics">'+metrics.map(([label, value]) => '<article><span>'+label+'</span><strong>'+value+'</strong></article>').join('')+'</div><div class="inventory-log-list">'+table+'</div><div class="inventory-log-pagination"><span>第 '+page+' / '+pageCount+' 页（共 '+total.toLocaleString('zh-CN')+' 条）</span><div><button class="secondary" type="button" data-log-prev '+(page <= 1 ? 'disabled' : '')+'>上一页</button><button class="secondary" type="button" data-log-next '+(page >= pageCount ? 'disabled' : '')+'>下一页</button></div></div>';
}
export async function renderInventoryPage(root: HTMLElement): Promise<void> {
  root.innerHTML = '<header><div><h1>库存</h1><p class="muted">WFS 在库库存、断货与滞销风险、头程在途</p></div></header><section class="inventory-metrics"><article><span>在库 WFS 库存总量</span><strong data-metric="total">-</strong></article><article data-risk-filter="stockout" tabindex="0" role="button" aria-pressed="false" title="点击只看断货风险，再点一次取消"><span>断货风险 SKU 数量</span><strong data-metric="stockout">-</strong></article><article data-risk-filter="overstock" tabindex="0" role="button" aria-pressed="false" title="点击只看滞销冗余，再点一次取消"><span>滞销冗余 SKU 数量</span><strong data-metric="overstock">-</strong></article><article data-shipment-anomaly tabindex="0" role="button" aria-label="查看头程货件异常"><span>头程货件异常数量</span><strong data-metric="shipment">-</strong><small class="muted">近 40 天已送达</small></article><article><span>本月仓储</span><strong data-metric="storage-fee">读取中…</strong><small class="muted" data-metric="storage-period">费用周期待账单返回</small></article></section><section class="inventory-charts"><div class="chart"><h3>库存库龄分布</h3><p class="muted">按首次入库日期估算，各区间展示可用库存数量</p><div data-chart="age"></div></div></section><section class="panel"><form class="inventory-filters filter-bar"><input name="sku" placeholder="SKU" aria-label="按 SKU 筛选"><input name="productName" placeholder="产品名称或中文品名" aria-label="按产品名称或中文品名筛选"><button class="primary">筛选</button><button type="button" data-reset>重置</button></form><div class="inventory-risk-state" hidden><span data-risk-label></span><button type="button" data-clear-risk>查看全部</button></div><div class="inventory-results"><div class="loading">正在加载库存…</div></div></section>';
  const form = root.querySelector<HTMLFormElement>('.inventory-filters')!; form.insertAdjacentHTML('afterbegin', '<select name="storeId" aria-label="按店铺筛选"><option value="">全部店铺</option></select>'); const target = root.querySelector<HTMLElement>('.inventory-results')!; const riskState = root.querySelector<HTMLElement>('.inventory-risk-state')!; const storageMetric = root.querySelector<HTMLElement>('[data-metric="storage-fee"]')!; const storagePeriod = root.querySelector<HTMLElement>('[data-metric="storage-period"]')!; let allRows: InventoryRow[] = []; let sourceRows: InventoryRow[] = []; let riskFilter = ''; let quantitySort: 'asc' | 'desc' = 'desc'; let inventoryPage = 1;
  form.insertAdjacentHTML('afterend', `
    <details class="inventory-recon-export">
      <summary>导出库存对账</summary>
      <form class="inventory-recon-form">
        <label>报告月份 <input name="month" type="month" required pattern="[0-9]{4}-[0-9]{2}" placeholder="YYYY-MM"></label>
        <button type="submit" class="primary">下载 Excel</button>
        <p class="muted inventory-recon-note">导出有权限的全部店铺，包含月初库存汇总、仓库明细及报告覆盖。</p>
        <p role="status" class="muted inventory-recon-status"></p>
      </form>
    </details>`);
  const reconForm = root.querySelector<HTMLFormElement>('.inventory-recon-form')!;
  const reconMonth = reconForm.querySelector('input')!;
  const reconStatus = reconForm.querySelector<HTMLElement>('[role="status"]')!;
  const previous = new Date();
  previous.setUTCDate(1);
  previous.setUTCMonth(previous.getUTCMonth()-1);
  reconMonth.value = reconMonth.max = previous.toISOString().slice(0,7);
  reconForm.addEventListener('submit', async event => {
    event.preventDefault();
    const month = reconMonth.value;
    const button = reconForm.querySelector<HTMLButtonElement>('button[type=submit]')!;
    if (button.disabled) return;
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month>reconMonth.max) { reconStatus.textContent='请选择已结束的月份'; return; }
    button.disabled = reconMonth.disabled = true;
    reconStatus.textContent = '正在生成报表…';
    try {
      const response = await fetch('/api/inventory/reconciliation/export?'+new URLSearchParams({month}), {credentials:'include'});
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? '导出失败（HTTP '+response.status+'）');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'WFS库存对账-'+month+'.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      reconStatus.textContent = '报表已下载';
    } catch (error) { reconStatus.textContent = error instanceof Error ? error.message : '导出失败，请重试'; }
    finally { button.disabled = reconMonth.disabled = false; }
  });
  const loadStorageFee = async () => {
    const storeId = form.querySelector<HTMLSelectElement>('select[name="storeId"]')?.value ?? '';
    const month = new Date().toISOString().slice(0, 7);
    storageMetric.textContent = '读取中…';
    try {
      const query = new URLSearchParams({ month }); if (storeId) query.set('storeId', storeId);
      const response = await fetch(`http://localhost:3000/api/inventory/storage-fees?${query}`, { credentials: 'include' });
      const body = await response.json() as { data?: { amount?: number | null; currency?: string | null; period?: { startDate?: string | null; endDate?: string | null } }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '读取仓储费失败');
      storageMetric.textContent = body.data?.amount == null ? '暂无账单' : `${body.data.currency ?? 'USD'} ${Number(body.data.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const startDate = body.data?.period?.startDate;
      const endDate = body.data?.period?.endDate;
      storagePeriod.textContent = startDate && endDate ? `费用周期：${startDate.replaceAll('-', '/')} - ${endDate.replaceAll('-', '/')}` : '费用周期待账单返回';
    } catch (error) { storageMetric.textContent = error instanceof Error ? error.message : '读取失败'; storagePeriod.textContent = '费用周期待账单返回'; }
  };
  let paginatingInventory = false; const paginateInventory = () => { if (paginatingInventory) return; paginatingInventory = true; const table = target.querySelector<HTMLTableElement>('table'); if (!table) { paginatingInventory = false; return; } const body = table.tBodies[0]; if (!body) { paginatingInventory = false; return; } const rows = [...body.rows]; const total = Math.max(1, Math.ceil(rows.length / 20)); inventoryPage = Math.min(inventoryPage, total); rows.forEach((row, index) => { row.hidden = index < (inventoryPage - 1) * 20 || index >= inventoryPage * 20; }); target.querySelector('[data-inventory-pagination]')?.remove(); if (total > 1) { const nav = document.createElement('div'); nav.className = 'pagination'; nav.dataset.inventoryPagination = 'true'; nav.innerHTML = `<button class="secondary" data-inventory-prev ${inventoryPage === 1 ? 'disabled' : ''}>上一页</button><span>第 ${inventoryPage} / ${total} 页（共 ${rows.length} 条库存）</span><button class="secondary" data-inventory-next ${inventoryPage === total ? 'disabled' : ''}>下一页</button>`; nav.querySelector('[data-inventory-prev]')?.addEventListener('click', () => { if (inventoryPage > 1) { inventoryPage--; paginateInventory(); } }); nav.querySelector('[data-inventory-next]')?.addEventListener('click', () => { if (inventoryPage < total) { inventoryPage++; paginateInventory(); } }); target.append(nav); } paginatingInventory = false; };
  const inventoryObserver = new MutationObserver((records) => { if (records.every((record) => [...record.addedNodes].every((node) => (node as HTMLElement).dataset?.inventoryPagination === 'true'))) return; if (!paginatingInventory) { inventoryPage = 1; paginateInventory(); } }); inventoryObserver.observe(target, { childList: true });
  const storeSelect = form.querySelector<HTMLSelectElement>('select[name="storeId"]')!;
  storeSelect.addEventListener('change', () => { if (!sourceRows.length) sourceRows = [...allRows]; const value = storeSelect.value; allRows = value ? sourceRows.filter((row) => row.storeId === value) : sourceRows; render(); loadStorageFee(); });
  const storeOptionsTimer = window.setInterval(() => { if (!allRows.length) return; sourceRows = sourceRows.length ? sourceRows : [...allRows]; for (const storeId of [...new Set(sourceRows.map((row) => row.storeId).filter(Boolean))].sort()) if (!storeSelect.querySelector(`option[value="${CSS.escape(storeId)}"]`)) { const option = document.createElement('option'); option.value = storeId; option.textContent = storeId; storeSelect.append(option); } if (storeSelect.options.length > 1) window.clearInterval(storeOptionsTimer); }, 100);
  const updateMetrics = (rows: InventoryRow[], shipmentCount?: number) => { const total = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0); root.querySelector('[data-metric="total"]')!.textContent = fmtInt(total); root.querySelector('[data-metric="stockout"]')!.textContent = String(new Set(rows.filter((row) => row.risk === 'stockout').map((row) => row.sku)).size); root.querySelector('[data-metric="overstock"]')!.textContent = String(new Set(rows.filter((row) => row.risk === 'overstock').map((row) => row.sku)).size); if (shipmentCount !== undefined) root.querySelector('[data-metric="shipment"]')!.textContent = String(shipmentCount); };
  let abnormalShipmentIds: string[] = [];
  const anomalyCard = root.querySelector<HTMLElement>('[data-shipment-anomaly]')!;
  const openShipmentAnomalies = () => { if (abnormalShipmentIds.length) root.dispatchEvent(new CustomEvent('open-wfs-shipment-anomalies', { bubbles: true, detail: abnormalShipmentIds })); };
  anomalyCard.addEventListener('click', openShipmentAnomalies);
  anomalyCard.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openShipmentAnomalies(); } });
  const renderCharts = (rows: InventoryRow[]) => { const today = new Date(); const ageBins = [{label:'0-90天',min:0,max:90,count:0,key:'0To90days'},{label:'91-180天',min:91,max:180,count:0,key:'91To180days'},{label:'181-270天',min:181,max:270,count:0,key:'181To270days'},{label:'271-365天',min:271,max:365,count:0,key:'271To365days'},{label:'365天以上',min:366,max:Infinity,count:0,key:'365PlusDays'}]; for(const row of rows){const ageData=row.ageDistribution; const reportedTotal=ageData ? Object.values(ageData).reduce((sum,value)=>sum+Number(value||0),0) : 0; if(reportedTotal>0){ ageBins[0].count+=Number(ageData?.['0To90days']||0); ageBins[1].count+=Number(ageData?.['91To180days']||0); ageBins[2].count+=Number(ageData?.['181To270days']||0); ageBins[3].count+=Number(ageData?.['271To365days']||0); ageBins[4].count+=Number(ageData?.['365PlusDays']||0)+Number(ageData?.['365To450days']||0)+Number(ageData?.['450PlusDays']||0); } else if(row.firstInStockDate){const age=Math.max(0,Math.floor((today.getTime()-new Date(row.firstInStockDate).getTime())/86400000));const bin=ageBins.find((x)=>age>=x.min&&age<=x.max);if(bin)bin.count+=Number(row.quantity||0);}}const ageMax=Math.max(1,...ageBins.map(x=>x.count));root.querySelector<HTMLElement>('[data-chart="age"]')!.innerHTML=ageBins.some(x=>x.count)?`<div class="inventory-age-layout">${inventoryAgeRowsMarkup(ageBins)}${inventoryAgeInsightMarkup(rows, today)}</div>`:'<div class="empty">暂无库龄数据</div>'; root.querySelectorAll<HTMLButtonElement>('[data-age-sku]').forEach((button) => { button.onclick = () => { const skuInput = form.elements.namedItem('sku'); if (skuInput instanceof HTMLInputElement) skuInput.value = button.dataset.ageSku ?? ''; inventoryPage = 1; render(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; }); };
  const render = () => {
    const values = new FormData(form);
    const sku = String(values.get('sku') ?? '').trim().toLowerCase();
    const name = String(values.get('productName') ?? '').trim().toLowerCase();
    const rows = allRows.filter((row) =>
      (!sku || String(row.sku ?? '').toLowerCase().includes(sku)) &&
      (!name || `${row.productName ?? ''} ${row.chineseName ?? ''}`.toLowerCase().includes(name)) &&
      (!riskFilter || row.risk === riskFilter),
    ).sort((a, b) => (Number(a.quantity || 0) - Number(b.quantity || 0)) * (quantitySort === 'asc' ? 1 : -1));
    updateMetrics(rows, abnormalShipmentIds.length);
    renderCharts(rows);
    riskState.hidden = !riskFilter;
    root.querySelectorAll<HTMLElement>('[data-risk-filter]').forEach((card) => { const on = card.dataset.riskFilter === riskFilter; card.classList.toggle('active', on); card.setAttribute('aria-pressed', String(on)); });
    riskState.querySelector('[data-risk-label]')!.textContent = riskFilter === 'stockout' ? '当前查看：断货风险 SKU' : riskFilter === 'overstock' ? '当前查看：滞销冗余 SKU' : '';
    target.innerHTML = rows.length ? `<table class="inventory-table"><thead><tr><th>商品</th><th class="num"><button type="button" class="table-sort" data-sort-quantity>可用库存 ${quantitySort === 'asc' ? '↑' : '↓'}</button></th><th class="num">头程在途</th><th class="num">预留</th><th>风险</th><th>更新</th></tr></thead><tbody>${rows.map((row) => `<tr><td><div class="inv-product"><div class="item-thumb-cell">${productImageMarkup(row.imageUrl, row.productName ?? row.sku)}</div><div class="inv-product-text"><button type="button" class="link" data-sku-log="${escapeHtml(row.sku)}" data-store-id="${escapeHtml(row.storeId)}">${escapeHtml(row.sku)}</button>${row.chineseName ? `<span class="inv-cn" title="${escapeHtml(row.chineseName)}">${escapeHtml(row.chineseName)}</span>` : ''}<span class="inv-name" title="${escapeHtml(row.productName)}">${escapeHtml(row.productName ?? '未提供名称')} · ${escapeHtml(row.storeId)}</span></div></div></td><td class="num${row.risk === 'stockout' ? ' is-low' : ''}">${fmtInt(Number(row.quantity || 0))}</td><td class="num">${(row.transitDetails?.length ?? 0) > 0 ? `<button type="button" class="link" data-transit-sku="${escapeHtml(row.sku)}" data-transit-store="${escapeHtml(row.storeId)}">${fmtInt(row.transitQuantity ?? 0)}${row.transitDetails?.some(detail => detail.needsReview) ? '<span class="status-pill warn">待核对</span>' : ''}</button>` : '<span class="muted">0</span>'}</td><td class="num">${fmtInt(row.reservedQuantity ?? 0)}</td><td>${inventoryRiskMarkup(row.risk)}</td><td class="inv-updated">${escapeHtml(row.updatedAt)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">没有匹配的库存，试试清除筛选条件</div>';
    target.querySelectorAll<HTMLButtonElement>('[data-transit-sku]').forEach((button) => button.addEventListener('click', () => { const row = rows.find((item) => item.sku === button.dataset.transitSku && item.storeId === button.dataset.transitStore); if (!row) return; const modal = document.createElement('div'); modal.className = 'inventory-log-modal'; modal.innerHTML = `<div class="inventory-log-dialog"><div class="inventory-log-header"><button class="inventory-log-close" type="button">×</button><h2>头程在途明细</h2><p class="muted">SKU: ${escapeHtml(row.sku)}</p></div><div class="inventory-log-body"><table><thead><tr><th>货件号</th><th>发货日期</th><th>发货量</th><th>已收货</th><th>剩余在途</th><th>状态</th></tr></thead><tbody>${(row.transitDetails ?? []).map((detail) => `<tr><td>${escapeHtml(detail.shipmentId || '待核对')}</td><td>${escapeHtml(detail.shippedAt)}</td><td>${detail.shipped == null ? '待核对' : detail.shipped}</td><td>${detail.received}</td><td>${detail.remaining == null ? '待核对' : detail.remaining}</td><td>${detail.needsReview ? '待核对' : detail.remaining === 0 ? '已全部收货' : '在途'}</td></tr>`).join('')}</tbody></table></div></div>`; root.append(modal); closeOnOutside(modal); modal.querySelector('.inventory-log-close')?.addEventListener('click', () => modal.remove()); }));
    target.querySelectorAll<HTMLButtonElement>('[data-sku-log]').forEach((button) => button.addEventListener('click', async () => {
      const skuValue = button.dataset.skuLog ?? '';
      const storeId = button.dataset.storeId ?? '';
      const modal = document.createElement('div'); modal.className = 'inventory-log-modal';
      modal.innerHTML = '<div class="inventory-log-dialog"><div class="inventory-log-header"><button class="inventory-log-close" type="button">×</button><h2>库存变动日志</h2><p class="muted">SKU: '+escapeHtml(skuValue)+'</p></div><div class="inventory-log-body">加载中...</div></div>';
      root.append(modal);
      closeOnOutside(modal);
      const bodyElement = modal.querySelector<HTMLElement>('.inventory-log-body')!;
      const closeModal = () => modal.remove();
      modal.querySelector('.inventory-log-close')!.addEventListener('click', closeModal);
      const currentInventory = Number(rows.find((row) => row.sku === skuValue)?.quantity ?? 0);
      let currentPage = 1;
      let loading = false;
      const loadLogPage = async (page: number) => {
        if (loading || !modal.isConnected) return;
        loading = true;
        bodyElement.setAttribute('aria-busy', 'true');
        if (currentPage === 1 && !bodyElement.querySelector('.inventory-log-metrics')) bodyElement.innerHTML = '<div class="loading">正在加载…</div>';
        try {
          const query = new URLSearchParams({ storeId, page: String(page), pageSize: '50' });
          const response = await fetch('http://localhost:3000/api/inventory/'+encodeURIComponent(skuValue)+'/logs?'+query, { credentials: 'include' });
          const result = await response.json() as { data?: InventoryLogPage; error?: { message?: string } };
          if (!response.ok) throw new Error(result.error?.message ?? '日志读取失败');
          if (!modal.isConnected) return;
          currentPage = page;
          bodyElement.innerHTML = inventoryLogPageMarkup(result.data ?? {}, currentInventory);
          bodyElement.querySelector<HTMLButtonElement>('[data-log-prev]')?.addEventListener('click', () => { void loadLogPage(currentPage - 1); });
          bodyElement.querySelector<HTMLButtonElement>('[data-log-next]')?.addEventListener('click', () => { void loadLogPage(currentPage + 1); });
        } catch (error) {
          if (modal.isConnected) bodyElement.textContent = error instanceof Error ? error.message : '日志读取失败';
        } finally {
          loading = false;
          bodyElement.removeAttribute('aria-busy');
        }
      };
      void loadLogPage(1);
    }));
    target.querySelector<HTMLButtonElement>('[data-sort-quantity]')?.addEventListener('click', () => { quantitySort = quantitySort === 'asc' ? 'desc' : 'asc'; render(); });
  };
  form.onsubmit = (event) => { event.preventDefault(); render(); }; root.querySelector<HTMLButtonElement>('[data-reset]')!.onclick = () => { form.reset(); riskFilter = ''; render(); }; root.querySelector<HTMLButtonElement>('[data-clear-risk]')!.onclick = () => { riskFilter = ''; render(); }; root.querySelectorAll<HTMLElement>('[data-risk-filter]').forEach((card) => { const activate = () => { riskFilter = card.dataset.riskFilter ?? ''; render(); }; card.addEventListener('click', activate); card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }); });
  const loadInventory = async () => {
  try {
    const response = await fetch('http://localhost:3000/api/inventory', { credentials: 'include' });
    const body = await response.json() as { data?: { rows?: InventoryRow[] }; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? '库存读取失败');
    allRows = body.data?.rows ?? [];
    updateMetrics(allRows);
    render();
    void loadStorageFee();
    void (async () => {
      try {
        const shipmentResponse = await fetch('/api/wfs/shipments?view=summary', { credentials: 'include' });
        const shipmentBody = await shipmentResponse.json() as { data?: { rows?: WfsReceiptShipment[] }; error?: { message?: string } };
        if (!shipmentResponse.ok) throw new Error(shipmentBody.error?.message ?? '货件读取失败');
        const anomalies = recentReceiptAnomalies(shipmentBody.data?.rows ?? []);
        abnormalShipmentIds = anomalies.map((row) => row.shipmentId!).filter(Boolean);
        updateMetrics(allRows, abnormalShipmentIds.length);
      } catch { root.querySelector<HTMLElement>('[data-metric="shipment"]')!.textContent = '读取失败'; }
    })();
  } catch (error) {
    target.innerHTML = inventoryLoadErrorMarkup(error instanceof Error ? error.message : '库存读取失败');
    target.querySelector<HTMLButtonElement>('[data-retry-inventory]')!.onclick = () => { void loadInventory(); };
  }
  };
  void loadInventory();
}
