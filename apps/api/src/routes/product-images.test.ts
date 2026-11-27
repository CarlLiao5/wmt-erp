import { describe, expect, it } from 'vitest';
import { productImageUrl, productImageQueryBatches } from './product-images.js';

describe('product image resolution', () => {
  it('resolves image URLs nested in report image objects', () => {
    expect(productImageUrl(null, { itemReport: { Images: [{ primary: { url: 'https://cdn.example/item.jpg' } }] } })).toBe('https://cdn.example/item.jpg');
  });

  it('ignores non-http image values', () => {
    expect(productImageUrl(null, { itemReport: { 'Primary Image URL': '—' } })).toBeUndefined();
  });

  it('splits large image lookups into bounded query batches', () => {
    const batches = productImageQueryBatches(Array.from({ length: 401 }, (_, i) => i));
    expect(batches.map((batch) => batch.length)).toEqual([200, 200, 1]);
  });
});
