const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type Feature = { name: string; value: string };
export interface ReviewVariantOption {
  itemId: string | null;
  name?: string | null;
  names?: string[];
  imageUrl?: string | null;
  count: number;
  features?: Feature[];
  featureSets?: Array<{ features: Feature[]; count: number }>;
  conflictingFeatures?: boolean;
}
const featureLabel = (features: Feature[]) => features.map(f => `${f.name}: ${f.value}`).join(' / ');
export function reviewVariantLabel(variant: ReviewVariantOption): string {
  if (!variant.itemId) return '变体未提供';
  const label = variant.conflictingFeatures ? '规格信息不一致' : featureLabel(variant.features ?? []) || variant.name || '规格未提供';
  return `${label} · Item ${variant.itemId}`;
}
export function filterReviewVariants(variants: ReviewVariantOption[], query: string): ReviewVariantOption[] {
  const term = query.trim().toLocaleLowerCase();
  return variants.filter(v => [v.itemId, v.name, ...(v.names ?? []), reviewVariantLabel(v), ...(v.featureSets ?? []).map(s => featureLabel(s.features))].some(text => String(text ?? '').toLocaleLowerCase().includes(term)));
}
export function reviewVariantOptionsMarkup(variants: ReviewVariantOption[], selected: string): string {
  return variants.map(variant => {
    const value = variant.itemId || '__missing__';
    let image = '';
    try { const url = new URL(variant.imageUrl!); if (url.protocol === 'https:') image = url.href; } catch { /* No safe image. */ }
    const imageMarkup = image ? `<img src="${esc(image)}" alt="变体商品图片" loading="lazy" referrerpolicy="no-referrer">` : '<span class="review-variant-image-empty" aria-hidden="true">无图</span>';
    return `<article class="review-variant-option"><button type="button" data-variant-choice="${esc(value)}" aria-pressed="${selected === value}" title="${esc(reviewVariantLabel(variant))}">${imageMarkup}<span class="review-variant-option-copy"><strong>${esc(reviewVariantLabel(variant))}</strong><small>${esc(variant.name || '商品名称未提供')}</small></span><span class="review-variant-count">${variant.count} 条</span></button>${variant.conflictingFeatures ? `<details class="review-variant-conflicts"><summary>查看规格记录 · ${variant.featureSets?.length ?? 0} 种</summary><ul>${(variant.featureSets ?? []).map(set => `<li><span>${esc(featureLabel(set.features) || '规格未提供')}</span><b>${set.count} 条</b></li>`).join('')}</ul></details>` : ''}</article>`;
  }).join('') || '<p class="review-variant-no-results" role="status">没有匹配的变体</p>';
}

export function mountReviewVariantPicker(host: HTMLElement, variants: ReviewVariantOption[], selected: string, onSelect: (value: string) => void): void {
  const total = variants.reduce((sum, v) => sum + v.count, 0);
  const current = variants.find(v => (v.itemId || '__missing__') === selected);
  const label = selected ? current ? reviewVariantLabel(current) : '所选变体' : '全部变体';
  host.innerHTML = `<input type="hidden" name="variant" value="${esc(selected)}"><details class="review-variant-picker"><summary aria-label="筛选评论变体"><span>${esc(label)}</span><small>${current?.count ?? total} 条</small><i aria-hidden="true">⌄</i></summary><div class="review-variant-popover"><label class="review-variant-search">搜索变体<input type="search" data-variant-search placeholder="规格、Item ID 或商品名称" autocomplete="off"></label><button class="review-variant-all" type="button" data-variant-choice="" aria-pressed="${!selected}"><span>全部变体</span><small>${total} 条</small></button><div class="review-variant-options" data-variant-options>${reviewVariantOptionsMarkup(variants, selected)}</div></div></details>`;
  const picker = host.querySelector<HTMLDetailsElement>('.review-variant-picker')!;
  const trigger = picker.querySelector<HTMLElement>('summary')!;
  const search = host.querySelector<HTMLInputElement>('[data-variant-search]')!;
  const options = host.querySelector<HTMLElement>('[data-variant-options]')!;
  const choose = (button: HTMLButtonElement) => {
    picker.open = false;
    trigger.focus();
    const value = button.dataset.variantChoice ?? '';
    host.querySelector<HTMLInputElement>('input[name="variant"]')!.value = value;
    onSelect(value);
  };
  const bindChoices = (root: HTMLElement) => root.querySelectorAll<HTMLButtonElement>('[data-variant-choice]').forEach(button => button.onclick = () => choose(button));
  bindChoices(host);
  search.oninput = () => { options.innerHTML = reviewVariantOptionsMarkup(filterReviewVariants(variants, search.value), selected); bindChoices(options); };
  search.onkeydown = event => {
    if (event.key === 'Enter') event.preventDefault();
    if (event.key === 'ArrowDown') { event.preventDefault(); options.querySelector<HTMLButtonElement>('button')?.focus(); }
  };
  picker.addEventListener('toggle', () => { if (picker.open) search.focus(); });
  picker.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); picker.open = false; trigger.focus(); } });
  picker.addEventListener('focusout', event => { if (event.relatedTarget instanceof Node && !picker.contains(event.relatedTarget)) picker.open = false; });
}

export function reviewLocalStatisticsMarkup(stats: { count: number; averageRating: number | null; positiveRate: number | null; negativeRate: number | null }): string {
  const values = [
    ['评论数', `${stats.count} 条`, '当前全部筛选结果'],
    ['平均分', stats.averageRating == null ? '—' : stats.averageRating.toFixed(2), '满分 5 分'],
    ['好评率', stats.positiveRate == null ? '—' : `${stats.positiveRate.toFixed(1)}%`, '4–5 星 / 筛选评论数'],
    ['差评率', stats.negativeRate == null ? '—' : `${stats.negativeRate.toFixed(1)}%`, '1–2 星 / 筛选评论数'],
  ];
  return `<section class="review-local-statistics" aria-label="当前筛选评论统计"><div class="review-local-caption"><strong>当前筛选</strong><span>本地已抓取评论 · 含当前变体、星级、日期和关键词条件</span></div><div class="review-local-metrics">${values.map(([title, value, hint]) => `<div><span>${title}</span><strong>${value}</strong><small>${hint}</small></div>`).join('')}</div></section>`;
}
