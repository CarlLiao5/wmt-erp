import { describe, expect, it } from 'vitest'; import { syncJobId } from './queue.js';
describe('sync queue',()=>{ it('derives the same id for overlapping duplicate windows',()=>{ const input={tenantId:'t',storeId:'s',resource:'orders',window:{from:'2026-01-01',to:'2026-01-02'}}; expect(syncJobId(input)).toBe(syncJobId({...input})); }); });
