import fs from 'node:fs/promises';
export function parseLossless(text){return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,t=>t[0]!=='"'&&/^-?\d+$/.test(t)&&!Number.isSafeInteger(Number(t))?JSON.stringify(t):t));}
export function unwrap(v){if('c'in v){if(String(v.c)!=='0')throw Error(`API business error ${v.c}: ${v.m??''}`);return v.d;}if('success'in v){if(!v.success)throw Error(v.errorMsg??'API failure');return v.data;}return v;}
export function sanitize(v){if(Array.isArray(v))return v.map(sanitize);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(authorization|.*api.?key|token|ousToken|accessToken|secret|credential)$/i.test(k)?'[REDACTED]':sanitize(x)]));if(typeof v==='string'){let text=v.replace(/([?&](?:token|access_token|signature|secret|key)=)[^&]+/gi,'$1[REDACTED]');const key=process.env.AHOLO_API_KEY;if(key)text=text.split(key).join('[REDACTED]');return text;}return v;}
export async function api(endpoint,body){
 const key=process.env.AHOLO_API_KEY;if(!key)throw Error('BLOCKED_MISSING_AHOLO_API_KEY');
 const response=await fetch(new URL(endpoint,'https://api.aholo3d.cn'),{method:body?'POST':'GET',headers:{Authorization:key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const text=await response.text();let data;try{data=parseLossless(text);}catch{data={error:'Non-JSON response',length:text.length};}
 return {at:new Date().toISOString(),http:response.status,ok:response.ok,body:data};
}
export async function record(file,value){await fs.mkdir(new URL('.',new URL(file,import.meta.url)),{recursive:true});await fs.writeFile(new URL(file,import.meta.url),JSON.stringify(sanitize(value),null,2));}
