import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {LocalProjects} from './local_projects.mjs';
import {LocalObjectAssets} from './local_object_assets.mjs';
import {Lux3DRuntime,LUX_RECIPE,modelProportions} from './lux3d_runtime.mjs';
import {sanitize} from './api_client.mjs';
import {resolveMeasurements} from './try_on.mjs';
import {photoMeasurements} from './ui_actions.mjs';
const pools=new Map(),active=new Set(['QUEUED','UPLOADING','RUNNING','DOWNLOADING']);
const uuid=/^[a-f0-9-]{36}$/,jobPattern=/^[a-f0-9]{64}$/;
export function objectSize(value){
 if(value===undefined||value===null)return undefined;
 if(!['width','depth','height'].every(k=>Number.isFinite(value[k])&&value[k]>=.01&&value[k]<=20))throw Error('物品长宽高需全部填写，范围为 0.01–20 米');
 return Object.fromEntries(['width','depth','height'].map(k=>[k,value[k]]));
}
export class ObjectGenerations{
 constructor(root,{projects,assets,runtime,concurrency=2}={}){
  this.root=root;this.projects=projects??new LocalProjects(root);this.assets=assets??new LocalObjectAssets(this.projects);this.runtime=runtime??new Lux3DRuntime();
  if(!pools.has(root))pools.set(root,{running:new Set(),queue:[],count:0,locks:new Map()});this.pool=pools.get(root);this.concurrency=concurrency;
 }
 dir(projectId,id){if(!jobPattern.test(id))throw Error('物品任务 ID 无效');return path.join(this.projects.dir(projectId),'object-generations',id);}
 async lock(key,fn){const before=this.pool.locks.get(key)??Promise.resolve(),next=before.catch(()=>{}).then(fn);this.pool.locks.set(key,next);try{return await next;}finally{if(this.pool.locks.get(key)===next)this.pool.locks.delete(key);}}
 async save(j){const dir=this.dir(j.projectId,j.id);await fs.mkdir(dir,{recursive:true});j.updatedAt=new Date().toISOString();await fs.appendFile(path.join(dir,'job.ndjson'),JSON.stringify(sanitize(j))+'\n');}
 async load(projectId,id){const lines=(await fs.readFile(path.join(this.dir(projectId,id),'job.ndjson'),'utf8')).split('\n');for(let i=lines.length-1;i>=0;i--){try{if(lines[i]){const j=JSON.parse(lines[i]);if(j.id===id&&j.projectId===projectId)return j;}}catch{}}throw Error('物品任务记录损坏');}
 public(j){return {id:j.id,projectId:j.projectId,sourceAssetId:j.sourceAssetId,sourceUrl:`/api/projects/${j.projectId}/objects/${j.sourceAssetId}`,name:j.name,category:j.category,size:j.size??null,measuredAxes:j.measuredAxes??[],sizeBasis:j.sizeBasis??null,draftSize:j.draftSize??null,state:j.state,message:j.message,error:j.error??null,taskId:j.taskId??null,resultAssetId:j.resultAssetId??null,createdAt:j.createdAt,updatedAt:j.updatedAt,attempt:j.attempt??1,canRetry:j.state==='FAILED',canResume:j.state==='PAUSED'&&!!j.taskId};}
 async list(projectId,{resume=true}={}){
  await this.projects.load(projectId);let names;try{names=await fs.readdir(path.join(this.projects.dir(projectId),'object-generations'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const jobs=[];for(const id of names.filter(n=>jobPattern.test(n))){const j=await this.load(projectId,id);if(resume&&active.has(j.state))this.enqueue(j);jobs.push(this.public(j));}
  return jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 }
 async create(projectId,items){
  if(!Array.isArray(items)||!items.length||items.length>20)throw Error('一次可添加 1–20 张物品照片，每张照片代表一件物品');
  return this.lock(projectId,async()=>{
   await this.projects.load(projectId);const assets=await this.assets.list(projectId),existing=await this.list(projectId,{resume:false});
   const prepared=items.map(item=>{
    if(!item||!uuid.test(item.sourceAssetId??'')||!['furniture','decor','picture'].includes(item.category))throw Error('请选择物品照片与类别');
    const source=assets.find(a=>a.id===item.sourceAssetId&&a.kind==='image');if(!source)throw Error('物品照片不属于当前项目');
    const size=objectSize(item.size),draft=photoMeasurements(item.draftSize,{draft:true}),draftSize=draft.draftSize??draft.size,name=String(item.name??source.name.replace(/\.[^.]+$/,'')).trim().slice(0,70)||'我的物品';
    const id=crypto.createHash('sha256').update(JSON.stringify({projectId,sourceAssetId:source.id,category:item.category,recipe:LUX_RECIPE})).digest('hex');
    return {id,projectId,sourceAssetId:source.id,sourceSha256:source.sha256,category:item.category,name,size,draftSize,state:'DRAFT',message:item.category==='picture'?'已保存在电脑，可直接作为挂画摆放':'照片已保存在电脑，等待确认生成',attempt:1,createdAt:new Date().toISOString(),recipe:LUX_RECIPE};
   });
   if(new Set([...existing.map(j=>j.id),...prepared.map(j=>j.id)]).size>40)throw Error('每个项目最多保留 40 件物品生成任务');
   const result=[];for(const j of prepared){const old=existing.find(v=>v.id===j.id);if(old){result.push(old);continue;}if(j.category==='picture'){j.state='READY';j.resultAssetId=j.sourceAssetId;}await this.save(j);existing.push(this.public(j));result.push(this.public(j));}return result;
  });
 }
 async start(projectId,ids){
  return this.lock(projectId,async()=>{
   const all=await this.list(projectId,{resume:false});
   if(ids!==undefined&&(!Array.isArray(ids)||ids.length>40||ids.some(id=>!jobPattern.test(id)||!all.some(j=>j.id===id))))throw Error('物品任务不属于当前项目');
   const selected=ids?all.filter(j=>ids.includes(j.id)):all;
   if(selected.some(j=>j.state==='DRAFT')&&!await this.projects.key())throw Error('请在电脑配置 AHOLO_API_KEY 后再生成物品');
   const result=[];for(const item of selected){const j=await this.load(projectId,item.id);if(j.state==='DRAFT'){j.state='QUEUED';j.message='等待生成三维物品';j.error=null;await this.save(j);this.enqueue(j);}else if(active.has(j.state))this.enqueue(j);result.push(this.public(j));}return result;
  });
 }
 enqueue(j){
  const key=j.projectId+':'+j.id;if(this.pool.running.has(key))return;
  this.pool.running.add(key);this.pool.queue.push({manager:this,job:j,key});this.pump();
 }
 pump(){while(this.pool.count<this.concurrency&&this.pool.queue.length){const {manager,job,key}=this.pool.queue.shift();this.pool.count++;manager.run(job).catch(()=>{}).finally(()=>{this.pool.count--;this.pool.running.delete(key);this.pump();});}}
 async run(j){
  const update=async(state,message)=>{if(j.state===state&&j.message===message)return;j.state=state;j.message=message;await this.save(j);};
  try{
   if(!await this.projects.key())throw Error('电脑未配置 AHOLO_API_KEY');
   if(j.submitAttempted&&!j.taskId){await update('SUBMIT_UNKNOWN','上次提交结果待确认，请填写已有 Lux3D 任务编号恢复，未自动重复生成');return;}
   if(!j.taskId){
    const source=await this.assets.get(j.projectId,j.sourceAssetId),file=path.join(this.projects.dir(j.projectId),'objects',source.meta.file);
    if(source.meta.kind!=='image')throw Error('生成需要物品照片');
    const check=await this.runtime.inspectSource(file,this.projects);j.sourceDimensions={width:check.width,height:check.height};
    await update('UPLOADING','正在将物品照片发送到 Lux3D');
    if(!j.remoteUrl){j.remoteUrl=await this.runtime.upload(file);await this.save(j);}
    j.submitAttempted=true;j.submittedAt=new Date().toISOString();await this.save(j);
    j.taskId=await this.runtime.submit(j.remoteUrl);await this.save(j);
   }
   await update('RUNNING','Lux3D 正在生成三维物品');
   const url=await this.runtime.wait(j.taskId,message=>update('RUNNING',message));
   const output=new URL(url);j.outputResource={host:output.hostname,path:output.pathname};
   await update('DOWNLOADING','三维物品已生成，正在下载到电脑');
   const bytes=await this.runtime.download(url),proportions=modelProportions(bytes,j.category),resolved=resolveMeasurements(proportions,j.size??j.draftSize),size=resolved.size;
   const asset=await this.lock(j.projectId+':assets',()=>this.assets.store(j.projectId,bytes,j.name+'.glb',{generationId:j.id,sourceAssetId:j.sourceAssetId,category:j.category,estimatedSize:size,sizeBasis:resolved.sizeBasis,measuredAxes:resolved.measuredAxes,lux3dTaskId:j.taskId}));
   j.resultAssetId=asset.id;j.resultSha256=asset.sha256;j.size=size;j.measuredAxes=resolved.measuredAxes;j.sizeBasis=resolved.sizeBasis;j.completedAt=new Date().toISOString();j.error=null;await update('READY','三维物品已保存，可以放入空间');
  }catch(e){j.error=String(sanitize(e.message)).slice(0,260);
   if(e.diagnostic)j.diagnostic=sanitize(e.diagnostic);
   if(e.rejected){j.submitAttempted=false;await update('FAILED',j.error);}
   else if(j.submitAttempted&&!j.taskId)await update('SUBMIT_UNKNOWN','提交结果待确认，未自动重复生成；请用已有任务编号恢复');
   else if(j.taskId&&!e.terminal)await update('PAUSED',j.error);
   else await update('FAILED',j.error);
  }
 }
 async action(projectId,id,action,body={}){
  return this.lock(projectId,async()=>{
   const j=await this.load(projectId,id),key=projectId+':'+id;
   if(this.pool.running.has(key))return this.public(j);
   if(action==='recover'){
    if(!['SUBMIT_UNKNOWN','PAUSED'].includes(j.state)||!/^\d{1,30}$/.test(String(body.taskId??'')))throw Error('请填写当前账号已有的 Lux3D 任务编号');
    const taskId=String(body.taskId);if(j.taskId&&j.taskId!==taskId)throw Error('已有任务编号不能更换');
    await this.projects.key();await this.runtime.query(taskId);j.taskId=taskId;j.submitAttempted=true;
   }else if(action==='retry'){
    if(j.state!=='FAILED')throw Error('只有明确失败的物品才能重新生成；其他状态请继续查询已有任务');
    j.previousTasks=[...j.previousTasks??[],{taskId:j.taskId??null,error:j.error,at:new Date().toISOString()}];delete j.taskId;j.submitAttempted=false;j.attempt=(j.attempt??1)+1;
   }else if(action==='resume'){if(j.state!=='PAUSED'||!j.taskId)throw Error('没有可以继续查询的物品任务');}
   else throw Error('物品任务操作无效');
   if(!await this.projects.key())throw Error('电脑未配置 AHOLO_API_KEY');j.state='QUEUED';j.message='继续处理物品任务';j.error=null;await this.save(j);this.enqueue(j);return this.public(j);
  });
 }
}
