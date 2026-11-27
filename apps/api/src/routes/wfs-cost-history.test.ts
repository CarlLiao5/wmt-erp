import {afterEach,expect,it,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());
vi.mock('@walmart-erp/db',()=>({createDb:()=>({pool:{query}})}));
import {wfsPaymentAverages,loadPaymentFeePages} from './wfs-last-mile.js';
afterEach(()=>{vi.useRealTimers();query.mockReset();});
it('matches all historical SKU bills, deduplicates pages and retains unit/sales weighting',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
 const line=(po:string,date:string,type:string,amount:string,qty='1')=>({storeId:'s1','Partner Item Id':'XMDK-TS-001','Purchase Order #':po,'Purchase Order line #':'1','Transaction Key':po+type,'Transaction Description':type==='fee'?'WFS Fulfillment fee':'Purchase','Transaction Type':type==='fee'?'Adjustment':'Sale','Amount Type':type==='fee'?'Fee/Reimbursement':type,'Transaction Posted Timestamp':date,Amount:amount,'Ship Qty':qty,Currency:'USD'});
 const rows=[line('old','08/20/2020','fee','-8'),line('old','08/20/2020','Product Price','50'),line('old','08/20/2020','Commission on Product','-5'),line('recent','11/01/2026','fee','-10','2'),line('recent','11/01/2026','Product Price','100','2'),line('recent','11/01/2026','Commission on Product','-10'),line('future','01/01/2030','fee','-999')];
 query.mockResolvedValue([[...rows,...rows]]);
 const result=await wfsPaymentAverages('t1',[' xmdk-ts-001 ','XMDK-TS-001']);
 expect(result.lastMile.get('XMDK-TS-001')).toEqual({amount:18,units:3});
 expect(result.commission.get('XMDK-TS-001')).toEqual({commission:15,sales:150});
 expect(query.mock.calls[0][0]).toContain('FROM recon_transactions');
 expect(query.mock.calls[0][0]).not.toContain('JSON_TABLE');
 expect(query.mock.calls[0][0]).not.toContain('p.report_month>=?');
 expect(query.mock.calls[0][1]).toEqual(['t1',['XMDK-TS-001']]);
});
it('still supports explicit month windows for other payment consumers',async()=>{
 query.mockResolvedValue([[]]);
 await loadPaymentFeePages('t1',['A'],'2026-08');
 expect(query.mock.calls[0][0]).toContain('p.report_month>=?');
 expect(query.mock.calls[0][1]).toEqual(['t1','2026-08',['A']]);
});
it('does not query bills without a SKU',async()=>{
 const result=await wfsPaymentAverages('t1',[]);
 expect(result.lastMile.size).toBe(0);expect(query).not.toHaveBeenCalled();
});
