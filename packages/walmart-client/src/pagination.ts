import type { WalmartConnection } from './types.js';
import { walmartGet } from './transport.js';
export async function* paginate<T>(connection: WalmartConnection, path: string, query: Record<string,string> = {}, fetcher?: typeof fetch) {
  let next: string | undefined = query.nextCursor;
  let offset = Number(query.offset ?? 0);
  const limit = Number(query.limit ?? 50);
  const seenCursors = new Set<string>();
  while (true) {
    const pageQuery = { ...query, ...(next ? { nextCursor: next } : {}), ...(next ? {} : { offset: String(offset), limit: String(limit) }) };
    const response: Awaited<ReturnType<typeof walmartGet<any>>> = await walmartGet<any>(connection, path, { query: pageQuery, fetcher });
    const envelope = response.data as any;
    const items = envelope.data ?? envelope.items ?? envelope.ItemResponse ?? envelope.shipments ?? (Array.isArray(envelope.payload) ? envelope.payload : envelope.payload?.shipments ?? envelope.payload?.data ?? []);
    for (const item of Array.isArray(items) ? items : []) yield item as T;
    next = envelope.nextCursor ?? envelope.meta?.nextCursor ?? envelope.payload?.nextCursor;
    if (next) {
      if (seenCursors.has(next)) throw new Error('Walmart pagination cursor repeated');
      seenCursors.add(next);
      continue;
    }
    const headers = envelope.headers;
    const totalCount = headers?.totalCount ?? envelope.totalItems ?? envelope.totalCount;
    if (!next && Number.isFinite(Number(totalCount))) {
      const current = Number(headers?.offset ?? envelope.offset ?? offset);
      const pageSize = Number(headers?.limit ?? envelope.limit ?? limit) || limit;
      const total = Number(totalCount);
      const nextOffset = current + pageSize;
      if (nextOffset < total && nextOffset > current) { offset = nextOffset; continue; }
    }
    next = undefined;
    if (!next) break;
  }
}
