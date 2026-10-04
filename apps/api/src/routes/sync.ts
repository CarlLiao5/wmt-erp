import { Router, type Request } from 'express';
import type { OrderVisibility } from './orders.js';
export interface SyncRequest { tenantId: string; storeId: string; resource: string; window: { from: string; to: string } }
export interface JobRef { id: string; jobId: string }

export function createSyncRouter(enqueue: (input: SyncRequest) => Promise<JobRef>, visibility: (req: Request) => OrderVisibility | Promise<OrderVisibility | undefined> | undefined): Router {
  const router = Router();
  router.post('/sync', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ error: 'Authentication required' });
      const body = req.body as Partial<SyncRequest>;
      if (!body.storeId || !['orders', 'returns'].includes(body.resource ?? '') || !body.window?.from || !body.window?.to || Number.isNaN(Date.parse(body.window.from)) || Number.isNaN(Date.parse(body.window.to))) return res.status(400).json({ error: 'Invalid sync request' });
      if (scope.role !== 'admin' && !scope.storeIds.has(body.storeId)) return res.status(403).json({ error: 'Store access required' });
      const job = await enqueue({ tenantId: scope.tenantId, storeId: body.storeId, resource: body.resource!, window: body.window });
      return res.status(202).json(job);
    } catch (error) { return next(error); }
  });
  return router;
}
