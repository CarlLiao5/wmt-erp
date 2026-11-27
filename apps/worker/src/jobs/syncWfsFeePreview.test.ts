import { describe, expect, it, vi } from 'vitest';
import { normalizePreviewCandidate, normalizePreviewResponse, previewRequestHash, runWfsFeePreviewCandidates } from './syncWfsFeePreview.js';

const shipment = {
  shipmentId: '4480592WFB',
  inboundOrderId: 'CRO-4480592',
  status: 'CREATED',
  shipToAddress: { fcId: '4093', fcName: 'Rogers' },
  returnAddress: { addressLine1: '1 Main St', city: 'Bentonville', stateCode: 'AR', countryCode: 'US', postalCode: '72712' },
  expectedDeliveryDate: '2026-11-20T00:00:00Z',
};

const item = (overrides: Record<string, unknown> = {}) => ({
  shipmentId: '4480592WFB',
  gtin: '00717067767134',
  sku: 'XMDK-CP001',
  itemDesc: 'Coffee Press',
  itemQty: 500,
  vendorPackQty: 25,
  innerPackQty: 20,
  expectedDeliveryDate: '2026-11-20T00:00:00Z',
  ...overrides,
});

describe('WFS fee preview normalization', () => {
  it('skipsCancelledAndIncompleteShipments', () => {
    expect(normalizePreviewCandidate({ ...shipment, status: 'CANCELLED' }, [{ payload: item(), receivedAt: 1 }]).reason).toBe('cancelled');
    expect(normalizePreviewCandidate({ ...shipment, returnAddress: undefined }, [{ payload: item(), receivedAt: 1 }]).reason).toBe('missing_address');
    expect(normalizePreviewCandidate(shipment, [{ payload: item({ gtin: '' }), receivedAt: 1 }]).reason).toBe('missing_item_fields');
  });

  it('keepsLatestItemSnapshotPerSku', () => {
    const candidate = normalizePreviewCandidate(shipment, [
      { payload: item({ itemQty: 300, itemDesc: 'old' }), receivedAt: 1 },
      { payload: item({ itemQty: 500, itemDesc: 'latest' }), receivedAt: 2 },
    ]);
    expect(candidate.request?.orderItems).toHaveLength(1);
    expect(candidate.request?.orderItems[0]).toMatchObject({ itemQty: 500, itemDesc: 'latest' });
    expect(candidate.request?.shipNode).toBeUndefined();
  });

  it('hashesOnlyNormalizedPreviewInputs', () => {
    const first = normalizePreviewCandidate(shipment, [{ payload: item({ displayFillRate: 0.2 }), receivedAt: 1 }]);
    const second = normalizePreviewCandidate(shipment, [{ payload: item({ displayFillRate: 0.9 }), receivedAt: 2 }]);
    expect(previewRequestHash(first.request!)).toBe(previewRequestHash(second.request!));
    expect(previewRequestHash(first.request!)).not.toBe(previewRequestHash(normalizePreviewCandidate(shipment, [{ payload: item({ vendorPackQty: 26 }), receivedAt: 2 }]).request!));
  });

  it('normalizesDestinationAndSkuFees', () => {
    const options = normalizePreviewResponse({ payload: [{ previews: [{ previewType: 'inbound', preview: [
      { shipNode: '4093', shipNodeName: 'Rogers', totalNetTransferCharge: 175, currencyUnit: 'USD', shipmentItems: [{ vendorSku: 'XMDK-CP001', productId: '00717067767134', itemQty: 500, netTransferCharge: 175 }] },
      { shipNode: '1234', totalNetTransferCharge: 210, currencyUnit: 'USD', shipmentItems: [{ sku: 'XMDK-CP001', itemQty: 500, netTransferCharge: 210 }] },
    ] }] }] });
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.totalNetTransferCharge)).toEqual(['175', '210']);
    expect(options.map((option) => option.items[0].netTransferCharge)).toEqual(['175', '210']);
    expect(options.map((option) => option.shipNode)).toEqual(['4093', '1234']);
  });

  it('queriesOnlyTheActualDestinationTransferHub', async () => {
    const candidate = normalizePreviewCandidate({ ...shipment, shipToAddress: { fcName: 'LAX2T' } }, [{ payload: item(), receivedAt: 1 }]);
    const saveSuccess = vi.fn();
    const preview = vi.fn(async (request) => ({ payload: [{ previews: [{ previewType: 'inbound', preview: [
      { shipNode: request.orderItems[0]?.shipNode, shipNodeName: 'Requested hub', totalNetTransferCharge: 175, currencyUnit: 'USD', shipmentItems: [] },
      { shipNode: '1234', shipNodeName: 'Other FC', totalNetTransferCharge: 300, currencyUnit: 'USD', shipmentItems: [] },
    ] }] }] }));
    await runWfsFeePreviewCandidates([candidate], {
      getPrevious: async () => undefined,
      preview,
      saveSkipped: vi.fn(), saveSuccess, saveFailure: vi.fn(),
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0]?.[0].orderItems[0]?.shipNode).toBe('4093');
    expect(saveSuccess.mock.calls[0]?.[2].map((option: { shipNode: string }) => option.shipNode)).toEqual(['4093']);
  });

  it('skipsShipmentsWhoseActualDestinationIsNotATransferHub', async () => {
    const candidate = normalizePreviewCandidate({ ...shipment, shipToAddress: { fcName: 'MCO1', city: 'Davenport' } }, [{ payload: item(), receivedAt: 1 }]);
    const preview = vi.fn();
    const saveSkipped = vi.fn();
    await runWfsFeePreviewCandidates([candidate], {
      getPrevious: async () => undefined,
      preview,
      saveSkipped,
      saveSuccess: vi.fn(),
      saveFailure: vi.fn(),
    });
    expect(candidate.reason).toBe('destination_not_transfer_hub');
    expect(preview).not.toHaveBeenCalled();
    expect(saveSkipped.mock.calls[0]?.[1]).toBe('destination_not_transfer_hub');
  });

  it('skipsUnchangedSuccessfulInputs', async () => {
    const candidate = normalizePreviewCandidate(shipment, [{ payload: item(), receivedAt: 1 }]);
    const preview = vi.fn();
    const result = await runWfsFeePreviewCandidates([candidate], {
      getPrevious: async () => ({ requestHash: previewRequestHash(candidate.request!), status: 'succeeded', lastSuccessAt: new Date(1) }),
      preview,
      saveSkipped: vi.fn(),
      saveSuccess: vi.fn(),
      saveFailure: vi.fn(),
    });
    expect(result.unchanged).toBe(1);
    expect(preview).not.toHaveBeenCalled();
  });

  it('continuesAfterShipmentFailure', async () => {
    const first = normalizePreviewCandidate({ ...shipment, shipmentId: 'SHIP-1' }, [{ payload: item({ shipmentId: 'SHIP-1' }), receivedAt: 1 }]);
    const second = normalizePreviewCandidate({ ...shipment, shipmentId: 'SHIP-2' }, [{ payload: item({ shipmentId: 'SHIP-2' }), receivedAt: 1 }]);
    const saveFailure = vi.fn();
    const saveSuccess = vi.fn();
    const result = await runWfsFeePreviewCandidates([first, second], {
      getPrevious: async () => undefined,
      preview: vi.fn()
        .mockRejectedValueOnce(new Error('preview unavailable'))
        .mockResolvedValue({ payload: [] }),
      saveSkipped: vi.fn(), saveSuccess, saveFailure,
    });
    expect(result.failed).toBe(1);
    expect(result.previewed).toBe(1);
    expect(saveFailure).toHaveBeenCalledTimes(1);
    expect(saveSuccess).toHaveBeenCalledTimes(1);
  });

  it('retriesFailedInputOnNextRun', async () => {
    const candidate = normalizePreviewCandidate(shipment, [{ payload: item(), receivedAt: 1 }]);
    const preview = vi.fn().mockResolvedValue({ payload: [] });
    const result = await runWfsFeePreviewCandidates([candidate], {
      getPrevious: async () => ({ requestHash: previewRequestHash(candidate.request!), status: 'failed', lastSuccessAt: null }),
      preview, saveSkipped: vi.fn(), saveSuccess: vi.fn(), saveFailure: vi.fn(),
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(result.previewed).toBe(1);
  });

  it('replacesOptionsOnlyAfterSuccessfulPreview', async () => {
    const candidate = normalizePreviewCandidate(shipment, [{ payload: item(), receivedAt: 1 }]);
    const saveSuccess = vi.fn();
    await runWfsFeePreviewCandidates([candidate], {
      getPrevious: async () => undefined,
      preview: async (request) => ({ payload: [{ previews: [{ previewType: 'inbound', preview: [
        { shipNode: request.orderItems[0]?.shipNode, totalNetTransferCharge: request.orderItems[0]?.shipNode === '4093' ? 175 : 210, currencyUnit: 'USD', shipmentItems: [] },
        { shipNode: '1234', totalNetTransferCharge: 999, currencyUnit: 'USD', shipmentItems: [] },
      ] }] }] }),
      saveSkipped: vi.fn(), saveSuccess, saveFailure: vi.fn(),
    });
    expect(saveSuccess).toHaveBeenCalledTimes(1);
    expect(saveSuccess.mock.calls[0]?.[2].map((option: { shipNode: string }) => option.shipNode)).toEqual(['4093']);

    const failedSave = vi.fn();
    const saveFailure = vi.fn();
    await runWfsFeePreviewCandidates([candidate], {
      getPrevious: async () => undefined,
      preview: async () => { throw new Error('preview failed'); },
      saveSkipped: vi.fn(), saveSuccess: failedSave, saveFailure,
    });
    expect(failedSave).not.toHaveBeenCalled();
    expect(saveFailure).toHaveBeenCalledTimes(1);
  });
});

it('uses future UTC delivery dates and consistent pack quantities for historical shipments', () => {
  const candidate = normalizePreviewCandidate(shipment,[{payload:item({itemQty:499,vendorPackQty:25,innerPackQty:20,expectedDeliveryDate:'2025-01-01'}),receivedAt:1}],new Date('2026-11-18T12:00:00Z'));
  expect(candidate.request?.orderItems[0]).toMatchObject({itemQty:500,expectedDeliveryDate:'2026-11-25T00:00:00.000Z'});
});
it('fills absent delivery dates for normalized historical item rows', () => {
  const candidate=normalizePreviewCandidate({...shipment,expectedDeliveryDate:undefined},[{payload:item({expectedDeliveryDate:undefined}),receivedAt:1}],new Date('2026-11-18T12:00:00Z'));
  expect(candidate.request?.orderItems[0].expectedDeliveryDate).toBe('2026-11-25T00:00:00.000Z');
});
it('reads the destination name returned inside shipToAddress',()=>{
  const [option]=normalizePreviewResponse({payload:[{previews:[{previewType:'inbound',preview:[{shipNode:4093,shipToAddress:{fcName:'LAX2T'},totalNetTransferCharge:175}]}]}]});
  expect(option.destinationName).toBe('LAX2T');
});

it('does not re-quote unchanged historical shipments when the fallback date advances',()=>{
 const historical={...shipment,expectedDeliveryDate:'2025-01-01'};
 const rows=[{payload:item({expectedDeliveryDate:'2025-01-01'}),receivedAt:1}];
 const first=normalizePreviewCandidate(historical,rows,new Date('2026-11-18'));
 const second=normalizePreviewCandidate(historical,rows,new Date('2026-11-19'));
 expect(first.request?.orderItems[0].expectedDeliveryDate).not.toBe(second.request?.orderItems[0].expectedDeliveryDate);
 expect(previewRequestHash(first.request!)).toBe(previewRequestHash(second.request!));
});

it('retains explicit API unit fees including zero without deriving them from totals',()=>{
 const [option]=normalizePreviewResponse({payload:[{previews:[{previewType:'inbound',preview:[{shipNode:'4093',shipmentItems:[{vendorSku:'A',unitTransferCharge:0.42},{vendorSku:'B',unitTransferCharge:0},{vendorSku:'C',netTransferCharge:100}]}]}]}]});
 expect(option?.items.map((i:any)=>i.unitTransferCharge)).toEqual(['0.42','0',null]);
});
