import { mountReviewVariantPicker, reviewLocalStatisticsMarkup } from '../components/ReviewVariantPicker.js';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const date = (v: unknown) => v ? new Date(String(v)).toLocaleString('zh-CN') : '—';
export function reviewProductMarkup(review: any): string {
    const product = review.reviewProduct ?? {};
    const item = product.itemId;
    const otherVariant = item && review.sourceItemId && item !== review.sourceItemId;
    let image = '';
    try { const url = new URL(product.imageUrl); if (url.protocol === 'https:') image = url.href; } catch { /* Missing or unsafe image URL. */ }
    const features = Array.isArray(product.features) ? product.features : [];
    return `<section class="review-product" aria-label="评论对应商品">${image ? `<img src="${esc(image)}" alt="评论商品图片" loading="lazy" referrerpolicy="no-referrer">` : '<span class="review-product-placeholder">暂无图片</span>'}<div class="review-product-info"><div class="review-product-caption">评论对应商品${otherVariant ? '<span class="review-variant-badge">其他变体评论</span>' : ''}</div><div class="review-product-name" title="${esc(product.name || '未提供')}">${esc(product.name || '商品名称未提供')}</div><div class="review-product-ids"><span>评论 Item：${esc(item || '未提供')}</span><span>抓取入口：${esc(review.sourceItemId || '未提供')}</span></div><div class="review-product-features">${features.length ? features.map((feature: any) => `<span>${esc(feature.name)}：<b>${esc(feature.value)}</b></span>`).join('') : '<span>规格未提供</span>'}</div></div></section>`;
}
export function reviewStatusText(status: string): string { return ({ idle: '待抓取', queued: '排队中', running: '同步中', completed: '已完成', paused: '已暂停', failed: '同步失败' } as Record<string, string>)[status] ?? status; }
export function reviewTargetActions(target: {
    initialStatus: string;
    status: string;
}, role: string): string {
    if (role !== 'admin')
        return '';
    const busy = ['running', 'queued'].includes(target.status);
    return `<button class="secondary" data-review-action="initial" ${busy || target.initialStatus === 'completed' ? 'disabled' : ''}>${target.initialStatus === 'partial' ? '继续历史' : '首次抓取'}</button><button class="secondary" data-review-action="incremental" ${busy || target.initialStatus === 'partial' ? 'disabled' : ''}>立即增量</button>`;
}
export function reviewListQuery(itemId: string, filters: {
    page: number;
    rating?: string;
    variant?: string;
    q?: string;
    from?: string;
    to?: string;
}): string { return '/api/product-reviews?' + new URLSearchParams({ itemId, page: String(filters.page), pageSize: '20', variant: filters.variant ?? '', rating: filters.rating ?? '', q: filters.q ?? '', from: filters.from ?? '', to: filters.to ?? '' }); }
export function reviewRatingSummary(snapshot: any): string {
    const number = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    const rating = number(snapshot.averageRating);
    const stars = rating === null ? 0 : Math.max(0, Math.min(100, rating / 5 * 100));
    const rows = ([['five',5],['four',4],['three',3],['two',2],['one',1]] as const).map(([key, star]) => {
        const pct = number(snapshot[`${key}StarPct`]);
        const count = number(snapshot[`${key}StarCount`]);
        const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
        const label = pct === null ? '暂无占比' : `${Number(pct.toFixed(1))}%`;
        return `<div class="review-rating-row"><span class="review-rating-label">${star}<span aria-hidden="true">★</span></span><div class="review-rating-track" role="img" aria-label="${star}星占比 ${label}"><span style="width:${width}%"></span></div><strong>${label}</strong><small>${count === null ? '—' : count.toLocaleString('zh-CN') + ' 条'}</small></div>`;
    }).join('');
    return `<section class="review-rating-overview" aria-label="商品评分概览"><div class="review-rating-score"><span class="review-rating-heading">商品综合评分</span><div class="review-rating-number">${rating === null ? '—' : rating.toFixed(1)}<span>/ 5</span></div><div class="review-rating-stars" aria-label="${rating === null ? '暂无评分' : rating.toFixed(1) + ' 分'}"><span aria-hidden="true">★★★★★</span><span aria-hidden="true" style="width:${stars}%">★★★★★</span></div><p>${number(snapshot.totalReviewCount)?.toLocaleString('zh-CN') ?? '—'} 条总评分</p></div><div class="review-rating-distribution"><div class="review-rating-caption"><strong>星级分布</strong><span>Walmart 全站评分 · 含转载评分</span></div>${rows}</div></section>`;
}
export function reviewManagementRow(target: any, role = 'admin'): string {
    const busy = ['queued', 'running'].includes(target.status);
    return `<tr><td>${esc(target.product?.chineseName || target.product?.productName || '未关联商品')}</td><td>${esc(target.product?.sku || '—')}</td><td>${esc(target.itemId)}</td><td>${Number(target.reviewCount ?? 0)}</td><td>${target.averageRating == null ? '暂无' : Number(target.averageRating).toFixed(1)}</td><td>${esc(reviewStatusText(target.status))}</td><td>${role === 'admin' ? `<button class="secondary" data-row-action="initial" data-item="${esc(target.itemId)}" ${busy || target.initialStatus === 'completed' ? 'disabled' : ''}>${target.initialStatus === 'partial' ? '继续历史' : '首次抓取'}</button><button class="secondary" data-row-action="incremental" data-item="${esc(target.itemId)}" ${busy || target.initialStatus !== 'completed' ? 'disabled' : ''}>增量</button><button class="secondary" data-row-schedule data-item="${esc(target.itemId)}">${target.enabled ? '暂停' : '开启'}</button>` : ''}<button class="link-button" data-view-item="${esc(target.itemId)}">查看评论</button></td></tr>`;
}
export function filterReviewTargets(targets: any[], query: string): any[] {
    const term = query.trim().toLocaleLowerCase('en-US');
    if (!term) return targets;
    return targets.filter(t => [t.itemId, t.product?.sku, t.product?.chineseName, t.product?.productName].some(v => String(v ?? '').toLocaleLowerCase('en-US').includes(term)));
}
async function api(url: string, method = 'GET', body?: unknown) {
    const response = await fetch(url, { method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    if (response.status === 204)
        return null;
    const text = await response.text();
    let result: any;
    try {
        result = JSON.parse(text);
    }
    catch {
        throw new Error(`服务返回异常（HTTP ${response.status}），请检查后端服务`);
    }
    if (!response.ok)
        throw new Error(result.error?.message ?? '请求失败');
    return result.data;
}
export async function renderProductReviewsPage(root: HTMLElement, role = 'member'): Promise<void> {
    let targets: any[] = [], selected = '', page = 1, sequence = 0, detailVisible = false, detailUnlocked = false;
    let variantItem = '';
    let filters = { variant: '', rating: '', q: '', from: '', to: '' };
    const admin = role === 'admin';
    root.innerHTML = `<div class="product-reviews-page"><section class="panel review-header"><div><span class="review-eyebrow">CUSTOMER VOICE</span><h1>商品评论</h1><p class="muted">Item 管理总览 · 评论详情按需查看</p></div><div class="review-header-tools"><span class="review-local-badge">本地评论库</span><button class="secondary" data-refresh>刷新状态</button></div></section>${admin ? `<details class="panel review-config"><summary>Firecrawl 连接设置 <span data-config-state></span></summary><form data-key-form><label>API Key<input type="password" name="apiKey" autocomplete="new-password" placeholder="输入新密钥以保存" required></label><button class="secondary">加密保存</button></form></details>` : ''}<div class="review-notice" role="status" aria-live="polite"></div><div class="review-view-tabs"><button class="secondary active" data-view="management">评论商品管理</button><button class="secondary" data-view="detail">评论详情</button>${admin ? `<form data-add-item class="review-add-inline"><input name="itemId" inputmode="numeric" pattern="[0-9]+" placeholder="输入 Item ID" required><button class="primary">添加 Item</button></form>` : ''}</div><section class="panel review-management" data-management></section><div class="review-workspace" data-detail hidden><aside class="panel review-target-panel"><div class="panel-head"><h2>评论商品</h2><span data-target-count></span></div><div class="review-target-search"><input data-target-search placeholder="搜索 Item、SKU 或品名" aria-label="搜索评论商品"><select data-target-select aria-label="选择评论商品"><option value="">选择一个 Item</option></select></div><div data-targets>加载中…</div></aside><section class="panel review-content"><div data-selected></div><form class="review-filters"><div class="review-variant-field"><span>变体</span><div data-review-variant-picker><span class="muted">选择商品后可筛选</span></div></div><label>星级<select name="rating" aria-label="星级"><option value="">全部星级</option>${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${n} 星</option>`).join('')}</select></label><label>开始日期<input type="date" name="from"></label><label>结束日期<input type="date" name="to"></label><label class="review-search">搜索评论<input name="q" placeholder="标题、正文或评论人"></label><button class="secondary">查询</button></form><div data-summary></div><div data-local-statistics></div><div data-review-list></div><div class="review-pagination" data-pagination></div></section></div></div>`;
    const notice = (message: string, error = false) => { const el = root.querySelector<HTMLElement>('.review-notice')!; el.textContent = message; el.classList.toggle('error', error); };
    const loadReviews = async () => {
        const token = ++sequence;
        const list = root.querySelector<HTMLElement>('[data-review-list]')!, pagination = root.querySelector<HTMLElement>('[data-pagination]')!;
        pagination.innerHTML = '';
        if (!selected || !detailUnlocked) {
            root.querySelector('[data-local-statistics]')!.innerHTML = '';
            root.querySelector('[data-summary]')!.innerHTML = '';
            root.querySelector('[data-review-variant-picker]')!.innerHTML = '<span class="muted">选择商品后可筛选</span>';
            list.innerHTML = '<div class="review-detail-empty"><strong>搜索商品后查看评论</strong><span>输入 Item、SKU 或产品名称，按 Enter 选择商品</span></div>';
            return;
        }
        if (variantItem !== selected) { filters.variant = ''; variantItem = selected; page = 1; root.querySelector('[data-review-variant-picker]')!.innerHTML = ''; root.querySelector('[data-summary]')!.innerHTML = ''; }
        root.querySelector('[data-local-statistics]')!.innerHTML = '';
        list.innerHTML = '<div class="empty" role="status">正在读取评论…</div>';
        try {
            const data = await api(reviewListQuery(selected, { page, ...filters }));
            if (token !== sequence)
                return;
            const pickerHost = root.querySelector<HTMLElement>('[data-review-variant-picker]');
            const restorePickerFocus = pickerHost?.contains(document.activeElement) ?? false;
            if (pickerHost) mountReviewVariantPicker(pickerHost, data.variants ?? [], filters.variant, value => {
                const form = root.querySelector<HTMLFormElement>('.review-filters')!;
                const input = new FormData(form);
                filters = { variant: value, rating: String(input.get('rating') ?? ''), from: String(input.get('from') ?? ''), to: String(input.get('to') ?? ''), q: String(input.get('q') ?? '').trim() };
                page = 1;
                void loadReviews();
            });
            if (restorePickerFocus) pickerHost?.querySelector<HTMLElement>('.review-variant-picker > summary')?.focus();
            root.querySelector('[data-local-statistics]')!.innerHTML = reviewLocalStatisticsMarkup(data.statistics);
            list.innerHTML = data.rows.length ? data.rows.map((r: any) => `<article class="review-card"><div class="review-card-meta"><span class="review-stars" aria-label="${r.rating}星">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span><time>${esc(date(r.publishedAt))}</time></div>${reviewProductMarkup(r)}<h3>${esc(r.title || '无标题')}</h3><p class="review-body">${esc(r.body)}</p><div class="review-author">${esc(r.author || '匿名评论人')}${r.verifiedPurchase ? ' · 已验证购买' : ''}</div></article>`).join('') : '<div class="empty">暂无符合条件的评论；新增商品需先启动抓取</div>';
            const snapshots = await api(`/api/product-reviews/snapshots?itemId=${encodeURIComponent(selected)}`);
            if (token !== sequence) return;
            const latest = snapshots.rows?.[0];
            root.querySelector('[data-summary]')!.innerHTML = latest ? reviewRatingSummary(latest) : '';
            const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
            pagination.innerHTML = `<span>共 ${Number(data.total)} 条 · 第 ${page} / ${pages} 页</span><div><button class="secondary" data-prev ${page <= 1 ? 'disabled' : ''}>上一页</button><button class="secondary" data-next ${page >= pages ? 'disabled' : ''}>下一页</button></div>`;
            pagination.querySelector<HTMLButtonElement>('[data-prev]')!.onclick = () => { page--; void loadReviews(); };
            pagination.querySelector<HTMLButtonElement>('[data-next]')!.onclick = () => { page++; void loadReviews(); };
        }
        catch (e) {
            if (token === sequence)
                list.textContent = (e as Error).message;
        }
    };
    const draw = () => {
        const targetQuery = root.querySelector<HTMLInputElement>('[data-target-search]')?.value ?? '';
        const visibleTargets = filterReviewTargets(targets, targetQuery);
        root.querySelector('[data-management]')!.innerHTML = `<div class="panel-head"><div><h2>已加入的 Item</h2><span class="muted">${targets.length} 个商品 · 可逐项控制抓取</span></div></div>${targets.length ? `<div class="review-table-wrap"><table class="review-management-table"><thead><tr><th>商品</th><th>SKU</th><th>Item ID</th><th>评论数</th><th>最新评分</th><th>状态</th><th>操作</th></tr></thead><tbody>${targets.map(t => reviewManagementRow(t, role)).join('')}</tbody></table></div>` : '<div class="empty">暂无 Item，请在上方添加 Item。</div>'}`;
        root.querySelectorAll<HTMLButtonElement>('[data-view-item]').forEach(b => b.onclick = () => { selected = b.dataset.viewItem!; detailUnlocked = true; detailVisible = true; updateView(); page = 1; void loadReviews(); });
        root.querySelectorAll<HTMLButtonElement>('[data-row-action]').forEach(b => b.onclick = async () => { try { await api('/api/product-reviews/sync','POST',{ itemId:b.dataset.item, mode:b.dataset.rowAction, pageBudget:100 }); notice('任务已排队'); await refresh(); } catch(e) { notice((e as Error).message,true); } });
        root.querySelectorAll<HTMLButtonElement>('[data-row-schedule]').forEach(b => b.onclick = async () => { const t=targets.find(x=>x.itemId===b.dataset.item); try { await api(`/api/product-reviews/targets/${b.dataset.item}/schedule`,'PUT',{enabled:!t.enabled}); await refresh(); } catch(e) { notice((e as Error).message,true); } });
        root.querySelectorAll<HTMLElement>('[data-target-count]').forEach(el => el.textContent = `${targets.length} 个`);
        const select = root.querySelector<HTMLSelectElement>('[data-target-select]');
        if (select) select.innerHTML = `<option value="">选择一个 Item</option>${visibleTargets.map(t => `<option value="${esc(t.itemId)}" ${selected === t.itemId ? 'selected' : ''}>${esc(t.product?.sku || '手动添加')} · ${esc(t.product?.chineseName || t.product?.productName || t.itemId)}</option>`).join('')}`;
        root.querySelector('[data-targets]')!.innerHTML = visibleTargets.length ? visibleTargets.map(t => `<button type="button" class="review-target ${selected === t.itemId ? 'active' : ''}" data-item="${esc(t.itemId)}">${t.product?.imageUrl ? `<img src="${esc(t.product.imageUrl)}" alt="" loading="lazy">` : '<span class="review-image-placeholder">商品</span>'}<span><strong title="${esc(t.product?.chineseName || t.product?.productName)}">${esc(t.product?.chineseName || t.product?.productName || '未关联商品')}</strong><small>Item ${esc(t.itemId)}</small><small>${esc(t.product?.sku ?? '手动添加')} · ${Number(t.reviewCount ?? 0)} 条评论</small></span><span class="review-state ${esc(t.status)}">${esc(reviewStatusText(t.status))}</span></button>`).join('') : '<div class="empty">没有匹配的商品</div>';
        root.querySelectorAll<HTMLButtonElement>('[data-targets] [data-item]').forEach(b => b.onclick = () => { selected = b.dataset.item!; detailUnlocked = true; page = 1; draw(); void loadReviews(); });
        if (select) select.onchange = () => { if (select.value) { selected = select.value; detailUnlocked = true; page = 1; draw(); void loadReviews(); } };
        const t = targets.find(x => x.itemId === selected);
        root.querySelector('[data-selected]')!.innerHTML = t ? `<div class="review-selected"><div><h2>${esc(t.product?.chineseName || t.product?.productName || '商品评论')}</h2><span class="muted">Item ${esc(t.itemId)} · 累计读取 ${Number(t.pagesRead)} 页</span></div><div class="review-item-actions">${reviewTargetActions(t, role)}${admin && ['queued', 'running'].includes(t.status) ? '<button class="secondary" data-pause>暂停抓取</button>' : ''}</div></div><div class="review-sync-meta"><span>最近成功 <b>${esc(date(t.lastSuccessAt))}</b></span><span>下次增量 <b>${t.enabled ? esc(date(t.nextRunAt)) : '未开启'}</b></span>${admin ? `<button class="secondary" data-schedule>${t.enabled ? '暂停同步' : '开启四天增量'}</button><label>本次历史页数<input data-budget type="number" min="1" max="100" value="2"></label>` : ''}</div>${t.lastError ? `<p class="review-error">${esc(t.lastError)}</p>` : ''}` : '<div class="panel-head"><h2>评论档案</h2></div>';
        root.querySelectorAll<HTMLButtonElement>('[data-review-action]').forEach(b => b.onclick = async () => {
            b.disabled = true;
            try {
                await api('/api/product-reviews/sync', 'POST', { itemId: selected, mode: b.dataset.reviewAction, pageBudget: Number(root.querySelector<HTMLInputElement>('[data-budget]')?.value ?? 2) });
                notice('任务已排队，可刷新状态查看进度');
                await refresh();
            }
            catch (e) {
                notice((e as Error).message, true);
                b.disabled = false;
            }
        });
        const pause = root.querySelector<HTMLButtonElement>('[data-pause]');
        if (pause)
            pause.onclick = async () => {
                pause.disabled = true;
                try {
                    await api(`/api/product-reviews/targets/${selected}/pause`, 'POST', {});
                    notice('已请求暂停；当前页结束后保存断点');
                    await refresh();
                }
                catch (e) {
                    notice((e as Error).message, true);
                }
            };
        const schedule = root.querySelector<HTMLButtonElement>('[data-schedule]');
        if (schedule)
            schedule.onclick = async () => {
                schedule.disabled = true;
                try {
                    await api(`/api/product-reviews/targets/${selected}/schedule`, 'PUT', { enabled: !t.enabled });
                    notice(t.enabled ? '已暂停该 Item；正在读取的页面结束后保存断点' : '已开启该 Item 的四天增量计划');
                    await refresh();
                }
                catch (e) {
                    notice((e as Error).message, true);
                    schedule.disabled = false;
                }
            };
    };
    const updateView = () => { (root.querySelector('[data-management]') as HTMLElement).hidden = detailVisible; (root.querySelector('[data-detail]') as HTMLElement).hidden = !detailVisible; root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.classList.toggle('active', (b.dataset.view === 'detail') === detailVisible)); };
    const refresh = async () => {
        targets = await api('/api/product-reviews/targets');
        draw();
    };
    root.querySelector<HTMLFormElement>('.review-filters')!.addEventListener('submit', e => { e.preventDefault(); e.stopPropagation(); const data = new FormData(e.currentTarget as HTMLFormElement); const query = String(data.get('q') ?? '').trim(); const productMatch = query ? filterReviewTargets(targets, query)[0] : undefined; if (productMatch) { selected = productMatch.itemId; detailUnlocked = true; filters = { variant: String(data.get('variant') ?? ''), rating: String(data.get('rating') ?? ''), q: '', from: String(data.get('from') ?? ''), to: String(data.get('to') ?? '') }; draw(); } else { filters = { variant: String(data.get('variant') ?? ''), rating: String(data.get('rating') ?? ''), q: query, from: String(data.get('from') ?? ''), to: String(data.get('to') ?? '') }; } page = 1; void loadReviews(); }, { capture: true });
    const add = root.querySelector<HTMLFormElement>('[data-add-item]');
    if (add)
        add.onsubmit = async (e) => {
            e.preventDefault();
            try {
                const data = new FormData(add);
                const itemId = String(data.get('itemId'));
                await api('/api/product-reviews/targets', 'POST', { itemId });
                selected = itemId;
                page = 1;
                add.reset();
                notice('Item 已加入列表；已有评论与抓取进度保留');
                await refresh();
                await loadReviews();
            }
            catch (e) {
                notice((e as Error).message, true);
            }
        };
    const key = root.querySelector<HTMLFormElement>('[data-key-form]');
    if (key) {
        key.onsubmit = async (e) => {
            e.preventDefault();
            try {
                await api('/api/product-reviews/config', 'PUT', { apiKey: new FormData(key).get('apiKey') });
                key.reset();
                notice('密钥已加密保存');
                root.querySelector('[data-config-state]')!.textContent = '已配置';
            }
            catch (e) {
                notice((e as Error).message, true);
            }
        };
        void api('/api/product-reviews/config').then(c => { root.querySelector('[data-config-state]')!.textContent = c.configured ? '已配置' : '未配置'; }).catch(() => { });
    }
    root.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick = async () => {
        try {
            await refresh();
            await loadReviews();
            notice('状态已刷新');
        }
        catch (e) {
            notice((e as Error).message, true);
        }
    };
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.onclick = () => { detailVisible = b.dataset.view === 'detail'; updateView(); if (detailVisible) { detailUnlocked = false; selected = ''; draw(); void loadReviews(); } });
    const targetSearch = root.querySelector<HTMLInputElement>('[data-target-search]')!;
    targetSearch.oninput = () => draw();
    targetSearch.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const match = filterReviewTargets(targets, targetSearch.value)[0]; if (match) { selected = match.itemId; detailUnlocked = true; draw(); void loadReviews(); } } };
    try {
        await refresh();
        updateView();
    }
    catch (e) {
        notice((e as Error).message, true);
    }
    const timer = setInterval(() => {
        if (!root.isConnected) {
            clearInterval(timer);
            return;
        }
        if (targets.some(t => ['queued', 'running'].includes(t.status)))
            void refresh().then(() => loadReviews()).catch(e => notice((e as Error).message, true));
    }, 15000);
}
