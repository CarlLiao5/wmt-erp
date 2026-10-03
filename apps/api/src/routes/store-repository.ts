import type { Store } from './store-management.js';
export interface StoreRepository { list(): Promise<Store[]>; create(store: Store): Promise<Store>; }
export function memoryStoreRepository(): StoreRepository { const rows: Store[] = []; return { list: async () => rows, create: async (store) => { rows.push(store); return store; } }; }
