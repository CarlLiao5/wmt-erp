import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../../packages/config/src/logger.js';
import { buildVisibilityScope } from '../../../../packages/domain/src/scope.js';
import { assertReadOnly } from '../../../../packages/walmart-client/src/readonly.js';

describe('Task 13 release gates', () => {
  it('allows only GET for Walmart business resources', () => {
    expect(() => assertReadOnly('GET', '/v3/items')).not.toThrow();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(() => assertReadOnly(method, '/v3/items')).toThrow(/read-only/);
  });

  it('keeps visibility tenant scoped and excludes expired assignments', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const scope = buildVisibilityScope({ tenantId: 't1', userId: 'u1', role: 'member' }, [
      { tenantId: 't1', userId: 'u1', storeId: 'store-a', validFrom: new Date('2026-01-01') },
      { tenantId: 't2', userId: 'u1', storeId: 'secret', validFrom: new Date('2026-01-01') },
      { tenantId: 't1', userId: 'u1', storeId: 'old', validFrom: new Date('2026-01-01'), validUntil: new Date('2026-10-01') },
    ], now);
    expect(scope.tenantId).toBe('t1');
    expect(scope.storeIds).toEqual(['store-a']);
  });

  it('redacts secrets from operational log output', () => {
    let output = '';
    const destination = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback(); } });
    const logger = createLogger({ service: 'api' }, destination);
    logger.info({ clientSecret: 'do-not-leak', accessToken: 'do-not-leak', requestId: 'safe' }, 'sync health');
    expect(output).not.toContain('do-not-leak');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('safe');
  });
});
