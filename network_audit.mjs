// Local-demo egress policy. Never records keys, headers, request bodies or URL queries.
import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDirectory} from './runtime_config.mjs';
import {modelScopeResultUrl} from './modelscope_runtime.mjs';
export function permittedRemote(url,method='GET'){
 const u=new URL(url);if(u.username||u.password)return false;
 // Local FLUX runtime only: fixed loopback port and narrow API operations.
 if(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.port==='8190')return method==='GET'&&/^\/(system_stats|queue|history(?:\/[a-f0-9-]{36})?|view|object_info\/(UNETLoader|CLIPLoader|VAELoader))$/.test(u.pathname)||method==='POST'&&/^\/(upload\/image|prompt|free)$/.test(u.pathname);
 if(u.protocol!=='https:'||(u.port&&u.port!=='443'))return false;
 if(u.hostname==='api-inference.modelscope.cn')return method==='POST'&&u.pathname==='/v1/images/generations'||method==='GET'&&/^\/v1\/tasks\/[A-Za-z0-9_-]{1,200}$/.test(u.pathname);
 if(method==='GET'&&modelScopeResultUrl(u.href))return true;
 if(u.hostname==='api.aholo3d.cn')return method==='GET'?/^\/asset\/v1\/token$|^\/world\/v1\/[A-Za-z0-9_-]+$|^\/lux3d\/v1\/generate\/task\/get$/.test(u.pathname):method==='POST'&&/^\/world\/v1\/(generations|reconstructions)$|^\/lux3d\/v1\/generate\/img-to-3d\/task\/create$/.test(u.pathname);
 if(/(^|\.)kujiale\.com$/.test(u.hostname))return /^\/ous\/api\/v2\//.test(u.pathname)&&['GET','POST'].includes(method)||method==='GET'&&!u.pathname.startsWith('/ous/');
 if(u.hostname==='tx-qhsmodel-1258830046.cos.ap-shanghai.myqcloud.com')return method==='GET'&&/^\/lux3dPbrEmbedResult\/[a-f0-9]{32}\/textured\.glb$/.test(u.pathname);
 return method==='GET'&&/(^|\.)aholo3d\.cn$/.test(u.hostname);
}
export function auditedFetch(original,record){return async(input,init={})=>{
 const u=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=(init.method??input.method??'GET').toUpperCase();
 const entry={at:new Date().toISOString(),method,host:u.hostname,path:u.pathname};
 if(!permittedRemote(u,method)){await record({...entry,event:'BLOCKED_BY_POLICY'});throw Error('本地 Demo 禁止访问未配置的生成或渲染服务');}
 await record({...entry,event:'REQUEST'});try{const response=await original(input,{...init,redirect:'error'});await record({...entry,event:'RESPONSE',http:response.status});return response;}catch(e){await record({...entry,event:'NETWORK_ERROR',error:e.name??'Error'});throw e;}
};}
export async function installNetworkAudit(root){const file=path.join(dataDirectory(root),'network-audit.ndjson');await fs.mkdir(path.dirname(file),{recursive:true});globalThis.fetch=auditedFetch(globalThis.fetch.bind(globalThis),entry=>fs.appendFile(file,JSON.stringify(entry)+'\n'));return file;}
