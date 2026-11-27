import type { USStateConfig } from '@walmart-erp/domain';
import { createMemoryWeatherCache, type WeatherCache } from './weatherCache.js';
import shp from 'shpjs';
export type StateConfig = USStateConfig;
export type ClimatePeriod = '6-10-day' | '8-14-day' | 'monthly' | 'seasonal';
export interface StateWeatherSnapshot { stateCode:string; observedAt:Date; current:Record<string,unknown>; forecast:Array<Record<string,unknown>>; alerts:Array<Record<string,unknown>>; raw:Record<string,unknown>; }
export interface ClimateSnapshot { stateCode:string; period:ClimatePeriod; validFrom?:Date; validTo?:Date; temperature:Record<string,number>; precipitation:Record<string,number>; raw:unknown; }
type Request=(url:string,init:{headers:Record<string,string>;signal?:AbortSignal})=>Promise<{status:number;ok?:boolean;headers:Headers;text?:()=>Promise<string>;arrayBuffer?:()=>Promise<ArrayBuffer>;json():Promise<any>}>;
export interface ClientOptions { request?:Request; cache?:WeatherCache; sleep?:(ms:number)=>Promise<void>; maxRetries?:number; userAgent?:string; minRequestIntervalMs?:number; timeoutMs?:number; }
const UA='wmterp-weather/1.0 (operations@wmterp.local)'; const defaultRequest:Request=(u,i)=>fetch(u,i) as any; const ttl={obs:600,forecast:1800,alerts:300,climate:86400};
function validState(s:StateConfig){if(!s?.code||!Number.isFinite(s.latitude)||!Number.isFinite(s.longitude)||s.latitude < -90||s.latitude>90||s.longitude < -180||s.longitude>180) throw new Error('Malformed state configuration');}
async function getJson(url:string,o:ClientOptions):Promise<any>{const request=o.request??defaultRequest,retries=o.maxRetries??3,sleep=o.sleep??((ms:number)=>new Promise(r=>setTimeout(r,ms))); for(let a=0;;a++){let transient=false; try{const c=typeof AbortController==='undefined'?undefined:new AbortController(); const timer=c&&setTimeout(()=>c.abort(),o.timeoutMs??15000); const r=await request(url,{headers:{Accept:'application/json, application/geo+json','User-Agent':o.userAgent??UA},signal:c?.signal}); if(timer) clearTimeout(timer); if(r.status>=200&&r.status<300){const contentType=r.headers.get('content-type')??''; if(contentType && !/json|\+json/i.test(contentType)) throw new Error('Weather service returned a non-JSON response'); try { if(r.text){const body=await r.text(); try{return JSON.parse(body);}catch{throw new Error('Weather service returned invalid JSON');}} return await r.json(); } catch(error){if(error instanceof SyntaxError) throw new Error('Weather service returned invalid JSON'); throw error;}} transient=r.status===429 || (r.status>=500 && r.status<600); if(!transient||a>=retries) throw new Error(`Weather request failed: HTTP ${r.status}`); const ra=Number(r.headers.get('retry-after')??0); await sleep(ra>0?ra*1000:Math.min(1000*2**a,10000)); continue;}catch(e){transient=e instanceof Error && (e.name==='AbortError'||e.name==='TimeoutError'||/timed out|timeout/i.test(e.message)); if(!transient||a>=retries) throw e;} await sleep(Math.min(1000*2**a,10000));}}
async function cached<T>(cache:WeatherCache,key:string,ttlSeconds:number,load:()=>Promise<T>):Promise<T>{const hit=await cache.get<T>(key); if(hit)return hit; const v=await load(); await cache.set(key,v,ttlSeconds); return v;}
export async function fetchStateWeather(state:StateConfig,o:ClientOptions={}):Promise<StateWeatherSnapshot>{validState(state); const cache=o.cache??createMemoryWeatherCache(); const legacy=await cache.get<StateWeatherSnapshot>(`weather:${state.code}`); if(legacy)return legacy; const point=await cached(cache,`weather:point:${state.code}`,86400,()=>getJson(`https://api.weather.gov/points/${state.latitude},${state.longitude}`,o)); const p=point.properties??{}, pause=o.minRequestIntervalMs??250, sleep=o.sleep??((ms:number)=>new Promise(r=>setTimeout(r,ms))); const req=async(u:string)=>{if(!u)throw new Error('NWS response is missing a required endpoint'); const v=await getJson(u,o); if(pause) await sleep(pause); return v;}; if(pause) await sleep(pause); const stations=await cached(cache,`weather:stations:${state.code}`,86400,()=>req(p.observationStations)); const station=stations.features?.[0]; const stationUrl=station?.id??station?.properties?.['@id']; if(typeof stationUrl!=='string')throw new Error('NWS observation station unavailable'); const obs=await cached(cache,`weather:obs:${state.code}`,ttl.obs,()=>req(`${stationUrl.replace(/\/$/,'')}/observations/latest`)); const forecast=await cached(cache,`weather:forecast:${state.code}`,ttl.forecast,()=>req(p.forecast)); const hourly=await cached(cache,`weather:hourly:${state.code}`,ttl.forecast,()=>req(p.forecastHourly)); const alerts=await cached(cache,`weather:alerts:${state.code}`,ttl.alerts,()=>req(`https://api.weather.gov/alerts/active?area=${encodeURIComponent(state.code)}`)); return {stateCode:state.code,observedAt:new Date(obs.properties?.timestamp??Date.now()),current:obs.properties??{},forecast:[...(forecast.properties?.periods??forecast.features??[]),...(hourly.properties?.periods??hourly.features??[])],alerts:alerts.features??[],raw:{point,stations,obs,forecast,hourly,alerts}}; }
const climateUrls:Partial<Record<ClimatePeriod,{temperature:string;precipitation:string}>>={
  '8-14-day':{temperature:'814temp_latest.zip',precipitation:'814prcp_latest.zip'},
  monthly:{temperature:'monthupd_temp_latest.zip',precipitation:'monthupd_prcp_latest.zip'},
  seasonal:{temperature:'seastemp_latest.zip',precipitation:'seasprcp_latest.zip'},
};
type ClimateFeature={geometry?:{type:string;coordinates:any};properties?:Record<string,unknown>};
type ClimateLayers={temperature:ClimateFeature[];precipitation:ClimateFeature[]};
let climateFeaturesCache:Partial<Record<ClimatePeriod,{expiresAt:number;promise:Promise<ClimateLayers>}>>={};
const field=(p:Record<string,unknown>,name:string)=>p[name]??p[name.toLocaleLowerCase()]??p[name.toLocaleUpperCase()];
function containsRing(ring:number[][],x:number,y:number):boolean{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i]??[],[xj,yj]=ring[j]??[];if(((yi>y)!==(yj>y))&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
function containsPoint(feature:ClimateFeature,x:number,y:number):boolean{const g=feature.geometry;if(!g)return false;const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];return polys.some((rings:number[][][])=>rings.length>0&&containsRing(rings[0]!,x,y)&&!rings.slice(1).some(r=>containsRing(r,x,y)));}
function climateDates(properties:Record<string,unknown>):{validFrom?:Date;validTo?:Date}{const parse=(v:unknown)=>{const s=String(v??'');if(/^\d{8}$/.test(s))return new Date(Date.UTC(Number(s.slice(0,4)),Number(s.slice(4,6))-1,Number(s.slice(6,8))));const d=new Date(s);return Number.isNaN(d.getTime())?undefined:d;};return{validFrom:parse(field(properties,'Start_Date')),validTo:parse(field(properties,'End_Date'))};}
async function loadClimateFeatures(period:ClimatePeriod,o:ClientOptions):Promise<ClimateLayers>{
  const now=Date.now(),cached=climateFeaturesCache[period];if(cached&&cached.expiresAt>now)return cached.promise;
  const files=climateUrls[period];if(!files)throw new Error(`Unsupported CPC GIS climate period: ${period}`);
  const promise=(async()=>{const request=o.request??defaultRequest;const read=async(file:string)=>{const response=await request(`https://ftp.cpc.ncep.noaa.gov/GIS/us_tempprcpfcst/${file}`,{headers:{Accept:'application/zip, application/octet-stream','User-Agent':o.userAgent??UA}});if(response.status<200||response.status>=300)throw new Error(`CPC GIS request failed: HTTP ${response.status}`);if(!response.arrayBuffer)throw new Error('CPC GIS response reader unavailable');const parsed=await shp(await response.arrayBuffer()) as any;const collections=Array.isArray(parsed)?parsed:[parsed];return collections.flatMap(c=>c?.features??[]) as ClimateFeature[];};const temperature=await read(files.temperature);if(o.minRequestIntervalMs)await(o.sleep??((ms:number)=>new Promise(r=>setTimeout(r,ms))))(o.minRequestIntervalMs);const precipitation=await read(files.precipitation);return{temperature,precipitation};})();
  climateFeaturesCache[period]={expiresAt:now+ttl.climate*1000,promise};try{return await promise;}catch(error){delete climateFeaturesCache[period];throw error;}
}
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
export async function fetchStateClimate(state:StateConfig,period:ClimatePeriod,o:ClientOptions={}):Promise<ClimateSnapshot>{
  validState(state);if(!climateUrls[period])throw new Error(`Unsupported climate period: ${period}`);
  const cache=o.cache??createMemoryWeatherCache(),key=`climate:${state.code}:${period}`;
  return cached(cache,key,ttl.climate,async()=>{
    let layers:ClimateLayers;try{layers=await loadClimateFeatures(period,o);}catch(error){throw new Error(`CPC climate response unavailable: ${error instanceof Error?error.message:String(error)}`);}
    const parseLayer=(features:ClimateFeature[])=>{const matches=features.filter(feature=>containsPoint(feature,state.longitude,state.latitude));const values:Record<string,number>={};let dates:{validFrom?:Date;validTo?:Date}={};for(const feature of matches){const properties=feature.properties??{};const category=String(field(properties,'Cat')??'').toLocaleLowerCase();const value=probabilityValue(field(properties,'Prob'));if(value===undefined)continue;const band=category.includes('above')?'aboveNormal':category.includes('below')?'belowNormal':category.includes('normal')?'nearNormal':undefined;if(band)values[band]=value;if(!dates.validFrom)dates=climateDates(properties);}return{matches,values,dates};};
    const temperatureLayer=parseLayer(layers.temperature),precipitationLayer=parseLayer(layers.precipitation);const temperature=temperatureLayer.values,precipitation=precipitationLayer.values;const dates=temperatureLayer.dates.validFrom?temperatureLayer.dates:precipitationLayer.dates;
    if(!Object.keys(temperature).length&&!Object.keys(precipitation).length)throw new Error(`CPC climate outlook does not cover ${state.code} representative point`);
    const raw={sampleLocation:{latitude:state.latitude,longitude:state.longitude,city:state.representativeCity},temperature:temperatureLayer.matches.map(f=>f.properties),precipitation:precipitationLayer.matches.map(f=>f.properties),validFrom:dates.validFrom?.toISOString()??null,validTo:dates.validTo?.toISOString()??null};
    return {stateCode:state.code,period,validFrom:dates.validFrom,validTo:dates.validTo,temperature,precipitation,raw};
  });
}
