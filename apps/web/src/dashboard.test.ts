import { describe, expect, it } from 'vitest';
import { freightTrackingResultSummary, mobileNavigationControlsMarkup, renderFreightTrackingSyncAction, renderWfsFeePreviewSyncAction, syncTaskResultSummary, visibleNavigation, wfsFeePreviewResultSummary } from './dashboard.js';
import { createNavigationPageCache } from './navigationPageCache.js';

const navigation = ['Dashboard', 'Items', 'Members', 'Stores', 'Sync Status'] as const;

describe('visibleNavigation', () => {
  it('hides administration pages from members', () => {
    expect(visibleNavigation(navigation, 'member')).toEqual(['Dashboard', 'Items', 'Sync Status']);
  });

  it('keeps administration pages visible for administrators', () => {
    expect(visibleNavigation(navigation, 'admin')).toEqual([...navigation]);
  });
});

describe('mobile navigation controls', () => {
  it('provides an accessible menu toggle and closeable backdrop', () => {
    const markup = mobileNavigationControlsMarkup();
    expect(markup).toContain('aria-controls="app-sidebar"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-label="打开导航"');
    expect(markup).toContain('aria-label="关闭导航"');
  });
});

describe('navigation page cache', () => {
  it('creates a page once and initializes it only once', async () => {
    const cache = createNavigationPageCache('Dashboard', { page: 'dashboard' });
    let creates = 0;
    let renders = 0;

    const page = cache.getOrCreate('Orders', () => {
      creates += 1;
      return { page: 'orders' };
    });
    await cache.initialize('Orders', async (value) => {
      expect(value).toBe(page);
      renders += 1;
    });
    await cache.initialize('Orders', async () => { renders += 1; });

    expect(cache.getOrCreate('Orders', () => ({ page: 'replacement' }))).toBe(page);
    expect(creates).toBe(1);
    expect(renders).toBe(1);
  });

  it('allows a failed first render to be retried', async () => {
    const cache = createNavigationPageCache('Dashboard', { page: 'dashboard' });
    let attempts = 0;
    cache.getOrCreate('Orders', () => ({ page: 'orders' }));

    await expect(cache.initialize('Orders', async () => {
      attempts += 1;
      throw new Error('temporary failure');
    })).rejects.toThrow('temporary failure');
    await cache.initialize('Orders', async () => { attempts += 1; });

    expect(cache.isInitialized('Orders')).toBe(true);
    expect(attempts).toBe(2);
  });
});

describe('freight tracking sync controls', () => {
  it('shows one tenant-level sync action only to administrators', () => {
    expect(renderFreightTrackingSyncAction('admin')).toContain('data-sync-resource="freight-tracking"');
    expect(renderFreightTrackingSyncAction('admin')).toContain('data-store-id="__tenant__"');
    expect(renderFreightTrackingSyncAction('member')).toBe('');
  });

  it('summarizes freight tracking counters without exposing credential fields', () => {
    expect(freightTrackingResultSummary({
      resource: 'freight-tracking', sourceShipments: 20, matched: 18, queried: 10, written: 7,
      notFound: 1, skippedDelivered: 2, skippedStale: 3, skippedUnmatched: 2, failed: 2,
      errors: [{ brand: 'qitexp', inboundNumber: 'QT1001', message: 'request failed' }],
      username: 'private-user', password: 'private-password', token: 'private-token',
    })).toBe('货件 20 · 已识别 18 · 查询 10 · 写入 7 · 未找到 1 · 已签收跳过 2 · 30 天无更新跳过 3 · 未识别前缀 2 · 失败 2');
  });
});

describe('WFS ITS fee preview sync controls', () => {
  it('renders the per-store action only for administrators', () => {
    expect(renderWfsFeePreviewSyncAction('admin', 'store-1')).toContain('data-sync-resource="wfs-inbound-preview"');
    expect(renderWfsFeePreviewSyncAction('admin', 'store-1')).toContain('data-store-id="store-1"');
    expect(renderWfsFeePreviewSyncAction('member', 'store-1')).toBe('');
  });

  it('shows the backfill outcome counters', () => {
    expect(wfsFeePreviewResultSummary({ scanned: 12, eligible: 8, previewed: 5, unchanged: 1, skipped: 4, noItsOption: 1, failed: 2 }))
      .toBe('扫描 12 · 符合 8 · 已预估 5 · 未变化 1 · 跳过 4 · 无 ITS 方案 1 · 失败 2');
  });
});

describe('sync task result summary', () => {
  it('shows normalized inventory rows instead of reporting zero writes', () => {
    expect(syncTaskResultSummary({ resource: 'inventory', received: 225, normalized: 225 }))
      .toBe('写入 225 · 接收 225');
  });
});
