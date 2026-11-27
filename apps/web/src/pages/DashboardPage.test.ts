import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { beginDashboardRender, dashboardTrendSvg, formatFreshness, formatStorageCard, normalizeTrendDate, shortTrendDate, trendBarHeight, last30Days } from './DashboardPage.js';

it('ignores an older dashboard render after a newer render starts', () => {
  const host = {};
  const firstRenderIsCurrent = beginDashboardRender(host);
  const secondRenderIsCurrent = beginDashboardRender(host);
  expect(firstRenderIsCurrent()).toBe(false);
  expect(secondRenderIsCurrent()).toBe(true);
});

it('scales daily trend bars against the largest revenue day', () => {
  expect(trendBarHeight(500, 1000)).toBe(75);
  expect(trendBarHeight(0, 1000)).toBe(4);
  expect(trendBarHeight(100, 0)).toBe(0);
});

it('keeps both trend axis labels inside the SVG viewBox at desktop and narrow widths', () => {
  const rows = [{ date: '2026-10-01', revenue: 2530, units: 1010, orders: 550 }];
  for (const width of [320, 1000, 1600]) {
    const svg = dashboardTrendSvg(rows, { days: 30, showRevenue: true, showUnits: true }, width);
    expect(svg).toContain(`viewBox="0 0 ${width} 300"`);
    expect(svg).not.toContain(`x="-`);
    expect(svg).not.toContain(`x="${width + 1}`);
  }
});

it('fills the SVG viewport even before a resized panel has been measured', () => {
  const svg = dashboardTrendSvg([{ date: '2026-10-01', revenue: 100, units: 4, orders: 1 }], { days: 30, showRevenue: true, showUnits: true }, 220);
  expect(svg).toContain('preserveAspectRatio="none"');
});

it('formats trend labels as compact month and day', () => {
  expect(shortTrendDate('2026-10-06')).toBe('10/06');
  expect(normalizeTrendDate('Mon Oct 05 2026 08:00:00 GMT+0800 (China Standard Time)')).toBe('2026-10-05');
  expect(formatFreshness('2026-09-30')).toBe('09/30（Pacific）');
});

it('keeps only the newest 30 trend dates in ascending order', () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}` }));
  expect(last30Days(rows)).toHaveLength(30);
  expect(last30Days(rows)[0].date).toBe('2026-09-02');
  expect(last30Days(rows).at(-1)?.date).toBe('2026-09-31');
});

it('formats the dashboard storage card with its billing period', () => {
  expect(formatStorageCard({ amount: 347.42, currency: 'USD', period: { startDate: '2026-09-26', endDate: '2026-10-02' } })).toEqual({ value: 'USD 347.42', period: '最新账期 · 2026/09/26 - 2026/10/02' });
  expect(formatStorageCard({ amount: null, currency: null, period: { startDate: null, endDate: null } })).toEqual({ value: '暂无数据', period: '最新账期 · 费用周期待账单返回' });
});

it('sizes the daily chart from its panel and observes later layout changes', () => {
  const source = readFileSync(new URL('./DashboardPage.tsx', import.meta.url), 'utf8');
  expect(source).toContain('new ResizeObserver(');
  expect(source).not.toContain('const chartWidth = TREND_CHART.width;');
});
