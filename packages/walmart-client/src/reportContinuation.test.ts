import {describe,it,expect,vi} from 'vitest';
import {runReportContinuation,reportWait,ReportDeferred,reportCheckpoint} from './reportContinuation.js';
describe('durable report continuation',()=>{
 it('checkpoints before yielding and resumes without submitting twice',async()=>{
  const state:any={}; const save=vi.fn(async()=>{}); const submit=vi.fn(async()=>({requestId:'existing'}));
  const run=()=>runReportContinuation(state,save,async()=>{
   const requested=await reportCheckpoint('submit',submit);
   await reportWait(600000,'report-generation'); return requested;
  });
  await expect(run()).rejects.toBeInstanceOf(ReportDeferred);
  await expect(run()).rejects.toBeInstanceOf(ReportDeferred);
  expect(submit).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalled();
  expect(state.startedAt).toBeGreaterThan(0);
 });
 it('enforces a total deadline across resumptions',async()=>{
  await expect(runReportContinuation({startedAt:Date.now()-86400001},async()=>{},async()=>1)).rejects.toThrow('24 hours');
 });
 it('isolates concurrent jobs',async()=>{
  const a:any={},b:any={};
  expect(await Promise.all([a,b].map((s,i)=>runReportContinuation(s,async()=>{},()=>reportCheckpoint('submit',async()=>i))))).toEqual([0,1]);
 });
});

import {walmartReportRequest} from './adapters/sem.js';
import type {WalmartConnection} from './types.js';
describe('report API resumes',()=>{
 it('persists one submission and READY status across cooldowns, refreshing downloads',async()=>{
  vi.useFakeTimers();
  try{
   const c:WalmartConnection={environment:'production',clientId:'resume-test-'+Math.random(),clientSecret:'test',accessToken:'test',baseUrl:'https://example.com'};
   const state:any={};let stored:any;let pending=true;
   const fetcher=vi.fn(async(input:any)=>{
    const url=String(input);
    if(url.includes('?reportType='))return Response.json({requestId:'one'});
    if(url.includes('/reportRequests/one'))return Response.json({requestStatus:pending?'RECEIVED':'READY'});
    return Response.json({downloadURL:'https://example.org/fresh'});
   }) as any;
   const run=()=>runReportContinuation(state,async()=>{stored=JSON.parse(JSON.stringify(state));},async()=>{
    await walmartReportRequest(c,'POST','/v3/reports/reportRequests?reportType=ITEM&reportVersion=v1',{body:JSON.stringify({format:'CSV'})},fetcher);
    const status=await (await walmartReportRequest(c,'GET','/v3/reports/reportRequests/one',{},fetcher)).json();
    if(status.requestStatus!=='READY')await reportWait(600000);
    return (await walmartReportRequest(c,'GET','/v3/reports/downloadReport?requestId=one',{},fetcher)).json();
   });
   await expect(run()).rejects.toBeInstanceOf(ReportDeferred); // before status
   expect(stored.checkpoints).toBeDefined();
   vi.advanceTimersByTime(360001);
   await expect(run()).rejects.toBeInstanceOf(ReportDeferred); // pending
   pending=false;vi.advanceTimersByTime(600001);
   await expect(run()).rejects.toBeInstanceOf(ReportDeferred); // READY, before download
   vi.advanceTimersByTime(360001);
   await expect(run()).resolves.toEqual({downloadURL:'https://example.org/fresh'});
   expect(fetcher.mock.calls.filter((x:any)=>String(x[0]).includes('?reportType='))).toHaveLength(1);
   expect(fetcher.mock.calls.filter((x:any)=>String(x[0]).includes('/reportRequests/one'))).toHaveLength(2);
   expect(JSON.stringify(stored)).not.toContain('downloadURL');
  }finally{vi.useRealTimers();}
 });
 it('yields immediately on 429 instead of sleeping inside a worker',async()=>{
  const c:WalmartConnection={environment:'production',clientId:'rate-test-'+Math.random(),clientSecret:'test',accessToken:'test',baseUrl:'https://example.com'};
  const fetcher=vi.fn(async()=>new Response('',{status:429,headers:{'Retry-After':'3600'}})) as any;
  const state:any={};
  await expect(runReportContinuation(state,async()=>{},()=>walmartReportRequest(c,'POST','/v3/reports/reportRequests?reportType=ITEM&reportVersion=v1',{body:JSON.stringify({format:'CSV'})},fetcher))).rejects.toBeInstanceOf(ReportDeferred);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(state.phase).toBe('api-rate-limit');expect(state.resumeAt-Date.now()).toBeGreaterThan(3500000);
 });
});
