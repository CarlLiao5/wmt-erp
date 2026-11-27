import { expect, it } from 'vitest';
import { buildSemSearchCloud, fetchAdvertisingPageResponses, filterPerformanceRows, filterSemSearchTermRows, groupPerformanceRows, groupPricingRows, paginateRows, performanceMetricLabel, SEM_SEARCH_CLOUD_GROUPS, sortSemItemRows, sortSemSearchTermRows } from './MarketingPages.js';

const reportRows = [
  { searchTerm: 'memory foam', reportDate: '2026-10-01', impressions: 10, adSpend: 1.25 },
  { searchTerm: 'memory foam', reportDate: '2026-10-01', impressions: 5, adSpend: 2.25 },
  { searchTerm: 'memory foam', reportDate: '2026-10-02', impressions: 8, adSpend: 0.5 },
  { searchTerm: 'firm mattress', reportDate: '2026-10-01', impressions: 30, adSpend: 3 },
];

it('ranks search phrases by unique report dates for the frequency cloud', () => {
  expect(buildSemSearchCloud(reportRows, 'frequency').map(({ term, value }) => ({ term, value }))).toEqual([
    { term: 'memory foam', value: 2 },
    { term: 'firm mattress', value: 1 },
  ]);
});

it('builds separate impression and spend rankings from their reported metrics', () => {
  expect(buildSemSearchCloud(reportRows, 'impressions').map(({ term, value }) => ({ term, value }))).toEqual([
    { term: 'firm mattress', value: 30 },
    { term: 'memory foam', value: 23 },
  ]);
  expect(buildSemSearchCloud(reportRows, 'spend').map(({ term, value }) => ({ term, value }))).toEqual([
    { term: 'memory foam', value: 4 },
    { term: 'firm mattress', value: 3 },
  ]);
  expect(buildSemSearchCloud(reportRows, 'frequency')[0].fontSize).toBeGreaterThan(buildSemSearchCloud(reportRows, 'frequency')[1].fontSize);
});

it('ranks individual words by occurrence instead of treating phrases as one term', () => {
  expect(buildSemSearchCloud(reportRows, 'wordFrequency').map(({ term, value }) => ({ term, value }))).toEqual([
    { term: 'foam', value: 3 },
    { term: 'memory', value: 3 },
    { term: 'firm', value: 1 },
    { term: 'mattress', value: 1 },
  ]);
});

it('uses the individual-word frequency cloud as the fourth analysis group', () => {
  expect(SEM_SEARCH_CLOUD_GROUPS.find(group => group.id === 'wordFrequency')).toMatchObject({
    title: '高频单词',
    available: true,
  });
});

it('filters rows by the exact selected cloud term', () => {
  const rows = [
    { searchTerm: 'wooden train', sku: 'A' },
    { searchTerm: 'wooden train set', sku: 'B' },
    { searchTerm: 'toy train', sku: 'C' },
  ];

  expect(filterSemSearchTermRows(rows, 'wooden train').map(row => row.sku)).toEqual(['A']);
  expect(filterSemSearchTermRows(rows, null)).toEqual(rows);
});

it('paginates report rows independently with twenty rows per page', () => {
  const rows = Array.from({ length: 45 }, (_, index) => ({ searchTerm: `term-${index}` }));
  expect(paginateRows(rows, 0, 20)).toHaveLength(20);
  expect(paginateRows(rows, 2, 20)).toHaveLength(5);
  expect(paginateRows(rows, 99, 20)).toEqual([]);
});

it('sorts SEM item reports by newest period while keeping active campaigns first', () => {
  const rows = [
    { periodStart: '2026-10-01', periodEnd: '2026-10-07', status: 'PAUSED', sku: 'old-paused' },
    { periodStart: '2026-10-08', periodEnd: '2026-10-14', status: 'ACTIVE', sku: 'new-active' },
    { periodStart: '2026-09-24', periodEnd: '2026-09-30', status: 'ACTIVE', sku: 'old-active' },
  ];

  expect(sortSemItemRows(rows).map(row => row.sku)).toEqual(['new-active', 'old-active', 'old-paused']);
});

it('sorts SEM search terms newest first before pagination', () => {
  const rows = [
    { reportDate: '2026-10-01', searchTerm: 'old', sku: 'A' },
    { reportDate: '2026-10-11', searchTerm: 'new', sku: 'B' },
    { reportDate: '2026-10-05', searchTerm: 'middle', sku: 'C' },
  ];

  expect(sortSemSearchTermRows(rows).map(row => row.searchTerm)).toEqual(['new', 'middle', 'old']);
  expect(paginateRows(sortSemSearchTermRows(rows), 0, 2).map(row => row.searchTerm)).toEqual(['new', 'middle']);
});

it('groups seller performance rows by store for card rendering', () => {
  const groups = groupPerformanceRows([
    { storeId: 'store-a', metric: '30DAY.ots', value: '99.5' },
    { storeId: 'store-b', metric: '7DAY.vtr', value: 98 },
    { storeId: 'store-a', metric: '30DAY.otd', value: 97 },
  ]);
  expect([...groups.keys()]).toEqual(['store-a', 'store-b']);
  expect(groups.get('store-a')).toHaveLength(2);
  expect(performanceMetricLabel('30DAY.ots')).toEqual({ window: '30 天', label: '按时发货率', suffix: '%' });
  expect(filterPerformanceRows([
    { metric: '7DAY.ots' },
    { metric: '30DAY.ots' },
    { metric: '30DAY.otd' },
  ], '30DAY').map(row => row.metric)).toEqual(['30DAY.ots', '30DAY.otd']);
});

it('uses the newest current promotion and latest base and incentive snapshots per SKU', () => {
  const rows = [
    { storeId: 'store-a', sku: 'SKU-1', priceType: 'promotion', price: '99', promotionType: 'BASE', startDate: '2026-10-01', endDate: '2026-11-07', receivedAt: '2026-11-08T09:00:00Z' },
    { storeId: 'store-a', sku: 'SKU-1', priceType: 'promotion', price: '89', promotionType: 'ROLLBACK', startDate: '2026-11-08', endDate: '2026-11-15', receivedAt: '2026-11-08T10:00:00Z' },
    { storeId: 'store-a', sku: 'SKU-1', priceType: 'base', price: '269.99', targetPrice: '151.19', receivedAt: '2026-11-08T10:00:00Z' },
    { storeId: 'store-a', sku: 'SKU-1', priceType: 'incentive', price: '165.99', incentiveType: 'REDUCED_REFERRAL', incentiveStatus: 'NEW', receivedAt: '2026-11-08T10:00:00Z' },
  ];
  expect(groupPricingRows(rows, new Date('2026-11-09T00:00:00Z'))).toEqual([expect.objectContaining({
    currentPrice: '269.99', promotionPrice: '89', promotionType: 'ROLLBACK', incentiveType: 'REDUCED_REFERRAL', targetPrice: '151.19',
  })]);
});

it('does not display expired promotions as current promotion values', () => {
  const rows = [{ storeId: 'store-a', sku: 'SKU-1', priceType: 'promotion', price: '165.99', promotionType: 'BASE', startDate: '2026-10-30T00:00:00Z', endDate: '2026-11-07T23:59:59Z', receivedAt: '2026-11-08T09:00:00Z' }];
  expect(groupPricingRows(rows, new Date('2026-11-09T00:00:00Z'))[0].promotionPrice).toBeNull();
});

it('sorts pricing rows by the earliest promotion end date first', () => {
  const rows = [
    { storeId: 'store-a', sku: 'LATE', priceType: 'promotion', price: '20', startDate: '2026-11-01', endDate: '2026-12-01', receivedAt: '2026-11-01T00:00:00Z' },
    { storeId: 'store-a', sku: 'EARLY', priceType: 'promotion', price: '10', startDate: '2026-11-01', endDate: '2026-11-15', receivedAt: '2026-11-01T00:00:00Z' },
  ];
  expect(groupPricingRows(rows, new Date('2026-11-05T00:00:00Z')).map(row => row.sku)).toEqual(['EARLY', 'LATE']);
});

it('starts the advertising and SEM item report requests together', async () => {
  const started: string[] = [];
  let releaseAdvertising!: (response: Response) => void;
  const advertisingResponse = new Promise<Response>((resolve) => { releaseAdvertising = resolve; });
  const fetcher = ((input: RequestInfo | URL) => {
    const url = String(input);
    started.push(url);
    if (url.startsWith('/api/advertising?')) return advertisingResponse;
    return Promise.resolve(new Response(JSON.stringify({ data: { rows: [{ sku: 'SKU-1' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;

  const resultPromise = fetchAdvertisingPageResponses(fetcher, new URLSearchParams('from=2026-10-01'));
  await Promise.resolve();

  expect(started).toEqual(['/api/advertising?from=2026-10-01', '/api/advertising/items?from=2026-10-01']);
  releaseAdvertising(new Response(JSON.stringify({ data: { rows: [{ campaignId: 'C-1' }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await expect(resultPromise).resolves.toHaveLength(2);
});
