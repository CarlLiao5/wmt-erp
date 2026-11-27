import { describe, expect, it } from 'vitest';
import { collectReconReportPages, latestReconReportDate } from './syncStorageFees.js';

describe('Recon Report storage fee sync', () => {
  it('selects the newest available report date that is not after the sync window', () => {
    expect(latestReconReportDate(['10062026', '10072025', '09222026'], '2026-10-08T23:59:59.999Z')).toBe('10062026');
    expect(latestReconReportDate(['10062026', '09222026'], '2026-10-01T00:00:00.000Z')).toBe('09222026');
  });

  it('stages every page before returning and rejects incomplete fetches', async () => {
    const fetchPage = async (_date: string, offset: number) => {
      if (offset === 0) return { data: { nextOffset: 2, reportDetails: [{ Amount: '-1' }, { Amount: '-2' }] }, correlationId: 'p1' };
      if (offset === 2) return { data: { reportDetails: [{ Amount: '-3' }] }, correlationId: 'p2' };
      throw new Error('unexpected offset');
    };
    await expect(collectReconReportPages('10062026', fetchPage, 2)).resolves.toEqual([
      { offset: 0, data: { nextOffset: 2, reportDetails: [{ Amount: '-1' }, { Amount: '-2' }] }, correlationId: 'p1' },
      { offset: 2, data: { reportDetails: [{ Amount: '-3' }] }, correlationId: 'p2' },
    ]);
    await expect(collectReconReportPages('10062026', async (_date, offset) => {
      if (offset === 0) return { data: { nextOffset: 2, reportDetails: [{ Amount: '-1' }, { Amount: '-2' }] }, correlationId: 'p1' };
      throw new Error('page fetch failed');
    }, 2)).rejects.toThrow('page fetch failed');
  });
});
