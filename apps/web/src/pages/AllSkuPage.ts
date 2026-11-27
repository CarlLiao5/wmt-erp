type SmartSheetRow = { sourceRowId: string; payload: Record<string, unknown>; syncedAt: string; updatedAt: string };
type AllSkuResponse = { data?: { rows?: SmartSheetRow[]; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }; error?: { message?: string } };

const escape = (value: unknown) => String(value ?? '—').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
function display(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(display).filter((part) => part !== '—').join(', ') || '—';
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return display(item.text ?? item.value ?? item.name ?? item.userName ?? JSON.stringify(value));
  }
  return String(value);
}
function fields(payload: Record<string, unknown>): Record<string, unknown> {
  const values = payload.values;
  return values && typeof values === 'object' && !Array.isArray(values) ? values as Record<string, unknown> : payload;
}

export async function renderAllSkuPage(root: HTMLElement): Promise<void> {
  root.innerHTML = '<header><div><p class="eyebrow">企微智能文档</p><h1>ALLSKU2026 商品表</h1><p class="muted">已同步到 ERP 的商品记录</p></div></header><section class="panel"><form class="allsku-filters"><input name="search" type="search" placeholder="搜索商品字段或源记录 ID" aria-label="搜索 ALLSKU 记录"><button class="primary" type="submit">搜索</button><button class="secondary" type="button" data-reset-allsku>重置</button></form><div class="allsku-sync-meta" data-allsku-meta></div><div class="allsku-table-scroll" data-allsku-results>加载中...</div><div class="allsku-pagination" data-allsku-pagination></div></section>';
  const form = root.querySelector<HTMLFormElement>('.allsku-filters')!;
  const results = root.querySelector<HTMLElement>('[data-allsku-results]')!;
  const pagination = root.querySelector<HTMLElement>('[data-allsku-pagination]')!;
  const meta = root.querySelector<HTMLElement>('[data-allsku-meta]')!;
  let page = 1;
  const load = async () => {
    results.textContent = '加载中...';
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', search: String(new FormData(form).get('search') ?? '') });
      const response = await fetch(`/api/smartsheet/allsku2026?${params}`, { credentials: 'include' });
      const body = await response.json() as AllSkuResponse;
      if (!response.ok) throw new Error(body.error?.message ?? 'ALLSKU 数据读取失败');
      const rows = body.data?.rows ?? [];
      const paging = body.data?.pagination ?? { page: 1, pageSize: 20, total: rows.length, totalPages: 1 };
      const columns = [...new Set(rows.flatMap((row) => Object.keys(fields(row.payload))))];
      meta.textContent = `共 ${paging.total} 条记录 · 每页 ${paging.pageSize} 条`;
      if (!rows.length) results.innerHTML = '<div class="empty">暂无已同步的 ALLSKU2026 记录</div>';
      else {
        const headers = ['源记录 ID', ...columns, '最近同步'];
        results.innerHTML = `<table class="data-table"><thead><tr>${headers.map((header) => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => { const values = fields(row.payload); return `<tr><td><code>${escape(row.sourceRowId)}</code></td>${columns.map((column) => `<td title="${escape(display(values[column]))}">${escape(display(values[column]))}</td>`).join('')}<td>${escape(new Date(row.syncedAt).toLocaleString('zh-CN'))}</td></tr>`; }).join('')}</tbody></table>`;
      }
      pagination.innerHTML = `<button class="secondary" type="button" data-allsku-prev ${paging.page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${paging.page} / ${paging.totalPages} 页</span><button class="secondary" type="button" data-allsku-next ${paging.page >= paging.totalPages ? 'disabled' : ''}>下一页</button>`;
      pagination.querySelector<HTMLButtonElement>('[data-allsku-prev]')!.onclick = () => { if (page > 1) { page -= 1; void load(); } };
      pagination.querySelector<HTMLButtonElement>('[data-allsku-next]')!.onclick = () => { if (page < paging.totalPages) { page += 1; void load(); } };
    } catch (error) { results.innerHTML = `<div class="empty error">${escape(error instanceof Error ? error.message : 'ALLSKU 数据读取失败')}</div>`; meta.textContent = ''; pagination.innerHTML = ''; }
  };
  form.onsubmit = (event) => { event.preventDefault(); page = 1; void load(); };
  form.querySelector<HTMLButtonElement>('[data-reset-allsku]')!.onclick = () => { form.reset(); page = 1; void load(); };
  await load();
}
