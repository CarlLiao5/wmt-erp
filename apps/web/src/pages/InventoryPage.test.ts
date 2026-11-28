import { describe, expect, it } from 'vitest';
import { agedQuantity, inventoryAgeInsightMarkup, inventoryAgeRowsMarkup, inventoryLoadErrorMarkup, inventoryLogPageMarkup, inventoryRiskMarkup } from './InventoryPage.js';

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

describe('inventory risk and age markup', () => {
  it('labels risk in Chinese: stamp for stock-out, warning for overstock, quiet when normal', () => {
    expect(inventoryRiskMarkup('stockout')).toBe('<span class="stamp">断货风险</span>');
    expect(inventoryRiskMarkup('overstock')).toBe('<span class="status-pill warn">滞销冗余</span>');
    expect(inventoryRiskMarkup('normal')).toBe('<span class="muted">正常</span>');
    expect(inventoryRiskMarkup(undefined)).toBe('<span class="muted">正常</span>');
    expect(inventoryRiskMarkup('<odd>')).toContain('&lt;odd&gt;');
  });

  it('splits fresh (0-180 days) from aged stock, whole units, never floating point noise', () => {
    const html = inventoryAgeRowsMarkup([
      { label: '0-90天', count: 6215.399999999995 }, { label: '91-180天', count: 2071.8000000000002 },
      { label: '181-270天', count: 1000 }, { label: '271-365天', count: 500 }, { label: '365天以上', count: 500 },
    ]);
    expect(html).toContain('<strong>8,287</strong><small>81%</small>');
    expect(html).toContain('<strong>2,000</strong><small>19%</small>');
    expect(html).toContain('<span class="age-row-label">0-90天</span>');
    expect(html).toContain('<span class="age-row-label">91-180天</span>');
    expect(html).toContain('<strong>6,215</strong><small>75%</small>');
    expect(html).toContain('<strong>2,072</strong><small>25%</small>');
    expect(html).toContain('181-270天');
    expect(html).toContain('50%');
    expect(html).not.toContain('999999');
  });

  it('does not divide by zero when there is no stock', () => {
    const html = inventoryAgeRowsMarkup([{ label: '0-90天', count: 0 }]);
    expect(html).toContain('0%');
    expect(html).not.toContain('NaN');
  });
});

describe('aged stock insight', () => {
  const now = new Date('2026-11-27T00:00:00Z');
  const row = (sku: string, quantity: number, extra: Record<string, unknown> = {}) => ({ storeId: 's', sku, quantity, updatedAt: '', ...extra }) as any;
  it('counts only units older than 180 days, from reported bands or the first in-stock date', () => {
    expect(agedQuantity(row('a', 100, { ageDistribution: { '0To90days': 60, '181To270days': 25, '365PlusDays': 15 } }), now)).toBe(40);
    expect(agedQuantity(row('b', 50, { firstInStockDate: '2026-01-01' }), now)).toBe(50);
    expect(agedQuantity(row('c', 50, { firstInStockDate: '2026-10-01' }), now)).toBe(0);
    expect(agedQuantity(row('d', 50), now)).toBe(0);
  });
  it('totals aged units, ranks products, and merges rows for the same SKU in a store', () => {
    const html = inventoryAgeInsightMarkup([
      row('low', 100, { ageDistribution: { '181To270days': 10 } }),
      row('top', 100, { ageDistribution: { '365PlusDays': 30 } }),
      row('top', 100, { ageDistribution: { '365PlusDays': 20 } }),
    ], now);
    expect(html).toContain('60 件');
    expect(html).toContain('占在库库存 20%');
    expect(html.indexOf('data-age-sku="top"')).toBeLessThan(html.indexOf('data-age-sku="low"'));
    expect(html).toContain('50 件');
  });
  it('says so when nothing is old, and escapes product text', () => {
    expect(inventoryAgeInsightMarkup([row('x', 10, { ageDistribution: { '0To90days': 10 } })], now)).toContain('没有超过 180 天的库存');
    expect(inventoryAgeInsightMarkup([row('<x>', 10, { ageDistribution: { '365PlusDays': 10 } })], now)).toContain('&lt;x&gt;');
  });
});
