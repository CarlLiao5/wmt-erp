import './ProfitPage.css';
type CalculationStatus = {state:'idle'|'queued'|'running'|'failed'|'ready';calculatedAt:string|null;nextRunAt:string|null};
type ProductProfit = {storeId:string;sku:string;chineseName?:string;imageUrl?:string;fees?:Record<typeof fields[number],number>;missing?:string[];quantity:number;revenue:number;returnDeduction:number;profit:number};
type Totals = {directAdvertisingDeduction?:number;returnDeduction:number;priorOrderReturnDeduction:number;profitBeforeReturns:number;adjustedProfit:number;revenue:number;purchase:number;freight:number;lastMile:number;commission:number;onsite:number;sem:number;its:number;profit:number;orderCount:number;incomplete:number};
type Order = Totals & {orderId:string;orderNumber:string;orderedAt:string;missing:string[]};
type ReturnAdjustment={returnId:string|null;orderNumber:string;storeId:string;sku:string;saleMonth:string;quantity:number|null;refund:number;refundSource:string;commissionCredit:number;commissionSource:string;returnFees:number;compensation:number;netDeduction:number;unsellableCost:number|null;missing:string[];feeStatus:string};
type ReturnData={rows:ReturnAdjustment[];summary:{count:number;quantity:number;pending:number;cancelled:number;excluded:number;nonUsd:number;refund:number;commissionCredit:number;returnFees:number;compensation:number;netDeduction:number;unsellableCost:number;incomplete:number;estimated:number}};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(n:number)=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fields=['purchase','freight','lastMile','commission','onsite','sem','its'] as const;
const labels=['采购成本','头程运费','尾程运费','佣金','站内广告','SEM（折后）','ITS 转运'];
export async function renderProfitPage(main:HTMLElement){
 main.classList.add('profit-page');
 main.innerHTML=`
 <header class="profit-heading">
  <div><h1>利润粗算</h1><p class="muted">按月查看销售额、费用与扣除退货后的毛利</p></div>
  <span class="profit-currency">USD</span>
 </header>
 <section class="panel profit-controls" aria-label="核算操作">
  <form data-calculate>
   <div class="profit-toolbar">
    <label>核算月份<input name="month" type="month" required></label>
    <div class="profit-actions">
     <button class="secondary" type="button" data-calculation-status aria-expanded="false">计算状态</button>
     <button class="primary" data-run-profit>立即计算</button>
    </div>
   </div>
   <details class="profit-export">
    <summary>导出报表</summary>
    <div class="profit-export-actions">
     <button class="secondary" type="button" data-profit-export>下载利润表</button>
     <button class="secondary" type="button" data-export>导出 SKU 缺失费用</button>
     <button class="secondary" type="button" data-return-export>导出卖家退货调整</button>
    </div>
   </details>
  </form>
  <div class="profit-run-status" data-run-status hidden></div>
  <details class="profit-settings" data-settings-panel>
   <summary>汇率与 SEM 减免</summary>
   <form data-settings>
    <label>人民币 / 美元<input name="exchangeRate" type="number" min="0.000001" step="any" required placeholder="填写汇率"></label>
    <label>SEM 减免比例（%）<input name="semDiscount" type="number" min="0" max="100" step="any" value="0" required></label>
    <button class="secondary">保存全局设置</button>
   </form>
  </details>
 </section>
 <p data-status role="status" aria-live="polite"></p>
 <dialog class="profit-fee-dialog" aria-labelledby="profit-fee-title"></dialog>
 <div data-result><section class="panel profit-empty"><strong>请选择核算月份</strong><p>选择后查看该月的利润概览和明细。</p></section></div>`;
 const settings=main.querySelector<HTMLFormElement>('[data-settings]')!,calculate=main.querySelector<HTMLFormElement>('[data-calculate]')!,status=main.querySelector<HTMLElement>('[data-status]')!,result=main.querySelector<HTMLElement>('[data-result]')!;
 const monthInput=calculate.elements.namedItem('month') as HTMLInputElement;
 let rows:Order[]=[],page=1,query='',busy=false,configured=false,dirty=false;
 let detailView:'orders'|'products'='orders';
 let products:ProductProfit[] | undefined;
 let displayedMonth='', refreshRequest: AbortController | undefined;
 const active=()=>main.isConnected && main.contains(result);
 let pending=false;
 let shownCalculation: string | null = null;
 let calculationStatus: CalculationStatus | undefined;
 let submittingCalculation=false;
 const statusButton=main.querySelector<HTMLButtonElement>('[data-calculation-status]')!;
 const runButton=main.querySelector<HTMLButtonElement>('[data-run-profit]')!;
 const statusPanel=main.querySelector<HTMLElement>('[data-run-status]')!;
 const stateLabels={idle:'尚未计算',queued:'等待计算',running:'计算中',failed:'计算失败，等待重试',ready:'已完成'};
 const formatTime=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'—';
 const inProgress=()=>calculationStatus?.state==='queued'||calculationStatus?.state==='running';

 function renderCalculationStatus() {
  const hasMonth = monthInput.value !== '';
  statusButton.disabled = busy || !configured || !hasMonth;
  runButton.disabled = busy || !configured || !hasMonth || submittingCalculation || inProgress();
  calculate.querySelectorAll<HTMLButtonElement>('[data-export], [data-profit-export], [data-return-export]').forEach(button => {
   button.disabled = busy || !configured || !hasMonth;
  });
  const state=calculationStatus?.state;
  statusButton.dataset.state=state??'';
  statusButton.textContent=state?'计算状态 · '+stateLabels[state]:'计算状态';
  statusPanel.textContent='上次完成 '+formatTime(calculationStatus?.calculatedAt??null)
   +'　·　下次计划 '+(inProgress()?'当前任务完成后安排':formatTime(calculationStatus?.nextRunAt??null));
 }
 statusButton.onclick=()=>{
  statusPanel.hidden=!statusPanel.hidden;
  statusButton.setAttribute('aria-expanded',String(!statusPanel.hidden));
  if(!statusPanel.hidden)void checkCalculation();
 };
 const api=async(path:string,init:RequestInit={})=>{const response=await fetch('/api/profit'+path,{credentials:'include',...init});const body=await response.json().catch(()=>null);if(!response.ok)throw Error(body?.error?.message??'请求失败（HTTP '+response.status+'）');return body.data;};
 const lock=(value:boolean)=>{busy=value;main.querySelectorAll<HTMLInputElement | HTMLButtonElement>('form button, form input').forEach(control=>control.disabled=value);renderCalculationStatus();};
 const feeDialog = main.querySelector<HTMLDialogElement>('.profit-fee-dialog')!;
 function showProductFees(row: ProductProfit) {
  const total = row.revenue - row.profit;
  const costs = row.fees;
  const feeRows = costs ? [...fields.map((field,index) => [labels[index]!, costs[field]] as const),
   ['卖家责任退货净扣减', row.returnDeduction] as const] : [];
  feeDialog.innerHTML = `<header><div><h2 id="profit-fee-title">商品费用明细</h2>
   <p>${esc(row.chineseName || row.sku)} · ${esc(row.storeId)} · ${esc(displayedMonth)}</p></div>
   <button type="button" class="secondary" data-close-fees>关闭</button></header>
   ${costs ? `<p class="profit-fee-total">费用合计 <strong>$${money(total)}</strong></p>
   <table class="data-table"><thead><tr><th scope="col">费用项目</th><th scope="col">金额（USD）</th><th scope="col">占总费用</th></tr></thead>
   <tbody>${feeRows.map(([label,value]) => {
    const share = total > 0.000001 ? value / total * 100 : null;
    return `<tr><th scope="row">${label}</th><td>${money(value)}</td><td>${share === null ? '—' : share.toFixed(1)+'%'}</td></tr>`;
   }).join('')}</tbody></table>
   ${row.missing?.length ? '<p class="profit-warning">待补数据：'+esc(row.missing.join('、'))+'。缺失费用未计入合计。</p>' : ''}`
   : '<p>这个月的费用明细将在下次核算后显示。</p>'}`;
  feeDialog.querySelector<HTMLButtonElement>('[data-close-fees]')!.onclick=()=>feeDialog.close();
  if(!feeDialog.open)feeDialog.showModal();
 }
 function drawDetail() {
  result.querySelectorAll<HTMLButtonElement>('[data-profit-view]').forEach(button => {
   button.setAttribute('aria-pressed', String(button.dataset.profitView===detailView));
  });
  const search=result.querySelector<HTMLInputElement>('[data-search]')!;
  search.placeholder=detailView==='orders'?'搜索订单号':'搜索 SKU 或中文名称';
  search.setAttribute('aria-label',search.placeholder);
  search.value=query;
  search.oninput=()=>{query=search.value;page=1;drawDetail();};
  if(detailView==='orders'){table();return;}
  const host=result.querySelector<HTMLElement>('[data-orders]')!;
  if(!products){
   host.textContent='本月产品利润将在下次核算后显示，也可点击「立即计算」。';
   return;
  }
  const keyword=query.trim().toLowerCase();
  const filtered=products.filter(row=>[row.sku,row.chineseName].some(value=>value?.toLowerCase().includes(keyword)));
  const pages=Math.max(1,Math.ceil(filtered.length/30));
  page=Math.min(page,pages);
  if(!filtered.length){host.textContent=keyword?'没有匹配的产品':'该月暂无产品利润';return;}
  const visibleProducts=filtered.slice((page-1)*30,page*30);
  host.innerHTML='<div class="profit-table profit-product-table"><table class="data-table"><thead><tr>'
   +['商品','销量','销售额','退货扣减','粗算毛利','毛利率'].map(label=>'<th scope="col">'+label+'</th>').join('')
   +'</tr></thead><tbody>'+visibleProducts.map((row,index)=>{
    const name=row.chineseName||'—';
    const image=row.imageUrl && /^(https?:)?\/\//i.test(row.imageUrl)
     ? '<img src="'+esc(row.imageUrl)+'" alt="" loading="lazy">' : '';
    return '<tr><td><button type="button" class="profit-product" data-profit-product="'+index+'" aria-haspopup="dialog"><span class="profit-product-image">'+image+'</span>'
     +'<span><strong title="'+esc(name)+'">'+esc(name)+'</strong><small>'+esc(row.sku||'未关联 SKU')+' · '+esc(row.storeId)+'</small></span></button></td>'
     +'<td>'+row.quantity.toLocaleString('zh-CN')+'</td><td>$'+money(row.revenue)+'</td><td>$'+money(row.returnDeduction)
     +'</td><td class="'+(row.profit<0?'profit-negative':'')+'">$'+money(row.profit)+'</td><td>'
     +(row.revenue?(row.profit/row.revenue*100).toFixed(1)+'%':'—')+'</td></tr>';
   }).join('')+'</tbody></table></div><div class="profit-pagination"><button class="secondary" data-product-prev '
   +(page===1?'disabled':'')+'>上一页</button><span>'+page+' / '+pages+' · '+filtered.length+' 条</span><button class="secondary" data-product-next '
   +(page===pages?'disabled':'')+'>下一页</button></div>';
  host.querySelectorAll<HTMLButtonElement>('[data-profit-product]').forEach(button=>{
   button.onclick=()=>showProductFees(visibleProducts[Number(button.dataset.profitProduct)]!);
  });
  host.querySelectorAll<HTMLImageElement>('img').forEach(image=>{image.onerror=()=>image.remove();});
  host.querySelector<HTMLButtonElement>('[data-product-prev]')!.onclick=()=>{page--;drawDetail();};
  host.querySelector<HTMLButtonElement>('[data-product-next]')!.onclick=()=>{page++;drawDetail();};
 }
 function table(){
  const filtered=rows.filter(r=>r.orderNumber.toLowerCase().includes(query.toLowerCase())),pages=Math.max(1,Math.ceil(filtered.length/30));page=Math.min(page,pages);
  result.querySelector<HTMLElement>('[data-orders]')!.innerHTML='<div class="profit-table"><table class="data-table"><thead><tr>'+['订单号','下单日期','销售额',...labels,'退货扣减','粗算毛利','成本完整性'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+filtered.slice((page-1)*30,page*30).map(r=>'<tr><td>'+esc(r.orderNumber)+'</td><td>'+esc(new Date(r.orderedAt).toLocaleDateString('zh-CN',{timeZone:'America/Los_Angeles'}))+'</td>'+[r.revenue,...fields.map(k=>r[k]),r.returnDeduction,r.profit].map(n=>'<td>'+money(n)+'</td>').join('')+'<td class="'+(r.missing.length?'profit-warning':'')+'">'+esc(r.missing.length?'缺少 '+r.missing.join('、'):'完整')+'</td></tr>').join('')+'</tbody></table></div><div class="profit-pagination"><button class="secondary" data-prev '+(page===1?'disabled':'')+'>上一页</button><span>'+page+' / '+pages+' · '+filtered.length+' 个订单</span><button class="secondary" data-next '+(page===pages?'disabled':'')+'>下一页</button></div>';
  result.querySelector<HTMLButtonElement>('[data-prev]')!.onclick=()=>{page--;table();};result.querySelector<HTMLButtonElement>('[data-next]')!.onclick=()=>{page++;table();};
 }
 async function download(kind:'profit'|'returns'|'missing-costs'){
  if(busy)return;
  if(!configured){status.textContent='请先保存全局设置';return;}
  const month=String(new FormData(calculate).get('month'));
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){status.textContent='请选择有效月份';return;}
  calculate.querySelector<HTMLDetailsElement>('.profit-export')!.open=false;
  const label=kind==='profit'?'月度利润表':kind==='returns'?'卖家退货调整':'SKU缺失费用';
  refreshRequest?.abort();
  lock(true);status.textContent='正在生成 '+month+' 的'+label+'清单…';
  try{
   const response=await fetch('/api/profit/'+(kind==='profit'?'':kind+'/')+'export?month='+encodeURIComponent(month),{credentials:'include'});
   if(!response.ok){const error=await response.json().catch(()=>null);throw Error(error?.error?.message??'导出失败（HTTP '+response.status+'）');}
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
   link.href=url;link.download=label+'-'+month+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   status.textContent='已导出 '+month+' 的'+label+'清单。';
  }catch(error){status.textContent=String(error);}finally{lock(false);}
 }
 main.querySelector<HTMLButtonElement>('[data-export]')!.onclick=()=>void download('missing-costs');
 main.querySelector<HTMLButtonElement>('[data-return-export]')!.onclick=()=>void download('returns');
 main.querySelector<HTMLButtonElement>('[data-profit-export]')!.onclick=()=>void download('profit');
 settings.oninput=()=>{
  dirty=true;
  status.textContent='参数已修改，保存后会自动重新计算。';
 };
 settings.onsubmit=async e=>{
  e.preventDefault();
  if(busy)return;
  const values=new FormData(settings);
  refreshRequest?.abort();
  lock(true);
  try {
   const saved=await api('/settings',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({exchangeRate:Number(values.get('exchangeRate')),semDiscount:Number(values.get('semDiscount'))}),
   });
   showSettings(saved);
   dirty=false;
  } catch(error) {
   status.textContent=String(error);
   return;
  } finally {
   lock(false);
  }
  if (monthInput.value) {
   await loadProfit();
   await checkCalculation();
  } else {
   status.textContent='全局设置已保存。';
  }
 };
 calculate.onsubmit=async e=>{
  e.preventDefault();
  if(busy||!configured||submittingCalculation||inProgress()||!monthInput.reportValidity())return;
  const month=monthInput.value;
  submittingCalculation=true;
  renderCalculationStatus();
  try {
   const next:CalculationStatus=await api('/calculate',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month}),
   });
   if(active()&&monthInput.value===month){
    calculationStatus=next;
    status.textContent=month+' · 已提交后台计算';
   }
  } catch(error) {
   if(active()&&monthInput.value===month)status.textContent=String(error);
  } finally {
   submittingCalculation=false;
   renderCalculationStatus();
  }
 };
 monthInput.onchange=async()=>{
  calculationStatus=undefined;
  shownCalculation=null;
  pending=false;
  renderCalculationStatus();
  if (!monthInput.value) {
   refreshRequest?.abort();
   displayedMonth='';
   statusPanel.hidden=true;
   statusButton.setAttribute('aria-expanded','false');
   status.textContent='';
   result.innerHTML='<section class="panel profit-empty">请选择核算月份。</section>';
   return;
  }
  await loadProfit();
  await checkCalculation();
 };

 async function checkCalculation() {
  if(!active()||busy||!configured||submittingCalculation)return;
  const month=monthInput.value;
  if(!month)return;
  try {
   const next:CalculationStatus=await api('/status?month='+encodeURIComponent(month));
   if(!active()||monthInput.value!==month||submittingCalculation)return;
   calculationStatus=next;
   renderCalculationStatus();
   if(next.calculatedAt && shownCalculation!==next.calculatedAt && !dirty)await loadProfit(true);
  } catch(error) {
   if(!statusPanel.hidden&&active())statusPanel.textContent=String(error);
  }
 }

 function showSettings(data:{exchangeRate:number;semDiscount:number}) {
  (settings.elements.namedItem('exchangeRate') as HTMLInputElement).value=String(data.exchangeRate);
  (settings.elements.namedItem('semDiscount') as HTMLInputElement).value=String(data.semDiscount);
  configured=true;
 }

 async function loadProfit(background=false) {
  if(busy || !active())return;
  if(!configured){
   status.textContent='请先保存汇率和 SEM 折扣。';
   result.innerHTML='<section class="panel profit-empty">保存全局设置后，将自动核算所选月份。</section>';
   return;
  }
  const month=monthInput.value;
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){
   status.textContent='请选择有效月份';
   return;
  }
  if(background && refreshRequest)return;
  refreshRequest?.abort();
  const request=new AbortController();
  refreshRequest=request;
  if(!background){
   lock(true);
   if(displayedMonth!==month)result.innerHTML='';
   status.textContent='正在读取 '+month+' 的核算结果…';
  }
  try {
   const data:({orders:Order[];summary:Totals;returns:ReturnData;products?:ProductProfit[];missingSkus?:Array<{storeId:string;sku:string;itemIds:string;missing:string[];advertisingSource?:string;advertisingDifference?:number;advertisingNetDifference?:number}>;advertisingReconciliation?:Record<string,{reported:number;allocated:number;unallocated:number;netUnallocated:number;directDeducted?:number}>;calculatedAt:string;pending:boolean} | {pending:true})=await api('?month='+encodeURIComponent(month),{signal:request.signal});
   if(request.signal.aborted || !active())return;
   pending=data.pending;
   if(!('calculatedAt' in data)){
    status.textContent=month+' · 等待后台核算';
    if(displayedMonth!==month)result.innerHTML='<section class="panel profit-empty">后台正在准备该月的核算结果，完成后会自动显示。</section>';
    return;
   }
   const searchFocused=!!result.querySelector('[data-search]:focus');
   const detailsOpen=!!result.querySelector('details[open]');
   if(displayedMonth!==month){page=1;query='';}
   displayedMonth=month;
   shownCalculation=data.calculatedAt;
   rows=data.orders;
   products=data.products;
   const s=data.summary;
   const feeItems = [...fields.map((field,index)=>({label:labels[index],amount:s[field]})),
    {label:'卖家责任退货净扣减',amount:s.returnDeduction}];
   const maxFee = Math.max(1,...feeItems.map(item=>Math.abs(item.amount)));
   const margin = s.revenue ? (s.profit/s.revenue*100).toFixed(1)+'%' : '—';
   result.innerHTML = `
    <div class="profit-metrics">
     <section class="panel profit-hero"><span>粗算毛利</span><strong>${s.profit<0?'−':''}$${money(Math.abs(s.profit))}</strong><small>已扣当月卖家责任退货</small></section>
     <section class="panel"><span>订单销售额</span><strong>$${money(s.revenue)}</strong><small>${s.orderCount.toLocaleString('zh-CN')} 笔订单</small></section>
     <section class="panel"><span>毛利率</span><strong>${margin}</strong><small>粗算毛利 ÷ 销售额</small></section>
     <section class="panel"><span>成本待补齐</span><strong class="${s.incomplete?'profit-warning':''}">${s.incomplete.toLocaleString('zh-CN')}</strong><small>笔订单缺少费用数据</small></section>
    </div>
    <section class="panel profit-breakdown">
     <header><h2>月度费用</h2><strong>$${money(s.revenue-s.profit)}</strong></header>
     <div class="profit-costs">${feeItems.map(({label,amount})=>`
      <div class="profit-cost-row"><span>${label}</span><strong>$${money(amount)}</strong>
      <progress aria-label="${label}金额大小" max="${maxFee}" value="${Math.abs(amount)}"></progress></div>`).join('')}</div>
     <p class="muted">无销量产品广告直接扣减 $${money(s.directAdvertisingDeduction??0)}，跨月订单的本月退货扣减 $${money(s.priorOrderReturnDeduction)} 均已计入月度毛利。
      ${data.returns.summary.estimated} 条退货含预估，${data.returns.summary.incomplete} 条待核对。</p>
    </section>
    <section class="panel profit-detail"><div class="profit-list-head"><div class="profit-view-switch" role="group" aria-label="利润明细视图"><button type="button" class="secondary" data-profit-view="orders">订单明细</button><button type="button" class="secondary" data-profit-view="products">产品利润</button></div><input data-search type="search" aria-label="搜索订单号" placeholder="搜索订单号"></div><div data-orders></div></section>
    <section class="panel profit-ad-reconciliation"><header><h2>广告分摊核对</h2></header><p class="muted">已匹配但无销量的广告直接扣入产品和月份毛利；未匹配或关联冲突的广告保留在缺失清单中，尚未扣入毛利。SEM 同时展示减免后的差额。</p><div class="table-scroll"><table class="data-table"><thead><tr><th>来源</th><th>报表花费</th><th>已计入（分摊＋直接扣减）</th><th>未分摊</th><th>未分摊（折后）</th></tr></thead><tbody>${Object.entries(data.advertisingReconciliation??{}).map(([source,r])=>'<tr><td>'+(source==='onsite'?'站内广告':'SEM')+'</td><td>$'+money(r.reported)+'</td><td>$'+money(r.allocated)+'</td><td>$'+money(r.unallocated)+'</td><td>$'+money(r.netUnallocated)+'</td></tr>').join('')}</tbody></table></div><details><summary>广告缺失 / 差额 SKU（${(data.missingSkus??[]).filter(r=>r.advertisingSource).length} 条）</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>店铺</th><th>SKU</th><th>Item ID</th><th>来源</th><th>缺失原因</th><th>原始差额 USD</th><th>折后差额 USD</th></tr></thead><tbody>${(data.missingSkus??[]).filter(r=>r.advertisingSource).map(r=>'<tr><td>'+esc(r.storeId)+'</td><td>'+esc(r.sku||'未提供')+'</td><td>'+esc(r.itemIds||'—')+'</td><td>'+esc(r.advertisingSource??'')+'</td><td>'+esc(r.missing.join('、'))+'</td><td>'+money(r.advertisingDifference??0)+'</td><td>'+money(r.advertisingNetDifference??0)+'</td></tr>').join('')}</tbody></table></div></details></section>
    <section class="panel profit-method"><details><summary>计算口径与费用来源</summary><p>按美国太平洋时间统计当月非取消 USD 订单。采购和头程使用成本表最新单价，乘数量后除以汇率。尾程和佣金优先使用订单行标准化 Payment 实际扣款，缺失时先用成本表的手填尾程和佣金率，再用全部历史 SKU 均值。站内广告和 SEM 按当月店铺 / 产品花费除销量后逐单分摊，SEM 再扣减设置比例。ITS 使用已获取预估的数量加权单价。缺失费用不扣除并标记，不能视为最终净利润；卖家责任已退款记录按退货月份扣减，商品残值为0，原销售成本不重复扣除；佣金优先实际返还，再用原订单佣金或SKU佣金率预估。税费尚未纳入。无账单的额外退货费用暂按0，实际账单按同订单/SKU全部已退款退货数量分摊。</p></details></section>`;

   result.querySelectorAll<HTMLButtonElement>('[data-profit-view]').forEach(button=>{
    button.onclick=()=>{
     const view=button.dataset.profitView as typeof detailView;
     if(view===detailView)return;
     detailView=view;page=1;query='';drawDetail();
    };
   });
   drawDetail();
   const search=result.querySelector<HTMLInputElement>('[data-search]')!;
   search.value=query;
   result.querySelector('details')!.open=detailsOpen;
   if(searchFocused)search.focus();
   if(!dirty)status.textContent=month+' · 上次核算 '+new Date(data.calculatedAt).toLocaleString('zh-CN')+' · USD'+(pending?' · 新设置等待后台核算':'');
  } catch(error) {
   if(!request.signal.aborted && active() && !background)status.textContent=String(error);
  } finally {
   if(refreshRequest===request)refreshRequest=undefined;
   if(!background)lock(false);
  }
 }

 async function refreshWhileOpen() {
  if(!active())return;
  if(monthInput.value && !document.hidden)await checkCalculation();
  if(active())window.setTimeout(refreshWhileOpen,pending||inProgress()?5_000:15_000);
 }

 lock(true);
 try {
  const data=await api('/settings');
  if(data)showSettings(data);
  else main.querySelector<HTMLDetailsElement>('[data-settings-panel]')!.open=true;
 } catch(error) {
  status.textContent=String(error);
  result.innerHTML='<section class="panel profit-empty">全局设置读取失败，请重新打开页面。</section>';
  return;
 } finally {
  lock(false);
 }
 if(active())window.setTimeout(refreshWhileOpen,pending||inProgress()?5_000:15_000);
}
