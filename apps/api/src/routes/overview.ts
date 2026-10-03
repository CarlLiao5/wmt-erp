import { Router } from 'express';
export interface DailyAggregate { date: string; revenue: number; orders: number; units: number; refreshedAt: string; }
export function overviewMetrics(rows: DailyAggregate[]) { return { revenue: rows.reduce((n, r) => n + r.revenue, 0), orders: rows.reduce((n, r) => n + r.orders, 0), units: rows.reduce((n, r) => n + r.units, 0), freshness: rows.at(-1)?.refreshedAt ?? null }; }
export function overviewRouter(list: () => Promise<DailyAggregate[]> = async () => []): Router { const r = Router(); r.get('/overview', async (_req, res, next) => { try { return res.json({ requestId: res.locals.requestId, data: overviewMetrics(await list()), error: null }); } catch (e) { return next(e); } }); return r; }
