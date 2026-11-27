import { renderProfitPage } from './pages/ProfitPage.js';
import { renderCostsPage } from './pages/CostsPage.js';
import { renderMembersPage } from './pages/MembersPage.js';
import { renderProductReviewsPage } from './pages/ProductReviewsPage.js';
import { listStores, createStore, configureStoreCredentials } from './api/stores.js';
import { renderOrdersPage } from './pages/OrdersPage.js';
import { openOrderDetailModal } from './pages/OrderDetailPage.js';
import { renderReturnsPage } from './pages/ReturnsPage.js';
import { renderInventoryPage } from './pages/InventoryPage.js';
import { renderWfsPage } from './pages/WfsPage.js';
import { renderItemsPage, type Item } from './pages/ItemsPage.js';
import { renderDashboardPage } from './pages/DashboardPage.js';
import { renderTargetsPage } from './pages/TargetsPage.js';
import { renderPricingPage, renderAdvertisingChartPage, renderPerformanceSummaryPage } from './pages/MarketingPages.js';
import { formatScheduleTime, renderIncrementalPlansHtml, renderSyncPlanCoverageHtml, type IncrementalPlanView } from './pages/SyncStatusPage.js';
import { renderAllSkuPage } from './pages/AllSkuPage.js';
import { renderBrightDataPanel } from './pages/BrightDataPanel.js';
import { renderProductAnalysisPage } from './pages/ProductAnalysisPage.js';
import { renderWeatherPage } from './pages/WeatherPage.js';
import { createNavigationPageCache } from './navigationPageCache.js';

export function renderFreightTrackingSyncAction(role: 'admin' | 'member'): string {
  if (role !== 'admin') return '';
  return '<div class="tenant-sync-action"><button class="secondary" data-sync-resource="freight-tracking" data-store-id="__tenant__">同步物流轨迹</button><small>按头程货代入库号查询物流状态并保存轨迹</small></div>';
}

export function renderWfsFeePreviewSyncAction(role: 'admin' | 'member', storeId: string): string {
  if (role !== 'admin') return '';
  return `<div class="sync-action-group"><span>WFS 货件费用</span><div><button class="secondary" data-sync-resource="wfs-inbound-preview" data-store-id="${escapeSync(storeId)}">同步 WFS 费用预估</button></div></div>`;
}

async function renderStoresPage(main: HTMLElement): Promise<void> {
  const stores = await listStores();
  main.innerHTML = `<header><div><p class="eyebrow">店铺管理</p><h1>Stores</h1></div></header><section class="panel"><form id="store-form"><input name="id" placeholder="店铺 ID" required><input name="name" placeholder="店铺名称" required><select name="environment"><option value="sandbox">Sandbox</option><option value="production">Production</option></select><button class="primary">添加店铺</button></form><div class="store-list">${stores.length ? stores.map((s) => `<div class="item-row store-entry"><div><strong>${escapeSync(s.name)}</strong><span>${escapeSync(s.id)} · ${escapeSync(s.environment)} · ${escapeSync(s.status)}</span></div><form class="credential-form" data-store-id="${escapeSync(s.id)}"><input name="clientId" placeholder="Client ID" required><input name="clientSecret" type="password" placeholder="Client Secret" required><button class="secondary" type="submit">保存凭证</button><small class="credential-status"></small></form></div>`).join('') : '<div class="empty">暂无店铺</div>'}</div></section>`;
  main.querySelector<HTMLFormElement>('#store-form')!.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    await createStore({ id: String(form.get('id')), name: String(form.get('name')), environment: form.get('environment') as 'sandbox' | 'production' });
    location.reload();
  };
  main.querySelectorAll<HTMLFormElement>('.credential-form').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const ok = await configureStoreCredentials(form.dataset.storeId!, String(data.get('clientId')), String(data.get('clientSecret')));
      const status = form.querySelector('.credential-status');
      if (status) status.textContent = ok ? '已加密保存' : '保存失败';
      if (ok) form.reset();
    };
  });
}

export function freightTrackingResultSummary(result: Record<string, unknown>): string {
  const count = (key: string): number => Number.isFinite(Number(result[key])) ? Number(result[key]) : 0;
  return `货件 ${count('sourceShipments')} · 已识别 ${count('matched')} · 查询 ${count('queried')} · 写入 ${count('written')} · 未找到 ${count('notFound')} · 已签收跳过 ${count('skippedDelivered')} · 30 天无更新跳过 ${count('skippedStale')} · 未识别前缀 ${count('skippedUnmatched')} · 失败 ${count('failed')}`;
}

export function syncTaskResultSummary(result: Record<string, unknown>): string {
  if (result.waiting) { const phases: Record<string,string> = {'report-generation':'Walmart 报告生成中','api-cooldown':'等待 API 调用间隔','api-rate-limit':'Walmart 限流等待'}; return `${phases[String(result.phase)] ?? String(result.phase)} · ${formatScheduleTime(result.resumeAt as string)} 继续（已释放执行槽位）`; }
  if (result.phase) return String(result.phase) + (result.month ? ' · ' + String(result.month) : '');

  if (result.scanned != null && result.eligible != null) return wfsFeePreviewResultSummary(result);
  let summary: string;
  if (result.success != null || result.total != null) {
    summary = `成功 ${result.success ?? 0} / ${result.total ?? 0} · 失败 ${result.failed ?? 0}`;
  } else if (result.normalized != null || result.received != null) {
    summary = `写入 ${result.normalized ?? result.written ?? 0} · 接收 ${result.received ?? 0}`;
  } else {
    summary = `写入 ${result.written ?? 0} · 跳过 ${result.skipped ?? 0}`;
  }
  if (result.resource === 'inventory-recon') summary += ' · 库存不平 ' + String(result.differences ?? 0) + ' 行';
  const unmatchedStoreNames = Array.isArray(result.unmatchedStoreNames) ? result.unmatchedStoreNames.filter((name): name is string => typeof name === 'string') : [];
  return `${summary}${unmatchedStoreNames.length ? ` · 未匹配：${unmatchedStoreNames.join('、')}` : ''}`;
}

export function wfsFeePreviewResultSummary(result: Record<string, unknown>): string {
  const count = (key: string) => Number.isFinite(Number(result[key])) ? Number(result[key]) : 0;
  return `扫描 ${count('scanned')} · 符合 ${count('eligible')} · 已预估 ${count('previewed')} · 未变化 ${count('unchanged')} · 跳过 ${count('skipped')} · 无 ITS 方案 ${count('noItsOption')} · 失败 ${count('failed')}`;
}

function renderRuntimeStatus(target: HTMLElement, data: any, isAdmin: boolean): void {
  const healthy = data?.status === 'ok';
  const services = isAdmin ? { API: 'ok', MySQL: data?.dependencies?.mysql, Redis: data?.dependencies?.redis, Worker: data?.worker } : data?.components ?? {};
  const labels: Record<string, string> = { mysqlUrl: 'MYSQL_URL', redisUrl: 'REDIS_URL', credentialKey: '凭证加密密钥' };
  const tiles = Object.entries(services).map(([name, value]) => `<div class="runtime-status-item"><span>${escapeSync(name)}</span><strong class="runtime-${value === 'ok' ? 'ok' : 'error'}">${value === 'ok' ? '正常' : '异常'}</strong></div>`).join('');
  const env = isAdmin ? `<div class="runtime-status-env">${Object.entries(data?.api ?? {}).map(([key, value]) => `<div><span>${escapeSync(labels[key] ?? key)}</span><strong class="runtime-${value ? 'ok' : 'error'}">${value ? '已加载' : '未加载'}</strong></div>`).join('')}</div>` : '';
  target.innerHTML = `<div class="runtime-status-summary"><span class="runtime-status-indicator ${healthy ? 'is-ok' : 'is-error'}"></span><strong>${healthy ? '运行正常' : '需要检查'}</strong><small>最近检查 ${escapeSync(formatScheduleTime(data?.checkedAt))}</small></div><div class="runtime-status-grid">${tiles}</div>${env}`;
}

async function renderSyncStatusPage(main: HTMLElement): Promise<void> {
  const canManage = main.dataset.role !== 'member';
  let currentScope: 'all' | 'tenant' | 'store' = 'tenant';
  const controlPanel = canManage ? `<section class="panel"><div class="panel-head"><h2>综合同步控制</h2><span data-sync-count>加载中...</span></div><div class="tenant-sync-actions"><div class="tenant-sync-action"><button class="primary" data-sync-resource="head-freight" data-store-id="__tenant__">同步头程在途</button><small>智能文档中的有效记录会落库，店铺匹配仅用于补充关联</small></div><div class="tenant-sync-action"><button class="secondary" data-sync-resource="smart-sheet-allsku2026" data-store-id="__tenant__">同步 ALLSKU2026 商品表</button><small>同步后可在 ALLSKU2026 页面查看，按源记录 ID 更新</small></div><div class="tenant-sync-action"><button class="secondary" data-sync-resource="lingxing-advertising" data-store-id="__tenant__">同步领星广告费用</button><small>同步 SP 商品级广告花费，写入领星广告明细表</small></div><div class="tenant-sync-action"><button class="secondary" data-sync-resource="lingxing-head-freight-costs" data-store-id="__tenant__">同步领星货件采购成本</button><small>按头程 WFS 货件号匹配领星已发货单 SKU、数量和采购单价</small></div><div class="tenant-sync-action"><button class="secondary" data-sync-resource="brightdata-inventory" data-store-id="__tenant__">同步 Bright Data 外部库存</button><small>抓取产品目录中的 Walmart 外部库存并写入 Bright Data 快照</small></div>${renderFreightTrackingSyncAction('admin')}</div><div class="tenant-incremental-control"><strong>综合增量同步</strong><span>每个任务独立控制 · 天气气候每日同步</span><div class="tenant-incremental-actions"><button class="secondary" data-tenant-resource="head-freight">头程在途</button><button class="secondary" data-tenant-resource="lingxing-advertising">领星广告</button><button class="secondary" data-tenant-resource="lingxing-head-freight-costs">领星采购成本</button><button class="secondary" data-tenant-resource="smart-sheet-allsku2026">ALLSKU</button><button class="secondary" data-tenant-resource="freight-tracking">物流轨迹</button><button class="secondary" data-tenant-resource="weather">天气气候</button></div></div><div class="sync-store-controls">加载中...</div><div data-sync-plan-status class="sync-plan-status"></div></section>` : '';
  const planActionStatus = canManage ? '<div data-plan-action-status class="sync-plan-action-status" role="status" aria-live="polite"></div>' : '';
  const planDescription = canManage ? '每家店铺独立控制；时间按中国时间（UTC+8）显示。' : '仅显示你有权查看的店铺同步进度。';
  const initialScope = String(currentScope);
  main.innerHTML = `<header><div><p class="eyebrow">同步任务</p><h1>Sync Status</h1><p class="muted">按店铺查看 Walmart API 同步与本地落库状态</p></div><button class="secondary" data-refresh-sync>刷新</button></header><section class="panel runtime-status-panel"><div class="panel-head"><div><h2>运行环境</h2><span class="muted">仅检查状态，不读取或展示密钥</span></div><button class="secondary" data-refresh-runtime>重新检查</button></div><div data-runtime-status class="runtime-status-content">检查中...</div></section>${controlPanel}<section class="panel"><div class="panel-head"><h2>持续增量同步</h2><span data-incremental-plan-count>加载中...</span></div><p class="muted">${planDescription}</p>${planActionStatus}<div data-incremental-plans class="sync-schedule-list">加载中...</div></section><section class="panel"><div class="panel-head"><h2>最近同步任务</h2></div><div class="sync-history-toolbar"><div class="sync-history-scope" role="group" aria-label="任务范围"><button type="button" data-sync-scope="tenant" aria-pressed="${initialScope === 'tenant'}">综合同步</button><button type="button" data-sync-scope="store" aria-pressed="${initialScope === 'store'}">店铺任务</button><button type="button" data-sync-scope="all" aria-pressed="${initialScope === 'all'}">全部</button></div><span class="muted">中国时间（UTC+8） · 最新任务在最上面</span></div><div class="sync-status-results">加载中...</div><div class="sync-status-pagination" data-sync-pagination></div></section>`;
  const expandedSyncStoreIds = new Set<string>();
  const reconMonthsByStore = new Map<string,string>();
  const taskPageByStore = new Map<string, number>();
  let currentPage = 1;
  // Keep the history page large enough to include every store before the
  // client groups jobs into store cards. Raw-job pagination used to hide other
  // stores behind the busiest store's rows.
  // Keep the status page responsive. The API already returns pagination; loading
  // hundreds of jobs also loads their result payloads and blocks first paint.
  const pageSize = 50;
  const expandedStoreIds = new Set<string>();
  main.addEventListener('click', async (event) => {
    const scopeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sync-scope]');
    if (scopeButton && canManage) {
      currentScope = scopeButton.dataset.syncScope as 'all' | 'tenant' | 'store';
      currentPage = 1;
      main.querySelectorAll<HTMLButtonElement>('[data-sync-scope]').forEach((button) => button.setAttribute('aria-pressed', String(button === scopeButton)));
      void load();
      return;
    }
    const disclosure = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-toggle-store-details]');
    if (disclosure) {
      const storeId = disclosure.dataset.toggleStoreDetails!;
      const expanded = !expandedStoreIds.has(storeId);
      if (expanded) expandedStoreIds.add(storeId); else expandedStoreIds.delete(storeId);
      disclosure.setAttribute('aria-expanded', String(expanded));
      const resources = disclosure.closest('.sync-schedule-store')?.querySelector<HTMLElement>('.sync-schedule-resources');
      resources?.classList.toggle('is-collapsed', !expanded);
      if (expanded) {
        resources?.removeAttribute('inert');
        resources?.setAttribute('aria-hidden', 'false');
      } else {
        resources?.setAttribute('inert', '');
        resources?.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-toggle-incremental-store]');
    if (toggle) {
      toggle.disabled = true;
      const actionStatus = main.querySelector<HTMLElement>('[data-plan-action-status]')!;
      actionStatus.textContent = '';
      try {
        const response = await fetch(`http://localhost:3000/api/sync/plans/stores/${encodeURIComponent(toggle.dataset.toggleIncrementalStore!)}/incremental`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled: toggle.dataset.nextEnabled === 'true' }),
        });
        const body = await response.json() as { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? '店铺增量同步状态更新失败');
        await load();
      } catch (error) {
        actionStatus.textContent = error instanceof Error ? error.message : '店铺增量同步状态更新失败';
        toggle.disabled = false;
      }
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sync-plan-store]');
    if (!button) return;
    button.disabled = true;
    const status = main.querySelector<HTMLElement>('[data-sync-plan-status]');
    try {
      const response = await fetch('http://localhost:3000/api/sync/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ storeId: button.dataset.syncPlanStore, resources: ['orders', 'returns', 'inventory', 'storage-fees', 'pricing', 'item-report', 'inventory-recon', 'advertising', 'advertising-sem', 'advertising-sem-items', 'advertising-sem-performance', 'advertising-sem-search-terms', 'performance'], mode: 'initial' }) });
      const body = await response.json() as { data?: { plans?: Array<{ id: string }> }; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '首次回填计划创建失败');
      const views = await Promise.all((body.data?.plans ?? []).map(async (plan) => { const result = await fetch(`http://localhost:3000/api/sync/plans/${encodeURIComponent(plan.id)}`, { credentials: 'include' }); const value = await result.json() as { data?: { status: string; resources: any[] } }; return value.data; }));
      if (status) status.innerHTML = views.filter(Boolean).map((view) => renderSyncPlanCoverageHtml(view!)).join('');
    } catch (error) { if (status) status.innerHTML = `<div class="empty error">${escapeSync(error instanceof Error ? error.message : '首次回填计划创建失败')}</div>`; } finally { button.disabled = false; }
  });
  const load = async () => {
    const results = main.querySelector<HTMLElement>('.sync-status-results')!;
    try {
      const [response, plansResponse, runtimeResponse] = await Promise.all([
        fetch(`http://localhost:3000/api/sync-status?page=${currentPage}&pageSize=${pageSize}&scope=${currentScope}`, { credentials: 'include' }),
        fetch('http://localhost:3000/api/sync/plans', { credentials: 'include' }),
        fetch('http://localhost:3000/api/operations/runtime-status', { credentials: 'include' }),
      ]);
      const body = await response.json() as { data?: { jobs?: Array<Record<string, unknown>>; stores?: Array<Record<string, unknown>>; pagination?: { page: number; pageSize: number; total: number; totalPages: number } }; error?: { message?: string } };
      const plansBody = await plansResponse.json() as { data?: { plans?: IncrementalPlanView[] }; error?: { message?: string } };
      const runtimeBody = await runtimeResponse.json() as { data?: any; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? '同步状态读取失败');
      if (!plansResponse.ok) throw new Error(plansBody.error?.message ?? '增量计划读取失败');
      if (!runtimeResponse.ok) throw new Error(runtimeBody.error?.message ?? '运行环境状态读取失败');
      renderRuntimeStatus(main.querySelector<HTMLElement>('[data-runtime-status]')!, runtimeBody.data, canManage);
      const jobs = body.data?.jobs ?? []; const stores = body.data?.stores ?? []; const pagination = body.data?.pagination ?? { page: currentPage, pageSize, total: jobs.length, totalPages: 1 };
      currentPage = pagination.page;
      const syncCount = main.querySelector<HTMLElement>('[data-sync-count]');
      if (syncCount) syncCount.textContent = currentScope === 'all' ? `${pagination.total} 个任务 / ${stores.length} 家店铺` : `${pagination.total} 条${currentScope === 'tenant' ? '综合同步' : '店铺任务'}`;
      const plans = plansBody.data?.plans ?? [];
      const tenantPlans = new Map(plans.filter((plan) => plan.storeId === '__tenant__').map((plan) => [plan.resource, plan]));
      main.querySelectorAll<HTMLButtonElement>('[data-tenant-resource]').forEach((button) => { const plan = tenantPlans.get(button.dataset.tenantResource!); const enabled = Number(plan?.enabled ?? 0) === 1; button.textContent = `${button.textContent?.replace(/：(?:开启|关闭)$/, '')}：${enabled ? '关闭' : '开启'}`; button.dataset.nextEnabled = String(!enabled); button.classList.toggle('primary', enabled); });
      const plansByStore = new Map<string, IncrementalPlanView[]>();
      for (const plan of plans) plansByStore.set(plan.storeId, [...(plansByStore.get(plan.storeId) ?? []), plan]);
      const enabledStores = [...plansByStore.values()].filter((storePlans) => storePlans.length > 0 && storePlans.every((plan) => plan.enabled)).length;
      main.querySelector<HTMLElement>('[data-incremental-plan-count]')!.textContent = `${enabledStores} 家店铺已开启 / ${stores.length} 家店铺`;
      main.querySelector<HTMLElement>('[data-incremental-plans]')!.innerHTML = renderIncrementalPlansHtml(plans, stores.map((store) => ({ id: String(store.id), name: String(store.name ?? store.id) })), expandedStoreIds, canManage);
      const controls = main.querySelector<HTMLElement>('.sync-store-controls');
      if (controls) {
      controls.innerHTML = stores.length ? stores.map((store) => { const expanded = expandedSyncStoreIds.has(String(store.id)); return `<article class="sync-store-row${expanded ? ' is-expanded' : ''}"><button type="button" class="sync-store-disclosure" data-toggle-sync-store="${escapeSync(store.id)}" aria-expanded="${expanded}"><span class="sync-store-chevron" aria-hidden="true"></span><span class="sync-store-identity"><strong>${escapeSync(store.name ?? store.id)}</strong><small>${escapeSync(store.id)} · ${escapeSync(store.environment)}</small></span><span class="sync-store-action-hint">同步控制</span></button><div class="sync-store-actions"${expanded ? '' : ' hidden'}><div class="sync-action-group sync-action-group-primary"><span>首次回填</span><button class="primary" data-sync-plan-store="${escapeSync(store.id)}">开始全量回填</button></div><div class="sync-action-group"><span>订单与库存</span><div><button class="secondary" data-sync-resource="orders" data-store-id="${escapeSync(store.id)}">同步订单</button><button class="secondary" data-sync-resource="returns" data-store-id="${escapeSync(store.id)}">同步退货</button><button class="secondary" data-sync-resource="inventory" data-store-id="${escapeSync(store.id)}">同步库存</button></div></div><div class="sync-action-group"><span>账单与价格</span><div><button class="secondary" data-sync-resource="storage-fees" data-store-id="${escapeSync(store.id)}">同步 Payment 账单</button><button class="secondary" data-sync-resource="pricing" data-store-id="${escapeSync(store.id)}">同步价格</button><button class="secondary" data-sync-resource="item-report" data-store-id="${escapeSync(store.id)}">同步商品报告</button></div></div><div class="sync-action-group"><span>广告与绩效</span><div><button class="secondary" data-sync-resource="advertising-onsite" data-store-id="${escapeSync(store.id)}">同步站内广告</button><button class="secondary" data-sync-resource="advertising-sem" data-store-id="${escapeSync(store.id)}">同步 SEM 广告</button><button class="secondary" data-sync-resource="advertising-sem-items" data-store-id="${escapeSync(store.id)}">同步 SEM 商品花费</button><button class="secondary" data-sync-resource="advertising-sem-performance" data-store-id="${escapeSync(store.id)}">同步 SEM 逐日报表</button><button class="secondary" data-sync-resource="advertising-sem-search-terms" data-store-id="${escapeSync(store.id)}">同步 SEM 搜索词</button><button class="secondary" data-sync-resource="performance" data-store-id="${escapeSync(store.id)}">同步绩效</button></div></div></div></article>`; }).join('') : '<div class="empty">暂无店铺</div>';
      controls.querySelectorAll<HTMLElement>('.sync-store-actions').forEach((actions) => { const storeId = actions.closest<HTMLElement>('.sync-store-row')?.querySelector<HTMLElement>('[data-toggle-sync-store]')?.dataset.toggleSyncStore ?? ''; const group = document.createElement('div'); group.className = 'sync-action-group'; group.innerHTML = '<span>商品</span><div><button class="secondary" data-sync-resource="item-report">同步商品报告</button></div>'; group.querySelector<HTMLButtonElement>('[data-sync-resource]')!.dataset.storeId = storeId; actions.append(group);
      const recon = document.createElement('div'); recon.className = 'sync-action-group';
      recon.innerHTML = '<span>月度库存对账</span><div><input type="month" aria-label="库存对账月份" data-recon-month><button class="secondary" data-sync-resource="inventory-recon">获取月度库存对账</button></div><small>按整月获取期初、期末库存；每月 2 日、8 日自动更新上月</small>';
      const monthInput = recon.querySelector<HTMLInputElement>('[data-recon-month]')!;
      monthInput.max = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0,7);
      monthInput.value = reconMonthsByStore.get(storeId) ?? monthInput.max;
      monthInput.onchange = () => { reconMonthsByStore.set(storeId, monthInput.value); };
      recon.querySelector<HTMLButtonElement>('[data-sync-resource]')!.dataset.storeId = storeId;
      actions.append(recon); actions.insertAdjacentHTML('beforeend', renderWfsFeePreviewSyncAction(main.dataset.role === 'admin' ? 'admin' : 'member', storeId)); });
      controls.querySelectorAll<HTMLButtonElement>('[data-toggle-sync-store]').forEach((button) => { button.onclick = () => { const id = button.dataset.toggleSyncStore!; expandedSyncStoreIds.has(id) ? expandedSyncStoreIds.delete(id) : expandedSyncStoreIds.add(id); void load(); }; });
      main.querySelectorAll<HTMLButtonElement>('[data-sync-resource]').forEach((button) => { button.onclick = async () => { const originalText = button.textContent ?? '同步'; button.disabled = true; button.textContent = '提交中'; try { const to = new Date(); const from = new Date(to.getTime() - 30 * 86400000); const payload: Record<string, unknown> = { resource: button.dataset.syncResource, window: { from: from.toISOString(), to: to.toISOString() } }; if (button.dataset.syncResource === 'inventory-recon') {
        const month = button.closest('.sync-action-group')?.querySelector<HTMLInputElement>('[data-recon-month]')?.value;
        if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('请选择月份');
        payload.window = {from:month+'-01T00:00:00.000Z',to:new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)-1).toISOString()};
      }
      if (button.dataset.storeId && button.dataset.storeId !== '__tenant__') payload.storeId = button.dataset.storeId; const r = await fetch('http://localhost:3000/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) }); if (!r.ok) { const result = await r.json().catch(() => ({})) as { error?: { message?: string } }; button.textContent = result.error?.message ?? '提交失败'; button.disabled = false; return; } button.textContent = '已提交'; setTimeout(() => { void load(); }, 500); } catch { button.textContent = '提交失败'; button.disabled = false; setTimeout(() => { if (button.isConnected) button.textContent = originalText; }, 2500); } }; });
      main.querySelectorAll<HTMLButtonElement>('[data-tenant-resource]').forEach((button) => { button.onclick = async () => { button.disabled = true; const response = await fetch('http://localhost:3000/api/sync/plans/tenant/incremental', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ resource: button.dataset.tenantResource, enabled: button.dataset.nextEnabled === 'true' }) }); if (response.ok) await load(); else button.disabled = false; }; });
      }
      const groupedJobs = new Map<string, Array<Record<string, unknown>>>(); for (const job of jobs) { const storeId = String(job.storeId ?? '__tenant__'); groupedJobs.set(storeId, [...(groupedJobs.get(storeId) ?? []), job]); } const groupedEntries = [...groupedJobs.entries()].sort((a, b) => String(b[1][0]?.createdAt ?? '').localeCompare(String(a[1][0]?.createdAt ?? ''))); const storeTotalPages = 1; const visibleGroupedEntries = groupedEntries;
      const storeNames = new Map(stores.map((store) => [String(store.id), String(store.name ?? store.id)]));
      const taskResourceLabel: Record<string, string> = { 'product-reviews': '商品评论', orders: '订单', returns: '退货', inventory: '库存', 'storage-fees': 'Payment 账单', pricing: '价格', 'item-report': '商品报告', 'inventory-recon': 'WFS 月度库存对账', 'lingxing-advertising': '领星广告费用', 'lingxing-head-freight-costs': '领星货件 SKU 采购成本', 'advertising-onsite': '站内广告', 'advertising-sem': 'SEM 广告', 'advertising-sem-items': 'SEM 商品花费', 'advertising-sem-performance': 'SEM 逐日报表', 'advertising-sem-search-terms': 'SEM 搜索词', 'wfs-inbound-preview': 'WFS ITS 费用预估', performance: '绩效', 'head-freight': '头程在途', 'smart-sheet-allsku2026': 'ALLSKU2026 商品表', 'freight-tracking': '物流轨迹' };
      const taskStatusLabel = (status: unknown) => ({ completed: '已完成', running: '运行中', queued: '排队中', failed: '失败', waiting: '等待中' } as Record<string, string>)[String(status)] ?? String(status ?? '未知'); const taskPageSize = 10;
      results.innerHTML = visibleGroupedEntries.length ? `<div class="sync-task-list">${visibleGroupedEntries.map(([storeId, storeJobs]) => { const latest = storeJobs[0]; const taskPages = Math.max(1, Math.ceil(storeJobs.length / taskPageSize)); const taskPage = Math.min(taskPageByStore.get(storeId) ?? 1, taskPages); const visibleJobs = storeJobs.slice((taskPage - 1) * taskPageSize, taskPage * taskPageSize); const status = String(latest?.status ?? 'unknown'); const expanded = expandedSyncStoreIds.has(`tasks:${storeId}`); return `<article class="sync-task-store"><button type="button" class="sync-task-store-heading" data-toggle-sync-store="tasks:${escapeSync(storeId)}" aria-expanded="${expanded}"><span class="sync-store-chevron" aria-hidden="true"></span><span class="sync-task-store-name"><strong>${escapeSync(storeId === '__tenant__' ? '综合同步' : storeNames.get(storeId) ?? storeId)}</strong><small>${escapeSync(storeId)} · ${storeJobs.length} 个任务 · 最新 ${escapeSync(formatScheduleTime(latest?.createdAt as string | Date | undefined))}</small></span><span class="sync-task-store-status sync-task-status-${escapeSync(status)}">${escapeSync(taskStatusLabel(status))}</span></button><div class="sync-task-items"${expanded ? '' : ' hidden'}>${visibleJobs.map((job) => { const result = job.resultPayload as { error?: string; written?: number; skipped?: number; success?: number; failed?: number; total?: number; normalized?: number; received?: number; unmatchedStoreNames?: string[] } | undefined; const isFreightTracking = job.resource === 'freight-tracking'; const resultText = result?.error ? `失败：${result.error}` : result ? isFreightTracking ? freightTrackingResultSummary(result) : syncTaskResultSummary(result) : '暂无结果'; const jobStatus = String(job.status ?? 'unknown'); const related = job.syncPlanId ? `${job.syncMode === 'incremental' ? (job.storeId === '__tenant__' ? '综合增量' : '店铺增量') : '首次同步'} · ${formatScheduleTime(job.windowFrom as string | Date | undefined)} 至 ${formatScheduleTime(job.windowTo as string | Date | undefined)}` : '手动任务'; return `<div class="sync-task-item"><div class="sync-task-item-main"><strong>${escapeSync(taskResourceLabel[String(job.resource)] ?? job.resource ?? '未知资源')}</strong><span class="sync-task-status sync-task-status-${escapeSync(jobStatus)}">${escapeSync(taskStatusLabel(jobStatus))}</span><small>${escapeSync(formatScheduleTime(job.createdAt as string | Date | undefined))} · 尝试 ${escapeSync(job.attempts ?? 0)} 次</small></div><p class="sync-task-related">关联：${escapeSync(related)}</p><p class="sync-task-result${result?.error ? ' error' : ''}" title="${escapeSync(resultText)}">${escapeSync(resultText)}</p><details class="sync-task-batch"><summary>批次详情</summary><code>${escapeSync(job.idempotencyKey ?? job.id ?? '—')}</code></details></div>`; }).join('')}${taskPages > 1 ? `<div class="sync-task-pagination"><button class="secondary" data-task-prev="${escapeSync(storeId)}" ${taskPage <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${taskPage} / ${taskPages} 页 · 共 ${storeJobs.length} 个任务</span><button class="secondary" data-task-next="${escapeSync(storeId)}" ${taskPage >= taskPages ? 'disabled' : ''}>下一页</button></div>` : ''}</div></article>`; }).join('')}</div>` : '<div class="empty">暂无同步任务记录</div>';
      results.querySelectorAll<HTMLButtonElement>('[data-toggle-sync-store^="tasks:"]').forEach((button) => { button.onclick = () => { const id = button.dataset.toggleSyncStore!; expandedSyncStoreIds.has(id) ? expandedSyncStoreIds.delete(id) : expandedSyncStoreIds.add(id); button.setAttribute('aria-expanded', String(expandedSyncStoreIds.has(id))); const items = button.nextElementSibling as HTMLElement | null; if (items) items.hidden = !expandedSyncStoreIds.has(id); }; });
      results.querySelectorAll<HTMLButtonElement>('[data-task-prev],[data-task-next]').forEach((button) => { button.onclick = () => { const storeId = button.dataset.taskPrev ?? button.dataset.taskNext; if (!storeId) return; const page = taskPageByStore.get(storeId) ?? 1; taskPageByStore.set(storeId, page + (button.dataset.taskNext ? 1 : -1)); void load(); }; });
      const paginationEl = main.querySelector<HTMLElement>('[data-sync-pagination]')!;
      paginationEl.innerHTML = `<span>共 ${groupedEntries.length} 家店铺 · 展开店铺查看任务</span>`;
      paginationEl.querySelector<HTMLButtonElement>('[data-sync-prev]')?.addEventListener('click', () => { currentPage -= 1; void load(); });
      paginationEl.querySelector<HTMLButtonElement>('[data-sync-next]')?.addEventListener('click', () => { currentPage += 1; void load(); });
    } catch (error) {
      const syncCount = main.querySelector<HTMLElement>('[data-sync-count]');
      if (syncCount) syncCount.textContent = '读取失败';
      results.innerHTML = `<div class="empty error">${escapeSync(error instanceof Error ? error.message : '同步状态读取失败')}</div>`;
    }
  };
  main.querySelector<HTMLButtonElement>('[data-refresh-sync]')!.onclick = () => { void load(); };
  main.querySelector<HTMLButtonElement>('[data-refresh-runtime]')!.onclick = async (event) => { const button = event.currentTarget as HTMLButtonElement; button.disabled = true; try { const response = await fetch('http://localhost:3000/api/operations/runtime-status', { credentials: 'include' }); const body = await response.json() as { data?: any; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? '运行环境状态读取失败'); renderRuntimeStatus(main.querySelector<HTMLElement>('[data-runtime-status]')!, body.data, canManage); } catch (error) { main.querySelector<HTMLElement>('[data-runtime-status]')!.textContent = error instanceof Error ? error.message : '运行环境状态读取失败'; } finally { button.disabled = false; } };
  await load();
}

function escapeSync(value: unknown): string { return String(value ?? '—').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] ?? char)); }
export function visibleNavigation(nav: readonly string[], role: 'admin' | 'member'): string[] {
  return role === 'admin' ? [...nav] : nav.filter((item) => !['Members', 'Stores', 'Costs', 'Profit'].includes(item));
}

const navigationLabels: Record<string, string> = {
  Dashboard: '仪表盘', Items: '商品', Orders: '订单', Returns: '退货', Inventory: '库存',
  WFS: '货件', 面板: '外部库存监控', 商品分析: '商品分析', 商品评论: '商品评论', ALLSKU2026: 'SKU归属',
  Pricing: '价格/促销', Advertising: '广告', Performance: '绩效', Targets: '经营目标',
  Profit: '利润粗算', Costs: '成本表', Members: '成员', Stores: '店铺', 'Sync Status': '同步状态', Weather: '天气气候',
};

const navigationSections = [
  { label: '工作台', pages: ['Dashboard'] },
  { label: '销售运营', pages: ['Items', 'Orders', 'Returns', 'Inventory', 'WFS', 'Targets'] },
  { label: '商品洞察', pages: ['面板', '商品分析', '商品评论', 'ALLSKU2026', 'Pricing', 'Advertising', 'Performance'] },
  { label: '外部数据', pages: ['Weather'] },
  { label: '系统管理', pages: ['Profit', 'Costs', 'Members', 'Stores', 'Sync Status'] },
];

export function mobileNavigationControlsMarkup(): string {
  return '<button type="button" class="mobile-menu-toggle" data-sidebar-toggle aria-controls="app-sidebar" aria-expanded="false" aria-label="打开导航"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button><button type="button" class="app-shell-backdrop" data-sidebar-backdrop aria-label="关闭导航" hidden></button>';
}

function bindMobileNavigation(root: HTMLElement): void {
  const sidebar = root.querySelector<HTMLElement>('#app-sidebar');
  const toggle = root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
  const backdrop = root.querySelector<HTMLButtonElement>('[data-sidebar-backdrop]');
  const navigation = root.querySelector<HTMLElement>('.app-navigation');
  if (!sidebar || !toggle || !backdrop) return;

  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  const setOpen = (open: boolean, restoreFocus = false) => {
    const mobile = isMobile();
    const expanded = mobile && open;
    root.querySelector('.shell')?.classList.toggle('sidebar-open', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? '关闭导航' : '打开导航');
    backdrop.hidden = !expanded;
    sidebar.inert = mobile && !expanded;
    if (expanded) navigation?.querySelector<HTMLButtonElement>('.nav')?.focus();
    else if (restoreFocus) toggle.focus();
  };

  toggle.onclick = () => setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  backdrop.onclick = () => setOpen(false, true);
  navigation?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('.nav')) setOpen(false);
  });
  if (root.dataset.mobileNavigationBound !== 'true') {
    root.dataset.mobileNavigationBound = 'true';
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.querySelector('.shell')?.classList.contains('sidebar-open')) {
        root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.click();
        root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')?.focus();
      }
    });
    window.addEventListener('resize', () => {
      const currentSidebar = root.querySelector<HTMLElement>('#app-sidebar');
      const currentToggle = root.querySelector<HTMLButtonElement>('[data-sidebar-toggle]');
      const currentBackdrop = root.querySelector<HTMLButtonElement>('[data-sidebar-backdrop]');
      if (!currentSidebar || !currentToggle || !currentBackdrop) return;
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      if (!mobile) {
        root.querySelector('.shell')?.classList.remove('sidebar-open');
        currentToggle.setAttribute('aria-expanded', 'false');
        currentToggle.setAttribute('aria-label', '打开导航');
        currentBackdrop.hidden = true;
      }
      currentSidebar.inert = mobile && !root.querySelector('.shell')?.classList.contains('sidebar-open');
    });
  }
  setOpen(false);
}

function decorateNavigation(root: HTMLElement, nav: readonly string[]): void {
  root.querySelector('aside')?.classList.add('app-sidebar');
  const navigation = root.querySelector<HTMLElement>('aside nav');
  if (!navigation) return;
  navigation.classList.add('app-navigation');
  navigation.setAttribute('aria-label', '主导航');
  const buttons = [...navigation.querySelectorAll<HTMLButtonElement>('.nav')];
  const byPage = new Map(buttons.map((button) => [button.textContent?.trim() ?? '', button]));
  navigation.replaceChildren();

  for (const section of navigationSections) {
    const pages = section.pages.filter((page) => nav.includes(page));
    if (!pages.length) continue;
    const group = document.createElement('section');
    group.className = 'nav-section';
    const heading = document.createElement('h2');
    heading.className = 'nav-section-title';
    heading.textContent = section.label;
    group.append(heading);
    for (const page of pages) {
      const button = byPage.get(page);
      if (!button) continue;
      button.dataset.page = page;
      button.dataset.label = navigationLabels[page] ?? page;
      button.setAttribute('aria-label', navigationLabels[page] ?? page);
      if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
      group.append(button);
    }
    navigation.append(group);
  }

  navigation.addEventListener('click', () => {
    navigation.querySelectorAll<HTMLButtonElement>('.nav').forEach((button) => {
      if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  });
}

let dashboardRole: 'admin' | 'member' = 'admin';
export async function renderDashboard(root: HTMLElement, nav: readonly string[], role: 'admin' | 'member' = dashboardRole) {
  dashboardRole = role;
  let activateCachedPage: ((key: string, render?: (main: HTMLElement) => Promise<void>, forceRender?: boolean) => Promise<HTMLElement>) | undefined;
  root.innerHTML = `<div class="shell">${mobileNavigationControlsMarkup()}<aside id="app-sidebar"><div class="brand">Walmart<span>ERP</span></div><nav>${nav.map((x,i)=>`<button class="nav ${i===0?'active':''}">${x}</button>`).join('')}</nav><div class="user"><span>${role === 'member' ? '成员' : '管理员'}</span><button class="logout-button" type="button" data-logout>退出登录</button><small data-logout-status role="status" aria-live="polite"></small></div></aside><main><header><div><p class="eyebrow">经营概览</p><h1>Dashboard</h1></div><div class="fresh">数据更新时间<br><strong>读取中...</strong></div></header><section class="metrics"><article><span>销售额</span><strong>$0.00</strong></article><article><span>订单数</span><strong>0</strong></article><article><span>销售件数</span><strong>0</strong></article><article><span>数据状态</span><strong class="ok">读取中</strong></article></section></main></div>`;
  decorateNavigation(root, nav);
  bindMobileNavigation(root);
  root.querySelector<HTMLElement>('main')!.dataset.role = role;
  root.querySelector<HTMLButtonElement>('[data-logout]')!.onclick = async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const status = root.querySelector<HTMLElement>('[data-logout-status]')!;
    button.disabled = true;
    status.textContent = '正在退出...';
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('退出失败，请重试');
      localStorage.removeItem('erp_session');
      window.location.reload();
    } catch {
      status.textContent = '退出失败，请检查连接后重试';
      button.disabled = false;
    }
  };
  root.querySelectorAll<HTMLButtonElement>('.nav').forEach((button) => button.onclick = async () => { root.querySelector('.nav.active')?.classList.remove('active'); button.classList.add('active'); const main = root.querySelector<HTMLElement>('main')!; if (button.textContent === 'Weather') { await renderWeatherPage(main); return; } if (button.textContent === 'Dashboard') { await renderDashboard(root, nav, role); return; } if (button.textContent === 'Orders') { await renderOrdersPage(main, (id) => { void openOrderDetailModal(id); }); return; } if (button.textContent === 'Returns') { await renderReturnsPage(main); return; } if (button.textContent === 'Inventory') { await renderInventoryPage(main); return; } if (button.textContent === 'WFS') { await renderWfsPage(main); return; } if (button.textContent === 'Members') { await renderMembersPage(main); return; } if (button.textContent === 'Sync Status') { await renderSyncStatusPage(main); return; } if (button.textContent === 'Items') { try { const response = await fetch('http://localhost:3000/api/items', { credentials: 'include' }); const body = await response.json() as { data?: Item[]; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? '商品读取失败'); renderItemsPage(main, body.data ?? []); } catch (error) { main.innerHTML = `<section class="panel"><div class="empty error">${error instanceof Error ? error.message : '商品读取失败'}</div></section>`; } return; } if (button.textContent !== 'Stores') return; const stores = await listStores(); main.innerHTML = `<header><div><p class="eyebrow">店铺管理</p><h1>Stores</h1></div></header><section class="panel"><form id="store-form"><input name="id" placeholder="店铺 ID" required><input name="name" placeholder="店铺名称" required><select name="environment"><option value="sandbox">Sandbox</option><option value="production">Production</option></select><button class="primary">添加店铺</button></form><div class="store-list">${stores.length ? stores.map((s) => `<div class="item-row store-entry"><div><strong>${s.name}</strong><span>${s.id} · ${s.environment} · ${s.status}</span></div><form class="credential-form" data-store-id="${s.id}"><input name="clientId" placeholder="Client ID" required><input name="clientSecret" type="password" placeholder="Client Secret" required><button class="secondary" type="submit">保存凭证</button><small class="credential-status"></small></form></div>`).join('') : '<div class="empty">暂无店铺</div>'}</div></section>`; root.querySelector<HTMLFormElement>('#store-form')!.onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); await createStore({ id: String(form.get('id')), name: String(form.get('name')), environment: form.get('environment') as 'sandbox' | 'production' }); location.reload(); }; root.querySelectorAll<HTMLFormElement>('.credential-form').forEach((form) => { form.onsubmit = async (event) => { event.preventDefault(); const data = new FormData(form); const ok = await configureStoreCredentials(form.dataset.storeId!, String(data.get('clientId')), String(data.get('clientSecret'))); const status = form.querySelector('.credential-status'); if (status) status.textContent = ok ? '已加密保存' : '保存失败'; if (ok) form.reset(); }; }); });
  const membersButton = [...root.querySelectorAll<HTMLButtonElement>('.nav')].find((button) => button.textContent === 'Members');
  if (membersButton) membersButton.onclick = async () => {
    root.querySelector('.nav.active')?.classList.remove('active');
    membersButton.classList.add('active');
    await renderMembersPage(root.querySelector<HTMLElement>('main')!);
  };
  if (root.dataset.wfsAnomalyNavigationBound !== 'true') {
    root.dataset.wfsAnomalyNavigationBound = 'true';
    root.addEventListener('open-wfs-shipment-anomalies', (event) => {
      const shipmentIds = (event as CustomEvent<string[]>).detail;
      if (!Array.isArray(shipmentIds) || !shipmentIds.length) return;
      void activateCachedPage?.('WFS', (main) => renderWfsPage(main, { anomalyShipmentIds: shipmentIds }), true);
    });
  }
  const storesMain = root.querySelector<HTMLElement>('main');
  let enhanceStoresForPage: (main: HTMLElement) => void = () => {};
  if (storesMain) {
    enhanceStoresForPage = (storesMain: HTMLElement) => {
      if (!storesMain.querySelector('#store-form') || storesMain.querySelector('#wecom-config-form') || storesMain.querySelector('#lingxing-config-form')) return;
      const panel = document.createElement('section');
      panel.className = 'panel';
      panel.innerHTML = '<div class="panel-head"><h2>企微智能文档同步</h2><span class="sync-status-badge">统一配置</span></div><p class="muted">使用脚本同源的 MCP API Key（URL 中的 apikey）访问智能文档。</p><form id="wecom-config-form" class="wecom-config-form"><label>MCP API Key<input name="apiKey" type="password" placeholder="脚本中的 apikey" autocomplete="new-password" required></label><label>Bot ID（可选）<input name="botId" placeholder="企业微信 Bot ID"></label><label>Secret（可选）<input name="secret" type="password" placeholder="企业微信 Secret" autocomplete="new-password"></label><label>智能文档 URL<input name="documentUrl" placeholder="智能文档 URL" required></label><label>子表 ID<input name="tableId" placeholder="子表 ID" required></label><div class="wecom-config-actions"><button class="secondary" type="submit">保存 Bot 配置</button><small class="wecom-config-status" role="status" aria-live="polite"></small></div></form>';
      const storeForm = storesMain.querySelector('#store-form');
      const storeSection = storeForm?.closest('section');
      if (storeSection) storeSection.before(panel); else storesMain.prepend(panel);
      const form = panel.querySelector<HTMLFormElement>('#wecom-config-form')!;
      form.onsubmit = async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const status = form.querySelector<HTMLElement>('.wecom-config-status')!;
        status.className = 'wecom-config-status';
        status.textContent = '保存中...';
        try {
          const response = await fetch('/api/wecom/head-freight/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ apiKey: data.get('apiKey'), botId: data.get('botId'), secret: data.get('secret'), documentUrl: data.get('documentUrl'), tableId: data.get('tableId') }) });
          const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          if (!response.ok) throw new Error(body?.error?.message ?? `保存失败（HTTP ${response.status}）`);
          status.className = 'wecom-config-status success';
          status.textContent = '已加密保存';
          form.reset();
        } catch (error) {
          status.className = 'wecom-config-status error';
          status.textContent = error instanceof Error ? error.message : '保存失败';
        }
      };
      const lingxingPanel = document.createElement('section');
      lingxingPanel.className = 'panel';
      lingxingPanel.innerHTML = '<div class="panel-head"><h2>领星广告费用同步</h2><span class="sync-status-badge">租户配置</span></div><p class="muted">领星 MCP API Key 加密保存到数据库，综合同步每天 20:00 使用该配置。</p><form id="lingxing-config-form" class="wecom-config-form"><label>领星 MCP API Key<input name="apiKey" type="password" placeholder="请输入领星 MCP API Key" autocomplete="new-password" required></label><label>广告账户 ID（逗号分隔）<input name="advertiserIds" placeholder="251287,355899" required></label><div class="wecom-config-actions"><button class="secondary" type="submit">保存领星配置</button><small class="lingxing-config-status" role="status" aria-live="polite"></small></div></form>';
      if (storeSection) storeSection.before(lingxingPanel); else storesMain.prepend(lingxingPanel);
      const lingxingForm = lingxingPanel.querySelector<HTMLFormElement>('#lingxing-config-form')!;
      lingxingForm.onsubmit = async (event) => {
        event.preventDefault();
        const data = new FormData(lingxingForm);
        const status = lingxingForm.querySelector<HTMLElement>('.lingxing-config-status')!;
        status.className = 'lingxing-config-status';
        status.textContent = '保存中...';
        try {
          const response = await fetch('/api/lingxing/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ apiKey: data.get('apiKey'), advertiserIds: data.get('advertiserIds') }) });
          const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          if (!response.ok) throw new Error(body?.error?.message ?? `保存失败（HTTP ${response.status}）`);
          status.className = 'lingxing-config-status success';
          status.textContent = '已加密保存';
          lingxingForm.reset();
        } catch (error) {
          status.className = 'lingxing-config-status error';
          status.textContent = error instanceof Error ? error.message : '保存失败';
        }
      };
    };
    const storesObserver = new MutationObserver(() => {
      const currentStoresMain = root.querySelector<HTMLElement>('main[data-page="Stores"]');
      if (currentStoresMain) enhanceStoresForPage(currentStoresMain);
    });
    storesObserver.observe(root, { childList: true, subtree: true });
    enhanceStoresForPage(storesMain);
  }
  const marketingRoutes: Record<string, (main: HTMLElement) => Promise<void>> = {
    ALLSKU2026: renderAllSkuPage,
    Pricing: renderPricingPage,
    Advertising: renderAdvertisingChartPage,
    Performance: renderPerformanceSummaryPage,
    '商品分析': renderProductAnalysisPage,
  };
  const brightDataButton = [...root.querySelectorAll<HTMLButtonElement>('.nav')].find((button) => button.textContent === '面板');
  if (brightDataButton) brightDataButton.onclick = async () => {
    root.querySelector('.nav.active')?.classList.remove('active');
    brightDataButton.classList.add('active');
    await renderBrightDataPanel(root.querySelector<HTMLElement>('main')!);
  };
  root.querySelectorAll<HTMLButtonElement>('.nav').forEach((button) => {
    const render = marketingRoutes[button.textContent ?? ''];
    if (!render) return;
    button.onclick = async () => {
      root.querySelector('.nav.active')?.classList.remove('active');
      button.classList.add('active');
      await render(root.querySelector<HTMLElement>('main')!);
    };
  });
  const initialMain = root.querySelector<HTMLElement>('main');
  const targetsButton = [...root.querySelectorAll<HTMLButtonElement>('.nav')].find((button) => button.textContent === 'Targets');
  if (targetsButton) targetsButton.onclick = async () => { root.querySelector('.nav.active')?.classList.remove('active'); targetsButton.classList.add('active'); await renderTargetsPage(root.querySelector<HTMLElement>('main')!, role); };

  if (!initialMain) return;
  initialMain.dataset.page = 'Dashboard';
  const pageCache = createNavigationPageCache('Dashboard', initialMain);
  let activeMain = initialMain;
  const pageRenderers: Record<string, (main: HTMLElement) => Promise<void>> = {
    Dashboard: renderDashboardPage,
    Orders: async (main) => {
      await renderOrdersPage(main, (id) => { void openOrderDetailModal(id); });
    },
    Returns: renderReturnsPage,
    Inventory: renderInventoryPage,
    WFS: renderWfsPage,
    Profit: renderProfitPage,
    Costs: renderCostsPage,
    Members: renderMembersPage,
    Stores: renderStoresPage,
    'Sync Status': renderSyncStatusPage,
    Items: async (main) => {
      main.innerHTML = '<header><div><h1>商品</h1></div></header><div class="loading">正在加载商品…</div>';
      try {
        const response = await fetch('/api/items', { credentials: 'include' });
        const body = await response.json() as { data?: Item[]; error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? '商品读取失败');
        renderItemsPage(main, body.data ?? []);
      } catch (error) {
        main.innerHTML = `<section class="panel"><div class="empty error">${escapeSync(error instanceof Error ? error.message : '商品读取失败')}</div></section>`;
      }
    },
    Weather: renderWeatherPage,
    Targets: (main) => renderTargetsPage(main, role),
    面板: renderBrightDataPanel,
    商品评论: (main) => renderProductReviewsPage(main, role),
    商品分析: renderProductAnalysisPage,
    ALLSKU2026: renderAllSkuPage,
    Pricing: renderPricingPage,
    Advertising: renderAdvertisingChartPage,
    Performance: renderPerformanceSummaryPage,
  };
  pageCache.initialize('Dashboard', renderDashboardPage).catch((error) => {
    initialMain.innerHTML = `<section class="panel"><div class="empty error">${escapeSync(error instanceof Error ? error.message : '仪表盘读取失败')}</div></section>`;
  });

  activateCachedPage = async (key, overrideRenderer, forceRender = false) => {
    const button = [...root.querySelectorAll<HTMLButtonElement>('.nav')].find((item) => item.dataset.page === key);
    if (button) {
      root.querySelector('.nav.active')?.classList.remove('active');
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    }
    const pageMain = pageCache.getOrCreate(key, () => {
      const next = document.createElement('main');
      next.dataset.role = role;
      next.dataset.page = key;
      return next;
    });
    if (pageMain !== activeMain) {
      activeMain.replaceWith(pageMain);
      activeMain = pageMain;
    }
    if (key === 'Stores') {
      pageMain.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ''; });
    }
    const renderer = overrideRenderer ?? pageRenderers[key];
    if (!renderer) return pageMain;
    if (forceRender || key === 'Profit') {
      try {
        if (pageCache.isInitialized(key)) {
          await renderer(pageMain);
          if (key === 'Stores') enhanceStoresForPage(pageMain);
        } else {
          await pageCache.initialize(key, async (main) => {
            await renderer(main);
            if (key === 'Stores') enhanceStoresForPage(main);
          });
        }
      } catch (error) {
        pageMain.innerHTML = `<section class="panel"><div class="empty error">${escapeSync(error instanceof Error ? error.message : '页面读取失败')}</div></section>`;
      }
      return pageMain;
    }
    try {
      await pageCache.initialize(key, async (main) => {
        await renderer(main);
        if (key === 'Stores') enhanceStoresForPage(main);
      });
    } catch (error) {
      pageMain.innerHTML = `<section class="panel"><div class="empty error">${escapeSync(error instanceof Error ? error.message : '页面读取失败')}</div></section>`;
    }
    return pageMain;
  };
  root.querySelectorAll<HTMLButtonElement>('.nav').forEach((button) => {
    button.onclick = () => { void activateCachedPage?.(button.dataset.page ?? button.textContent?.trim() ?? ''); };
  });
}
