import { describe, expect, it } from 'vitest';
import { claimDuePlans } from './scheduler.js';
import { brightDataScheduleBatchId, enqueueDueBrightDataSchedules } from './brightdata-scheduler.js';

describe('incremental sync scheduler', () => {
  it('keeps the same scheduled day isolated between tenants', () => {
    expect(brightDataScheduleBatchId('tenant-1', new Date('2026-10-20T08:00:00.000Z'))).not.toBe(brightDataScheduleBatchId('tenant-2', new Date('2026-10-20T08:00:00.000Z')));
  });

  it('enqueues one deterministic tenant-level Bright Data run and advances to tomorrow', async () => {
    const statements: string[] = [];
    const dueSchedule = { tenantId: 'tenant-1', nextRunAt: new Date('2026-10-20T08:00:00.000Z') };
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string): Promise<[unknown, unknown]> => {
        statements.push(sql);
        if (sql.includes('FROM brightdata_sync_schedules')) return [[dueSchedule], []];
        return [[], []];
      },
    };
    const pool = { query: connection.query, getConnection: async () => connection };
    const queued: Array<{ tenantId: string; resource: string; batchId?: string }> = [];

    await enqueueDueBrightDataSchedules(pool, async (request) => { queued.push(request); return { id: 'job-1', jobId: 'job-1' }; }, new Date('2026-10-20T08:01:00.000Z'));

    expect(queued[0]).toMatchObject({ tenantId: 'tenant-1', resource: 'brightdata-inventory', batchId: brightDataScheduleBatchId('tenant-1', dueSchedule.nextRunAt), storeId: '__tenant__' });
    expect(statements.some((sql) => sql.includes('UPDATE brightdata_sync_schedules'))).toBe(true);
    expect(connection.commit).toBeDefined();
  });

  it('does not create another window while the plan already has pending work', async () => {
    const statements: string[] = [];
    const plan = {
      id: 'plan-1',
      tenantId: 'tenant-1',
      storeId: 'store-1',
      resource: 'orders',
      intervalMinutes: 15,
      overlapDays: 5,
      nextRunAt: new Date('2026-10-18T00:15:00.000Z'),
    };
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string) => {
        statements.push(sql);
        if (sql.includes('FROM sync_plans')) return [[plan], []];
        if (sql.includes('FROM sync_windows')) return [[{ id: 'pending-window' }], []];
        return [[], []];
      },
    };
    const pool = { query: connection.query, getConnection: async () => connection };

    await claimDuePlans(pool, new Date('2026-10-18T00:30:00.000Z'));

    expect(statements.some((sql) => sql.includes('INSERT INTO sync_windows'))).toBe(false);
    expect(statements.some((sql) => sql.includes('UPDATE sync_plans SET next_run_at'))).toBe(false);
  });

  it('advances a due plan by its configured interval instead of a shared clock time', async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = [];
    const plan = {
      id: 'plan-orders', tenantId: 'tenant-1', storeId: 'store-1', resource: 'orders',
      intervalMinutes: 15, overlapDays: 5, nextRunAt: new Date('2026-10-18T00:15:00.000Z'),
    };
    const connection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values });
        if (sql.includes('FROM sync_plans') && sql.includes('SELECT id')) return [[plan], []];
        return [[], []];
      },
    };
    const pool = { query: connection.query, getConnection: async () => connection };

    await claimDuePlans(pool, new Date('2026-10-18T00:30:00.000Z'));

    const advance = statements.find(({ sql }) => sql.includes('UPDATE sync_plans SET next_run_at'));
    expect(advance?.values?.[0]).toEqual(new Date('2026-10-18T00:45:00.000Z'));
  });
});

it('creates the previous complete month for inventory reconciliation',async()=>{
 const statements:Array<{sql:string;values?:any[]}>=[];
 const plan={id:'p-recon',tenantId:'t',storeId:'s',resource:'inventory-recon',intervalMinutes:43200,overlapDays:31,nextRunAt:new Date('2026-11-02T04:00Z')};
 const connection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  query:async(sql:string,values?:any[])=>{
   statements.push({sql,values});
   if(sql.includes("WHERE mode = 'incremental' AND enabled"))return [[plan],[]];
   return [[],[]];
  }};
 await claimDuePlans({getConnection:async()=>connection,query:connection.query},new Date('2026-11-02T04:01Z'));
 const insert=statements.find(s=>s.sql.includes('INSERT INTO sync_windows'))!;
 expect(insert.values?.[6]).toEqual(new Date('2026-10-01T00:00:00.000Z'));
 expect(insert.values?.[7]).toEqual(new Date('2026-10-31T23:59:59.999Z'));
 expect(statements.find(s=>s.sql.includes('UPDATE sync_plans SET next_run_at'))?.values?.[0]).toEqual(new Date('2026-11-08T04:00:00.000Z'));
});
