import { createHash } from 'node:crypto';

export interface TestTenant {
  id: string;
  name: string;
}

export interface TestUser {
  id: string;
  tenantId: string;
  email: string;
  role: 'admin' | 'member';
}

export function createTestFixtures(seed = 'default'): {
  tenant: TestTenant;
  admin: TestUser;
  member: TestUser;
} {
  const digest = createHash('sha256').update(seed).digest('hex').slice(0, 20);
  const tenantId = `tenant_${digest}`;

  return {
    tenant: { id: tenantId, name: `Test tenant ${seed}` },
    admin: {
      id: `user_admin_${digest}`,
      tenantId,
      email: `admin+${digest}@example.test`,
      role: 'admin',
    },
    member: {
      id: `user_member_${digest}`,
      tenantId,
      email: `member+${digest}@example.test`,
      role: 'member',
    },
  };
}

export { createTestApp } from './http.js';
