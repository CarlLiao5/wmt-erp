import { nextProductReviewRunAt, reviewRunKey } from '../../../../packages/db/src/product-reviews.js';
import type { SyncRequest } from '../queue.js';
export function reviewScheduleRequest(row: {
    tenantId: string;
    itemId: string;
    nextRunAt: Date;
}): SyncRequest { const slot = new Date(row.nextRunAt).toISOString(); return { tenantId: row.tenantId, storeId: '__tenant__', resource: 'product-reviews', window: { from: slot, to: slot }, batchId: reviewRunKey(row.tenantId, row.itemId, 'incremental', slot), state: { itemId: row.itemId, mode: 'incremental', pageBudget: 1 } }; }
export async function enqueueDueProductReviewSchedules(pool: any, enqueue: (r: SyncRequest) => Promise<unknown>, now: Date) {
    const c = await pool.getConnection();
    try {
        await c.beginTransaction();
        const [rows] = await c.query("SELECT tenant_id AS tenantId,item_id AS itemId,next_run_at AS nextRunAt FROM product_review_targets WHERE enabled=1 AND next_run_at<=? AND status NOT IN ('queued','running') AND initial_status='completed' ORDER BY next_run_at LIMIT 20 FOR UPDATE", [now]);
        for (const row of rows) {
            await enqueue(reviewScheduleRequest(row));
            await c.query("UPDATE product_review_targets SET next_run_at=?,status='queued',stop_requested=0,updated_at=NOW(3) WHERE tenant_id=? AND item_id=?", [nextProductReviewRunAt(now), row.tenantId, row.itemId]);
        }
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
