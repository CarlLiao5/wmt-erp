type Detail = { id: string; lines: Array<{ id?: string; sku: string; quantity: number; amount: number; status?: string; customer?: Record<string, string> }> };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
export async function renderOrderDetailPage(main: HTMLElement, id: string, back: () => void): Promise<void> {
  main.innerHTML = '<header><div><p class="eyebrow">订单详情</p><h1>Order</h1></div></header><section class="panel">加载中...</section>';
  const response = await fetch(`http://localhost:3000/api/orders/${encodeURIComponent(id)}`, { credentials: 'include' });
  const body = await response.json() as { data?: Detail; error?: { message: string } };
  const panel = main.querySelector<HTMLElement>('.panel')!;
  if (!response.ok || !body.data) { panel.textContent = body.error?.message ?? '订单读取失败'; return; }
  panel.innerHTML = `<button class="link" id="back-orders">返回订单</button><h2>${escapeHtml(body.data.id)}</h2><table><thead><tr><th>SKU</th><th>数量</th><th>金额</th><th>状态</th></tr></thead><tbody>${body.data.lines.map((line) => `<tr><td>${escapeHtml(line.sku)}</td><td>${line.quantity}</td><td>${line.amount.toFixed(2)}</td><td>${escapeHtml(line.status)}</td></tr>`).join('')}</tbody></table>`;
  panel.querySelector<HTMLButtonElement>('#back-orders')!.onclick = back;
}
