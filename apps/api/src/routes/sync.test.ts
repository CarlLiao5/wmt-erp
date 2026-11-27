import express from 'express';
import { describe, expect, it } from 'vitest';
import { createSyncRouter } from './sync.js';

describe('sync resource validation', () => {
  it('enqueues the store-level Walmart Item report resource', async () => {
    let request: any;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async (input) => { request = input; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'admin', storeIds: new Set(['store-1']), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resource: 'item-report', window: { from: '2026-10-01', to: '2026-10-15' } }) });
      expect(response.status).toBe(202);
      expect(request).toMatchObject({ tenantId: 'tenant', storeId: 'store-1', resource: 'item-report' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('enqueues WFS inbound preview for an administrator and preserves store scope', async () => {
    let request: any;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async (input) => { request = input; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'admin', storeIds: new Set(['store-1']), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resource: 'wfs-inbound-preview', window: { from: '2026-10-01', to: '2026-10-31' } }) });
      expect(response.status).toBe(202);
      expect(request).toMatchObject({ tenantId: 'tenant', storeId: 'store-1', resource: 'wfs-inbound-preview' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('rejects WFS inbound preview submitted by a member', async () => {
    let enqueued = false;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async () => { enqueued = true; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'member', storeIds: new Set(['store-1']), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resource: 'wfs-inbound-preview', window: { from: '2026-10-01', to: '2026-10-31' } }) });
      expect(response.status).toBe(403);
      expect(enqueued).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('enqueues head freight as a tenant-level resource without a store id', async () => {
    let request: any;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async (input) => { request = input; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start'); const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'head-freight', window: { from: '2026-10-01', to: '2026-10-15' } }) });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(response.status).toBe(202); expect(request.storeId).toBe('__tenant__'); expect(request.resource).toBe('head-freight');
  });
  it('enqueues ALLSKU2026 as a tenant-level resource without a store id', async () => {
    let request: any;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async (input) => { request = input; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start'); const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'smart-sheet-allsku2026', window: { from: '2026-10-01', to: '2026-10-15' } }) });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(response.status).toBe(202); expect(request.storeId).toBe('__tenant__'); expect(request.resource).toBe('smart-sheet-allsku2026');
  });
  it('enqueues Bright Data inventory as a tenant-level resource without a store id', async () => {
    let request: any;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async (input) => { request = input; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'brightdata-inventory', window: { from: '2026-10-01', to: '2026-10-15' } }) });
      expect(response.status).toBe(202); expect(request.storeId).toBe('__tenant__'); expect(request.resource).toBe('brightdata-inventory');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('enqueues freight tracking as a tenant-level resource without a store id', async () => {
    let request: any;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async (input) => { request = input; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'admin', storeIds: new Set<string>(), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'spoofed-store', resource: 'freight-tracking', window: { from: '2026-10-01', to: '2026-10-15' } }) });
      expect(response.status).toBe(202);
      expect(request).toMatchObject({ tenantId: 'tenant', storeId: '__tenant__', resource: 'freight-tracking' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('rejects freight tracking submitted by a member', async () => {
    let enqueued = false;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async () => { enqueued = true; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'member', storeIds: new Set<string>(), skus: new Set<string>() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'freight-tracking', window: { from: '2026-10-01', to: '2026-10-15' } }) });
      expect(response.status).toBe(403);
      expect(enqueued).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('rejects member sync submissions even for an assigned store', async () => {
    let enqueued = false;
    const app = express(); app.use(express.json()); app.use((_req, res, next) => { res.locals.requestId = 'test'; next(); });
    app.use(createSyncRouter(async () => { enqueued = true; return { id: 'job', jobId: 'job' }; }, async () => ({ tenantId: 'tenant', role: 'member', storeIds: new Set(['store-1']), skus: new Set() })));
    const server = app.listen(0); const address = server.address(); if (!address || typeof address === 'string') throw new Error('server did not start');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: 'store-1', resource: 'orders', window: { from: '2026-10-01', to: '2026-10-15' } }) });
      expect(response.status).toBe(403);
      expect(enqueued).toBe(false);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});

it('enqueues inventory reconciliation with server-derived tenant and chosen month',async()=>{
 let received:any;
 const app=express();app.use(express.json());
 app.use(createSyncRouter(async input=>{received=input;return {id:'job',jobId:'job'};},()=>({tenantId:'t',role:'admin',storeIds:new Set(['s']),skus:new Set()})));
 const server=app.listen(0);const address=server.address() as any;
 try {
  const response=await fetch('http://127.0.0.1:'+address.port+'/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId:'other',storeId:'s',resource:'inventory-recon',window:{from:'2026-10-01T00:00:00.000Z',to:'2026-10-31T23:59:59.999Z'}})});
  expect(response.status).toBe(202);
  expect(received.tenantId).toBe('t');
  expect(received.resource).toBe('inventory-recon');
  expect(received.window.to).toBe('2026-10-31T23:59:59.999Z');
 } finally {server.close();}
});
