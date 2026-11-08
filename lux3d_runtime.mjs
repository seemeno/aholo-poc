import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {Box3,Vector3,Matrix4,Quaternion} from 'three';
import {api,unwrap} from './api_client.mjs';
import {uploadAsset} from './asset_upload.mjs';
import {inspectObject} from './local_object_assets.mjs';

export const LUX_RECIPE={version:'G1',faceCount:100000,outputFormat:['glb'],aiPredictSize:false};
export function modelProportions(bytes,category='furniture'){
 inspectObject(bytes,'model.glb');
 const g=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)).trim()),bounds=new Box3();
 const visit=(index,parent,ancestors=new Set())=>{
  if(ancestors.has(index))throw Error('模型包含循环节点');
  const node=g.nodes?.[index];if(!node)return;
  const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...node.translation??[0,0,0]),new Quaternion(...node.rotation??[0,0,0,1]),new Vector3(...node.scale??[1,1,1]));
  const world=parent.clone().multiply(local),next=new Set([...ancestors,index]);
  for(const p of g.meshes?.[node.mesh]?.primitives??[]){const a=g.accessors?.[p.attributes?.POSITION];if(!a?.min||!a?.max)throw Error('模型缺少几何范围');bounds.union(new Box3(new Vector3(...a.min),new Vector3(...a.max)).applyMatrix4(world));}
  for(const child of node.children??[])visit(child,world,next);
 };
 for(const index of g.scenes?.[g.scene??0]?.nodes??[])visit(index,new Matrix4());
 const size=bounds.getSize(new Vector3()),longest=Math.max(size.x,size.y,size.z);
 if(![size.x,size.y,size.z].every(v=>Number.isFinite(v)&&v>1e-6))throw Error('模型没有可用的三维尺寸');
 const scale=(category==='decor'?.35:1)/longest;
 // glTF is Y-up; the editor uses Z-up.
 return {width:size.x*scale,depth:size.z*scale,height:size.y*scale};
}
export class Lux3DRuntime{
 constructor({callApi=api,transfer=uploadAsset,request=(...args)=>fetch(...args),pollMs=8000,maxWaitMs=30*60*1000}={}){Object.assign(this,{callApi,transfer,request,pollMs,maxWaitMs});}
 async inspectSource(file,projects){try{return await projects.py('media_check.py',[file],45000);}catch(cause){const error=Error(cause.killed?'电脑繁忙，照片检查暂时超时。尚未提交生成，可以稍后单独重试':'物品照片检查未完成，请重试；若仍失败，请重新选择 JPG、PNG 或 WebP 图片');error.diagnostic=String(cause.stderr??cause.message).slice(0,8000);throw error;}}
 async upload(file){const bytes=await fs.readFile(file);return this.transfer(file,{md5:crypto.createHash('md5').update(bytes).digest('hex'),name:path.basename(file),size:bytes.length});}
 async submit(img){
  const response=await this.callApi('/lux3d/v1/generate/img-to-3d/task/create',{img,...LUX_RECIPE});
  let value;try{if(!response.ok)throw Error(`Lux3D 拒绝生成（HTTP ${response.http}）`);value=unwrap(response.body);}catch(e){e.rejected=true;throw e;}
  const taskId=typeof value==='object'?value.taskId??value.taskid:value;
  if(!/^\d{1,30}$/.test(String(taskId??'')))throw Error('Lux3D 未返回任务编号，请核对任务记录');
  return String(taskId);
 }
 async query(taskId){
  if(!/^\d{1,30}$/.test(String(taskId)))throw Error('Lux3D 任务编号无效');
  const response=await this.callApi('/lux3d/v1/generate/task/get?taskid='+taskId);
  if(!response.ok)throw Error(`查询 Lux3D 暂时失败（HTTP ${response.http}），已有任务编号已保留`);
  const value=unwrap(response.body);
  if(value.taskId!==undefined&&String(value.taskId)!==String(taskId))throw Error('Lux3D 返回了不同的任务编号');
  return value;
 }
 async wait(taskId,onUpdate){
  const start=Date.now();
  while(Date.now()-start<this.maxWaitMs){
   const result=await this.query(taskId);
   if(result.status===3){const url=result.outputs?.map(o=>o.content).find(u=>{try{return new URL(u).pathname.toLowerCase().endsWith('.glb');}catch{return false;}});if(!url)throw Error('Lux3D 已完成，但没有返回可用的 GLB');return url;}
   if([4,6].includes(result.status)){const e=Error(result.status===6?'Lux3D 任务已取消':'Lux3D 生成失败，可以单独重新生成这件物品');e.terminal=true;throw e;}
   await onUpdate(result.status===0?'正在等待 Lux3D 生成':'Lux3D 正在生成三维物品');
   await new Promise(r=>setTimeout(r,this.pollMs));
  }
  throw Error('生成仍在进行，任务编号已保存，可稍后继续查询');
 }
 async download(url){
  const u=new URL(url);
  const storage=/(^|\.)(aholo3d\.cn|kujiale\.com)$/.test(u.hostname)||u.hostname==='tx-qhsmodel-1258830046.cos.ap-shanghai.myqcloud.com'&&/^\/lux3dPbrEmbedResult\/[a-f0-9]{32}\/textured\.glb$/.test(u.pathname);
  if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!storage||!u.pathname.toLowerCase().endsWith('.glb'))throw Error('模型下载地址不符合 Lux3D 资源域名约定');
  const r=await this.request(u,{redirect:'error',signal:AbortSignal.timeout(180000)});
  if(!r.ok)throw Error(`模型下载失败（HTTP ${r.status}），可继续下载已有任务`);
  if(Number(r.headers.get('content-length'))>100*1024**2)throw Error('模型超过 100 MB，请降低面数后生成');
  const parts=[];let length=0;for await(const part of r.body){length+=part.length;if(length>100*1024**2)throw Error('模型超过 100 MB');parts.push(part);}
  const bytes=Buffer.concat(parts);inspectObject(bytes,'model.glb');return bytes;
 }
}
