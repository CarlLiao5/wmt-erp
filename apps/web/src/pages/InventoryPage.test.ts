import { describe, expect, it } from 'vitest';
import { inventoryLoadErrorMarkup, inventoryLogPageMarkup } from './InventoryPage.js';

describe('inventory load error', () => {
  it('escapes the message and offers an in-page retry', () => {
    const markup = inventoryLoadErrorMarkup('库存读取失败 <temporary>');

    expect(markup).toContain('库存读取失败 &lt;temporary&gt;');
    expect(markup).toContain('data-retry-inventory');
    expect(markup).toContain('>重试</button>');
  });
});

describe('inventory log pagination markup', () => {
  it('renders server-side summary and a bounded page of log rows', () => {
    const markup = inventoryLogPageMarkup({
      rows: [{ transactionTime: '2026-11-04', fcName: 'FC 1', changedUnits: -2, reasonDescription: '<sale>' }],
      total: 6784,
      page: 2,
      pageSize: 50,
      summary: { salesQuantity: 8, monthlyNet: -3, outbound: 5, inbound: 2, salesOutboundDifference: 4 },
    }, 12);

    expect(markup).toContain('月初库存');
    expect(markup).toContain('<strong>15</strong>');
    expect(markup).toContain('第 2 / 136 页');
    expect(markup).toContain('共 6,784 条');
    expect(markup).toContain('&lt;sale&gt;');
    expect(markup).not.toContain('data-page="1"');
  });
});
