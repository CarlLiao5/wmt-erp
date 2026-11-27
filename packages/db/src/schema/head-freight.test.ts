import { describe, expect, it } from 'vitest';
import { headFreightRows, wecomBotConfigs } from './index.js';

describe('head freight schema contracts', () => {
  it('stores tenant bot configuration without exposing a plaintext key column', () => {
    expect(wecomBotConfigs.tenantId.name).toBe('tenant_id');
    expect(wecomBotConfigs.encryptedBotId.name).toBe('encrypted_bot_id');
    expect(wecomBotConfigs.encryptedBotSecret.name).toBe('encrypted_bot_secret');
    expect(wecomBotConfigs.documentUrl.name).toBe('document_url');
  });

  it('keeps the source store name when ERP store matching is unavailable', () => {
    expect(headFreightRows.storeId.name).toBe('store_id');
    expect(headFreightRows.storeId.notNull).toBe(false);
    expect(headFreightRows.sourceStoreName.name).toBe('source_store_name');
    expect(headFreightRows.idempotencyKey.name).toBe('idempotency_key');
  });
});
