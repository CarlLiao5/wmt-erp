import { paginate } from '../pagination.js';
import { walmartGet } from '../transport.js';
import type { WalmartConnection, WalmartResponse } from '../types.js';

export const MAX_ORDER_PAGE_SIZE = 200;

export function buildOrdersQuery(query: Record<string, string> = {}): Record<string, string> {
  const requestedLimit = Number(query.limit ?? MAX_ORDER_PAGE_SIZE);
  return { ...query, limit: String(Math.min(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : MAX_ORDER_PAGE_SIZE, MAX_ORDER_PAGE_SIZE)) };
}

export interface OrderPageEnvelope {
  data?: unknown[];
  items?: unknown[];
  list?: { elements?: unknown[] | { order?: unknown[] }; meta?: { nextCursor?: string | null } };
  orders?: unknown[];
  nextCursor?: string | null;
  totalCount?: number;
  totalItems?: number;
  headers?: { totalCount?: number; offset?: number; limit?: number };
}

export const listOrders = (c: WalmartConnection, q: Record<string, string> = {}) => paginate<unknown>(c, '/v3/orders', buildOrdersQuery(q));
export const listOrdersPage = (c: WalmartConnection, q: Record<string, string> = {}): Promise<WalmartResponse<OrderPageEnvelope>> => walmartGet<OrderPageEnvelope>(c, '/v3/orders', { query: buildOrdersQuery(q) });
export const getOrder = (c: WalmartConnection, id: string) => paginate<unknown>(c, `/v3/orders/${encodeURIComponent(id)}`);
