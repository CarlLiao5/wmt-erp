import { Router } from 'express';
export interface SyncRequest { tenantId: string; storeId: string; resource: string; window: { from: string; to: string } }
export interface JobRef { id: string; jobId: string }

export function createSyncRouter(enqueue: (input: SyncRequest) => Promise<JobRef>): Router {
  const router = Router();
  router.post('/sync', async (req, res, next) => {
    try {
      const body = req.body as Partial<SyncRequest>;
      if (!body.tenantId || !body.storeId || !body.resource || !body.window?.from || !body.window?.to) return res.status(400).json({ error: 'Invalid sync request' });
      const job = await enqueue(body as SyncRequest);
      return res.status(202).json(job);
    } catch (error) { return next(error); }
  });
  return router;
}
