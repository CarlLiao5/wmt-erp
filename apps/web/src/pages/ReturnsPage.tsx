type ReturnRow = { id: string; orderId: string; storeId: string; sku: string; status: string; amount: number; returnedAt?: string };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
export async function renderReturnsPage(main: HTMLElement): Promise<void> {
  main.innerHTML = '<header><div><p class="eyebrow">退货管理</p><h1>Returns</h1></div></header><section class="panel"><form class="return-filters"><input name="orderNumber" placeholder="订单号"><input name="itemId" placeholder="Item ID"><input name="storeId" placeholder="店铺 ID"><input name="sku" placeholder="SKU"><select name="status"><option value="">全部状态</option><option>REFUNDED</option><option>REQUESTED</option><option>REJECTED</option></select><input name="from" type="date"><input name="to" type="date"><button class="primary">筛选</button></form><div class="return-results">加载中...</div><div class="pagination"><button type="button" data-page="previous" aria-label="上一页">‹</button><span class="page-label"></span><button type="button" data-page="next" aria-label="下一页">›</button></div></section>';
  const form = main.querySelector<HTMLFormElement>('.return-filters')!;
  let currentPage = 1;
  const load = async () => {
    const params = new URLSearchParams(); for (const [key, value] of new FormData(form)) if (value) params.set(key, String(value));
    params.set('page', String(currentPage));
    const response = await fetch(`http://localhost:3000/api/returns?${params}`, { credentials: 'include' });
    const body = await response.json() as { data?: { rows: ReturnRow[]; total: number; pageSize: number }; error?: { message: string } };
    const target = main.querySelector<HTMLElement>('.return-results')!;
    if (!response.ok) { target.textContent = body.error?.message ?? '退货读取失败'; return; }
    const rows = body.data?.rows ?? [];
    target.innerHTML = `<p>${body.data?.total ?? 0} 条退货明细</p>${rows.length ? `<table><thead><tr><th>退货号</th><th>订单号</th><th>店铺</th><th>SKU</th><th>退款</th><th>状态</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.orderId)}</td><td>${escapeHtml(row.storeId)}</td><td>${escapeHtml(row.sku)}</td><td>${row.amount.toFixed(2)}</td><td>${escapeHtml(row.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无退货</div>'}`;
    const pageCount = Math.max(1, Math.ceil((body.data?.total ?? 0) / (body.data?.pageSize ?? 20)));
    main.querySelector<HTMLElement>('.page-label')!.textContent = `${currentPage} / ${pageCount}`;
    main.querySelector<HTMLButtonElement>('[data-page="previous"]')!.disabled = currentPage <= 1;
    main.querySelector<HTMLButtonElement>('[data-page="next"]')!.disabled = currentPage >= pageCount;
  };
  form.onsubmit = (event) => { event.preventDefault(); currentPage = 1; void load(); };
  main.querySelector<HTMLButtonElement>('[data-page="previous"]')!.onclick = () => { currentPage--; void load(); };
  main.querySelector<HTMLButtonElement>('[data-page="next"]')!.onclick = () => { currentPage++; void load(); };
  await load();
}
