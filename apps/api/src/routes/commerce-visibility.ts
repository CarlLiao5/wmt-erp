import { buildVisibilityScope, type Assignment } from '@walmart-erp/domain';
import { and, createDb, customerFieldGrants, eq, skuAssignments, skus, storeAssignments } from '@walmart-erp/db';
import type { OrderVisibility } from './orders.js';

export interface CommerceSession { tenantId: string; userId: string; role: 'admin' | 'member'; }
export interface CommerceAssignment extends Assignment { sku?: string; skuStoreId?: string; }
export type AssignmentLoader = (session: CommerceSession) => Promise<CommerceAssignment[]>;
export type CustomerGrantLoader = (session: CommerceSession) => Promise<string[]>;

export async function resolveCommerceVisibility(session: CommerceSession, loadAssignments: AssignmentLoader, now = new Date(), loadGrants: CustomerGrantLoader = async () => []): Promise<OrderVisibility> {
  if (session.role === 'admin') return { tenantId: session.tenantId, role: 'admin', storeIds: new Set(), skus: new Set(), customerFields: new Set(['name', 'email', 'phone']) };
  const assignments = await loadAssignments(session);
  const scope = buildVisibilityScope(session, assignments, now);
  const skuIds = new Set(scope.skuIds);
  const skus = assignments.filter((assignment) => assignment.skuId && skuIds.has(assignment.skuId) && assignment.sku && assignment.skuStoreId).map((assignment) => `${assignment.skuStoreId}:${assignment.sku}`);
  const grants = await loadGrants(session);
  return { tenantId: session.tenantId, role: 'member', storeIds: new Set(scope.storeIds), skus: new Set(skus), customerFields: new Set(grants.filter((field) => ['name', 'email', 'phone'].includes(field))) };
}

export function mysqlCustomerGrantLoader(): CustomerGrantLoader {
  const { db } = createDb();
  return async (session) => (await db.select({ field: customerFieldGrants.field }).from(customerFieldGrants).where(and(eq(customerFieldGrants.tenantId, session.tenantId), eq(customerFieldGrants.userId, session.userId)))).map((row) => row.field);
}

export function mysqlAssignmentLoader(): AssignmentLoader {
  const { db } = createDb();
  return async (session) => {
    const stores = await db.select().from(storeAssignments).where(and(eq(storeAssignments.tenantId, session.tenantId), eq(storeAssignments.userId, session.userId)));
    const assignedSkus = await db.select().from(skuAssignments).where(and(eq(skuAssignments.tenantId, session.tenantId), eq(skuAssignments.userId, session.userId)));
    const catalog = await db.select({ id: skus.id, storeId: skus.storeId, externalId: skus.externalId }).from(skus).where(eq(skus.tenantId, session.tenantId));
    const byId = new Map(catalog.map((sku) => [sku.id, sku]));
    return [...stores.map((row) => ({ ...row, storeId: row.storeId, validUntil: row.validUntil })), ...assignedSkus.map((row) => ({ ...row, skuId: row.skuId, sku: byId.get(row.skuId)?.externalId, skuStoreId: byId.get(row.skuId)?.storeId, validUntil: row.validUntil }))];
  };
}
