import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { ProductReviewRepository, normalizeReviewItemId, reviewPageFilter } from '../../../../packages/db/src/product-reviews.js';
import { encryptCredential } from '../security/credentials.js';
import { canViewStoreSku } from './sku-visibility.js';
import type { OrderVisibility } from './orders.js';
interface Options {
    visibility: (req: Request) => Promise<OrderVisibility | undefined> | OrderVisibility | undefined;
    repo?: ProductReviewRepository;
    products: (tenantId: string) => Promise<Array<{
        storeId: string;
        sku: string;
        itemId?: string | null;
        productName?: string | null;
        imageUrl?: string | null;
    }>>;
    enqueue?: (request: any) => Promise<unknown>;
}
export function productReviewsRouter(options: Options): Router {
    const router = Router();
    const repo = () => options.repo ?? new ProductReviewRepository();
    const fail = (res: any, status: number, message: string) => res.status(status).json({ data: null, error: { message } });
    router.use('/product-reviews', async (req, res, next) => {
        try {
            const scope = await options.visibility(req);
            if (!scope?.tenantId)
                return fail(res, 401, '请先登录');
            res.locals.reviewScope = scope;
            next();
        }
        catch (e) {
            next(e);
        }
    });
    const admin = (res: any) => res.locals.reviewScope.role === 'admin';
    const visible = async (res: any, itemId: string) => { const v = res.locals.reviewScope as OrderVisibility; return v.role === 'admin' || (await options.products(v.tenantId!)).some(p => String(p.itemId) === itemId && canViewStoreSku(v, p.storeId, p.sku)); };
    const wrap = (fn: (req: Request, res: any) => Promise<unknown>) => async (req: Request, res: any, next: any) => {
        try {
            return await fn(req, res);
        }
        catch (e) {
            if (e instanceof Error && /请输入|格式|星级|预算|模式/.test(e.message))
                return fail(res, 400, e.message);
            return next(e);
        }
    };
    router.get('/product-reviews/targets', wrap(async (_req, res) => { const v = res.locals.reviewScope; const products = (await options.products(v.tenantId)).filter(p => canViewStoreSku(v, p.storeId, p.sku)); const targets = (await repo().listTargets(v.tenantId)).filter(t => v.role === 'admin' || products.some(p => String(p.itemId) === t.itemId)).map(t => ({ ...t, product: products.find(p => String(p.itemId) === t.itemId) ?? null })); return res.json({ data: targets, error: null }); }));
    router.post('/product-reviews/targets', wrap(async (req, res) => {
        if (!admin(res))
            return fail(res, 403, '需要管理员权限');
        const itemId = normalizeReviewItemId(req.body.itemId);
        return res.status(201).json({ data: await repo().addTarget(res.locals.reviewScope.tenantId, itemId), error: null });
    }));
    router.get('/product-reviews/config', wrap(async (_req, res) => {
        if (!admin(res))
            return fail(res, 403, '需要管理员权限');
        const [rows] = await repo().pool.query('SELECT updated_at AS updatedAt FROM product_review_configs WHERE tenant_id=?', [res.locals.reviewScope.tenantId]);
        return res.json({ data: { configured: (rows as any[]).length > 0, updatedAt: (rows as any[])[0]?.updatedAt ?? null }, error: null });
    }));
    router.put('/product-reviews/config', wrap(async (req, res) => {
        if (!admin(res))
            return fail(res, 403, '需要管理员权限');
        if (typeof req.body.apiKey !== 'string' || !/^fc-[a-zA-Z0-9-]{10,150}$/.test(req.body.apiKey.trim()))
            return fail(res, 400, '请输入有效的 Firecrawl API Key');
        await repo().pool.query('INSERT INTO product_review_configs(tenant_id,encrypted_api_key,updated_at) VALUES (?,?,NOW(3)) ON DUPLICATE KEY UPDATE encrypted_api_key=VALUES(encrypted_api_key),updated_at=NOW(3)', [res.locals.reviewScope.tenantId, encryptCredential(req.body.apiKey.trim())]);
        return res.status(204).send();
    }));
    router.get('/product-reviews', wrap(async (req, res) => {
        const itemId = normalizeReviewItemId(req.query.itemId);
        if (!await visible(res, itemId))
            return fail(res, 403, '无权查看该商品评论');
        const filters = reviewPageFilter(req.query);
        return res.json({ data: await repo().listReviews(res.locals.reviewScope.tenantId, itemId, filters), error: null });
    }));
    router.get('/product-reviews/snapshots', wrap(async (req, res) => {
        const itemId = normalizeReviewItemId(req.query.itemId);
        if (!await visible(res, itemId)) return fail(res, 403, '无权查看该商品评论');
        return res.json({ data: await repo().listSnapshots(res.locals.reviewScope.tenantId, itemId), error: null });
    }));
    router.put('/product-reviews/targets/:itemId/schedule', wrap(async (req, res) => {
        if (!admin(res))
            return fail(res, 403, '需要管理员权限');
        const itemId = normalizeReviewItemId(req.params.itemId), r = repo(), tenantId = res.locals.reviewScope.tenantId;
        if (!await r.getTarget(tenantId, itemId))
            return fail(res, 404, '评论目标不存在');
        if (typeof req.body.enabled !== 'boolean')
            return fail(res, 400, 'enabled 必须为布尔值');
        await r.setSchedule(tenantId, itemId, req.body.enabled);
        return res.json({ data: await r.getTarget(tenantId, itemId), error: null });
    }));
    router.post('/product-reviews/targets/:itemId/pause', wrap(async (req, res) => {
        if (!admin(res))
            return fail(res, 403, '需要管理员权限');
        const itemId = normalizeReviewItemId(req.params.itemId), tenantId = res.locals.reviewScope.tenantId;
        await repo().setSchedule(tenantId, itemId, false);
        return res.json({ data: await repo().getTarget(tenantId, itemId), error: null });
    }));
    router.post('/product-reviews/sync', wrap(async (req, res) => {
        if (!admin(res))
            return fail(res, 403, '需要管理员权限');
        const itemId = normalizeReviewItemId(req.body.itemId), tenantId = res.locals.reviewScope.tenantId, r = repo();
        if (!['initial', 'incremental'].includes(req.body.mode))
            return fail(res, 400, '同步模式错误');
        const budget = Number(req.body.pageBudget ?? 2);
        if (!Number.isInteger(budget) || budget < 1 || budget > 100)
            return fail(res, 400, '页数预算需为1至100');
        const target = await r.getTarget(tenantId, itemId);
        if (!target)
            return fail(res, 404, '评论目标不存在');
        if (['queued', 'running'].includes(target.status))
            return fail(res, 409, '该 Item 已在同步中');
        if (req.body.mode === 'incremental' && target.initialStatus !== 'completed')
            return fail(res, 409, '请先完成首次历史抓取');
        const [changed] = await r.pool.query("UPDATE product_review_targets SET status='queued',stop_requested=0,last_error=NULL WHERE tenant_id=? AND item_id=? AND status NOT IN ('queued','running')", [tenantId, itemId]);
        if (!(changed as any).affectedRows)
            return fail(res, 409, '该 Item 已在同步中');
        const now = new Date().toISOString();
        try {
            const request = { tenantId, storeId: '__tenant__', resource: 'product-reviews', window: { from: now, to: now }, batchId: randomUUID(), state: { itemId, mode: req.body.mode, pageBudget: req.body.mode === 'incremental' ? 1 : budget } };
            let result;
            if (options.enqueue)
                result = await options.enqueue(request);
            else {
                const { createSyncQueue, enqueueSync } = await import('../../../worker/src/queue.js');
                const { queue, redis } = createSyncQueue(undefined, 'product-reviews-sync');
                try {
                    result = await enqueueSync(request, queue);
                }
                finally {
                    await queue.close();
                    await redis.quit();
                }
            }
            return res.status(202).json({ data: result, error: null });
        }
        catch (e) {
            await r.pool.query("UPDATE product_review_targets SET status='failed',last_error='入队失败，请重试' WHERE tenant_id=? AND item_id=?", [tenantId, itemId]);
            throw e;
        }
    }));
    return router;
}
