import { expect, it } from 'vitest';
import { renderProductRateRows, renderReconciliationRows, renderReturnViewSwitch } from './ReturnsPage.js';

it('renders the return views as an accessible segmented control with one active view', () => {
  const markup = renderReturnViewSwitch('product-rates');
  expect(markup).toContain('role="group" aria-label="退货数据视图"');
  expect(markup).toContain('data-return-view="details" aria-pressed="false"');
  expect(markup).toContain('data-return-view="reconciliation" aria-pressed="false"');
  expect(markup).toContain('data-return-view="product-rates" aria-pressed="true"');
  expect(markup).toContain('WFS 扣款异常');
});

it('renders product return rates with a product image and truncated Chinese name', () => {
  const markup = renderProductRateRows([{ storeId: 's1', sku: 'SKU-A', productName: 'English title', chineseName: '这是一个较长的中文产品名称', imageUrl: 'https://img.example/a.jpg', orderCount: 20, returnedOrderCount: 3, returnRate: 0.15 }], 1, 'returnRate', 'desc');
  expect(markup).toContain('src="https://img.example/a.jpg"');
  expect(markup).toContain('这是一个较长的中文产品名称');
  expect(markup).toContain('title="这是一个较长的中文产品名称"');
  expect(markup).toContain('English title');
});

it('renders pending unmatched payments without claiming no charge, and escapes ledger data', () => {
  const html = renderReconciliationRows([{ id: 'r', orderId: 's:o', storeId: 's', sku: '<sku>', status: 'REFUNDED', amount: 100, reconciliation: { refundDebit: 0, commissionCredit: 0, returnFees: 0, compensation: 0, netDebit: 0, currency: null, status: '待核对', transactions: [] } }], 1);
  expect(html).toContain('待核对'); expect(html).toContain('尚未匹配相关账单'); expect(html).toContain('&lt;sku&gt;'); expect(html).not.toContain('未扣款');
});
it('shows separate amounts and expandable ledger evidence for a charge', () => {
  const html = renderReconciliationRows([{ id: 'r', orderId: 's:o', storeId: 's', sku: 'SKU', status: 'REFUNDED', amount: 100, refundCoveredBy: 'Walmart', reconciliation: { refundDebit: 100, commissionCredit: 15, returnFees: 5, compensation: 0, netDebit: 90, currency: 'USD', status: '已扣款', transactions: [{ amount: -100, currency: 'USD', description: 'Return Refund', amountType: 'Product Price', sourceId: 'recon-report:10062026' }] } }], 1);
  expect(html).toContain('USD 90.00'); expect(html).toContain('已扣款'); expect(html).toContain('<details>'); expect(html).toContain('recon-report:10062026');
});

it('renders the seller-attributed product rate columns with sortable headers', async () => {
  const { renderProductRateRows } = await import('./ReturnsPage.js');
  const markup = renderProductRateRows([{ storeId: 's1', sku: 'SKU-A', productName: 'Alpha', orderCount: 20, returnedOrderCount: 3, returnRate: 0.15 }], 1, 'returnRate', 'desc');
  expect(markup).toContain('卖家责任退货率');
  expect(markup).toContain('15.00%');
  expect(markup).toContain('data-product-rate-sort="orderCount"');
});

it('draws the return trend across the measured container width without stretching markers', async () => {
  const { renderReturnTrend } = await import('./ReturnsPage.js');
  const rows = [{date:'2026-11-17',count:2},{date:'2026-11-18',count:4}];
  const wide = renderReturnTrend(rows,1440);
  expect(wide).toContain('viewBox="0 0 1440 190"');
  expect(wide).toContain('cx="1412.0"');
  expect(wide).toContain('r="4"');
  expect(renderReturnTrend(rows,360)).toContain('viewBox="0 0 360 190"');
  expect(renderReturnTrend([],360)).toContain('暂无退货');
});
