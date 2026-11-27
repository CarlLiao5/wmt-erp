import { Router, type Request } from 'express';
import type { OrderVisibility } from './orders.js';
export interface SyncRequest { tenantId: string; storeId: string; resource: string; window: { from: string; to: string }; batchId?: string }
export interface JobRef { id: string; jobId: string }

export function createSyncRouter(enqueue: (input: SyncRequest) => Promise<JobRef>, visibility: (req: Request) => OrderVisibility | Promise<OrderVisibility | undefined> | undefined): Router {
  const router = Router();
  router.post('/sync', async (req, res, next) => {
    try {
      const scope = await visibility(req);
      if (!scope?.tenantId) return res.status(401).json({ error: 'Authentication required' });
      if (scope.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
      const body = req.body as Partial<SyncRequest>;
      const isTenantResource = body.resource === 'head-freight' || body.resource === 'smart-sheet-allsku2026' || body.resource === 'brightdata-inventory' || body.resource === 'freight-tracking' || body.resource === 'lingxing-advertising' || body.resource === 'lingxing-head-freight-costs';
      const storeId = isTenantResource ? '__tenant__' : body.storeId;
      if (!storeId || !['orders', 'returns', 'inventory', 'storage-fees', 'pricing', 'item-report', 'inventory-recon', 'advertising', 'advertising-onsite', 'advertising-sem', 'advertising-sem-items', 'advertising-sem-performance', 'advertising-sem-search-terms', 'performance', 'wfs-inbound-preview', 'head-freight', 'smart-sheet-allsku2026', 'brightdata-inventory', 'freight-tracking', 'lingxing-advertising', 'lingxing-head-freight-costs'].includes(body.resource ?? '') || !body.window?.from || !body.window?.to || Number.isNaN(Date.parse(body.window.from)) || Number.isNaN(Date.parse(body.window.to))) return res.status(400).json({ error: 'Invalid sync request' });
      if (!isTenantResource && scope.role !== 'admin' && !scope.storeIds.has(storeId)) return res.status(403).json({ error: 'Store access required' });
      const job = await enqueue({ tenantId: scope.tenantId, storeId, resource: body.resource!, window: body.window });
      return res.status(202).json(job);
    } catch (error) { return next(error); }
  });
  return router;
}
