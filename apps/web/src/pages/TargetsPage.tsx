import { productImageMarkup } from '../components/ProductImage.js';
import './TargetsPage.css';
// Completion tone: reached target, on the way, or well behind.
const rateTone = (rate: number | null): string => rate == null ? 'none' : rate >= 1 ? 'good' : rate >= 0.6 ? 'mid' : 'low';

type TargetRow = Record<string, unknown> & {
  storeId?: string;
  sku?: string;
  itemId?: string | null;
  productName?: string | null;
  ownerName?: string | null;
  amountTarget?: string | number | null;
  sellingDays?: string | number | null;
  expectedDailySales?: string | number | null;
  quantityTarget?: string | number | null;
  completedSales?: number;
  completedUnits?: number;
  actualUnits?: number;
  imageUrl?: string | null;
};

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const monthInPacific = (): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
};
const currency = (value: number | null): string => value == null ? '暂无目标' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const numberValue = (value: unknown): number | null => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export async function renderTargetsPage(main: HTMLElement, role: 'admin' | 'member' = 'admin'): Promise<void> {
  const month = monthInPacific();
  const admin = role === 'admin';
  main.innerHTML = `
    <header class="targets-header">
      <div><p class="eyebrow">经营目标</p><h1>Targets</h1><p class="muted">按负责人跟进定版目标与当月销售完成情况</p></div>
      <div class="targets-header-actions">
        <label class="target-month-field">目标月份<input type="month" data-month value="${month}"></label>
        ${admin ? '<button class="primary" data-init type="button">初始化 SKU 目标</button>' : ''}
      </div>
    </header>
    <section class="target-metrics${admin ? ' has-draft-metric' : ''}" data-metrics aria-label="目标完成概览">
      <article><span>筛选后目标金额</span><strong data-metric-target>加载中</strong><small>仅统计已定版金额目标</small></article>
      <article><span>匹配订单销售额</span><strong data-metric-sales>加载中</strong><small>按店铺与 SKU 归属</small></article>
      <article class="target-rate-card"><span>完成率</span><strong data-metric-rate>加载中</strong><div class="target-rate-track"><i data-metric-rate-bar style="width:0%"></i></div><small data-metric-count>等待目标数据</small></article>
      ${admin ? '<article><span>草稿目标总额</span><strong data-metric-draft>加载中</strong><small data-metric-draft-count>读取草稿目标</small></article>' : ''}
    </section>
    <section class="targets-filter-bar" aria-label="搜索和筛选">
      <label class="targets-search-field"><span>搜索 SKU 或产品</span><input data-search type="search" placeholder="SKU、产品名称或 Item ID" autocomplete="off"></label>
      <label><span>店铺</span><select data-store><option value="">全部店铺</option></select></label>
      <label><span>负责人</span><select data-owner><option value="">全部负责人</option></select></label>
      <button class="secondary" data-clear type="button" hidden>清除筛选</button>
    </section>
    <section class="target-owner-panel" aria-labelledby="target-owner-title">
      <div class="target-section-heading"><div><p class="eyebrow">负责人表现</p><h2 id="target-owner-title">目标与完成情况</h2></div><span class="target-data-note" data-performance-note>正在读取定版目标...</span></div>
      <div class="target-owner-chart" data-owner-chart aria-live="polite"><div class="empty">正在加载负责人数据...</div></div>
    </section>
    <section class="target-detail-panel">
      <div class="target-section-heading target-list-heading"><div><p class="eyebrow">SKU 明细</p><h2>目标清单</h2></div><div class="target-list-controls"><div class="target-view-switch" role="group" aria-label="目标视图"><button type="button" data-view="planning" aria-pressed="false">目标制定</button><button type="button" data-view="tracking" aria-pressed="true">完成跟踪</button></div><span class="target-data-note" data-row-count></span></div></div>
      <div class="target-table-wrap" data-table><div class="empty">正在读取目标...</div></div>
    </section>
    ${admin ? `<details class="target-admin-tools"><summary>月度目标调整与定版</summary><div class="target-admin-content"><div class="monthly-target-status" data-status>正在读取当前月份目标...</div><ul class="target-import-errors" data-import-errors hidden></ul><div class="monthly-target-actions" data-actions hidden><button data-export type="button">导出带公式 Excel</button><button data-revision type="button" hidden>创建修订草稿</button><label class="file-button">上传调整后的 Excel<input data-file type="file" accept=".xlsx" hidden></label><button data-preview type="button" disabled>预览调整</button><button class="primary" data-finalize type="button" disabled>定版目标</button></div></div></details>` : ''}`;

  const monthInput = main.querySelector<HTMLInputElement>('[data-month]')!;
  const searchInput = main.querySelector<HTMLInputElement>('[data-search]')!;
  const storeSelect = main.querySelector<HTMLSelectElement>('[data-store]')!;
  const ownerSelect = main.querySelector<HTMLSelectElement>('[data-owner]')!;
  const table = main.querySelector<HTMLElement>('[data-table]')!;
  const chart = main.querySelector<HTMLElement>('[data-owner-chart]')!;
  const status = main.querySelector<HTMLElement>('[data-status]');
  const importErrors = main.querySelector<HTMLUListElement>('[data-import-errors]');
  const performanceNote = main.querySelector<HTMLElement>('[data-performance-note]')!;
  const rowCount = main.querySelector<HTMLElement>('[data-row-count]')!;
  let batchId = '';
  let editorRows: TargetRow[] = [];
  let performanceRows: TargetRow[] = [];
  let finalized = false;
  let editorStatus = '';
  let previewRows: TargetRow[] = [];
  let view: 'planning' | 'tracking' = 'tracking';
  let sortKey = '';
  let sortDirection: 'asc' | 'desc' = 'desc';

  table.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-basis-toggle]');
    if (!button) return;
    const content = button.parentElement?.querySelector<HTMLElement>('.target-basis-content');
    if (!content) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    button.textContent = expanded ? '查看依据' : '收起依据';
    content.hidden = expanded;
  });

  const activeStore = () => storeSelect.value;
  const activeOwner = () => ownerSelect.value;
  const searchMatches = (row: TargetRow) => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    if (!query) return true;
    return [row.sku, row.productName, row.itemId].some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
  };
  const matchesFilters = (row: TargetRow) => (!activeStore() || row.storeId === activeStore())
    && (!activeOwner() || (row.ownerName?.trim() || '未分配负责人') === activeOwner())
    && searchMatches(row);

  const renderOptions = () => {
    const previousStore = activeStore();
    const previousOwner = activeOwner();
    const optionsRows = [...performanceRows, ...editorRows];
    const stores = [...new Set(optionsRows.map((row) => row.storeId).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
    const owners = [...new Set(optionsRows.map((row) => row.ownerName?.trim() || '未分配负责人'))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    storeSelect.innerHTML = `<option value="">全部店铺</option>${stores.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    ownerSelect.innerHTML = `<option value="">全部负责人</option>${owners.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    if (stores.includes(previousStore)) storeSelect.value = previousStore;
    if (owners.includes(previousOwner)) ownerSelect.value = previousOwner;
    const hasFilters = Boolean(searchInput.value.trim() || storeSelect.value || ownerSelect.value);
    main.querySelector<HTMLButtonElement>('[data-clear]')!.hidden = !hasFilters;
  };

  const filteredPerformance = () => performanceRows.filter(matchesFilters);
  const filteredEditor = () => editorRows.filter(matchesFilters);

  const renderMetrics = () => {
    const rows = filteredPerformance();
    const targetValues = rows.map((row) => numberValue(row.amountTarget)).filter((value): value is number => value != null);
    const target = finalized && targetValues.length ? targetValues.reduce((sum, value) => sum + value, 0) : null;
    const completed = finalized ? rows.reduce((sum, row) => sum + (numberValue(row.completedSales) ?? 0), 0) : null;
    const rate = target != null && target > 0 && completed != null ? completed / target : null;
    main.querySelector<HTMLElement>('[data-metric-target]')!.textContent = currency(target);
    main.querySelector<HTMLElement>('[data-metric-sales]')!.textContent = completed == null ? '暂无数据' : currency(completed);
    main.querySelector<HTMLElement>('[data-metric-rate]')!.textContent = rate == null ? '暂无目标' : `${(rate * 100).toFixed(1)}%`;
    const rateBar = main.querySelector<HTMLElement>('[data-metric-rate-bar]')!;
    rateBar.style.width = `${rate == null ? 0 : Math.min(100, rate * 100)}%`;
    rateBar.dataset.tone = rateTone(rate);
    main.querySelector<HTMLElement>('[data-metric-count]')!.textContent = finalized ? `${rows.length} 个匹配 SKU` : '等待目标定版';
    if (admin) {
      const draftValues = editorRows.map((row) => numberValue(row.amountTarget)).filter((value): value is number => value != null);
      const draftTotal = editorStatus === 'draft' && draftValues.length ? draftValues.reduce((sum, value) => sum + value, 0) : null;
      main.querySelector<HTMLElement>('[data-metric-draft]')!.textContent = editorStatus === 'draft' ? currency(draftTotal) : '暂无草稿';
      main.querySelector<HTMLElement>('[data-metric-draft-count]')!.textContent = editorStatus === 'draft' ? `${editorRows.length} 个 SKU · ${editorRows.length - draftValues.length} 个缺少金额目标` : '当前没有草稿批次';
    }
  };

  const renderChart = () => {
    const rows = filteredPerformance();
    if (!finalized || !rows.length) {
      chart.innerHTML = `<div class="empty">${finalized ? '没有符合当前筛选条件的 SKU 目标' : '本月还没有已定版目标'}</div>`;
      return;
    }
    const groups = new Map<string, { target: number; targetRows: number; sales: number; skus: number }>();
    for (const row of rows) {
      const owner = row.ownerName?.trim() || '未分配负责人';
      const group = groups.get(owner) ?? { target: 0, targetRows: 0, sales: 0, skus: 0 };
      const rowTarget = numberValue(row.amountTarget);
      if (rowTarget != null) { group.target += rowTarget; group.targetRows += 1; }
      group.sales += numberValue(row.completedSales) ?? 0;
      group.skus += 1;
      groups.set(owner, group);
    }
    const values = [...groups].sort((a, b) => b[1].target - a[1].target || b[1].sales - a[1].sales || a[0].localeCompare(b[0], 'zh-CN'));
    const max = Math.max(1, ...values.flatMap(([, value]) => [value.targetRows ? value.target : 0, value.sales]));
    chart.innerHTML = values.map(([owner, value]) => {
      const target = value.targetRows ? value.target : null;
      const targetWidth = Math.max(0, Math.min(100, (target ?? 0) / max * 100));
      const salesWidth = Math.max(0, Math.min(100, value.sales / max * 100));
      const rate = target != null && target > 0 ? value.sales / target : null;
      const rateText = rate == null ? '暂无目标' : `${(rate * 100).toFixed(1)}%`;
      return `<article class="target-owner-row"><div class="target-owner-info"><strong>${escapeHtml(owner)}</strong><small>${value.skus} 个 SKU</small></div><span class="target-rate-chip" data-tone="${rateTone(rate)}">${rateText}</span><div class="target-owner-bars"><div class="target-owner-bar-line"><span>目标</span><div class="target-owner-track"><i class="is-target" style="width:${targetWidth}%"></i></div><b>${escapeHtml(currency(target))}</b></div><div class="target-owner-bar-line"><span>完成</span><div class="target-owner-track"><i class="is-complete" style="width:${salesWidth}%"></i></div><b>${escapeHtml(currency(value.sales))}</b></div></div></article>`;
    }).join('');
  };

  const displayValue = (row: TargetRow, key: string) => {
    const value = row[key];
    return value == null || value === '' ? '暂无数据' : String(value);
  };
  const cellMarkup = (row: TargetRow, key: string) => {
    if (key === 'imageUrl') return productImageMarkup(row.imageUrl, row.productName ?? row.sku);
    if (key === 'productName') {
      const name = displayValue(row, key);
      return `<span class="target-product-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    }
    return escapeHtml(displayValue(row, key));
  };
  const renderTable = () => {
    const sourceRows = view === 'planning' && admin ? filteredEditor() : filteredPerformance();
    const totalRows = view === 'planning' && admin ? editorRows.length : performanceRows.length;
    rowCount.textContent = sourceRows.length ? `显示 ${sourceRows.length} / ${totalRows} 个 SKU` : '';
    const rows = [...sourceRows].sort((a, b) => {
      if (!sortKey) return 0;
      const valueFor = (row: TargetRow) => sortKey === 'unitsRate'
        ? (numberValue(row.quantityTarget) ? (numberValue(row.completedUnits ?? row.actualUnits) ?? 0) / numberValue(row.quantityTarget)! : null)
        : sortKey === 'salesRate'
          ? (numberValue(row.amountTarget) ? (numberValue(row.completedSales) ?? 0) / numberValue(row.amountTarget)! : null)
          : row[sortKey];
      const left = valueFor(a); const right = valueFor(b);
      const leftNumber = numberValue(left); const rightNumber = numberValue(right);
      let result: number;
      if (leftNumber != null || rightNumber != null) {
        if (leftNumber == null) return 1;
        if (rightNumber == null) return -1;
        result = leftNumber - rightNumber;
      }
      else result = String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN');
      return sortDirection === 'asc' ? result : -result;
    });
    const bindSortButtons = () => table.querySelectorAll<HTMLButtonElement>('[data-sort-key]').forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sortKey ?? '';
      if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDirection = 'desc'; }
      renderTable();
    }));
    if (!rows.length) {
      const hasRows = view === 'planning' && admin ? editorRows.length : performanceRows.length;
      table.innerHTML = `<div class="empty">${hasRows ? '没有符合当前筛选条件的目标' : (view === 'planning' && admin ? '暂无目标数据，请初始化 SKU 目标' : '本月暂无已定版目标')}</div>`;
      return;
    }
    const planningColumns = [
      ['图片', 'imageUrl'], ['店铺', 'storeId'], ['SKU', 'sku'], ['品名', 'productName'], ['负责人', 'ownerName'],
      ['在库', 'inventoryQuantity'], ['上月日均销量', 'lastMonthAvgDailySales'], ['上月均价', 'lastMonthAvgPrice'],
      ['预计日销', 'expectedDailySales'], ['销售天数', 'sellingDays'], ['数量目标', 'quantityTarget'], ['金额目标', 'amountTarget'],
    ] as const;
    const percent = (actual: unknown, target: unknown) => {
      const actualValue = numberValue(actual);
      const targetValue = numberValue(target);
      return actualValue == null || targetValue == null || targetValue <= 0 ? '暂无目标' : `${(actualValue / targetValue * 100).toFixed(1)}%`;
    };
    if (view === 'planning') {
      table.innerHTML = `<table class="target-table monthly-target-table"><thead><tr>${planningColumns.map(([label, key]) => `<th>${key === 'imageUrl' ? label : `<button type="button" class="target-sort" data-sort-key="${key}" aria-label="按${label}排序">${label}${sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button>`}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${planningColumns.map(([, key]) => `<td>${cellMarkup(row, key)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      bindSortButtons();
      return;
    }
    const trackingColumns = [
      ['图片', 'imageUrl'], ['店铺', 'storeId'], ['SKU', 'sku'], ['品名', 'productName'], ['负责人', 'ownerName'],
      ['数量目标', 'quantityTarget'], ['实际销量', 'completedUnits'], ['销量完成率', 'unitsRate'],
      ['金额目标', 'amountTarget'], ['完成销售额', 'completedSales'], ['销售额完成率', 'salesRate'],
    ] as const;
    table.innerHTML = `<table class="target-table monthly-target-table target-tracking-table"><thead><tr>${trackingColumns.map(([label, key]) => `<th>${key === 'imageUrl' ? label : `<button type="button" class="target-sort" data-sort-key="${key}" aria-label="按${label}排序">${label}${sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button>`}</th>`).join('')}<th>目标依据</th></tr></thead><tbody>${rows.map((row) => {
      const values = trackingColumns.map(([, key]) => {
        if (key === 'unitsRate') return percent(row.completedUnits ?? row.actualUnits, row.quantityTarget);
        if (key === 'salesRate') return percent(row.completedSales, row.amountTarget);
        if (key === 'completedUnits') return numberValue(row.completedUnits ?? row.actualUnits)?.toLocaleString('en-US', { maximumFractionDigits: 2 }) ?? '暂无数据';
        if (key === 'completedSales') return currency(numberValue(row.completedSales));
        if (key === 'amountTarget') return currency(numberValue(row.amountTarget));
        return key === 'imageUrl' || key === 'productName' ? cellMarkup(row, key) : displayValue(row, key);
      });
      const basis = [
        ['在库库存', displayValue(row, 'inventoryQuantity')], ['上月日均销量', displayValue(row, 'lastMonthAvgDailySales')],
        ['上月均价', displayValue(row, 'lastMonthAvgPrice')], ['预计日销', displayValue(row, 'expectedDailySales')],
        ['销售天数', displayValue(row, 'sellingDays')],
      ];
      return `<tr>${values.map((value, index) => { const key = trackingColumns[index][1]; if (key === 'imageUrl' || key === 'productName') return `<td>${value}</td>`; if (key === 'unitsRate' || key === 'salesRate') { const rate = key === 'unitsRate' ? (numberValue(row.quantityTarget) && numberValue(row.quantityTarget)! > 0 ? (numberValue(row.completedUnits ?? row.actualUnits) ?? 0) / numberValue(row.quantityTarget)! : null) : (numberValue(row.amountTarget) && numberValue(row.amountTarget)! > 0 ? (numberValue(row.completedSales) ?? 0) / numberValue(row.amountTarget)! : null); return `<td><span class="target-rate-chip" data-tone="${rateTone(rate)}">${escapeHtml(value)}</span></td>`; } return `<td>${escapeHtml(value)}</td>`; }).join('')}<td><div class="target-basis"><button class="target-basis-toggle" type="button" data-basis-toggle aria-expanded="false">查看依据</button><dl class="target-basis-content" hidden>${basis.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></div></td></tr>`;
    }).join('')}</tbody></table>`;
    bindSortButtons();
  };
  const render = () => {
    renderOptions();
    const tracking = view === 'tracking';
    main.querySelector<HTMLElement>('[data-metrics]')!.hidden = !tracking;
    main.querySelector<HTMLElement>('.target-owner-panel')!.hidden = !tracking;
    main.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => { button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
    renderMetrics(); renderChart(); renderTable();
  };

  const loadPerformance = async () => {
    performanceNote.textContent = '正在读取定版目标...';
    try {
      const params = new URLSearchParams({ month: monthInput.value });
      const response = await fetch(`/api/targets/performance?${params}`, { credentials: 'include' });
      const body = await response.json() as { data?: { batch?: { status?: string; revision?: number } | null; rows?: TargetRow[] }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '读取负责人目标失败');
      performanceRows = body.data?.rows ?? [];
      finalized = body.data?.batch?.status === 'finalized';
      performanceNote.textContent = finalized ? `定版版本 ${body.data?.batch?.revision ?? '-'} · 销售额按订单 SKU 匹配` : '等待本月目标定版';
      render();
    } catch (error) {
      finalized = false;
      performanceRows = [];
      performanceNote.textContent = error instanceof Error ? error.message : '读取负责人目标失败';
      render();
    }
  };

  const loadEditor = async () => {
    if (!admin) return;
    if (status) status.textContent = '正在读取当前月份目标...';
    try {
      const response = await fetch('/api/targets/initialize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ month: monthInput.value }) });
      const body = await response.json() as { data?: { batch?: { id?: string; status?: string }; rows?: TargetRow[] }; error?: { message?: string } };
      if (!response.ok || !body.data?.batch?.id) throw new Error(body.error?.message ?? '初始化失败');
      batchId = body.data.batch.id;
      const detail = await fetch(`/api/targets/${encodeURIComponent(batchId)}`, { credentials: 'include' });
      const detailBody = await detail.json() as { data?: { batch?: { status?: string }; rows?: TargetRow[] }; error?: { message?: string } };
      if (!detail.ok) throw new Error(detailBody.error?.message ?? '读取目标明细失败');
      editorRows = detailBody.data?.rows ?? body.data.rows ?? [];
      editorStatus = detailBody.data?.batch?.status ?? body.data.batch.status ?? 'draft';
      if (importErrors) { importErrors.hidden = true; importErrors.replaceChildren(); }
      if (status) status.textContent = `批次 ${editorStatus} · ${editorRows.length} 个 SKU`;
      const actions = main.querySelector<HTMLElement>('[data-actions]');
      if (actions) actions.hidden = false;
      const finalizeButton = main.querySelector<HTMLButtonElement>('[data-finalize]');
      const isDraft = editorStatus === 'draft';
      if (finalizeButton) finalizeButton.disabled = !isDraft || !editorRows.length;
      const fileInput = main.querySelector<HTMLInputElement>('[data-file]');
      if (fileInput) fileInput.disabled = !isDraft;
      const previewButton = main.querySelector<HTMLButtonElement>('[data-preview]');
      if (previewButton) previewButton.disabled = !isDraft;
      const revisionButton = main.querySelector<HTMLButtonElement>('[data-revision]');
      if (revisionButton) revisionButton.hidden = editorStatus !== 'finalized';
      render();
    } catch (error) {
      editorRows = [];
      editorStatus = '';
      if (status) status.textContent = error instanceof Error ? error.message : '初始化失败';
      render();
    }
  };

  const reloadMonth = () => {
    searchInput.value = '';
    storeSelect.value = '';
    ownerSelect.value = '';
    void loadPerformance();
    if (admin) void loadEditor();
  };
  monthInput.addEventListener('change', reloadMonth);
  searchInput.addEventListener('input', render);
  storeSelect.addEventListener('change', render);
  ownerSelect.addEventListener('change', render);
  main.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
    view = button.dataset.view === 'tracking' ? 'tracking' : 'planning';
    render();
  }));
  main.querySelector('[data-clear]')?.addEventListener('click', () => { searchInput.value = ''; storeSelect.value = ''; ownerSelect.value = ''; render(); });
  main.querySelector('[data-init]')?.addEventListener('click', () => void loadEditor());
  main.querySelector('[data-revision]')?.addEventListener('click', async () => {
    if (!batchId) return;
    const button = main.querySelector<HTMLButtonElement>('[data-revision]')!;
    button.disabled = true;
    if (status) status.textContent = '正在创建修订草稿...';
    try {
      const response = await fetch(`/api/targets/${encodeURIComponent(batchId)}/revision`, { method: 'POST', credentials: 'include' });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `创建修订失败（HTTP ${response.status}）`);
      await loadEditor();
      if (status) status.textContent = '修订草稿已创建，可上传 Excel 调整后复核总额再定版';
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : '创建修订失败，请重试';
      button.disabled = false;
    }
  });

  main.querySelector('[data-export]')?.addEventListener('click', async () => {
    if (!batchId) return;
    const response = await fetch(`/api/targets/${encodeURIComponent(batchId)}/export?format=xlsx`, { credentials: 'include' });
    if (!response.ok) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = `SKU目标-${monthInput.value}.xlsx`;
    link.click();
    URL.revokeObjectURL(link.href);
  });
  main.querySelector<HTMLInputElement>('[data-file]')?.addEventListener('change', async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !batchId) return;
    const previewButton = main.querySelector<HTMLButtonElement>('[data-preview]')!;
    const finalizeButton = main.querySelector<HTMLButtonElement>('[data-finalize]')!;
    previewButton.disabled = true;
    finalizeButton.disabled = true;
    if (status) status.textContent = `正在校验 ${file.name}...`;
    if (importErrors) { importErrors.hidden = true; importErrors.replaceChildren(); }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const response = await fetch(`/api/targets/${encodeURIComponent(batchId)}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ contentBase64: btoa(binary) }) });
      const body = await response.json().catch(() => null) as { data?: { rows?: TargetRow[]; errors?: string[] }; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `导入失败（HTTP ${response.status}），请检查文件后重试`);
      const errors = body?.data?.errors ?? [];
      if (errors.length) {
        if (status) status.textContent = `导入校验未通过：${errors.length} 个问题，草稿未修改`;
        if (importErrors) {
          importErrors.replaceChildren(...errors.map((message) => { const item = document.createElement('li'); item.textContent = message; return item; }));
          importErrors.hidden = false;
        }
        return;
      }
      previewRows = body?.data?.rows ?? [];
      editorRows = previewRows;
      editorStatus = 'draft';
      render();
      previewButton.disabled = !previewRows.length;
      finalizeButton.disabled = !previewRows.length;
      if (status) status.textContent = `导入校验通过：${previewRows.length} 个 SKU，${file.name} 已保存到草稿，可定版`;
      input.value = '';
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : '导入失败，请检查网络和 Excel 文件后重试';
      input.value = '';
    }
  });
  main.querySelector('[data-preview]')?.addEventListener('click', () => { editorRows = previewRows; render(); if (status) status.textContent = '预览数据已保存到草稿，可定版'; });
  main.querySelector('[data-finalize]')?.addEventListener('click', async () => {
    if (!batchId) return;
    const button = main.querySelector<HTMLButtonElement>('[data-finalize]')!;
    button.disabled = true;
    if (status) status.textContent = '正在定版目标...';
    try {
      const response = await fetch(`/api/targets/${encodeURIComponent(batchId)}/finalize`, { method: 'POST', credentials: 'include' });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `定版失败（HTTP ${response.status}）`);
      if (status) status.textContent = '目标已定版，正在刷新负责人完成情况...';
      await Promise.all([loadPerformance(), loadEditor()]);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : '定版失败，请重试';
      button.disabled = false;
    }
  });

  void loadPerformance();
  if (admin) void loadEditor();
}
