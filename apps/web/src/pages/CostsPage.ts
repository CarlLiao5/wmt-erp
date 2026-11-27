type Cost = {period:string;sku:string;upc:string;itemId:string;productName:string;purchaseCost:string;lingxingPurchaseCost?:string|null;lingxingPurchaseQuantity?:string|null;freightCost:string|null;lastMileAverage?:number|null;lastMileUnits?:number;commissionRate?:number|null;manualLastMile?:string|null;manualCommissionPercent?:string|null};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function renderCostsPage(main:HTMLElement) {
 main.classList.add('costs-page');
 main.innerHTML='<header><div><p class="eyebrow">管理员专属</p><h1>成本表</h1><p class="muted">采购与头程单价 · 金额币种沿用原表</p></div><div class="cost-header-actions"><button class="secondary" data-template>↓ 下载导入模板</button><button class="primary" data-new>＋ 手动录入</button></div></header><section class="panel"><div class="panel-head"><div><h2>Excel 导入</h2><p class="muted">按 SKU 更新已有记录，所有空白字段保留原值，填写 0 则更新为 0。新增 SKU 须填写采购单价，佣金率可填 15 或 15%。</p></div></div><form data-import class="cost-toolbar"><label>导入工作表<input name="sheet" value="成本表" maxlength="64" required></label><label>选择表格<input name="file" type="file" accept=".xlsx" required></label><button class="secondary">预览导入</button></form><div data-preview></div><p data-status role="status"></p></section><section class="panel"><div class="cost-toolbar"><h2>成本明细 <span data-total></span></h2><input data-search type="search" placeholder="搜索 SKU、品名、Item ID" aria-label="搜索成本"></div><div class="cost-scroll" data-list></div><div class="cost-toolbar"><button class="secondary" data-prev>上一页</button><span data-page></span><button class="secondary" data-next>下一页</button></div></section><dialog class="members-dialog" aria-labelledby="cost-title"></dialog>';
 const status=main.querySelector<HTMLElement>('[data-status]')!, list=main.querySelector<HTMLElement>('[data-list]')!, search=main.querySelector<HTMLInputElement>('[data-search]')!, dialog=main.querySelector<HTMLDialogElement>('dialog')!;
 let rows:Cost[]=[],page=1;
 let feeState: 'loading' | 'ready' | 'error' = 'loading';
 const fees = new Map<string, Pick<Cost, 'lastMileAverage' | 'lastMileUnits' | 'commissionRate'>>();
 const api=async(path='',init:RequestInit={})=>{const r=await fetch('/api/wfs-costs'+path,{credentials:'include',...init});const b=await r.json().catch(()=>null);if(!r.ok||!b)throw Error(b?.error?.message??'请求失败（HTTP '+r.status+'）');return b.data;};
 const money=(s:string)=>Number(s).toLocaleString('en-US',{maximumFractionDigits:6});
 const commissionCell = (row: Cost) => {
  const formatted = row.commissionRate == null
   ? (feeState === 'loading' ? '计算中…' : feeState === 'error' ? '读取失败' : '—')
   : new Intl.NumberFormat('zh-CN', {style:'percent', minimumFractionDigits:2, maximumFractionDigits:2}).format(row.commissionRate);
  return '<td class="cost-commission" title="全部历史 Payment 实际商品佣金 ÷ 对应商品销售额">'+formatted+'</td>';
 };
 const lingxingPurchaseCell = (row: Cost) => {
  if (row.lingxingPurchaseCost == null) return '<td>—</td>';
  const units = money(row.lingxingPurchaseQuantity ?? '0');
  return '<td title="已发货采购金额合计 ÷ 发货数量合计 · '+esc(units)+' 件">'
   +esc(money(row.lingxingPurchaseCost))+'</td>';
 };
 const table=(data:Cost[],edit=false)=>'<table class="data-table"><thead><tr>'+['SKU','UPC','Item ID','品名','出库采购单价','出库头程单价',...(edit?['尾程均价 (USD)','平均佣金率','领星加权采购单价 (CNY/件)']:[]),'手填尾程 (USD/件)','手填佣金率',...(edit?['操作']:[])].map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+data.map((r,i)=>'<tr>'+[r.sku,r.upc||'—',r.itemId||'—',r.productName||'—',money(r.purchaseCost),r.freightCost==null?'待补':money(r.freightCost)].map(v=>'<td title="'+esc(v)+'">'+esc(v)+'</td>').join('')+(edit?'<td title="'+esc('全部历史 Payment WFS 履约扣款 · 样本 '+(r.lastMileUnits??0)+' 件')+'">'+(r.lastMileAverage!=null?esc(money(String(r.lastMileAverage))):feeState==='loading'?'计算中…':feeState==='error'?'读取失败':'—')+'</td>'+commissionCell(r)+lingxingPurchaseCell(r):'')+
  '<td>'+(r.manualLastMile==null?'—':esc(String(Number(r.manualLastMile))))+'</td>'+
  '<td>'+(r.manualCommissionPercent==null?'—':esc(String(Number(r.manualCommissionPercent)))+'%')+'</td>'+
  (edit?'<td><button class="secondary" data-edit="'+i+'">调整</button></td>':'')+'</tr>').join('')+'</tbody></table>';
 function draw(){
  main.querySelector<HTMLElement>('[data-total]')!.textContent=rows.length+' 个 SKU';
  const query=search.value.trim().toLowerCase(),filtered=rows.filter(r=>[r.sku,r.productName,r.itemId,r.upc].some(v=>v.toLowerCase().includes(query)));
  const pages=Math.max(1,Math.ceil(filtered.length/30));page=Math.min(page,pages);
  const slice=filtered.slice((page-1)*30,page*30);
  list.innerHTML=slice.length?table(slice,true):'<div class="empty">暂无成本记录</div>';
  main.querySelector<HTMLElement>('[data-page]')!.textContent='第 '+page+' / '+pages+' 页 · 共 '+filtered.length+' 条';
  main.querySelector<HTMLButtonElement>('[data-prev]')!.disabled=page===1;
  main.querySelector<HTMLButtonElement>('[data-next]')!.disabled=page===pages;
  list.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(b=>b.onclick=()=>edit(slice[Number(b.dataset.edit)]));
 }
 async function load(){
  const costs: Cost[] = await api();
  rows = costs.map((row) => ({...row, ...fees.get(row.sku)}));
  draw();
 }
 async function loadFees(){
  try {
   const costs: Cost[] = await api('?lastMile=1');
   for (const {sku,lastMileAverage,lastMileUnits,commissionRate} of costs) fees.set(sku,{lastMileAverage,lastMileUnits,commissionRate});
   rows = rows.map((row) => ({...row, ...fees.get(row.sku)}));
   feeState = 'ready';
  } catch {
   feeState = 'error';
  }
  draw();
 }
 function edit(row?:Cost){
  const keys=['sku','upc','itemId','productName','purchaseCost','freightCost','manualLastMile','manualCommissionPercent'] as const,labels=['SKU','UPC','Item ID','品名','出库采购单价','出库头程单价','手填尾程（USD/件）','手填佣金率（%）'];
  dialog.innerHTML='<form><h2 id="cost-title">'+(row?'调整成本':'手动录入')+'</h2>'+keys.map((k,i)=>'<label>'+labels[i]+'<input name="'+k+'" value="'+esc(row?.[k]??'')+'" '+(i===0?'required '+(row?'readonly ':''):'')+(i>3?'type="number" min="0" step="any" '+(i===4?'required':i===7?'max="100"':''):'')+'></label>').join('')+'<p class="muted">手填费用仅在对应订单费用缺失时使用，留空可清除。佣金率如 15% 请填写 15。</p><p role="alert"></p><div class="member-dialog-actions"><button type="button" class="secondary">取消</button><button class="primary">保存</button></div></form>';
  dialog.querySelector<HTMLButtonElement>('[type=button]')!.onclick=()=>dialog.close();
  const form=dialog.querySelector('form')!;let busy=false;
  dialog.oncancel=e=>{if(busy)e.preventDefault();};
  form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const button=form.querySelector<HTMLButtonElement>('.primary')!;button.disabled=true;try{await api('',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(new FormData(form)),period:row?.period??rows[0]?.period??'current'})});dialog.close();await load();status.textContent='成本已保存';}catch(error){form.querySelector('p')!.textContent=String(error);}finally{busy=false;button.disabled=false;}};
  dialog.showModal();
 }
 main.querySelector<HTMLButtonElement>('[data-template]')!.onclick=async event=>{
  const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
  try{
   const response=await fetch('/api/wfs-costs/template',{credentials:'include'});
   if(!response.ok)throw Error('模板下载失败（HTTP '+response.status+'）');
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
   link.href=url;link.download='成本导入模板.xlsx';document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(error){status.textContent=String(error);}finally{button.disabled=false;}
 };
 main.querySelector<HTMLButtonElement>('[data-new]')!.onclick=()=>edit();
 search.oninput=()=>{page=1;draw();};
 main.querySelector<HTMLButtonElement>('[data-prev]')!.onclick=()=>{page--;draw();};
 main.querySelector<HTMLButtonElement>('[data-next]')!.onclick=()=>{page++;draw();};
 const form=main.querySelector<HTMLFormElement>('[data-import]')!,preview=main.querySelector<HTMLElement>('[data-preview]')!;
 form.onsubmit=async e=>{
  e.preventDefault();const data=new FormData(form),file=data.get('file') as File,sheet=String(data.get('sheet')).trim();
  const button=form.querySelector('button')!;button.disabled=true;preview.innerHTML='';status.textContent='正在核对表格…';
  try{
   const buffer=await file.arrayBuffer(),path='/import?sheet='+encodeURIComponent(sheet),init={method:'POST',headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:buffer};
   const result=await api(path,init);status.textContent='工作表「'+sheet+'」共 '+result.count+' 条：新增 '+result.inserted+' 条，更新 '+result.updated+' 条。空白字段保留原值；下方显示合并后的前 8 条。';
   preview.innerHTML='<div class="cost-scroll">'+table(result.rows.map((r:Cost)=>({...r,period:sheet})))+'</div><button class="primary" data-commit>确认导入 '+result.count+' 条</button>';
   preview.querySelector<HTMLButtonElement>('[data-commit]')!.onclick=async event=>{
    const commit=event.currentTarget as HTMLButtonElement;commit.disabled=true;
    try{const saved=await api(path+'&commit=1',init);status.textContent='已导入「'+sheet+'」：新增 '+saved.inserted+' 条，更新 '+saved.updated+' 条；空白字段已保留原值';preview.innerHTML='';await load();}catch(error){status.textContent=String(error);commit.disabled=false;}
   };
  }catch(error){status.textContent=String(error);}finally{button.disabled=false;}
 };
 try{await load();void loadFees();}catch(error){status.textContent=String(error);}
}
