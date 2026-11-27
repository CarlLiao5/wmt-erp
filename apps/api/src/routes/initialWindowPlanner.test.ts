import { describe, expect, it } from 'vitest';
import { planInitialWindows } from './initialWindowPlanner.js';

describe('planInitialWindows', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');

  it('creates bounded 30-day windows for every initial resource', () => {
    const windows = planInitialWindows({
      planId: 'plan-1',
      tenantId: 'tenant-1',
      storeId: 'store-1',
      resource: 'orders',
      mode: 'initial',
      now,
    });

    expect(windows).toHaveLength(7);
    expect(windows[0]).toMatchObject({
      planId: 'plan-1',
      tenantId: 'tenant-1',
      storeId: 'store-1',
      resource: 'orders',
      status: 'planned',
      windowFrom: new Date('2026-04-19T00:00:00.000Z'),
      windowTo: new Date('2026-05-18T00:00:00.000Z'),
    });
    expect(windows.at(-1)).toMatchObject({
      windowFrom: new Date('2026-10-16T00:00:00.000Z'),
    });
    expect(new Set(windows.map((window) => window.batchId)).size).toBe(windows.length);
  });

  it.each(['returns', 'inventory', 'storage-fees', 'pricing', 'advertising', 'performance'])('creates at least one window for %s', (resource) => {
    const windows = planInitialWindows({
      planId: 'plan-1', tenantId: 'tenant-1', storeId: 'store-1', resource, mode: 'initial', now,
    });
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.every((window) => window.planId === 'plan-1' && window.status === 'planned')).toBe(true);
  });

  it('uses an explicit requested range and avoids future days', () => {
    const windows = planInitialWindows({
      planId: 'plan-1', tenantId: 'tenant-1', storeId: 'store-1', resource: 'pricing', mode: 'initial', now,
      requestedFrom: '2026-10-01', requestedTo: '2026-10-20',
    });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      windowFrom: new Date('2026-10-01T00:00:00.000Z'),
      windowTo: new Date('2026-10-16T00:00:00.000Z'),
    });
  });

  it('does not create initial windows for incremental plans', () => {
    expect(planInitialWindows({
      planId: 'plan-1', tenantId: 'tenant-1', storeId: 'store-1', resource: 'orders', mode: 'incremental', now,
    })).toEqual([]);
  });

  it('keeps the same window boundaries when a plan is retried on a later day', () => {
    const first = planInitialWindows({
      planId: 'plan-1', tenantId: 'tenant-1', storeId: 'store-1', resource: 'orders', mode: 'initial',
      now: new Date('2026-10-15T19:43:31.014Z'),
    });
    const retry = planInitialWindows({
      planId: 'plan-1', tenantId: 'tenant-1', storeId: 'store-1', resource: 'orders', mode: 'initial',
      now: new Date('2026-10-15T19:43:31.014Z'),
    });
    expect(retry.map(({ batchId, windowFrom, windowTo }) => ({ batchId, windowFrom, windowTo })))
      .toEqual(first.map(({ batchId, windowFrom, windowTo }) => ({ batchId, windowFrom, windowTo })));
  });
});

it('plans inventory reconciliation by calendar month, excluding the unfinished month',()=>{
 const windows=planInitialWindows({planId:'p',tenantId:'t',storeId:'s',resource:'inventory-recon',mode:'initial',now:new Date('2026-11-20Z'),requestedFrom:'2026-08-15',requestedTo:'2026-11-20'});
 expect(windows).toHaveLength(3);
 expect(windows[0].windowFrom.toISOString()).toBe('2026-08-01T00:00:00.000Z');
 expect(windows[2].windowTo.toISOString()).toBe('2026-10-31T23:59:59.999Z');
});
