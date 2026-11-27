import { describe, expect, it } from 'vitest';
import { brightDataActionMarkup, brightDataCategories, brightDataEstimatedSalesByItem, brightDataItemCategory, brightDataMetricSeries, brightDataMetricSvg, brightDataScheduleControlsMarkup, brightDataTabs, brightDataTrendControlsMarkup, brightDataTrendSeries, brightDataTrendText, filterBrightDataInventory, filterBrightDataItems, filterBrightDataItemsByCategory, latestInventoryByItem, paginateBrightDataRows, summarizeBrightDataInventory, stockChangeByItem, type BrightDataItem, type BrightDataInventory } from './BrightDataPanel.js';

const inventory: BrightDataInventory[] = [
  { id: '1', itemId: 'A-1', productName: 'Blue mug', availableQuantity: 4, queriedAt: '2026-10-19T00:00:00.000Z', rating: '4.5', reviewCount: 10 },
  { id: '2', itemId: 'B-2', productName: 'Red mug', availableQuantity: 0, queriedAt: '2026-10-18T00:00:00.000Z', rating: '3.5', reviewCount: 2 },
  { id: '3', itemId: 'C-3', productName: 'Green bowl', availableQuantity: null, queriedAt: '2026-10-17T00:00:00.000Z', rating: null, reviewCount: null },
];

describe('Bright Data panel helpers', () => {
  it('exposes the two panel tabs in navigation order', () => {
    expect(brightDataTabs).toEqual(['库存数据看板', '产品管理']);
  });
  it('renders a schedule toggle with an explicit enabled state', () => {
    const markup = brightDataScheduleControlsMarkup({ enabled: true, timezone: 'Asia/Shanghai', nextRunAt: '2026-10-21T08:00:00.000Z', lastRunAt: null });
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('每日 16:00 已开启');
    expect(markup).toContain('暂停定时');
  });
  it('summarizes inventory snapshots for the dashboard cards', () => {
    expect(summarizeBrightDataInventory(inventory)).toEqual({ snapshots: 3, products: 3, inStock: 1, outOfStock: 1, unknownStock: 1, averageRating: 4, reviews: 12 });
  });

  it('uses the newest known snapshot per item and computes stock deltas', () => {
    const rows = [...inventory, { ...inventory[0], id: '4', availableQuantity: 9, queriedAt: '2026-10-20T00:00:00.000Z' }];
    expect(latestInventoryByItem(rows).map((row) => row.availableQuantity)).toEqual([9, 0, null]);
    expect(stockChangeByItem(rows).get('A-1')).toEqual({ current: 9, previous: 4, change: 5 });
    expect(brightDataEstimatedSalesByItem(rows).get('A-1')).toBe(0);
  });

  it('uses the latest snapshot of each day for signed daily stock change and estimated sales', () => {
    const rows: BrightDataInventory[] = [
      { ...inventory[0], id: 'day-1-early', availableQuantity: 100, queriedAt: '2026-10-18T01:00:00.000Z' },
      { ...inventory[0], id: 'day-1-late', availableQuantity: 95, queriedAt: '2026-10-18T23:00:00.000Z' },
      { ...inventory[0], id: 'day-2-early', availableQuantity: 90, queriedAt: '2026-10-19T01:00:00.000Z' },
      { ...inventory[0], id: 'day-2-late', availableQuantity: 84, queriedAt: '2026-10-19T23:00:00.000Z' },
    ];

    expect(stockChangeByItem(rows).get('A-1')).toEqual({ current: 84, previous: 95, change: -11 });
    expect(brightDataEstimatedSalesByItem(rows).get('A-1')).toBe(11);
  });

  it('estimates orders from positive inventory reductions only', () => {
    const rows = [
      { ...inventory[0], availableQuantity: 12, queriedAt: '2026-10-18T00:00:00.000Z' },
      { ...inventory[0], id: '7', availableQuantity: 8, queriedAt: '2026-10-19T00:00:00.000Z' },
    ];
    expect(brightDataEstimatedSalesByItem(rows).get('A-1')).toBe(4);
  });

  it('renders explicit no-history trends and actionable view controls', () => {
    expect(brightDataTrendText(null)).toBe('无历史');
    expect(brightDataTrendText(-2)).toBe('-2');
    expect(brightDataTrendSeries(inventory, 'A-1')).toEqual([4]);
    expect(brightDataActionMarkup('A-1')).toContain('data-brightdata-action="view"');
  });

  it('builds sorted metric series and filters missing values', () => {
    const rows: BrightDataInventory[] = [
      { ...inventory[0], queriedAt: '2026-10-20T00:00:00.000Z', rating: '4.8', price: '19.99' },
      { ...inventory[0], id: '5', queriedAt: '2026-10-18T00:00:00.000Z', rating: null, price: null },
      { ...inventory[0], id: '6', queriedAt: '2026-10-19T00:00:00.000Z', rating: '4.5', price: '18.50' },
    ];
    expect(brightDataMetricSeries(rows, 'A-1', 'rating').map((point) => point.value)).toEqual([4.5, 4.8]);
    expect(brightDataMetricSeries(rows, 'A-1', 'price').map((point) => point.value)).toEqual([18.5, 19.99]);
  });

  it('reads rating trends from legacy raw payloads when the normalized rating column is empty', () => {
    const rows: BrightDataInventory[] = [
      { ...inventory[0], rating: null, queriedAt: '2026-10-18T00:00:00.000Z', rawPayload: { aggregateRating: { ratingValue: '4.2' } } },
      { ...inventory[0], id: 'rating-2', rating: null, queriedAt: '2026-10-19T00:00:00.000Z', rawPayload: { Rating: '4.5' } },
    ];
    expect(brightDataMetricSeries(rows, 'A-1', 'rating').map((point) => point.value)).toEqual([4.2, 4.5]);
  });

  it('collapses repeated snapshots from the same day to the latest observation', () => {
    const rows = [
      { ...inventory[0], id: 'early', queriedAt: '2026-10-19T01:00:00.000Z', price: '21.00' },
      { ...inventory[0], id: 'late', queriedAt: '2026-10-19T23:00:00.000Z', price: '19.99' },
      { ...inventory[0], id: 'next', queriedAt: '2026-10-20T01:00:00.000Z', price: '18.99' },
    ];
    expect(brightDataMetricSeries(rows, 'A-1', 'price').map((point) => point.value)).toEqual([19.99, 18.99]);
  });

  it('adds a native hover tooltip to every metric point', () => {
    const svg = brightDataMetricSvg(inventory, 'A-1', 'rating', '评分', '#22c55e');
    expect(svg).toContain('aria-label="评分快照"');
    expect(svg).toContain('<title>评分');
    expect(svg).toContain('2026');
    expect(svg).toContain('4.5');
  });

  it('renders restrained circular nodes while keeping a tooltip hit target for each observation', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      ...inventory[0],
      id: `trend-${index}`,
      queriedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString(),
      availableQuantity: 20 + index,
    }));
    const svg = brightDataMetricSvg(rows, 'A-1', 'availableQuantity', '库存', '#f59e0b');

    expect(svg.match(/class="brightdata-hit-point"/g)).toHaveLength(20);
    expect(svg.match(/class="brightdata-data-point"/g)?.length).toBeLessThanOrEqual(8);
    expect(svg).toContain('class="brightdata-data-point" cx=');
    expect(svg).toContain(' r="0.9"');
    expect(svg).not.toContain('<ellipse');
    expect(svg).toContain('class="brightdata-hit-point"');
  });

  it('renders a filled trend row with an anchored selected-point tooltip', () => {
    const rows = [
      { ...inventory[0], queriedAt: '2026-10-18T00:00:00.000Z', rating: '4.4' },
      { ...inventory[0], id: 'later-rating', queriedAt: '2026-10-19T00:00:00.000Z', rating: '4.5' },
    ];
    const svg = brightDataMetricSvg(rows, 'A-1', 'rating', '评分', '#22c55e');
    expect(svg).toContain('brightdata-area-fill');
    expect(svg).toContain('brightdata-active-indicator');
    expect(svg).toContain('data-value="4.5"');
    expect(svg).toContain('aria-label="评分趋势"');
  });

  it('uses a smooth path for multi-point trends', () => {
    const rows = [
      { ...inventory[0], queriedAt: '2026-10-18T00:00:00.000Z', rating: '4.0' },
      { ...inventory[0], id: '8', queriedAt: '2026-10-19T00:00:00.000Z', rating: '4.5' },
      { ...inventory[0], id: '9', queriedAt: '2026-10-20T00:00:00.000Z', rating: '4.2' },
    ];
    expect(brightDataMetricSvg(rows, 'A-1', 'rating', '评分', '#22c55e')).toContain('<path');
  });

  it('renders an accessible metric switcher for expanded trends', () => {
    const markup = brightDataTrendControlsMarkup('A-1', 'rating');
    expect(markup).toContain('data-brightdata-metric="availableQuantity"');
    expect(markup).toContain('data-brightdata-metric="rating"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('searches item id and product fields and filters by category', () => {
    const items: BrightDataItem[] = [
      { id: '1', itemId: 'A-1', productName: 'Blue mug', rawPayload: { category: 'Kitchen' } },
      { id: '2', itemId: 'B-2', productName: 'Red mug', rawPayload: { category: 'Home' } },
    ];
    expect(filterBrightDataItems(items, 'mug', 'Kitchen')).toHaveLength(1);
    expect(filterBrightDataItems(items, 'B-2', 'all')[0]?.productName).toBe('Red mug');
    expect(filterBrightDataInventory(inventory, '', 'Kitchen', [{ id: '1', itemId: 'A-1', rawPayload: { category: 'Kitchen' } }])).toHaveLength(1);
  });

  it('reads legacy category field aliases regardless of casing or spacing', () => {
    expect(brightDataItemCategory({ id: '1', itemId: 'A-1', rawPayload: { Category: 'Sports' } })).toBe('Sports');
    expect(brightDataItemCategory({ id: '2', itemId: 'B-2', rawPayload: { '产品 分类': 'Kitchen' } })).toBe('Kitchen');
  });

  it('builds the complete unique category list from the product catalog', () => {
    expect(brightDataCategories([
      { id: '1', itemId: 'A-1', rawPayload: { Category: 'Sports' } },
      { id: '2', itemId: 'B-2', rawPayload: { category: 'Kitchen' } },
      { id: '3', itemId: 'C-3', rawPayload: { category: 'Sports' } },
    ])).toEqual(['Kitchen', 'Sports']);
  });

  it('filters the product catalog by a selected category without requiring a text query', () => {
    const items: BrightDataItem[] = [
      { id: '1', itemId: 'A-1', rawPayload: { Category: 'Sports' } },
      { id: '2', itemId: 'B-2', rawPayload: { category: 'Kitchen' } },
    ];
    expect(filterBrightDataItemsByCategory(items, 'Sports').map((item) => item.itemId)).toEqual(['A-1']);
    expect(filterBrightDataItemsByCategory(items, 'all')).toEqual(items);
  });

  it('paginates rows with stable bounds', () => {
    expect(paginateBrightDataRows(['a', 'b', 'c'], 2, 2)).toEqual({ rows: ['c'], page: 2, totalPages: 2 });
    expect(paginateBrightDataRows(['a'], 0, 2)).toEqual({ rows: ['a'], page: 1, totalPages: 1 });
  });
});
