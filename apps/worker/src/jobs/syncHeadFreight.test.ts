import { describe, expect, it } from 'vitest';
import { listSmartSheetRecords, matchHeadFreightStore, mergeNonEmptyHeadFreightFields, normalizeHeadFreightRecord } from './syncHeadFreight.js';

describe('head freight MCP parsing', () => {
  it('pages with limit 500 and stops on the next cursor', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const records = await listSmartSheetRecords({ documentUrl: 'doc', tableId: 'sheet', call: async (_tool, args) => { calls.push(args); return calls.length === 1 ? { records: [{ id: 'a', values: { SKU: 'A' } }], has_more: true, next_cursor: 'next' } : { records: [{ id: 'b', values: { SKU: 'B' } }], has_more: false }; } });
    expect(records.map((row) => row.id)).toEqual(['a', 'b']);
    expect(calls).toEqual([{ docid: 'doc', sheet_id: 'sheet', type: 'records', key_type: 'field_title', limit: 500 }, { docid: 'doc', sheet_id: 'sheet', type: 'records', key_type: 'field_title', limit: 500, cursor: 'next' }]);
  });

  it('normalizes aliases and retains source store name without requiring a match', () => {
    const row = normalizeHeadFreightRecord({ id: 'row-1', values: { 合同编号: ' po-1\n第二行 ', SKU: ' sku-1 ', 店铺名称: [{ text: 'Store X' }], 数量: '12 件', 发货时间: '2026-10-01T00:00:00Z', 当前状态: '已发货\n在途' } }, { tenantId: 'tenant', batchId: 'batch' });
    expect(row.sourceRowId).toBe('row-1');
    expect(row.sourceStoreName).toBe('Store X');
    expect(row.contractNumber).toBe('PO-1');
    expect(row.quantity).toBe('12');
    expect(row.shippedAt).toBe('2026-10-01');
    expect(row.currentStatus).toBe('已发货 在途');
  });

  it('skips an empty placeholder row', () => {
    const row = normalizeHeadFreightRecord({ id: 'empty', values: {} }, { tenantId: 'tenant', batchId: 'batch' });
    expect(row.hasContent).toBe(false);
  });

  it('treats store matching as optional and preserves non-empty fields on merge', () => {
    const row = normalizeHeadFreightRecord({ id: 'row-2', values: { 店铺名称: 'Unknown Store', SKU: 'SKU-2', 产品名称: 'New name' } }, { tenantId: 'tenant', batchId: 'batch' });
    expect(matchHeadFreightStore(row, [{ id: 'store-1', name: 'Other Store' }])).toEqual({ storeId: undefined, status: 'unmatched', sourceStoreName: 'Unknown Store' });
    expect(mergeNonEmptyHeadFreightFields({ sku: 'old', productName: 'old name', quantity: '5' }, { sku: 'new', productName: undefined, quantity: '0' })).toEqual({ sku: 'new', productName: 'old name', quantity: '0' });
  });
});
