import express from 'express';
import { describe, expect, it } from 'vitest';
import { latestWeatherSnapshotsByState, weatherRouter, type WeatherSource } from './weather.js';
const source:WeatherSource={state:async s=>({status:'ok',current:{temperature:s.code==='CA'?20:10}}),detail:async s=>({status:'ok',forecast:[{temperature:20}],alerts:[],climate:[{period:'6-10-day',temperature:{aboveNormal:40}}]}),health:async()=>({configured:true})};
it('selects one latest usable weather snapshot per state with deterministic tie-breaking',()=>{
  const rows=[
    {stateCode:'CA',metric:'temperature',value:null,observedAt:new Date('2026-11-04T12:00:00Z'),createdAt:new Date('2026-11-04T12:01:00Z'),rawPayload:{alerts:['unavailable']}},
    {stateCode:'CA',metric:'temperature',value:'18',observedAt:new Date('2026-11-04T11:00:00Z'),createdAt:new Date('2026-11-04T11:01:00Z'),rawPayload:{alerts:['older']}},
    {stateCode:'CA',metric:'temperature',value:'17',observedAt:new Date('2026-11-04T11:00:00Z'),createdAt:new Date('2026-11-04T11:02:00Z'),rawPayload:{alerts:['selected']}},
    {stateCode:'NY',metric:'temperature',value:'4',observedAt:new Date('2026-11-04T10:00:00Z'),createdAt:new Date('2026-11-04T10:01:00Z'),rawPayload:{alerts:[]}},
  ];
  const latest=latestWeatherSnapshotsByState(rows);
  expect([...latest.keys()]).toEqual(['CA','NY']);
  expect((latest.get('CA')?.rawPayload as {alerts:string[]}).alerts).toEqual(['selected']);
});
function appFor(visible=true){const app=express();app.use((_req,res,next)=>{res.locals.requestId='test';next();});app.use(weatherRouter({source,visibility:()=>visible?{tenantId:'t'}:undefined}));return app;}
describe('weather routes',()=>{it('returns 48 state summaries and paginates',async()=>{const app=appFor();const srv=app.listen(0);const a=srv.address();if(!a||typeof a==='string')throw Error('listen');try{const r=await fetch(`http://127.0.0.1:${a.port}/weather/states?page=1&pageSize=48`);const b=await r.json() as any;expect(r.status).toBe(200);expect(b.data.pagination.total).toBe(48);expect(b.data.rows).toHaveLength(48);}finally{await new Promise<void>(x=>srv.close(()=>x()));}});it('isolates one state failure',async()=>{const app=express();app.use((_req,res,next)=>{res.locals.requestId='test';next();});app.use(weatherRouter({source:{...source,state:async s=>{if(s.code==='CA')throw Error('upstream');return {status:'ok'};},detail:source.detail,health:source.health},visibility:()=>({tenantId:'t'})}));const srv=app.listen(0);const a=srv.address();if(!a||typeof a==='string')throw Error('listen');try{const b=await (await fetch(`http://127.0.0.1:${a.port}/weather/states?q=CA`)).json() as any;expect(b.data.rows[0].status).toBe('unavailable');}finally{await new Promise<void>(x=>srv.close(()=>x()));}});it('requires auth and never emits credentials',async()=>{const srv=appFor(false).listen(0);const a=srv.address();if(!a||typeof a==='string')throw Error('listen');try{const r=await fetch(`http://127.0.0.1:${a.port}/weather/states`);expect(r.status).toBe(401);expect(JSON.stringify(await r.json())).not.toContain('token');}finally{await new Promise<void>(x=>srv.close(()=>x()));}});});
