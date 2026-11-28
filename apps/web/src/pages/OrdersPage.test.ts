import { describe, expect, it } from 'vitest';
import { hourPeak, orderStatusMarkup, salesStatsMarkup } from './OrdersPage.js';

describe('order status labels', () => {
  it('shows Chinese labels with a tone for known statuses', () => {
    expect(orderStatusMarkup('Created')).toBe('<span class="status-pill warn">待发货</span>');
    expect(orderStatusMarkup('Shipped')).toBe('<span class="status-pill">已发货</span>');
    expect(orderStatusMarkup('Cancelled')).toBe('<span class="status-pill neutral">已取消</span>');
  });

  it('keeps unknown statuses readable and escaped, and marks missing ones', () => {
    expect(orderStatusMarkup('Pending <b>')).toBe('<span class="status-pill">Pending &lt;b&gt;</span>');
    expect(orderStatusMarkup(undefined)).toContain('—');
    expect(orderStatusMarkup('  ')).toContain('—');
  });
});

describe('sales statistics', () => {
  const rows = [
    { storeId: 's', sku: 'LOW', units: 2, orders: 2, revenue: 100 },
    { storeId: 's', sku: 'HIGH', itemId: '123', chineseName: '放大镜', units: 8, orders: 6, revenue: 300 },
  ];
  it('ranks SKUs by revenue, shows each share, and derives average order value', () => {
    const html = salesStatsMarkup(rows, { units: 10, orders: 8, revenue: 400 }, '2026-11-26');
    expect(html.indexOf('HIGH')).toBeLessThan(html.indexOf('LOW'));
    expect(html).toContain('75%');
    expect(html).toContain('25%');
    expect(html).toContain('$50.00');
    expect(html).toContain('放大镜');
    expect(html).toContain('Item ID 123');
  });
  it('escapes product text and explains an empty range', () => {
    expect(salesStatsMarkup([{ storeId: 's', sku: '<x>', units: 1, orders: 1, revenue: 1 }], undefined, 'r')).toContain('&lt;x&gt;');
    const empty = salesStatsMarkup([], { units: 0, orders: 0, revenue: 0 }, '2026-11-26');
    expect(empty).toContain('没有销量');
    expect(empty).not.toContain('NaN');
  });
});

describe('hourly chart peak', () => {
  const hours = [{ label: '00', count: 3, chinaCount: 9 }, { label: '05', count: 18, chinaCount: 2 }, { label: '06', count: 7, chinaCount: 9 }];
  it('names the busiest hour for each time zone, keeping the earlier hour on ties', () => {
    expect(hourPeak(hours, 'count')).toBe('，高峰 05:00（18 单）');
    expect(hourPeak(hours, 'chinaCount')).toBe('，高峰 00:00（9 单）');
  });
  it('says nothing when there are no orders', () => {
    expect(hourPeak([], 'count')).toBe('');
    expect(hourPeak([{ label: '00', count: 0, chinaCount: 0 }], 'count')).toBe('');
  });
});
