export interface SyncPlanResourceView { resource: string; status?: string; coverageFrom?: string | null; coverageTo?: string | null; boundaryReason?: string | null; windowCount: number; completedWindows: number; failedWindows: number; lastError?: string | null; }
export interface SyncPlanView { status: string; resources: SyncPlanResourceView[]; }
export interface IncrementalPlanView {
  id: string;
  storeId: string;
  storeName: string;
  resource: string;
  status: string;
  enabled: boolean;
  intervalMinutes: number;
  overlapDays: number;
  nextRunAt: string | null;
  windowCount: number;
  completedWindows: number;
  failedWindows: number;
  latestWindow: { status: string; windowFrom: string; windowTo: string; createdAt: string; lastError?: string | null } | null;
}

const labels: Record<string, string> = { orders: '订单', returns: '退货', inventory: '库存', 'wfs-inbound-preview': 'WFS ITS 费用预估', 'storage-fees': 'Recon 仓储费用', pricing: '价格', 'item-report': '商品报告', 'inventory-recon': 'WFS 月度库存对账', 'head-freight': '头程在途', 'smart-sheet-allsku2026': 'ALLSKU 表', 'freight-tracking': '物流轨迹', 'lingxing-advertising': '领星广告费用', 'lingxing-head-freight-costs': '领星货件 SKU 采购成本', advertising: '站内广告', 'advertising-onsite': '站内广告', 'advertising-sem': 'SEM 广告', 'advertising-sem-items': 'SEM 商品花费', 'advertising-sem-performance': 'SEM 逐日报表', 'advertising-sem-search-terms': 'SEM 搜索词', performance: '绩效' };
const boundaryText = (value?: string | null): string => value === 'orders_api_180_day_limit' ? '订单接口仅覆盖最近 180 天' : value ?? '';
const statusLabels: Record<string, string> = { planned: '待运行', queued: '排队中', running: '同步中', completed: '已完成', partial: '部分完成', failed: '失败' };

function escapeHtml(value: unknown): string {
  return String(value ?? '—').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

export function formatScheduleTime(value?: string | Date | null): string {
  if (!value) return '—';
  const rawValue = value instanceof Date ? value.toISOString() : value;
  const normalized = rawValue.replace(' ', 'T');
  const date = new Date(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? rawValue : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function formatInterval(minutes: number): string {
  if (minutes % 1440 === 0) return `每 ${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时`;
  return `每 ${minutes} 分钟`;
}

export function renderIncrementalPlansHtml(plans: IncrementalPlanView[], stores: Array<{ id: string; name?: string }> = [], expandedStoreIds: ReadonlySet<string> = new Set(), canManage = true): string {
  plans = plans.filter((plan) => plan.storeId !== '__tenant__');
  const storeMap = new Map(stores.map((store) => [store.id, store]));
  const storeIds = [...new Set([...stores.map((store) => store.id), ...plans.map((plan) => plan.storeId)])];
  if (!storeIds.length) return '<div class="empty">暂无店铺</div>';
  return `<div class="sync-schedule-list">${storeIds.map((storeId, index) => {
    const storePlans = plans.filter((plan) => plan.storeId === storeId);
    const enabledCount = storePlans.filter((plan) => plan.enabled).length;
    const enabled = storePlans.length > 0 && enabledCount === storePlans.length;
    const state = enabledCount > 0 && !enabled ? '部分开启' : enabled ? '已开启' : '已暂停';
    const storeName = storeMap.get(storeId)?.name ?? storePlans[0]?.storeName ?? storeId;
    const details = storePlans.length ? storePlans.map((plan) => {
      const latest = plan.latestWindow;
      const statusLabel = latest ? statusLabels[latest.status] ?? latest.status : plan.enabled ? '等待首次运行' : '已暂停';
      const windowRange = latest ? `${formatScheduleTime(latest.windowFrom)} 至 ${formatScheduleTime(latest.windowTo)}` : '暂无同步窗口';
      const latestError = latest?.status === 'failed' && latest.lastError ? `<small class="error">${escapeHtml(latest.lastError)}</small>` : '';
      return `<div class="sync-schedule-resource"><div class="sync-schedule-heading"><div><strong>${escapeHtml(labels[plan.resource] ?? plan.resource)}</strong><span>${plan.resource === 'inventory-recon' ? '每月 2 日、8 日北京时间 12:00 · 获取上月完整报告' : formatInterval(plan.intervalMinutes) + ' · 重叠 ' + plan.overlapDays + ' 天'}</span></div><span class="sync-schedule-state ${plan.enabled ? 'enabled' : 'paused'}">${plan.enabled ? '已开启' : '已暂停'}</span></div><div class="sync-schedule-details"><div><span>下次运行</span><strong>${plan.enabled ? formatScheduleTime(plan.nextRunAt) : '已暂停'}</strong></div><div><span>最近窗口</span><strong>${escapeHtml(statusLabel)} · ${windowRange}</strong>${latestError}</div><div><span>窗口进度</span><strong>完成 ${plan.completedWindows}/${plan.windowCount} · 失败 ${plan.failedWindows}</strong></div></div></div>`;
    }).join('') : '<div class="empty">该店铺尚未创建增量计划</div>';
    const expanded = expandedStoreIds.has(storeId);
    const resourcesId = `sync-store-resources-${index}`;
    const toggle = canManage ? `<button class="${enabled ? 'secondary' : 'primary'} sync-schedule-toggle" data-toggle-incremental-store="${escapeHtml(storeId)}" data-next-enabled="${enabled ? 'false' : 'true'}">${enabled ? '暂停此店铺' : '开启此店铺'}</button>` : '';
    return `<article class="sync-schedule-store"><div class="sync-schedule-store-heading"><button type="button" class="sync-schedule-store-disclosure" data-toggle-store-details="${escapeHtml(storeId)}" aria-expanded="${expanded}" aria-controls="${resourcesId}"><span class="sync-schedule-chevron" aria-hidden="true"></span><span class="sync-schedule-store-label"><strong>${escapeHtml(storeName)}</strong><span>${escapeHtml(storeId)} · ${storePlans.length ? `${enabledCount}/${storePlans.length} 项资源开启` : '未配置'}</span></span></button><span class="sync-schedule-state ${enabledCount ? 'enabled' : 'paused'}">${state}</span>${toggle}</div><div id="${resourcesId}" class="sync-schedule-resources${expanded ? '' : ' is-collapsed'}"${expanded ? '' : ' inert aria-hidden="true"'}>${details}</div></article>`;
  }).join('')}</div>`;
}

export function renderSyncPlanCoverageHtml(plan: SyncPlanView): string {
  return `<div class="sync-plan-summary"><strong>${plan.status === 'partial' ? '部分完成' : plan.status === 'completed' ? '已完成' : plan.status}</strong>${plan.resources.map((item) => `<div class="sync-plan-resource"><span>${labels[item.resource] ?? item.resource}</span><span>${item.completedWindows}/${item.windowCount} 个窗口</span><span>${item.coverageFrom ?? '暂无覆盖'}${item.coverageTo ? ` 至 ${item.coverageTo}` : ''}</span>${item.boundaryReason ? `<small>${boundaryText(item.boundaryReason)}</small>` : ''}${item.failedWindows ? `<small class="error">${item.failedWindows} 个窗口可重试${item.lastError ? `：${item.lastError}` : ''}</small>` : ''}</div>`).join('')}</div>`;
}
export function renderSyncPlanCoverage(root: HTMLElement, plan: SyncPlanView): void { root.innerHTML = renderSyncPlanCoverageHtml(plan); }
