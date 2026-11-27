import { paginate } from '../pagination.js';
import { walmartGet } from '../transport.js';
import type { WalmartConnection, WalmartResponse } from '../types.js';

export interface ReturnsPageEnvelope { returns?: unknown[]; returnOrders?: unknown[]; data?: unknown[]; meta?: { nextCursor?: string | null }; nextCursor?: string | null; }
export const listReturns = (c: WalmartConnection, q: Record<string,string>={}) => paginate<unknown>(c, '/v3/returns', q);
export const listReturnsPage = (c: WalmartConnection, q: Record<string,string>={}): Promise<WalmartResponse<ReturnsPageEnvelope>> => walmartGet<ReturnsPageEnvelope>(c, '/v3/returns', { query: q });
