import { describe, expect, it, vi } from 'vitest';
import { getAvailableReconReportDates, getReconReportPage, normalizeReconStorageFees, normalizeReconTransactions, normalizeStorageFees, reconNextOffset } from './storageFees.js';

describe('storage fee normalization', () => {
  it('extracts storage and warehousing rows from payment statement details', () => {
    const rows = normalizeStorageFees({
      statement: { statementDate: '2026-10-06', currency: 'USD', transactions: [
        { feeType: 'WFS_STORAGE_FEE', amount: 12.5 },
        { feeType: 'referral fee', amount: 3 },
        { description: 'Warehousing charge', amount: '4.25' },
      ] },
    }, 'store-1');
    expect(rows).toEqual([
      { storeId: 'store-1', month: '2026-10', feeType: 'WFS_STORAGE_FEE', amount: 12.5, currency: 'USD' },
      { storeId: 'store-1', month: '2026-10', feeType: 'Warehousing charge', amount: 4.25, currency: 'USD' },
    ]);
  });

  it('returns no rows when the statement has no storage fee lines', () => {
    expect(normalizeStorageFees({ statement: { transactions: [{ feeType: 'referral fee', amount: 3 }] } }, 's')).toEqual([]);
  });

  it('extracts WFS storage fees from the payment statement transactionDetails envelope', () => {
    const rows = normalizeStorageFees({
      payload: {
        transactionDetails: {
          wfs: { netPayable: -33.7, wfsFulfillmentFee: -33.7, wfsStorageFee: -8.25 },
        },
      },
    }, 'prod-001');

    expect(rows).toEqual([{
      storeId: 'prod-001',
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
      feeType: 'wfsStorageFee',
      amount: 8.25,
      currency: 'USD',
    }]);
  });

  it('does not classify WFS fulfillment fees as storage fees', () => {
    expect(normalizeStorageFees({
      payload: { transactionDetails: { wfs: { wfsFulfillmentFee: -33.7 } } },
    }, 'prod-001')).toEqual([]);
  });
});

describe('Recon Report storage fee adapter', () => {
  const connection = { clientId: 'id', clientSecret: 'secret', environment: 'production' as const, baseUrl: 'https://example.test', accessToken: 'token', accessTokenExpiresAt: Date.now() + 300_000 };

  it('requests the V1 available reconciliation dates', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      expect(url.pathname).toBe('/v3/report/reconreport/availableReconFiles');
      expect(url.searchParams.get('reportVersion')).toBe('v1');
      return new Response(JSON.stringify({ availableApReportDates: ['10062026', '09292026'] }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(getAvailableReconReportDates(connection, fetcher)).resolves.toEqual(['10062026', '09292026']);
  });

  it('requests a JSON recon page with the documented pagination parameters', async () => {
    const fetcher = vi.fn(async (url: URL) => {
      expect(url.pathname).toBe('/v3/report/reconreport/reconFileJson');
      expect(url.searchParams.get('reportDate')).toBe('10062026');
      expect(url.searchParams.get('offset')).toBe('1000');
      expect(url.searchParams.get('noOfRecords')).toBe('1000');
      return new Response(JSON.stringify({ transactionDetails: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(getReconReportPage(connection, '10062026', 1000, 1000, fetcher)).resolves.toMatchObject({ status: 200 });
  });

  it('keeps only WFS StorageFee rows and uses the period end month', () => {
    expect(normalizeReconStorageFees({
      reportDate: '10062026',
      reportData: [
        { 'Period Start Date': '09/26/2026', 'Period End Date': '10/02/2026', 'Transaction Type': 'Service Fee', 'Transaction Description': 'WFS StorageFee', Amount: '-344.78' },
        { 'Period Start Date': '09/26/2026', 'Period End Date': '10/02/2026', 'Transaction Type': 'Service Fee', 'Transaction Description': 'WFS FulfillmentFee', Amount: '-99.00' },
        { 'Period Start Date': '09/26/2026', 'Period End Date': '10/02/2026', 'Transaction Type': 'Service Fee', 'Transaction Description': 'WFS LongTermStorageFee', Amount: '-12.00' },
      ],
    }, '10001578336', '10062026')).toEqual([{
      storeId: '10001578336',
      month: '2026-10',
      feeType: 'wfsStorageFee',
      amount: 344.78,
      currency: 'USD',
    }]);
  });

  it('continues from Walmart nextOffset when a report is paginated', () => {
    expect(reconNextOffset({ nextOffset: 2000, reportDetails: [{ 'Transaction Description': 'WFS StorageFee', Amount: '-1' }] }, 1000, 1000)).toBe(2000);
    expect(reconNextOffset({ hasMoreRecords: true, reportDetails: [{ 'Transaction Description': 'WFS StorageFee', Amount: '-1' }] }, 0, 1000)).toBe(1);
  });

  it('normalizes recon rows into stable, queryable transaction records', () => {
    const context = { tenantId: 'tenant-1', storeId: 'store-1', reportDate: '10062026', sourceId: 'recon-report:10062026:0', receivedAt: new Date('2026-10-07T00:00:00.000Z') };
    const payload = { reportData: [{
      'Transaction ID': 'txn-1', 'Transaction Description': 'WFS StorageFee', 'Transaction Type': 'Service Fee',
      'Customer Order #': 'CO-1', 'Purchase Order #': 'PO-1', 'Partner Item Id': 'SKU-1', 'Amount Type': 'Fee/Reimbursement',
      'Transaction Posted Timestamp': { value: '10/02/2026' }, 'Period Start Date': { date: '09/26/2026' }, 'Period End Date': '10/02/2026',
      Amount: { currencyAmount: '-344.78' }, Currency: 'USD',
    }] };
    const rows = normalizeReconTransactions(payload, context);
    expect(rows).toEqual([expect.objectContaining({
      tenantId: 'tenant-1', storeId: 'store-1', reportMonth: '2026-10', sourceId: context.sourceId,
      customerOrderId: 'CO-1', purchaseOrderId: 'PO-1', sku: 'SKU-1', amountType: 'Fee/Reimbursement', transactionId: 'txn-1', transactionDate: new Date('2026-10-02T00:00:00.000Z'),
      periodStartDate: new Date('2026-09-26T00:00:00.000Z'), periodEndDate: new Date('2026-10-02T00:00:00.000Z'),
      description: 'WFS StorageFee', transactionType: 'Service Fee', amount: '-344.78', currency: 'USD',
      receivedAt: context.receivedAt,
    })]);
    expect(rows[0].transactionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(normalizeReconTransactions(payload, context)[0].transactionKey).toBe(rows[0].transactionKey);
  });

  it('uses a report-wide row identity for pages and replays', () => {
    const context = { tenantId: 'tenant-1', storeId: 'store-1', reportDate: '10062026', sourceId: 'recon-report:10062026', receivedAt: new Date('2026-10-07T00:00:00.000Z') };
    const row = { 'Transaction Description': 'WFS StorageFee', Amount: '-10.00' };
    const pageOne = normalizeReconTransactions({ reportDetails: [row] }, { ...context, rowOffset: 0 });
    const pageTwo = normalizeReconTransactions({ reportDetails: [row] }, { ...context, rowOffset: 1000 });
    const replayOne = normalizeReconTransactions({ reportDetails: [row] }, { ...context, rowOffset: 0 });
    const replayTwo = normalizeReconTransactions({ reportDetails: [row] }, { ...context, rowOffset: 1000 });
    expect(pageOne[0].sourceId).toBe(pageTwo[0].sourceId);
    expect([pageOne[0].rowNumber, pageTwo[0].rowNumber]).toEqual([1, 1001]);
    expect(pageOne[0].transactionKey).not.toBe(pageTwo[0].transactionKey);
    expect(replayOne[0].transactionKey).toBe(pageOne[0].transactionKey);
    expect(replayTwo[0].transactionKey).toBe(pageTwo[0].transactionKey);
  });

  it('scopes otherwise identical report keys to the tenant', () => {
    const context = { storeId: 'store-1', reportDate: '10062026', sourceId: 'recon-report:10062026', receivedAt: new Date('2026-10-07T00:00:00.000Z'), rowOffset: 0 };
    const payload = { reportDetails: [{ 'Transaction ID': 'txn-1', 'Transaction Description': 'WFS StorageFee', Amount: '-10.00' }] };
    const firstTenant = normalizeReconTransactions(payload, { ...context, tenantId: 'tenant-1' })[0];
    const secondTenant = normalizeReconTransactions(payload, { ...context, tenantId: 'tenant-2' })[0];
    expect(firstTenant.sourceId).toBe(secondTenant.sourceId);
    expect(firstTenant.transactionKey).toBe(secondTenant.transactionKey);
    expect(firstTenant.id).not.toBe(secondTenant.id);
  });
});

 it('normalizes bill transaction identity, PO line and shipped units for profit fees',()=>{
 const [row]=normalizeReconTransactions({reportData:[{'Transaction Description':'Purchase',Amount:'50','Purchase Order line #':'02','Ship Qty':'3','Transaction Key':'bill-tx-1'}]}, {tenantId:'t',storeId:'s',reportDate:'11012026',sourceId:'recon-report:11012026',receivedAt:new Date()});
 expect(row).toMatchObject({purchaseOrderLine:'02',shipQty:3,billTransactionKey:'bill-tx-1'});
 });
