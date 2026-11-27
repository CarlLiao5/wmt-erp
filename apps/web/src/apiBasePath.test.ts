import { describe, expect, it } from 'vitest';
import { resolveApiRequestUrl } from './apiBasePath.js';

describe('resolveApiRequestUrl', () => {
  it('adds the deployed ERP base path to same-origin API requests', () => {
    expect(resolveApiRequestUrl('/api/wfs/shipments?view=summary', '/ERP/'))
      .toBe('/ERP/api/wfs/shipments?view=summary');
  });

  it('rewrites legacy localhost API URLs while preserving the deployment prefix', () => {
    expect(resolveApiRequestUrl('http://localhost:3000/api/stores', '/ERP/'))
      .toBe('/ERP/api/stores');
  });

  it('leaves development API paths and non-API URLs unchanged', () => {
    expect(resolveApiRequestUrl('/api/auth/me', '/')).toBe('/api/auth/me');
    expect(resolveApiRequestUrl('/assets/app.js', '/ERP/')).toBe('/assets/app.js');
  });
});
