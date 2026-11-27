import {AsyncLocalStorage} from 'node:async_hooks';
export interface ReportContinuationState {
 startedAt?:number;
 checkpoints?:Record<string,unknown>;
 phase?:string;
 resumeAt?:number;
}
interface Context {state:ReportContinuationState;save:()=>Promise<void>;cooldown?:{get:(key:string)=>Promise<number>;set:(key:string,until:number)=>Promise<void>}}
const context=new AsyncLocalStorage<Context>();
export class ReportDeferred extends Error {
 constructor(public readonly resumeAt:number,public readonly phase:string){super(phase);this.name='ReportDeferred';}
}
export async function runReportContinuation<T>(state:ReportContinuationState,save:()=>Promise<void>,run:()=>Promise<T>,cooldown?:Context['cooldown']):Promise<T>{
 state.startedAt??=Date.now();
 if(Date.now()-state.startedAt>=86400000)throw Error('Walmart report exceeded total deadline of 24 hours');
 await save();
 return context.run({state,save,cooldown},run);
}
export async function reportWait(ms:number,phase='report-generation'):Promise<void>{
 const current=context.getStore();
 if(!current){await new Promise(resolve=>setTimeout(resolve,ms));return;}
 const resumeAt=Date.now()+Math.max(ms,1000);
 if(resumeAt>=current.state.startedAt!+86400000)throw Error('Walmart report exceeded total deadline of 24 hours');
 current.state.phase=phase;current.state.resumeAt=resumeAt;
 await current.save();
 throw new ReportDeferred(resumeAt,phase);
}
export async function reportCheckpoint<T>(key:string,run:()=>Promise<T>):Promise<T>{
 const current=context.getStore();
 if(!current)return run();
 current.state.checkpoints??={};
 if(Object.hasOwn(current.state.checkpoints,key))return current.state.checkpoints[key] as T;
 const value=await run();current.state.checkpoints[key]=value;await current.save();return value;
}
export async function reportCooldown(key:string,until?:number):Promise<number>{
 const current=context.getStore();
 if(!current?.cooldown)return 0;
 if(until!==undefined){await current.cooldown.set(key,until);return until;}
 return current.cooldown.get(key);
}
export function hasReportContinuation(){return !!context.getStore();}

export async function reportReadyResponse(key:string,load:()=>Promise<Response>):Promise<Response>{
 const current=context.getStore();
 const saved=current?.state.checkpoints?.[key] as {body:string;status:number}|undefined;
 if(saved)return new Response(saved.body,{status:saved.status});
 const response=await load();
 if(current&&response.ok){
  const body=await response.clone().text();
  const data=JSON.parse(body);
  const status=String(data.reportRequest?.status??data.status??data.requestStatus??'').toUpperCase();
  if(['READY','COMPLETED','SUCCESS'].includes(status)){
   current.state.checkpoints??={};current.state.checkpoints[key]={body,status:response.status};await current.save();
  }
 }
 return response;
}

export async function reportProgress(phase:string):Promise<void>{
 const current=context.getStore();
 if(!current)return;
 current.state.phase=phase;
 delete current.state.resumeAt;
 await current.save();
}
