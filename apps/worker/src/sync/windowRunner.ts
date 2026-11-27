export interface WindowPage {
  records: number;
  nextCursor?: string | null;
  coverageFrom?: string;
  coverageTo?: string;
}

export interface WindowCheckpoint {
  windowId: string;
  cursor: string | null;
  pageCount: number;
  recordCount: number;
  coverageFrom?: string;
  coverageTo?: string;
}

export interface WindowStore {
  checkpoint(update: WindowCheckpoint): Promise<void>;
  complete(update: WindowCheckpoint): Promise<void>;
  fail?(windowId: string, error: Error): Promise<void>;
}

export interface WindowResult {
  windowId: string;
  pageCount: number;
  recordCount: number;
  coverageFrom?: string;
  coverageTo?: string;
}

export class StoreRateLimiter {
  private readonly lanes = new Map<string, Promise<void>>();

  constructor(private readonly delayMs = 250) {}

  async wait(storeId: string): Promise<void> {
    const previous = this.lanes.get(storeId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const lane = previous.then(() => current);
    this.lanes.set(storeId, lane);
    await previous;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    release();
    if (this.lanes.get(storeId) === lane) this.lanes.delete(storeId);
  }

  storeCount(): number { return this.lanes.size; }
}

export const createStoreLimiter = (delayMs?: number): StoreRateLimiter => new StoreRateLimiter(delayMs);

export function assertForwardProgress(previousCursor: string | null | undefined, nextCursor: string | null | undefined): void {
  if (previousCursor && nextCursor && previousCursor === nextCursor) throw new Error(`repeated cursor: ${nextCursor}`);
}

export async function runSyncWindow(
  windowId: string,
  fetchPage: (cursor: string | null) => Promise<WindowPage>,
  store: WindowStore,
  limiter: StoreRateLimiter,
  storeId = windowId,
): Promise<WindowResult> {
  let cursor: string | null = null;
  let pageCount = 0;
  let recordCount = 0;
  let coverageFrom: string | undefined;
  let coverageTo: string | undefined;
  try {
    while (true) {
      await limiter.wait(storeId);
      const page = await fetchPage(cursor);
      assertForwardProgress(cursor, page.nextCursor);
      pageCount += 1;
      recordCount += page.records;
      coverageFrom = coverageFrom && page.coverageFrom ? (coverageFrom < page.coverageFrom ? coverageFrom : page.coverageFrom) : coverageFrom ?? page.coverageFrom;
      coverageTo = coverageTo && page.coverageTo ? (coverageTo > page.coverageTo ? coverageTo : page.coverageTo) : coverageTo ?? page.coverageTo;
      const update = { windowId, cursor: page.nextCursor ?? null, pageCount, recordCount, coverageFrom, coverageTo };
      await store.checkpoint(update);
      if (!page.nextCursor) {
        await store.complete(update);
        return { windowId, pageCount, recordCount, coverageFrom, coverageTo };
      }
      cursor = page.nextCursor;
    }
  } catch (error) {
    await store.fail?.(windowId, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
