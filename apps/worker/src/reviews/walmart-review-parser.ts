import { createHash } from 'node:crypto';
import type { ReviewRecord, ReviewSummary } from '../../../../packages/db/src/product-reviews.js';
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export function reviewUrl(itemId: string): string { return `https://www.walmart.com/reviews/product/${itemId}?sort=submission-desc`; }
export function safeReviewUrl(value: string, base: string, itemId: string): string {
    const url = new URL(decode(value), base);
    if (url.protocol !== 'https:' || !['www.walmart.com', 'walmart.com'].includes(url.hostname) || url.username || url.password || url.pathname !== `/reviews/product/${itemId}`)
        throw new Error('拒绝不属于当前商品的分页链接');
    url.searchParams.set('sort', 'submission-desc');
    url.hash = '';
    return url.toString();
}
export function parseWalmartReviewPage(input: {
    itemId: string;
    url: string;
    html?: string;
    markdown?: string;
}) {
    const html = input.html ?? '', markdown = input.markdown ?? '';
    if (/robot or human|press & hold|verify you are human|access denied|captcha/i.test(markdown.slice(0, 4000) + html.slice(0, 3000)))
        throw new Error('Walmart 评论页被拦截');
    const records = new Map<string, ReviewRecord>();
    const sourceReviews = new Map<string, [string, number, string]>();
    let summary: ReviewSummary | undefined;
    let explicitEmpty = false;
    let nextPageUrl: string | null = null;
    const walk = (value: any, depth = 0): void => {
        if (!value || typeof value !== 'object' || depth > 35)
            return;
        if (Array.isArray(value)) {
            for (const x of value)
                walk(x, depth + 1);
            return;
        }
        const id = value.reviewId ?? value.reviewID ?? (value['@type'] === 'Review' ? value.identifier : undefined);
        const rating = Number(value.rating ?? value.reviewRating?.ratingValue);
        const body = value.reviewText ?? value.reviewBody ?? value.text;
        const source = value.syndicationSource;
        const hasSyndicationSource = typeof source === 'string' ? source.trim().length > 0 : Boolean(source && typeof source === 'object' && Object.values(source).some(v => typeof v === 'string' && v.trim().length > 0));
        const syndication = String(value.reviewType ?? '').toLowerCase() === 'syndication' || hasSyndicationSource || ['syndication', 'wholescale'].includes(String(value.externalSource ?? '').toLowerCase());
        if (value.averageOverallRating !== undefined || value.totalReviewCount !== undefined) summary = { averageRating: Number.isFinite(Number(value.averageOverallRating)) ? Number(value.averageOverallRating) : null, totalReviewCount: Number.isFinite(Number(value.totalReviewCount)) ? Number(value.totalReviewCount) : null, starCounts:{1:value.ratingValueOneCount ?? null,2:value.ratingValueTwoCount ?? null,3:value.ratingValueThreeCount ?? null,4:value.ratingValueFourCount ?? null,5:value.ratingValueFiveCount ?? null}, starPercentages:{1:value.percentageOneCount ?? null,2:value.percentageTwoCount ?? null,3:value.percentageThreeCount ?? null,4:value.percentageFourCount ?? null,5:value.percentageFiveCount ?? null} };
        if (id && Number.isInteger(rating) && rating >= 1 && rating <= 5 && typeof body === 'string') {
            sourceReviews.set(String(id), [String(id), rating, body]);
        }
        if (!syndication && id && Number.isInteger(rating) && rating >= 1 && rating <= 5 && typeof body === 'string') {
            const date = value.reviewSubmissionTime ?? value.submissionTime ?? value.datePublished;
            records.set(String(id), { reviewKey: String(id), rating, title: value.reviewTitle ?? value.headline ?? null, body, publishedAt: date && Number.isFinite(Date.parse(date)) ? (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date) ? new Date(Date.parse(date + ' 12:00:00 UTC')).toISOString() : new Date(date).toISOString()) : null, author: typeof value.author === 'object' ? value.author?.name ?? null : value.userNickname ?? value.author ?? null, verifiedPurchase: typeof value.verifiedPurchaser === 'boolean' ? value.verifiedPurchaser : Array.isArray(value.badges) ? value.badges.some((b: any) => b.id === 'VerifiedPurchaser') : null, sourceUrl: input.url, rawPayload: value });
        }
        if (value.totalReviewCount === 0 || value.totalReviews === 0)
            explicitEmpty = true;
        if (Array.isArray(value.customerReviews)) {
            if (value.activeSort && value.activeSort !== 'submission-desc')
                throw new Error('评论排序不符合最新评论要求');
            if (value.customerReviews.length === 0 && value.totalReviewCount === 0)
                explicitEmpty = true;
            walk(value.customerReviews, depth + 1);
            const next = value.pagination?.next?.url;
            if (typeof next === 'string' && next)
                nextPageUrl = safeReviewUrl(next.startsWith('sort=') ? '?' + next : next, input.url, input.itemId);
            for (const key of ['nextPageUrl', 'nextUrl'])
                if (typeof value[key] === 'string')
                    nextPageUrl = safeReviewUrl(value[key], input.url, input.itemId);
            return;
        }
        for (const [key, v] of Object.entries(value)) {
            if (/nextPageUrl|nextUrl/.test(key) && typeof v === 'string')
                nextPageUrl = safeReviewUrl(v, input.url, input.itemId);
            else
                walk(v, depth + 1);
        }
    };
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(match[1]);
        }
        catch {
            continue;
        }
        walk(parsed);
    }
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
        if (/rel=["']next["']|aria-label=["'][^"']*next/i.test(match[1]) || /^\s*(next|下一页)\s*$/i.test(match[2].replace(/<[^>]+>/g, ''))) {
            const href = match[1].match(/href=["']([^"']+)["']/i)?.[1];
            if (href)
                nextPageUrl = safeReviewUrl(href, input.url, input.itemId);
        }
    }
    if (!sourceReviews.size && !explicitEmpty)
        throw new Error('评论页结构无法识别，未当作零评论处理');
    const reviews = [...records.values()];
    const contentHash = createHash('sha256').update(JSON.stringify([...sourceReviews.values()].sort())).digest('hex');
    return { reviews, nextPageUrl, contentHash, explicitEmpty, summary };
}
