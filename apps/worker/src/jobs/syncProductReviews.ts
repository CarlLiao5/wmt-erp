import { createHash, randomUUID } from 'node:crypto';
import { ProductReviewRepository, normalizeReviewItemId, type ReviewMode, type ReviewSummary } from '../../../../packages/db/src/product-reviews.js';
import { decryptCredential } from '../../../api/src/security/credentials.js';
import { FirecrawlClient } from '../reviews/firecrawl-client.js';
import { parseWalmartReviewPage, reviewUrl } from '../reviews/walmart-review-parser.js';
import type { SyncRequest } from '../queue.js';
type Parsed = ReturnType<typeof parseWalmartReviewPage>;
type ParsedPage = { reviews: Parsed['reviews']; nextPageUrl: string | null; contentHash: string; summary?: ReviewSummary };
export async function runReviewPages(input: {
    mode: ReviewMode;
    startUrl: string;
    pageBudget: number;
    read: (url: string) => Promise<ParsedPage>;
    save: (page: ParsedPage, url: string) => Promise<void>;
    shouldStop: () => Promise<boolean>;
}) {
    let url: string | null = input.startUrl;
    const urls = new Set<string>(), hashes = new Set<string>();
    let pages = 0, reviews = 0;
    while (url && pages < input.pageBudget) {
        if (await input.shouldStop())
            return { status: 'paused', nextUrl: url, pages, reviews, reason: '已暂停' };
        if (urls.has(url))
            return { status: 'paused', nextUrl: url, pages, reviews, reason: '分页链接重复' };
        urls.add(url);
        const page = await input.read(url);
        if (hashes.has(page.contentHash))
            return { status: 'paused', nextUrl: url, pages, reviews, reason: '页面内容重复' };
        hashes.add(page.contentHash);
        await input.save(page, url);
        pages++;
        reviews += page.reviews.length;
        if (input.mode === 'incremental')
            return { status: 'completed', nextUrl: null, pages, reviews };
        url = page.nextPageUrl;
    }
    return { status: url ? 'paused' : 'completed', nextUrl: url, pages, reviews, reason: url ? '已达到本次页数预算' : undefined };
}
export async function syncProductReviews(request: SyncRequest, deps: {
    repo?: ProductReviewRepository;
} = {}) {
    const repo = deps.repo ?? new ProductReviewRepository(), pool = repo.pool, itemId = normalizeReviewItemId(request.state?.itemId), mode: ReviewMode = request.state?.mode === 'initial' ? 'initial' : 'incremental';
    const runId = request.batchId ?? randomUUID();
    const lock = await pool.getConnection();
    let acquired = false, pageId = '';
    let creditsUsed: number | undefined;
    try {
        // Server-wide advisory lock deliberately serializes all Firecrawl work, even across processes and tenants.
        const [locks] = await lock.query("SELECT GET_LOCK('wmterp:firecrawl:reviews',30) AS acquired");
        acquired = Number((locks as any[])[0].acquired) === 1;
        if (!acquired)
            throw new Error('评论抓取服务繁忙，请稍后重试');
        const target = await repo.getTarget(request.tenantId, itemId);
        if (!target)
            throw new Error('评论目标不存在');
        if (target.stopRequested) {
            await pool.query("UPDATE product_review_targets SET status='paused' WHERE tenant_id=? AND item_id=?", [request.tenantId, itemId]);
            return { status: 'paused', reason: '已暂停' };
        }
        if (mode === 'incremental' && target.initialStatus !== 'completed')
            throw new Error('请先继续完成历史抓取');
        if (mode === 'initial' && target.initialStatus === 'completed') {
            await pool.query("UPDATE product_review_targets SET status='completed' WHERE tenant_id=? AND item_id=?", [request.tenantId, itemId]);
            await pool.query("UPDATE product_review_runs SET status='completed',ended_at=NOW(3) WHERE id=?", [runId]);
            return { status: 'completed', reason: '历史抓取已经完成' };
        }
        if (mode === 'incremental') {
            const [done] = await pool.query("SELECT id FROM product_review_pages WHERE run_id=? AND tenant_id=? AND item_id=? AND status='completed' LIMIT 1", [runId, request.tenantId, itemId]);
            if ((done as any[]).length) {
                await pool.query("UPDATE product_review_targets SET status='completed' WHERE tenant_id=? AND item_id=?", [request.tenantId, itemId]);
                await pool.query("UPDATE product_review_runs SET status='completed',ended_at=NOW(3) WHERE id=?", [runId]);
                return { status: 'completed', pages: 1, reason: '已恢复提交成功的增量页' };
            }
        }
        const [configs] = await pool.query('SELECT encrypted_api_key AS apiKey FROM product_review_configs WHERE tenant_id=?', [request.tenantId]);
        const config = (configs as any[])[0];
        if (!config)
            throw new Error('请先配置 Firecrawl API Key');
        const client = new FirecrawlClient(decryptCredential(config.apiKey));
        await pool.query("INSERT INTO product_review_runs(id,tenant_id,item_id,mode,status,started_at) VALUES (?,?,?,?,'running',NOW(3)) ON DUPLICATE KEY UPDATE status='running',ended_at=NULL", [runId, request.tenantId, itemId, mode]);
        await pool.query("UPDATE product_review_targets SET status='running',last_error=NULL WHERE tenant_id=? AND item_id=?", [request.tenantId, itemId]);
        const result = await runReviewPages({ mode, startUrl: mode === 'initial' ? (target.nextPageUrl ?? reviewUrl(itemId)) : reviewUrl(itemId), pageBudget: Math.min(100, Math.max(1, Number(request.state?.pageBudget) || 2)), shouldStop: async () => Boolean((await repo.getTarget(request.tenantId, itemId))?.stopRequested),
            read: async (url) => {
                const hash = createHash('sha256').update(url).digest('hex');
                const [pending] = await pool.query("SELECT id,batch_id AS batchId,status FROM product_review_pages WHERE tenant_id=? AND item_id=? AND mode=? AND url_hash=? AND status IN ('submitting','submitted') ORDER BY updated_at DESC LIMIT 1", [request.tenantId, itemId, mode, hash]);
                let p = (pending as any[])[0];
                if (p?.status === 'submitting')
                    throw new Error('上次提交结果未知，请核对 Firecrawl 批次后再恢复，防止重复扣费');
                if (!p) {
                    p = { id: randomUUID(), batchId: null };
                    await pool.query("INSERT INTO product_review_pages(id,tenant_id,item_id,run_id,mode,source_url,url_hash,status,updated_at) VALUES (?,?,?,?,?,?,?,'submitting',NOW(3))", [p.id, request.tenantId, itemId, runId, mode, url, hash]);
                    let submitted: {
                        batchId: string;
                    };
                    try {
                        submitted = await client.submit([url]);
                    }
                    catch (e) {
                        if ((e as {
                            definitive?: boolean;
                        }).definitive)
                            await pool.query("UPDATE product_review_pages SET status='failed',updated_at=NOW(3) WHERE id=?", [p.id]);
                        throw e;
                    }
                    p.batchId = submitted.batchId;
                    await pool.query("UPDATE product_review_pages SET batch_id=?,status='submitted',updated_at=NOW(3) WHERE id=?", [p.batchId, p.id]);
                }
                pageId = p.id;
                for (let i = 0; i < 60; i++) {
                    const batch = await client.poll(p.batchId);
                    if (batch.status === 'failed' || batch.status === 'cancelled') {
                        await pool.query("UPDATE product_review_pages SET status='failed',updated_at=NOW(3) WHERE id=?", [p.id]);
                        throw new Error('Firecrawl 批次失败，可重新启动该 Item 同步');
                    }
                    if (batch.status === 'completed') {
                        if (batch.data.length !== 1)
                            throw new Error('Firecrawl 返回页面数量不正确');
                        creditsUsed = batch.creditsUsed;
                        const doc = batch.data[0];
                        let parsed: ReturnType<typeof parseWalmartReviewPage>;
                        try {
                            parsed = parseWalmartReviewPage({ itemId, url, html: doc.rawHtml ?? doc.html, markdown: doc.markdown });
                        }
                        catch (error) {
                            await pool.query("UPDATE product_review_pages SET status='failed',updated_at=NOW(3) WHERE id=?", [p.id]);
                            throw error;
                        }
                        if (mode === 'initial') {
                            const [seen] = await pool.query('SELECT id FROM product_review_pages WHERE tenant_id=? AND item_id=? AND mode=? AND content_hash=? AND id<>? LIMIT 1', [request.tenantId, itemId, mode, parsed.contentHash, pageId]);
                            if ((seen as any[]).length)
                                throw new Error('历史页面内容重复，已停止继续翻页');
                        }
                        return parsed;
                    }
                    await new Promise(r => setTimeout(r, 5000));
                }
                throw new Error('Firecrawl 尚未完成，已保留批次，可继续检查');
            }, save: async (page, sourceUrl) => repo.upsertPage({ tenantId: request.tenantId, itemId, pageId, sourceUrl, reviews: page.reviews, nextPageUrl: page.nextPageUrl, contentHash: page.contentHash, mode, creditsUsed, summary: page.summary }) });
        await pool.query("UPDATE product_review_targets SET status=?,last_error=?,next_run_at=IF(enabled=1 AND ?=\'completed\' AND ?=\'incremental\',DATE_ADD(NOW(3),INTERVAL 96 HOUR),next_run_at),stop_requested=0,updated_at=NOW(3) WHERE tenant_id=? AND item_id=?", [result.status, result.reason ?? null, result.status, mode, request.tenantId, itemId]);
        await pool.query('UPDATE product_review_runs SET status=?,pages_read=?,reviews_written=?,error_message=?,ended_at=NOW(3) WHERE id=?', [result.status, result.pages, result.reviews, result.reason ?? null, runId]);
        return result;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : '评论同步失败';
        await pool.query("UPDATE product_review_targets SET status='failed',last_error=?,updated_at=NOW(3) WHERE tenant_id=? AND item_id=?", [message.slice(0, 500), request.tenantId, itemId]);
        await pool.query("UPDATE product_review_runs SET status='failed',error_message=?,ended_at=NOW(3) WHERE id=?", [message.slice(0, 500), runId]);
        throw e;
    }
    finally {
        if (acquired)
            await lock.query("SELECT RELEASE_LOCK('wmterp:firecrawl:reviews')");
        lock.release();
    }
}
