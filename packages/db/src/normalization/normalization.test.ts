import {expect,it} from 'vitest';
import {normalizeOrderExtensions} from './order-extensions.js';
import {normalizeInventoryHealth} from './inventory-health.js';
import {normalizeItemReport} from './item-report.js';
const scope={tenantId:'t',storeId:'s',sourceId:'source',capturedAt:new Date('2026-11-17T00:00:00Z')};
it('normalizes all order statuses, shipment tracking and charge/tax components without altering sales totals',()=>{
 const result=normalizeOrderExtensions({list:{elements:{order:[{purchaseOrderId:'PO',shippingInfo:{estimatedShipDate:1794873600000,estimatedDeliveryDate:1794960000000,methodCode:'Express'},orderLines:{orderLine:[{lineNumber:'1',item:{sku:'SKU',condition:'New'},statusDate:1794873600000,orderLineQuantity:{amount:'2',unitOfMeasurement:'EACH'},charges:{charge:[{chargeType:'PRODUCT',chargeName:'ItemPrice',chargeAmount:{amount:10,currency:'USD'},tax:{taxName:'Tax',taxAmount:{amount:0,currency:'USD'}}}]},orderLineStatuses:{orderLineStatus:[{status:'Acknowledged',statusQuantity:{amount:'1'}},{status:'Shipped',statusQuantity:{amount:'1'},trackingInfo:{shipDateTime:1794873600000,trackingNumber:'TRACK',carrierName:{otherCarrier:'FedEx'},trackingURL:'https://tracking.test'}}]}}]}}]}}},scope);
 expect(result.headers[0].estimated_ship_at).toBeInstanceOf(Date);expect(result.statuses).toHaveLength(2);expect(result.tracking[0].tracking_number).toBe('TRACK');expect(result.charges[0]).toMatchObject({amount:'10',tax_amount:'0',currency:'USD'});expect(result.lines[0].quantity_unit).toBe('EACH');
 expect(normalizeOrderExtensions({orders:[{purchaseOrderId:'PO',orderLines:{orderLine:[{lineNumber:'1',item:{sku:'SKU'}}]}}]},scope).charges).toEqual([]);
 expect(normalizeOrderExtensions({orders:[{purchaseOrderId:'PO'}]},{...scope,tenantId:'other'}).headers[0].id).not.toBe(result.headers[0].id);
});
it('captures full health metrics and independent age buckets preserving unknowns and zero',()=>{
 const r=normalizeInventoryHealth({itemInformation:{sku:'sku',itemID:'123'},inventoryData:{availableUnits:0,reservedUnits:83,onhandUnits:100,unavailableUnits:{inventoryReviewUnits:2},inventoryAge:{'0To90days':98,'365PlusDays':0},firstInStockDate:'2026-10-12'},inventoryInsights:{daysOfSupply:'260',customerFavorite:false}},scope);
 expect(r.snapshots[0]).toMatchObject({available_units:'0',reserved_units:'83',onhand_units:'100',inventory_review_units:'2',days_of_supply:'260',customer_favorite:0,inbound_units:null});expect(r.ages).toHaveLength(2);expect(r.ages[1].quantity).toBe('0');expect(normalizeInventoryHealth({},scope).snapshots).toEqual([]);
});
it('keeps every report field independently and parses typed fields without inventing blank prices',()=>{
 const fields={SKU:'sku','Item ID':'123',Price:'0','Offer End Date':'11/23/2026','Average Rating':'','Unexpected Column':'preserve me','GTIN':'000123'};
 const r=normalizeItemReport([fields],{...scope,requestId:'req'});expect(r.snapshots[0]).toMatchObject({sku:'sku',item_id:'123',price:'0',average_rating:null,gtin:'000123'});expect(r.snapshots[0].offer_end_date?.toISOString()).toBe('2026-11-23T00:00:00.000Z');expect(r.fields.find(x=>x.field_name==='Unexpected Column')?.field_value).toBe('preserve me');expect(normalizeItemReport([fields],{...scope,requestId:'req'}).snapshots[0].id).toBe(r.snapshots[0].id);
});
