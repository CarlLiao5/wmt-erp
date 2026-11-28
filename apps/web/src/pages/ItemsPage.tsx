import { iconMarkup } from '../components/icons.js';
import { productImageMarkup } from '../components/ProductImage.js';
import './ItemsPage.css';

export interface Item { id: string; storeId: string; sku: string; title?: string; chineseName?: string; itemId?: string; ownerId?: string | null; ownerName?: string | null; updatedAt?: string | Date; description?: string; brand?: string; productType?: string; lifecycleStatus?: string; publishedStatus?: string; availability?: string; gtin?: string; variantGroupId?: string; imageUrl?: string; isDuplicate?: boolean; isCustomerFavorite?: boolean; details?: Record<string, unknown>; reportFields?: Record<string, string>; }
const esc=(value: unknown) => String(value ?? '—').replace(/[&<>\"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char] ?? char));
const dateText=(value: unknown) => value ? new Date(String(value)).toLocaleString('zh-CN') : '—';
const dayText=(value: unknown) => { if (!value) return '—'; const d = new Date(String(value)); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('zh-CN'); };
const PUBLISH_LABELS: Record<string, { label: string; tone: string }> = {
  PUBLISHED: { label: '已发布', tone: '' },
  UNPUBLISHED: { label: '未发布', tone: 'neutral' },
  SYSTEM_PROBLEM: { label: '系统问题', tone: 'danger' },
};
export function publishedStatusMarkup(status?: string): string {
  const raw = String(status ?? '').trim();
  if (!raw) return '<span class="muted">—</span>';
  const known = PUBLISH_LABELS[raw.toUpperCase()];
  return `<span class="status-pill${known?.tone ? ` ${known.tone}` : known ? '' : ' neutral'}">${esc(known?.label ?? raw)}</span>`;
}
const imageFrom=(item: Item) => { if (item.imageUrl) return item.imageUrl; const d=item.details ?? {}; const candidates=[d.imageUrl,d.image,d.mainImageUrl,d.productImage,d.primaryImage,d.imageURL]; const nested=[d.images,d.imageUrls,d.productImages]; for(const value of [...candidates,...nested.flatMap((v)=>Array.isArray(v)?v:[])]) if(typeof value==='string' && /^https?:\/\//.test(value)) return value; return undefined; };
export function renderItemsPage(root: HTMLElement, items: Item[] = []): void {
  const rows = items.slice();
  let statusFilter: 'all' | 'published' | 'unpublished' = 'all';
  root.innerHTML = `<header><div><h1>商品</h1><p class="muted">按 SKU、名称、Item ID 或负责人查找商品，点击一行查看详情</p></div></header><section class="item-metrics"><button type="button" class="item-metric-card" data-status-card="all" aria-pressed="true"><span>全部 SKU</span><strong data-metric="total">0</strong></button><button type="button" class="item-metric-card" data-status-card="published" aria-pressed="false"><span>已发布</span><strong data-metric="published">0</strong></button><button type="button" class="item-metric-card" data-status-card="unpublished" aria-pressed="false"><span>未发布</span><strong data-metric="unpublished">0</strong></button></section><section class="panel"><form class="items-filters"><input name="query" placeholder="按 SKU、商品名称、中文品名、Item ID 或负责人筛选" aria-label="筛选商品"><select name="store"><option value="">全部店铺</option>${[...new Set(rows.map((item) => item.storeId))].sort().map((store) => `<option value="${esc(store)}">${esc(store)}</option>`).join('')}</select><button class="primary">筛选</button><button type="button" data-reset>重置</button></form><div class="panel-head"><h2>SKU 列表</h2><span data-count>${rows.length} 个</span></div><div class="item-results"></div></section>`;
  const results = root.querySelector<HTMLElement>('.item-results')!;
  const form = root.querySelector<HTMLFormElement>('.items-filters')!;
  const pageSize = 20;
  let currentPage = 1;
  const draw = () => {
    const values = new FormData(form); const query = String(values.get('query') ?? '').trim().toLowerCase(); const store = String(values.get('store') ?? '');
    const baseFiltered = rows.filter((item) => (!store || item.storeId === store) && (!query || [item.sku, item.title, item.chineseName, item.itemId, item.ownerName, item.ownerId].map((value) => String(value ?? '').toLowerCase()).some((value) => value.includes(query))));
    const published = baseFiltered.filter((item) => String(item.publishedStatus ?? '').toUpperCase() === 'PUBLISHED');
    const filtered = statusFilter === 'published' ? published : statusFilter === 'unpublished' ? baseFiltered.filter((item) => String(item.publishedStatus ?? '').toUpperCase() !== 'PUBLISHED') : baseFiltered;
    root.querySelector('[data-metric="total"]')!.textContent = String(baseFiltered.length);
    root.querySelector('[data-metric="published"]')!.textContent = String(published.length);
    root.querySelector('[data-metric="unpublished"]')!.textContent = String(baseFiltered.length - published.length);
    root.querySelectorAll<HTMLElement>('[data-status-card]').forEach((card) => { const on = card.dataset.statusCard === statusFilter; card.classList.toggle('active', on); card.setAttribute('aria-pressed', String(on)); });
    root.querySelector('[data-count]')!.textContent = `${filtered.length} 个`;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    results.innerHTML = filtered.length ? `<div class="item-table-wrap"><table class="data-table item-table"><thead><tr><th>商品</th><th>Item ID</th><th>类型 / 品牌</th><th>状态</th><th>负责人</th><th>更新</th></tr></thead><tbody>${pageItems.map((item) => `<tr data-item-id="${esc(item.id)}" tabindex="0" aria-label="查看 ${esc(item.sku)} 详情"><td><div class="item-cell"><div class="item-thumb-cell">${productImageMarkup(imageFrom(item), item.title ?? item.sku)}</div><div class="item-cell-text"><strong>${esc(item.sku)}</strong>${item.chineseName ? `<span class="item-cn">${esc(item.chineseName)}</span>` : ''}<span class="item-title" title="${esc(item.title)}">${esc(item.title ?? '未提供名称')}</span></div></div></td><td class="item-id">${esc(item.itemId)}</td><td><div class="item-type">${esc(item.productType)}</div><div class="item-brand">${esc(item.brand)}</div></td><td>${publishedStatusMarkup(item.publishedStatus)}</td><td>${item.ownerName ?? item.ownerId ? esc(item.ownerName ?? item.ownerId) : '<span class="muted">未分配</span>'}</td><td class="item-updated" title="${esc(dateText(item.updatedAt))}">${esc(dayText(item.updatedAt))}</td></tr>`).join('')}</tbody></table></div><nav class="item-pagination" aria-label="SKU 列表分页"><button type="button" data-item-prev aria-label="上一页" ${currentPage === 1 ? 'disabled' : ''}>${iconMarkup('chevron-left')}</button><span>第 ${currentPage} / ${totalPages} 页，共 ${filtered.length} 个商品</span><button type="button" data-item-next aria-label="下一页" ${currentPage === totalPages ? 'disabled' : ''}>${iconMarkup('chevron-right')}</button></nav>` : '<div class="empty">没有匹配的商品，试试换个关键词或清除店铺筛选</div>';
    results.querySelectorAll<HTMLTableRowElement>('tr[data-item-id]').forEach((row) => { const open = () => { const item=filtered.find((candidate) => candidate.id === row.dataset.itemId); if (item) openItemDialog(item); }; row.onclick = open; row.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }; });
    results.querySelector<HTMLButtonElement>('[data-item-prev]')?.addEventListener('click', () => { if (currentPage > 1) { currentPage--; draw(); } });
    results.querySelector<HTMLButtonElement>('[data-item-next]')?.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; draw(); } });
  };
  form.onsubmit = (event) => { event.preventDefault(); currentPage = 1; draw(); };
  form.querySelector<HTMLButtonElement>('[data-reset]')!.onclick = () => { form.reset(); statusFilter = 'all'; currentPage = 1; draw(); };
  root.querySelectorAll<HTMLButtonElement>('[data-status-card]').forEach((card) => { card.onclick = () => { statusFilter = card.dataset.statusCard as typeof statusFilter; currentPage = 1; draw(); }; });
  draw();
}

function openItemDialog(item: Item): void {
  document.querySelector('dialog.item-modal')?.remove();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const image = imageFrom(item);
  const fact = (label: string, value: unknown) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`;
  const reportRows = Object.entries(item.reportFields ?? {}).map(([name, value]) => fact(esc(name), value)).join('');
  const dialog = document.createElement('dialog');
  dialog.className = 'item-modal';
  dialog.setAttribute('aria-label', `${item.sku} 商品详情`);
  dialog.innerHTML = `<div class="item-modal-bar"><button type="button" class="item-modal-close" aria-label="关闭">${iconMarkup('close', 18)}</button></div><div class="item-modal-body"><div class="item-modal-top">${image ? `<img class="item-modal-image" src="${esc(image)}" alt="${esc(item.title ?? item.sku)}">` : `<div class="item-modal-image item-modal-image-empty">${iconMarkup('image', 28)}</div>`}<div class="item-modal-heading"><h2>${esc(item.sku)}</h2>${item.chineseName ? `<p class="item-modal-cn">${esc(item.chineseName)}</p>` : ''}<p class="muted">${esc(item.title ?? '未提供名称')}</p><div class="item-modal-status">${publishedStatusMarkup(item.publishedStatus)}</div></div></div><div class="item-modal-grid">${fact('Item ID', item.itemId)}${fact('店铺', item.storeId)}${fact('GTIN', item.gtin)}${fact('商品类型', item.productType)}${fact('品牌', item.brand)}${fact('可售状态', item.availability)}${fact('生命周期', item.lifecycleStatus)}${fact('负责人', item.ownerName ?? item.ownerId ?? '未分配')}${fact('更新时间', dateText(item.updatedAt))}</div>${item.description ? `<section class="item-modal-section"><h3>商品描述</h3><p>${esc(item.description)}</p></section>` : ''}${reportRows ? `<section class="item-modal-section"><h3>Walmart 商品报告</h3><div class="item-modal-grid">${reportRows}</div></section>` : ''}</div>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.item-modal-close')!.onclick = () => dialog.close();
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { dialog.remove(); opener?.focus(); });
}
