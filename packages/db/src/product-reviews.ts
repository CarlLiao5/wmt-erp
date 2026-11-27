import { createHash, randomUUID } from 'node:crypto';
import { createDb } from './db.js';
import { groupReviewVariants } from './product-review-variants.js';
import { normalizeReviewProduct } from './product-review-product.js';
export type ReviewMode = 'initial' | 'incremental';
export interface ReviewRecord {
    reviewKey: string;
    rating: number;
    title: string | null;
    body: string | null;
    publishedAt: string | null;
    author: string | null;
    verifiedPurchase: boolean | null;
    sourceUrl: string;
    rawPayload: unknown;
}
export interface ReviewSummary { averageRating: number | null; totalReviewCount: number | null; starCounts: Record<1|2|3|4|5, number | null>; starPercentages: Record<1|2|3|4|5, number | null>; }
export interface ReviewTarget {
    id: string;
    tenantId: string;
    itemId: string;
    enabled: number;
    nextRunAt: Date | null;
    lastSuccessAt: Date | null;
    initialStatus: string;
    nextPageUrl: string | null;
    status: string;
    stopRequested: number;
    pagesRead: number;
    lastError: string | null;
}
export function normalizeReviewItemId(value: unknown): string {
    const id = String(value ?? '').trim();
    if (!/^\d{1,30}$/.test(id))
        throw new Error('请输入有效的数字 Item ID');
    return id;
}
export const nextProductReviewRunAt = (from: Date): Date => new Date(from.getTime() + 96 * 3600000);
export const scheduleUpdateValues = (enabled: boolean) => ({ enabled: Number(enabled), stopRequested: Number(!enabled) });
export const reviewRunKey = (tenant: string, item: string, mode: ReviewMode, slot: string): string => createHash('sha256').update(JSON.stringify([tenant, item, mode, slot])).digest('hex');
export function reviewPageFilter(q: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(q.page) || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(Number(q.pageSize) || 20)));
    const rating = q.rating ? Number(q.rating) : undefined;
    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5))
        throw new Error('星级需为1至5');
    for (const key of ['from', 'to'])
        if (q[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(q[key])))
            throw new Error('日期格式错误');
    const variant = q.variant ? String(q.variant) : '';
    if (variant && variant !== '__missing__') normalizeReviewItemId(variant);
    return { page, pageSize, rating, variant, q: String(q.q ?? '').slice(0, 200), from: q.from ? String(q.from) : undefined, to: q.to ? String(q.to) : undefined };
}
const targetColumns = 'id, tenant_id AS tenantId, item_id AS itemId, enabled, next_run_at AS nextRunAt, last_success_at AS lastSuccessAt, initial_status AS initialStatus, next_page_url AS nextPageUrl, status, stop_requested AS stopRequested, pages_read AS pagesRead, last_error AS lastError';
export class ProductReviewRepository {
    constructor(readonly pool = createDb().pool) { }
    async addTarget(tenantId: string, itemId: string) { normalizeReviewItemId(itemId); await this.pool.query('INSERT IGNORE INTO product_review_targets (id,tenant_id,item_id,created_at,updated_at) VALUES (?,?,?,NOW(3),NOW(3))', [randomUUID(), tenantId, itemId]); return this.getTarget(tenantId, itemId); }
    async getTarget(tenantId: string, itemId: string): Promise<ReviewTarget | undefined> { const [rows] = await this.pool.query(`SELECT ${targetColumns} FROM product_review_targets WHERE tenant_id=? AND item_id=?`, [tenantId, itemId]); return (rows as ReviewTarget[])[0]; }
    async listTargets(tenantId: string): Promise<ReviewTarget[]> { const [rows] = await this.pool.query(`SELECT ${targetColumns}, (SELECT COUNT(*) FROM product_reviews r WHERE r.tenant_id=t.tenant_id AND r.item_id=t.item_id) AS reviewCount, (SELECT average_rating FROM product_review_snapshots s WHERE s.tenant_id=t.tenant_id AND s.item_id=t.item_id ORDER BY captured_at DESC LIMIT 1) AS averageRating, (SELECT total_review_count FROM product_review_snapshots s WHERE s.tenant_id=t.tenant_id AND s.item_id=t.item_id ORDER BY captured_at DESC LIMIT 1) AS totalReviewCount, (SELECT captured_at FROM product_review_snapshots s WHERE s.tenant_id=t.tenant_id AND s.item_id=t.item_id ORDER BY captured_at DESC LIMIT 1) AS latestSnapshotAt FROM product_review_targets t WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1000`, [tenantId]); return rows as ReviewTarget[]; }
    async listSnapshots(tenantId: string, itemId: string) { const [rows] = await this.pool.query(`SELECT captured_at AS capturedAt,average_rating AS averageRating,total_review_count AS totalReviewCount,one_star_count AS oneStarCount,two_star_count AS twoStarCount,three_star_count AS threeStarCount,four_star_count AS fourStarCount,five_star_count AS fiveStarCount,one_star_pct AS oneStarPct,two_star_pct AS twoStarPct,three_star_pct AS threeStarPct,four_star_pct AS fourStarPct,five_star_pct AS fiveStarPct FROM product_review_snapshots WHERE tenant_id=? AND item_id=? ORDER BY captured_at DESC LIMIT 1000`, [tenantId,itemId]); return { rows }; }
    async setSchedule(tenantId: string, itemId: string, enabled: boolean) { await this.pool.query('UPDATE product_review_targets SET enabled=?,next_run_at=IF(?,COALESCE(next_run_at,?),NULL),stop_requested=?,updated_at=NOW(3) WHERE tenant_id=? AND item_id=?', [scheduleUpdateValues(enabled).enabled, +enabled, nextProductReviewRunAt(new Date()), scheduleUpdateValues(enabled).stopRequested, tenantId, itemId]); }
    async listReviews(tenantId: string, itemId: string, filter: ReturnType<typeof reviewPageFilter>) {
        const conditions = ['tenant_id=?', 'item_id=?'], values: unknown[] = [tenantId, itemId];
        if (filter.variant === '__missing__') conditions.push('review_item_id IS NULL');
        else if (filter.variant) { conditions.push('review_item_id=?'); values.push(filter.variant); }
        if (filter.rating) {
            conditions.push('rating=?');
            values.push(filter.rating);
        }
        if (filter.q) {
            conditions.push('(title LIKE ? OR body LIKE ? OR author LIKE ?)');
            values.push(...Array(3).fill(`%${filter.q}%`));
        }
        if (filter.from) {
            conditions.push('published_at>=?');
            values.push(filter.from);
        }
        if (filter.to) {
            conditions.push('published_at<DATE_ADD(?, INTERVAL 1 DAY)');
            values.push(filter.to);
        }
        const where = conditions.join(' AND ');
        const [count] = await this.pool.query(`SELECT COUNT(*) AS total,AVG(rating) AS averageRating,SUM(rating>=4) AS positiveCount,SUM(rating<=2) AS negativeCount FROM product_reviews WHERE ${where}`, values);
        const [rows] = await this.pool.query(`SELECT review_key AS reviewKey,rating,title,body,published_at AS publishedAt,author,verified_purchase AS verifiedPurchase,source_url AS sourceUrl,review_item_id AS reviewItemId,review_item_name AS reviewItemName,review_item_image_url AS reviewItemImageUrl,review_features AS reviewFeatures FROM product_reviews WHERE ${where} ORDER BY published_at DESC,review_key LIMIT ? OFFSET ?`, [...values, filter.pageSize, (filter.page - 1) * filter.pageSize]);
        const annotatedRows = (rows as any[]).map(({ reviewItemId, reviewItemName, reviewItemImageUrl, reviewFeatures, ...row }) => ({ ...row, sourceItemId: itemId, reviewProduct: normalizeReviewProduct({ itemId: reviewItemId, itemName: reviewItemName, itemImageUrl: reviewItemImageUrl, features: typeof reviewFeatures === 'string' ? JSON.parse(reviewFeatures) : reviewFeatures }) }));
        // Options span all reviews under the authorized crawl item, independent of pagination/other filters.
        const [variantRows] = await this.pool.query(`SELECT review_item_id AS itemId,review_item_name AS name,review_item_image_url AS imageUrl,CAST(review_features AS CHAR) AS features,COUNT(*) AS count FROM product_reviews WHERE tenant_id=? AND item_id=? GROUP BY review_item_id,review_item_name,review_item_image_url,CAST(review_features AS CHAR) ORDER BY count DESC,review_item_id`, [tenantId, itemId]);
        const variants = groupReviewVariants(variantRows as any[]);
        const aggregate = (count as any[])[0];
        const total = Number(aggregate.total);
        const positiveCount = Number(aggregate.positiveCount ?? 0), negativeCount = Number(aggregate.negativeCount ?? 0);
        const statistics = { count: total, averageRating: total && aggregate.averageRating != null ? Number(aggregate.averageRating) : null, positiveCount, negativeCount, positiveRate: total ? positiveCount / total * 100 : null, negativeRate: total ? negativeCount / total * 100 : null };
        return { rows: annotatedRows, variants, statistics, total, page: filter.page, pageSize: filter.pageSize };
    }
    async upsertPage(input: {
        tenantId: string;
        itemId: string;
        pageId: string;
        sourceUrl: string;
        reviews: ReviewRecord[];
        nextPageUrl: string | null;
        contentHash: string;
        mode: ReviewMode;
        creditsUsed?: number;
        summary?: ReviewSummary;
    }) {
        const c = await this.pool.getConnection();
        try {
            await c.beginTransaction();
            const [saved] = await c.query('SELECT status FROM product_review_pages WHERE id=? AND tenant_id=? AND item_id=? FOR UPDATE', [input.pageId, input.tenantId, input.itemId]);
            if (!(saved as any[]).length)
                throw new Error('评论页面检查点不存在');
            if ((saved as any[])[0].status === 'completed') {
                await c.commit();
                return;
            }
            for (const r of input.reviews) {
                const product = normalizeReviewProduct(r.rawPayload);
                await c.query('INSERT INTO product_reviews (id,tenant_id,item_id,review_key,rating,title,body,published_at,author,verified_purchase,source_url,raw_payload,review_item_id,review_item_name,review_item_image_url,review_features,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE rating=VALUES(rating),title=VALUES(title),body=VALUES(body),published_at=VALUES(published_at),author=VALUES(author),verified_purchase=VALUES(verified_purchase),review_item_id=COALESCE(VALUES(review_item_id),review_item_id),review_item_name=COALESCE(VALUES(review_item_name),review_item_name),review_item_image_url=COALESCE(VALUES(review_item_image_url),review_item_image_url),review_features=COALESCE(VALUES(review_features),review_features),raw_payload=IF(JSON_EXTRACT(VALUES(raw_payload), \'$.truncated\') = TRUE, raw_payload, VALUES(raw_payload)),last_seen_at=NOW(3)', [randomUUID(), input.tenantId, input.itemId, r.reviewKey, r.rating, r.title, r.body, r.publishedAt ? new Date(r.publishedAt) : null, r.author, r.verifiedPurchase === null ? null : +r.verifiedPurchase, r.sourceUrl, JSON.stringify(r.rawPayload).length <= 200000 ? JSON.stringify(r.rawPayload) : JSON.stringify({ truncated: true }), product.itemId, product.name, product.imageUrl, product.features.length ? JSON.stringify(product.features) : null]);
            }
            if (input.summary) { const s=input.summary; await c.query('INSERT INTO product_review_snapshots (id,tenant_id,item_id,captured_at,average_rating,total_review_count,one_star_count,two_star_count,three_star_count,four_star_count,five_star_count,one_star_pct,two_star_pct,three_star_pct,four_star_pct,five_star_pct,source_url,raw_payload) VALUES (?,?,?,NOW(3),?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[randomUUID(),input.tenantId,input.itemId,s.averageRating,s.totalReviewCount,s.starCounts[1],s.starCounts[2],s.starCounts[3],s.starCounts[4],s.starCounts[5],s.starPercentages[1],s.starPercentages[2],s.starPercentages[3],s.starPercentages[4],s.starPercentages[5],input.sourceUrl,JSON.stringify(s)]); }
            await c.query("UPDATE product_review_pages SET status='completed',content_hash=?,next_page_url=?,credits_used=?,updated_at=NOW(3) WHERE id=?", [input.contentHash, input.nextPageUrl, input.creditsUsed ?? null, input.pageId]);
            await c.query(`UPDATE product_review_targets SET pages_read=pages_read+1,last_success_at=NOW(3),updated_at=NOW(3)${input.mode === 'initial' ? ',next_page_url=?,initial_status=?' : ''} WHERE tenant_id=? AND item_id=?`, [...(input.mode === 'initial' ? [input.nextPageUrl, input.nextPageUrl ? 'partial' : 'completed'] : []), input.tenantId, input.itemId]);
            await c.commit();
        }
        catch (e) {
            await c.rollback();
            throw e;
        }
        finally {
            c.release();
        }
    }
}
