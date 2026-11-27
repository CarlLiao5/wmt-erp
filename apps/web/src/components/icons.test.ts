import { describe, expect, it } from 'vitest';
import { iconMarkup } from './icons.js';
import { productImageMarkup } from './ProductImage.js';
import { dateRangePickerMarkup } from './DateRangePicker.js';

describe('icons', () => {
  it('renders decorative SVGs that follow the surrounding text colour', () => {
    const svg = iconMarkup('calendar', 20);
    expect(svg).toContain('width="20"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('aria-hidden="true"');
  });
  it('replaces the text glyphs in the date picker and image placeholder', () => {
    const picker = dateRangePickerMarkup('t', '2026-01-01', '2026-01-02');
    expect(picker).not.toMatch(/>[▦‹›]</);
    expect(picker).toContain('<svg');
    expect(productImageMarkup(undefined, 'x')).toContain('<svg');
  });
});
