import { expect, it } from 'vitest';
import { publishedStatusMarkup } from './ItemsPage.js';

it('labels publish status in Chinese with a tone', () => {
  expect(publishedStatusMarkup('PUBLISHED')).toBe('<span class="status-pill">已发布</span>');
  expect(publishedStatusMarkup('unpublished')).toBe('<span class="status-pill neutral">未发布</span>');
  expect(publishedStatusMarkup('SYSTEM_PROBLEM')).toBe('<span class="status-pill danger">系统问题</span>');
});

it('keeps unknown statuses readable and escaped, and marks missing ones', () => {
  expect(publishedStatusMarkup('IN <REVIEW>')).toBe('<span class="status-pill neutral">IN &lt;REVIEW&gt;</span>');
  expect(publishedStatusMarkup(undefined)).toContain('—');
});
