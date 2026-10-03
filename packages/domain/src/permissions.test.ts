import { describe, expect, it } from 'vitest';
import { assertPermission, hasPermission } from './permissions.js';
describe('permissions', () => { it('gives admins management permissions and members read/export only', () => { expect(hasPermission('admin','manage_members')).toBe(true); expect(hasPermission('member','manage_members')).toBe(false); expect(() => assertPermission('member','manage_targets')).toThrow('Forbidden'); }); });
