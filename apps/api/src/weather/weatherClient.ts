import type { USStateConfig } from '@walmart-erp/domain';
import { createMemoryWeatherCache, type WeatherCache } from './weatherCache.js';
export type StateConfig = USStateConfig;
export type ClimatePeriod = '6-10-day' | '8-14-day' | 'monthly' | 'seasonal';
export interface StateWeatherSnapshot { stateCode:string; observedAt:Date; current:Record<string,unknown>; forecast:Array<Record<string,unknown>>; alerts:Array<Record<string,unknown>>; raw:Record<string,unknown>; }
export interface ClimateSnapshot { stateCode:string; period:ClimatePeriod; validFrom?:Date; validTo?:Date; temperature:Record<string,number>; precipitation:Record<string,number>; raw:unknown; }
type Request=(url:string,init:{headers:Record<string,string>;signal?:AbortSignal})=>Promise<{status:number;ok?:boolean;headers:Headers;text?:()=>Promise<string>;json():Promise<any>}>;
export interface ClientOptions { request?:Request; cache?:WeatherCache; sleep?:(ms:number)=>Promise<void>; maxRetries?:number; userAgent?:string; minRequestIntervalMs?:number; timeoutMs?:number; }
const UA='wmterp-weather/1.0 (operations@wmterp.local)'; const defaultRequest:Request=(u,i)=>fetch(u,i) as any; const ttl={obs:600,forecast:1800,alerts:300,climate:86400};
function validState(s:StateConfig){if(!s?.code||!Number.isFinite(s.latitude)||!Number.isFinite(s.longitude)||s.latitude < -90||s.latitude>90||s.longitude < -180||s.longitude>180) throw new Error('Malformed state configuration');}
async function getJson(url:string,o:ClientOptions):Promise<any>{const request=o.request??defaultRequest,retries=o.maxRetries??3,sleep=o.sleep??((ms:number)=>new Promise(r=>setTimeout(r,ms))); for(let a=0;;a++){let transient=false; try{const c=typeof AbortController==='undefined'?undefined:new AbortController(); const timer=c&&setTimeout(()=>c.abort(),o.timeoutMs??15000); const r=await request(url,{headers:{Accept:'application/json, application/geo+json','User-Agent':o.userAgent??UA},signal:c?.signal}); if(timer) clearTimeout(timer); if(r.status>=200&&r.status<300){const contentType=r.headers.get('content-type')??''; if(contentType && !/json|\+json/i.test(contentType)) throw new Error('Weather service returned a non-JSON response'); try { if(r.text){const body=await r.text(); try{return JSON.parse(body);}catch{throw new Error('Weather service returned invalid JSON');}} return await r.json(); } catch(error){if(error instanceof SyntaxError) throw new Error('Weather service returned invalid JSON'); throw error;}} transient=r.status===429 || (r.status>=500 && r.status<600); if(!transient||a>=retries) throw new Error(`Weather request failed: HTTP ${r.status}`); const ra=Number(r.headers.get('retry-after')??0); await sleep(ra>0?ra*1000:Math.min(1000*2**a,10000)); continue;}catch(e){transient=e instanceof Error && (e.name==='AbortError'||e.name==='TimeoutError'||/timed out|timeout/i.test(e.message)); if(!transient||a>=retries) throw e;} await sleep(Math.min(1000*2**a,10000));}}
async function cached<T>(cache:WeatherCache,key:string,ttlSeconds:number,load:()=>Promise<T>):Promise<T>{const hit=await cache.get<T>(key); if(hit)return hit; const v=await load(); await cache.set(key,v,ttlSeconds); return v;}
export async function fetchStateWeather(state:StateConfig,o:ClientOptions={}):Promise<StateWeatherSnapshot>{validState(state); const cache=o.cache??createMemoryWeatherCache(); const legacy=await cache.get<StateWeatherSnapshot>(`weather:${state.code}`); if(legacy)return legacy; const point=await cached(cache,`weather:point:${state.code}`,86400,()=>getJson(`https://api.weather.gov/points/${state.latitude},${state.longitude}`,o)); const p=point.properties??{}, pause=o.minRequestIntervalMs??250, sleep=o.sleep??((ms:number)=>new Promise(r=>setTimeout(r,ms))); const req=async(u:string)=>{const v=await getJson(u,o); if(pause) await sleep(pause); return v;}; if(pause) await sleep(pause); const obs=await cached(cache,`weather:obs:${state.code}`,ttl.obs,()=>req(`https://api.weather.gov/points/${state.latitude},${state.longitude}/observations/latest`)); const forecast=await cached(cache,`weather:forecast:${state.code}`,ttl.forecast,()=>req(p.forecast)); const hourly=await cached(cache,`weather:hourly:${state.code}`,ttl.forecast,()=>req(p.forecastHourly)); const alerts=await cached(cache,`weather:alerts:${state.code}`,ttl.alerts,()=>req(`https://api.weather.gov/alerts/active?point=${state.latitude},${state.longitude}`)); return {stateCode:state.code,observedAt:new Date(obs.properties?.timestamp??Date.now()),current:obs.properties??{},forecast:[...(forecast.features??[]),...(hourly.features??[])],alerts:alerts.features??[],raw:{point,obs,forecast,hourly,alerts}}; }
const climateUrls:Record<ClimatePeriod,string>={ '6-10-day':'https://www.cpc.ncep.noaa.gov/products/predictions/610day/fxus06.html','8-14-day':'https://www.cpc.ncep.noaa.gov/products/predictions/814day/fxus07.html',monthly:'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/fxus07.html',seasonal:'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/fxus05.html' };
function probabilityValue(v: unknown): number|undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const n=Number(v.replace('%','').trim()); return Number.isFinite(n)?n:undefined; }
  return undefined;
}
/** Extract only explicitly supplied CPC probability bands. Never infers a temperature value. */
export function parseClimateProbabilities(raw: unknown): {temperature:Record<string,number>; precipitation:Record<string,number>} {
  if (!raw || typeof raw !== 'object') throw new Error('CPC climate response unavailable');
  const root:any = raw;
  const pick = (source:any):Record<string,number> => {
    const out:Record<string,number> = {};
    if (!source || typeof source !== 'object') return out;
    for (const band of ['aboveNormal','nearNormal','belowNormal']) {
      const value = probabilityValue(source[band] ?? source[band.replace('Normal','_normal')] ?? source[band.replace('Normal','-normal')]);
      if (value !== undefined) out[band] = value;
    }
    return out;
  };
  const temperature = pick(root.temperature ?? root.temperatureProbability ?? root.temp);
  const precipitation = pick(root.precipitation ?? root.precipitationProbability ?? root.precip);
  // Some CPC JSON responses expose the bands at the top level.
  if (!Object.keys(temperature).length) Object.assign(temperature, pick(root));
  if (!Object.keys(precipitation).length && root.precipitationProbability) Object.assign(precipitation, pick(root.precipitationProbability));
  if (!Object.keys(temperature).length && !Object.keys(precipitation).length) throw new Error('CPC climate response unavailable: probability bands missing');
  return {temperature, precipitation};
}
export async function fetchStateClimate(state:StateConfig,period:ClimatePeriod,o:ClientOptions={}):Promise<ClimateSnapshot>{validState(state); if(!(period in climateUrls)) throw new Error(`Unsupported climate period: ${period}`); const cache=o.cache??createMemoryWeatherCache(),key=`climate:${state.code}:${period}`; return cached(cache,key,ttl.climate,async()=>{if(o.minRequestIntervalMs) await (o.sleep??((ms:number)=>new Promise(r=>setTimeout(r,ms))))(o.minRequestIntervalMs); let raw:any; try { raw=await getJson(climateUrls[period],o); } catch (error) { throw new Error(`CPC climate response unavailable: ${error instanceof Error?error.message:String(error)}`); } const parsed=parseClimateProbabilities(raw); return {stateCode:state.code,period,temperature:parsed.temperature,precipitation:parsed.precipitation,raw};});}
