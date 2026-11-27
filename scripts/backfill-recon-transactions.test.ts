import { describe, expect, it } from 'vitest';
import { planReconBackfill } from './backfill-recon-transactions.js';

const receivedAt = new Date('2026-10-07T00:00:00.000Z');
function archive(tenantId: string, sourceId: string, payload: unknown) {
  return { id: `${tenantId}:${sourceId}`, tenantId, storeId: 'store-1', sourceId, payload, receivedAt };
}

describe('Recon transaction archive backfill planner', () => {
  it('reconstructs report-wide row identities across pages and replays', () => {
    const duplicate = { 'Transaction ID': 'tx-same', 'Transaction Description': 'WFS StorageFee', Amount: '-10.00' };
    const pages = [
      archive('tenant-1', 'recon-report:10062026:0', { nextOffset: 1, reportDetails: [duplicate] }),
      archive('tenant-1', 'recon-report:10062026:1', { reportDetails: [duplicate] }),
    ];
    const first = planReconBackfill(pages);
    const replay = planReconBackfill(pages);
    expect(first).toHaveLength(1);
    expect(first[0].complete).toBe(true);
    expect(first[0].transactions.map((row) => row.sourceId)).toEqual(['recon-report:10062026', 'recon-report:10062026']);
    expect(first[0].transactions.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(first[0].transactions[0].transactionKey).not.toBe(first[0].transactions[1].transactionKey);
    expect(replay[0].transactions.map((row) => row.transactionKey)).toEqual(first[0].transactions.map((row) => row.transactionKey));
  });

  it('keeps identical store/report keys isolated by tenant', () => {
    const payload = { reportDetails: [{ 'Transaction Description': 'WFS StorageFee', Amount: '-1.00' }] };
    const plans = planReconBackfill([
      archive('tenant-a', 'recon-report:10062026:0', payload),
      archive('tenant-b', 'recon-report:10062026:0', payload),
    ]);
    expect(plans.map((plan) => `${plan.tenantId}:${plan.sourceId}`)).toEqual(['tenant-a:recon-report:10062026', 'tenant-b:recon-report:10062026']);
    expect(plans[0].transactions[0].transactionKey).toBe(plans[1].transactions[0].transactionKey);
    expect(plans[0].transactions[0].id).not.toBe(plans[1].transactions[0].id);
  });

  it('marks gaps and truncated archives incomplete so callers cannot clean report tails', () => {
    const pages = [
      archive('tenant-1', 'recon-report:10062026:0', { nextOffset: 1000, reportDetails: [{ 'Transaction Description': 'WFS StorageFee', Amount: '-1.00' }] }),
      archive('tenant-1', 'recon-report:10062026:2000', { reportDetails: [{ 'Transaction Description': 'WFS StorageFee', Amount: '-2.00' }] }),
    ];
    expect(planReconBackfill(pages)[0].complete).toBe(false);
  });

  it('rebuilds from the current mapping so an unmappable middle row is omitted', () => {
    const plan = planReconBackfill([archive('tenant-1', 'recon-report:10062026:0', { reportDetails: [
      { 'Transaction Description': 'WFS StorageFee', Amount: '-1.00' },
      { 'Transaction Description': 'WFS StorageFee' },
      { 'Transaction Description': 'WFS StorageFee', Amount: '-3.00' },
    ] })])[0]!;
    expect(plan.complete).toBe(true);
    expect(plan.transactions.map((row) => row.rowNumber)).toEqual([1, 3]);
    expect(plan.transactions.some((row) => row.rowNumber === 2)).toBe(false);
  });
});
