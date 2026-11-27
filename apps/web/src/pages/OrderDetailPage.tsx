import { iconMarkup } from '../components/icons.js';
import { orderStatusMarkup } from './OrdersPage.js';
import './OrderDetailPage.css';

type DetailLine = { id?: string; orderId: string; orderNumber?: string; storeId: string; sku: string; itemId?: string; quantity: number; amount: number; orderedAt?: string; region?: string; status?: string; customer?: Record<string, string> };
export type OrderDetail = { id: string; lines: DetailLine[] };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const CUSTOMER_LABELS: Record<string, string> = { name: '姓名', email: '邮箱', phone: '电话' };

export function orderDetailMarkup(detail: OrderDetail): string {
  const first = detail.lines[0];
  const totalUnits = detail.lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalAmount = detail.lines.reduce((sum, line) => sum + line.amount, 0);
  const placedAt = first?.orderedAt ? new Date(first.orderedAt) : undefined;
  const utc = placedAt ? placedAt.toISOString().replace('T', ' ').replace('Z', ' UTC') : '—';
  const cn = placedAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, dateStyle: 'medium', timeStyle: 'medium' }).format(placedAt) : '—';
  const orderNumber = first?.orderNumber ?? detail.id;
  const customer = Object.entries(first?.customer ?? {});
  const fact = (label: string, value: string) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<div class="order-modal-head"><h2 id="order-modal-title">${escapeHtml(orderNumber)}</h2><button type="button" class="order-modal-copy" data-copy-order="${escapeHtml(orderNumber)}" aria-label="复制订单号">${iconMarkup('copy')}</button><span class="order-modal-copied" role="status" aria-live="polite"></span>${orderStatusMarkup(first?.status)}</div>`
    + `<p class="order-modal-id">内部 ID：${escapeHtml(detail.id)}</p>`
    + `<div class="order-modal-metrics"><article><span>订单金额</span><strong>$${totalAmount.toFixed(2)}</strong></article><article><span>商品总数</span><strong>${totalUnits}</strong></article><article><span>店铺</span><strong>${escapeHtml(first?.storeId ?? '—')}</strong></article><article><span>地区</span><strong>${escapeHtml(first?.region ?? '—')}</strong></article></div>`
    + `<div class="order-modal-sections"><section><h3>下单时间</h3><dl>${fact('UTC 时间', utc)}${fact('中国时间', escapeHtml(cn))}</dl></section><section><h3>客户信息</h3>${customer.length ? `<dl>${customer.map(([key, value]) => fact(escapeHtml(CUSTOMER_LABELS[key] ?? key), escapeHtml(value))).join('')}</dl>` : '<p class="muted">你的权限看不到客户信息</p>'}</section></div>`
    + `<section class="order-modal-lines"><h3>商品明细 <span class="muted">${detail.lines.length} 行</span></h3><div class="order-modal-table"><table><thead><tr><th>SKU</th><th>Item ID</th><th class="num">数量</th><th class="num">金额</th><th>状态</th></tr></thead><tbody>${detail.lines.map((line) => `<tr><td><strong>${escapeHtml(line.sku)}</strong></td><td>${escapeHtml(line.itemId ?? '—')}</td><td class="num">${line.quantity}</td><td class="num">$${line.amount.toFixed(2)}</td><td>${orderStatusMarkup(line.status)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

// The orders list stays mounted underneath, so closing the dialog puts people back exactly where they were.
export async function openOrderDetailModal(id: string): Promise<void> {
  document.querySelector('dialog.order-modal')?.remove();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = 'order-modal';
  dialog.setAttribute('aria-label', '订单详情');
  dialog.innerHTML = `<div class="order-modal-bar"><button type="button" class="order-modal-close" aria-label="关闭">${iconMarkup('close', 18)}</button></div><div class="order-modal-body"></div>`;
  const body = dialog.querySelector<HTMLElement>('.order-modal-body')!;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.order-modal-close')!.onclick = () => dialog.close();
  // The dialog has no padding of its own, so a click that lands on it is a click on the backdrop.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); });

  const load = async () => {
    body.innerHTML = '<div class="loading">正在加载订单…</div>';
    try {
      const response = await fetch(`http://localhost:3000/api/orders/${encodeURIComponent(id)}`, { credentials: 'include' });
      const payload = await response.json() as { data?: OrderDetail; error?: { message: string } };
      if (!dialog.isConnected) return;
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? '订单读取失败');
      body.innerHTML = orderDetailMarkup(payload.data);
      const copy = body.querySelector<HTMLButtonElement>('[data-copy-order]');
      copy?.addEventListener('click', async () => {
        const note = body.querySelector<HTMLElement>('.order-modal-copied')!;
        try { await navigator.clipboard.writeText(copy.dataset.copyOrder ?? ''); note.textContent = '已复制'; copy.innerHTML = iconMarkup('check'); }
        catch { note.textContent = '复制失败，请手动选中订单号'; }
        window.setTimeout(() => { note.textContent = ''; copy.innerHTML = iconMarkup('copy'); }, 1600);
      });
    } catch (error) {
      if (!dialog.isConnected) return;
      body.innerHTML = `<div class="empty error">${escapeHtml(error instanceof Error ? error.message : '订单读取失败')}<br><button type="button" class="secondary" data-retry>重试</button></div>`;
      body.querySelector<HTMLButtonElement>('[data-retry]')!.onclick = () => void load();
    }
  };
  await load();
}
