import { Router } from 'express';
export interface OrderLine { orderId: string; storeId: string; sku: string; quantity: number; amount: number; }
export interface OrderVisibility { role: 'admin' | 'member'; storeIds: Set<string>; skus: Set<string>; }
export function filterVisibleOrderLines(lines: OrderLine[], v: OrderVisibility) { return v.role === 'admin' ? lines : lines.filter((l) => v.storeIds.has(l.storeId) || v.skus.has(l.sku)); }
export function orderMetrics(lines: OrderLine[]) { return { orders: new Set(lines.map((l) => l.orderId)).size, units: lines.reduce((n, l) => n + l.quantity, 0), revenue: lines.reduce((n, l) => n + l.amount, 0) }; }
export function ordersRouter(list: () => Promise<OrderLine[]> = async () => []): Router { const r = Router(); r.get('/orders', async (_req, res, next) => { try { const lines = await list(); return res.json({ requestId: res.locals.requestId, data: { lines, metrics: orderMetrics(lines) }, error: null }); } catch (e) { return next(e); } }); return r; }
