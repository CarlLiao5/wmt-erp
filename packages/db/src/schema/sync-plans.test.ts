import { describe, expect, it } from 'vitest';
import { syncJobs } from './sync.js';
import { syncPlans, syncWindows } from './sync-plans.js';

describe('sync plan schema contracts', () => {
  it('defines a tenant/store/resource plan with mode and nullable requested bounds', () => {
    expect(syncPlans.tenantId.name).toBe('tenant_id');
    expect(syncPlans.storeId.name).toBe('store_id');
    expect(syncPlans.resource.name).toBe('resource');
    expect(syncPlans.mode.name).toBe('mode');
    expect(syncPlans.requestedFrom.name).toBe('requested_from');
    expect(syncPlans.requestedTo.name).toBe('requested_to');
    expect(syncPlans.status.name).toBe('status');
  });

  it('defines resumable windows with cursor, counts, coverage and source fields', () => {
    expect(syncWindows.planId.name).toBe('plan_id');
    expect(syncWindows.windowFrom.name).toBe('window_from');
    expect(syncWindows.windowTo.name).toBe('window_to');
    expect(syncWindows.cursor.name).toBe('cursor');
    expect(syncWindows.pageCount.name).toBe('page_count');
    expect(syncWindows.recordCount.name).toBe('record_count');
    expect(syncWindows.coverageFrom.name).toBe('coverage_from');
    expect(syncWindows.coverageTo.name).toBe('coverage_to');
    expect(syncWindows.source.name).toBe('source');
    expect(syncWindows.lastError.name).toBe('last_error');
  });

  it('links executable jobs to an optional sync window', () => {
    expect(syncJobs.syncWindowId.name).toBe('sync_window_id');
  });
});
