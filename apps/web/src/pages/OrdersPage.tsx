type OrderLine = { id?: string; orderId: string; orderNumber?: string; storeId: string; sku: string; quantity: number; amount: number; status?: string; orderedAt?: string };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
export async function renderOrdersPage(main: HTMLElement, openDetail: (id: string) => void): Promise<void> {
  main.innerHTML = '<header><div><p class="eyebrow">订单管理</p><h1>Orders</h1></div></header><section class="panel"><form class="order-filters"><input name="orderNumber" placeholder="订单号"><input name="sku" placeholder="SKU"><input name="storeId" placeholder="店铺 ID"><select name="status"><option value="">全部状态</option><option>CREATED</option><option>SHIPPED</option><option>CANCELLED</option></select><input name="from" type="date"><input name="to" type="date"><button class="primary">筛选</button></form><div class="order-results">加载中...</div></section>';
  const form = main.querySelector<HTMLFormElement>('.order-filters')!;
  const load = async () => {
    const params = new URLSearchParams(); for (const [key, value] of new FormData(form)) if (value) params.set(key, String(value));
    const response = await fetch(`http://localhost:3000/api/orders?${params}`, { credentials: 'include' });
    const body = await response.json() as { data?: { lines: OrderLine[]; total: number }; error?: { message: string } };
    const target = main.querySelector<HTMLElement>('.order-results')!;
    if (!response.ok) { target.textContent = body.error?.message ?? '订单读取失败'; return; }
    const lines = body.data?.lines ?? [];
    target.innerHTML = `<p>${body.data?.total ?? 0} 条订单明细</p>${lines.length ? `<table><thead><tr><th>订单号</th><th>店铺</th><th>SKU</th><th>数量</th><th>金额</th><th>状态</th></tr></thead><tbody>${lines.map((line) => `<tr><td><button class="link" data-order-id="${escapeHtml(line.orderId)}">${escapeHtml(line.orderNumber ?? line.orderId)}</button></td><td>${escapeHtml(line.storeId)}</td><td>${escapeHtml(line.sku)}</td><td>${line.quantity}</td><td>${line.amount.toFixed(2)}</td><td>${escapeHtml(line.status)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">暂无订单</div>'}`;
    target.querySelectorAll<HTMLButtonElement>('[data-order-id]').forEach((button) => button.onclick = () => openDetail(button.dataset.orderId!));
  };
  form.onsubmit = (event) => { event.preventDefault(); void load(); };
  await load();
}
