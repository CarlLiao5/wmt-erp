import { describe, expect, it } from 'vitest';
import { renderIncrementalPlansHtml, renderSyncPlanCoverageHtml } from './SyncStatusPage.js';

describe('Sync Status plan coverage', () => {
  it('renders the order API boundary instead of claiming full history', () => {
    const html = renderSyncPlanCoverageHtml({ status: 'partial', resources: [{ resource: 'orders', coverageFrom: '2026-04-19', coverageTo: '2026-10-16', boundaryReason: 'orders_api_180_day_limit', windowCount: 6, completedWindows: 6, failedWindows: 0 }] });
    expect(html).toContain('最近 180 天');
    expect(html).toContain('2026-04-19');
    expect(html).toContain('部分完成');
  });

  it('renders retryable failed windows as an actionable state', () => {
    const html = renderSyncPlanCoverageHtml({ status: 'partial', resources: [{ resource: 'returns', windowCount: 2, completedWindows: 1, failedWindows: 1, lastError: '429' }] });
    expect(html).toContain('可重试');
    expect(html).toContain('429');
  });

  it('keeps sync controls out of the member read-only view', () => {
    const html = renderIncrementalPlansHtml([], [{ id: 'store-1', name: 'My Store' }], new Set(), false);
    expect(html).toContain('My Store');
    expect(html).not.toContain('data-toggle-incremental-store');
    expect(html).not.toContain('暂停此店铺');
  });

  it('keeps store sync controls available to administrators', () => {
    const html = renderIncrementalPlansHtml([], [{ id: 'store-1', name: 'My Store' }]);
    expect(html).toContain('data-toggle-incremental-store="store-1"');
    expect(html).toContain('开启此店铺');
  });

  it('does not render tenant-wide plans in the store plan list', () => {
    const html = renderIncrementalPlansHtml([
      { id: 'tenant-weather', storeId: '__tenant__', storeName: '综合同步', resource: 'weather', status: 'planned', enabled: true, intervalMinutes: 720, overlapDays: 0, nextRunAt: null, windowCount: 0, completedWindows: 0, failedWindows: 0, latestWindow: null },
      { id: 'store-orders', storeId: 'store-1', storeName: 'My Store', resource: 'orders', status: 'planned', enabled: true, intervalMinutes: 15, overlapDays: 5, nextRunAt: null, windowCount: 0, completedWindows: 0, failedWindows: 0, latestWindow: null },
    ], [{ id: 'store-1', name: 'My Store' }]);
    expect(html).toContain('My Store');
    expect(html).not.toContain('综合同步');
    expect(html).not.toContain('weather');
  });
});
