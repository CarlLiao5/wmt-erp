import { expect, it } from 'vitest';
import { renderProductWordCloud } from './ProductAnalysisPage.js';

it('renders campaign terms as a positioned SEM-style cloud with exposure metrics', () => {
  const markup = renderProductWordCloud([
    { term: 'Campaign Alpha', count: 120, spend: 3.5, sales: 8 },
    { term: 'Campaign Beta', count: 40, spend: 1, sales: 2 },
  ], '暂无站内投放数据', '曝光');

  expect(markup).toContain('sem-search-cloud');
  expect(markup).toContain('class="sem-word"');
  expect(markup).toContain('--cloud-x:');
  expect(markup).toContain('120 曝光');
  expect(markup).toContain('$3.50 花费');
});

it('renders an explicit empty state when the selected product has no report terms', () => {
  expect(renderProductWordCloud([], '暂无站内投放数据', '曝光')).toContain('暂无站内投放数据');
});

it('limits the cloud to the 25 highest exposure terms', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    term: `keyword ${40 - index}`,
    count: 100 - index,
    spend: index,
    sales: index * 2,
  }));
  const markup = renderProductWordCloud(rows, '暂无站内投放数据', '曝光');

  expect((markup.match(/class="sem-word"/g) ?? [])).toHaveLength(25);
  expect(markup).toContain('keyword 40');
  expect(markup).toContain('keyword 16');
  expect(markup).not.toContain('keyword 15');
});
