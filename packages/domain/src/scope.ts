import type { Role } from './permissions.js';
export interface VisibilityUser { tenantId: string; userId: string; role: Role; }
export interface Assignment { userId: string; tenantId: string; storeId?: string; skuId?: string; validFrom: Date; validUntil?: Date | null; }
export interface VisibilityScope { tenantId: string; userId: string; allStores: boolean; storeIds: string[]; skuIds: string[]; }
export function buildVisibilityScope(user: VisibilityUser, assignments: Assignment[], now = new Date()): VisibilityScope {
  const active = assignments.filter((a) => a.tenantId === user.tenantId && a.userId === user.userId && a.validFrom <= now && (!a.validUntil || a.validUntil > now));
  if (user.role === 'admin') return { tenantId: user.tenantId, userId: user.userId, allStores: true, storeIds: [], skuIds: [] };
  return { tenantId: user.tenantId, userId: user.userId, allStores: false, storeIds: [...new Set(active.flatMap((a) => a.storeId ? [a.storeId] : []))], skuIds: [...new Set(active.flatMap((a) => a.skuId ? [a.skuId] : []))] };
}
