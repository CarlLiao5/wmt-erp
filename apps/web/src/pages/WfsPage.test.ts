import { describe, expect, it } from 'vitest';
import { renderWfsFeePreviewMarkup, wfsDeliveryAgeLabel } from './WfsPage.js';

describe('WFS actual delivery age', () => {
  it('counts whole calendar days since delivery', () => {
    expect(wfsDeliveryAgeLabel('2026-11-10', new Date('2026-11-14T12:00:00'))).toBe('4天前');
    expect(wfsDeliveryAgeLabel('2026-11-14T23:45:00Z', new Date('2026-11-14T08:00:00'))).toBe('今天');
  });

  it('labels future, missing, and invalid delivery dates distinctly', () => {
    const today = new Date('2026-11-14T12:00:00');
    expect(wfsDeliveryAgeLabel('2026-11-16', today)).toBe('未来2天');
    expect(wfsDeliveryAgeLabel(undefined, today)).toBe('未送达');
    expect(wfsDeliveryAgeLabel('invalid', today)).toBe('未送达');
  });
});

describe('WFS fee preview details', () => {
  it('rendersSeparateItsDestinationEstimates', () => {
    const html = renderWfsFeePreviewMarkup([
      { previewType: 'inbound', shipNode: '4093', totalNetTransferCharge: '175', currency: 'USD', items: [] },
      { previewType: 'inbound', shipNode: '4005', totalNetTransferCharge: '210', currency: 'USD', items: [] },
    ]);
    expect(html).toContain('data-preview-option="4093"');
    expect(html).toContain('data-preview-option="4005"');
    expect(html).toContain('USD 175.00');
    expect(html).toContain('USD 210.00');
    expect(html).not.toContain('USD 385.00');
  });

  it('rendersPerSkuTransferCharges', () => {
    const html = renderWfsFeePreviewMarkup([{ previewType: 'inbound', shipNode: '4093', totalNetTransferCharge: '175', currency: 'USD', items: [{ sku: 'XMDK-CP001', gtin: '00717067767134', itemQuantity: 500, netTransferCharge: '175', currency: 'USD' }] }]);
    expect(html).toContain('XMDK-CP001');
    expect(html).toContain('00717067767134');
    expect(html).toContain('500');
    expect(html).toContain('USD 175.00');
  });

  it('labelsStaleAndMissingEstimates', () => {
    const html = renderWfsFeePreviewMarkup([{ previewType: 'inbound', shipNode: '4093', totalNetTransferCharge: null, currency: null, stale: true, lastSuccessAt: '2026-11-01T00:00:00.000Z', items: [{ sku: 'SKU-1', itemQuantity: 10, netTransferCharge: null }] }]);
    expect(html).toContain('旧预估');
    expect(html).toContain('暂无数据');
    expect(html).not.toContain('0 USD');
  });
});

it('separates warehouse, quote amount and product fee details',()=>{
 const html=renderWfsFeePreviewMarkup([{previewType:'inbound',shipNode:'4093',destinationName:'LAX2T',totalNetTransferCharge:'225.0000',currency:'USD',items:[]}]);
 expect(html).toContain('wfs-fee-route');expect(html).toContain('wfs-fee-total');
 expect(html).toContain('USD 225.00');expect(html).not.toContain('225.0000');
 expect(html).toContain('节点 4093');expect(html).toContain('SKU 费用明细');
});

it('matches SKU fees and uses quote quantity rather than shipment totals or planned quantity', async()=>{
 const { feePerSkuUnit, feeForSkuTotal } = await import('./WfsPage.js');
 const previews=[{previewType:'inbound',totalNetTransferCharge:'287.55',currency:'USD',items:[
  {sku:'A',netTransferCharge:'233.10',itemQuantity:666},
  {sku:'B',netTransferCharge:'54.45',itemQuantity:99},
 ]}];
 expect(feePerSkuUnit(previews,'a')).toBe('USD 0.35');
 expect(feePerSkuUnit(previews,'B')).toBe('USD 0.55');
 expect(feeForSkuTotal(previews,'B')).toBe('USD 54.45');
 expect(feePerSkuUnit(previews,'unknown')).toBe('暂无数据');
});
it('prefers API unit fees including zero and does not invent missing fees', async()=>{
 const { feePerSkuUnit } = await import('./WfsPage.js');
 const fee=(item:any)=>feePerSkuUnit([{previewType:'inbound',currency:'USD',items:[{sku:'A',...item}]}],'A');
 expect(fee({unitTransferCharge:'0.42',netTransferCharge:'100',itemQuantity:10})).toBe('USD 0.42');
 expect(fee({unitTransferCharge:'0',netTransferCharge:'100',itemQuantity:10})).toBe('USD 0.00');
 expect(fee({netTransferCharge:null,itemQuantity:10})).toBe('暂无数据');
 expect(fee({netTransferCharge:'100',itemQuantity:0})).toBe('暂无数据');
 expect(fee({netTransferCharge:'0',itemQuantity:10})).toBe('USD 0.00');
});
