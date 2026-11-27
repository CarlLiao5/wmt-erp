const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

export function productImageMarkup(imageUrl: unknown, alt: unknown): string {
  const url = typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl) ? imageUrl : '';
  return url
    ? `<img class="item-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`
    : '<span class="item-thumb-placeholder" aria-label="暂无图片">—</span>';
}
