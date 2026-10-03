export type Role = 'admin' | 'member';
export type Permission = 'read' | 'export' | 'manage_members' | 'manage_connections' | 'manage_targets';
const permissions: Record<Role, readonly Permission[]> = { admin: ['read','export','manage_members','manage_connections','manage_targets'], member: ['read','export'] };
export function hasPermission(role: Role, permission: Permission): boolean { return permissions[role]?.includes(permission) ?? false; }
export function assertPermission(role: Role, permission: Permission): void { if (!hasPermission(role, permission)) throw new Error('Forbidden'); }
