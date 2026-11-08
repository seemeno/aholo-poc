import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateScene} from './scene_state.mjs';
import {planFingerprint} from './ui_actions.mjs';
import {LocalProjects} from './local_projects.mjs';
import {LocalObjectAssets} from './local_object_assets.mjs';
import {EffectRuntime} from './effect_runtime.mjs';
import {EFFECT_RECIPE} from './effect_workflow.mjs';
const pools=new Map(),terminal=new Set(['READY','FAILED','SUBMIT_UNKNOWN']);
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function ordered(v){return v&&typeof v==='object'?Array.isArray(v)?v.map(ordered):Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,ordered(v[k])])):v;}
function stable(v){return JSON.stringify(ordered(v));}
export function renderContent(scene){return stable({projectId:scene.projectId,worldId:scene.worldId,structure:scene.structure,sceneScale:scene.sceneScale,objects:scene.objects,camera:scene.camera});}
export function pngDimensions(bytes){
 if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.toString('ascii',bytes.length-8,bytes.length-4)!=='IEND')throw Error('需要完整的 PNG 场景截图');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width<256||height<256||width>1024||height>1024||width%16||height%16||width*height>1024**2)throw Error('效果图尺寸需为 256–1024 的 16 像素倍数');
 return {width,height};
}
export class LocalEffectRenderer{
 constructor(root,{runtime,projects}={}){
  this.root=root;this.base=path.join(root,'local-data/effect-renders');this.projects=projects??new LocalProjects(root);this.runtime=runtime??new EffectRuntime(root);
  if(!pools.has(root))pools.set(root,{flights:new Map(),running:new Set(),tail:Promise.resolve()});this.pool=pools.get(root);
 }
 dir(id){if(!/^[a-f0-9]{64}$/.test(id))throw Error('效果图 ID 无效');return path.join(this.base,id);}
 // Append complete durable snapshots: Windows readers cannot block a rename-overwrite,
 // and a truncated final record after a crash leaves the preceding record usable.
 async save(j){j.updatedAt=new Date().toISOString();await fs.appendFile(path.join(this.dir(j.id),'job.ndjson'),JSON.stringify(j)+'\n');}
 async load(id){
  try{const lines=(await fs.readFile(path.join(this.dir(id),'job.ndjson'),'utf8')).split('\n');for(let i=lines.length-1;i>=0;i--){try{if(lines[i])return JSON.parse(lines[i]);}catch{}}throw Error('效果图状态尚未完整保存');}
  catch(e){if(e.code!=='ENOENT')throw e;return JSON.parse(await fs.readFile(path.join(this.dir(id),'job.json'),'utf8'));}
 }
 public(j){return {id:j.id,projectId:j.projectId,state:j.state,message:j.message,createdAt:j.createdAt,updatedAt:j.updatedAt,completedAt:j.completedAt??null,elapsedMs:j.completedAt?Date.parse(j.completedAt)-Date.parse(j.createdAt):null,width:j.width,height:j.height,backend:'FLUX.2 Klein 4B · 本地',recipe:j.recipe,referenceCount:j.references.length,imageUrl:j.state==='READY'?`/api/effect-renders/${j.id}/image`:null,previewUrl:`/api/effect-renders/${j.id}/preview`,snapshotHash:j.sceneHash,planFingerprint:planFingerprint(j.scene),sourceSavedAt:j.sourceSavedAt??null};}
 async references(projectId,scene){
  const visible=scene.objects.filter(o=>o.visible),refs=[];
  if(visible.some(o=>o.assetId==='builtin_tv')){
   try{const bytes=await fs.readFile(path.join(this.root,'assets/demo/furniture_reference.png'));refs.push({label:'the existing light-wood cabinet',bytes,ext:'.png',mime:'image/png'});}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const assets=new LocalObjectAssets(this.projects);
  const all=await assets.list(projectId);
  const sources=new Set();
  for(const o of visible.filter(o=>o.assetKind==='glb'&&o.assetId!=='builtin_tv')){
   const meta=all.find(a=>a.id===o.assetId);if(!meta?.sourceAssetId||sources.has(meta.sourceAssetId))continue;
   const source=all.find(a=>a.id===meta.sourceAssetId&&a.kind==='image');if(!source)continue;
   const {bytes}=await assets.get(projectId,source.id);if(refs.length>=3)break;
   if(bytes.length<=8*1024**2){refs.push({label:'the existing '+(meta.category==='decor'?'decorative object':'furniture')+' '+o.name,bytes,ext:path.extname(source.file),mime:source.mime});sources.add(source.id);}
  }
  if(refs.length)return refs.slice(0,1);
  for(const id of [...new Set(visible.filter(o=>o.assetKind==='image').map(o=>o.assetId))]){
   if(refs.length>=1)break;if(sources.has(id))continue;const {meta,bytes}=await assets.get(projectId,id);if(bytes.length<=8*1024**2){refs.push({label:'the existing artwork or picture',bytes,ext:path.extname(meta.file),mime:meta.mime});sources.add(id);}
  }
  // The whole placement already contains every artwork. Multiple separate art
  // latents caused extra plants/furniture in real tests; retain one product ref.
  return refs.slice(0,1);
 }
 async start(body){
  const projectId=body?.projectId;this.projects.dir(projectId??'');
  const scene=validateScene(body.scene);if(scene.projectId!==projectId||!scene.camera)throw Error('缺少当前项目的机位快照');
  if(!scene.objects.some(o=>o.visible))throw Error('请先摆放并显示至少一件物品');
  const p=await this.projects.load(projectId);if(p.status!=='READY')throw Error('请等待空间加载完成');
  await new LocalObjectAssets(this.projects).validateReferences(projectId,scene);
  const saved=validateScene(await this.projects.scene(projectId));
  if(renderContent(saved)!==renderContent(scene))throw Error('摆放已变化，请先保存当前方案再生成');
  if(typeof body.preview!=='string'||body.preview.length>6*1024**2||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(body.preview))throw Error('场景截图无效或过大');
  const image=Buffer.from(body.preview.slice(body.preview.indexOf(',')+1),'base64'),size=pngDimensions(image);
  if(image.length>4*1024**2||scene.camera.resolution?.join(',')!==[size.width,size.height].join(','))throw Error('截图与保存机位的分辨率不一致');
  const sceneHash=digest(renderContent(scene)),flightKey=projectId+':'+sceneHash;
  if(this.pool.flights.has(flightKey))return this.pool.flights.get(flightKey);
  const promise=this.create({projectId,scene,sceneHash,sourceSavedAt:saved.savedAt??null,image,...size,force:body.force===true}).finally(()=>this.pool.flights.delete(flightKey));
  this.pool.flights.set(flightKey,promise);return promise;
 }
 async create({projectId,scene,sceneHash,sourceSavedAt,image,width,height,force}){
  const latest=await this.latest(projectId,false);
  if(latest&&latest.snapshotHash===sceneHash&&!terminal.has(latest.state))return latest;
  const refs=await this.references(projectId,scene);
  const room=await fs.stat(path.join(this.projects.dir(projectId),'room.ply'));
  const id=digest(stable({recipe:EFFECT_RECIPE,projectId,sceneHash,image:digest(image),refs:refs.map(r=>digest(r.bytes)),room:{bytes:room.size,mtime:room.mtimeMs},nonce:force?crypto.randomUUID():null}));
  try{const existing=await this.load(id);if(!terminal.has(existing.state))this.enqueue(existing);return this.public(existing);}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(this.dir(id),{recursive:true});
  const references=refs.map((r,i)=>({label:r.label,file:`reference-${i}${r.ext}`,mime:r.mime,ext:r.ext,sha256:digest(r.bytes)}));
  const j={id,projectId,sceneHash,sourceSavedAt,scene,recipe:EFFECT_RECIPE,seed:20261105,width,height,state:'QUEUED',message:'已保存当前机位，正在等待电脑生成',createdAt:new Date().toISOString(),references,previewSha256:digest(image),submitAttempted:false};
  await fs.writeFile(path.join(this.dir(id),'preview.png'),image);
  await Promise.all(refs.map((r,i)=>fs.writeFile(path.join(this.dir(id),references[i].file),r.bytes)));
  await this.save(j);this.enqueue(j);return this.public(j);
 }
 enqueue(j){
  if(this.pool.running.has(j.id)||terminal.has(j.state))return;
  this.pool.running.add(j.id);
  const task=this.pool.tail.catch(()=>{}).then(()=>this.run(j)).finally(()=>this.pool.running.delete(j.id));
  this.pool.tail=task.catch(()=>{});
 }
 async run(j){
  const update=async(state,message)=>{if(j.state===state&&j.message===message)return;j.state=state;j.message=message;await this.save(j);};
  try{
   await update('PREPARING','正在准备电脑上的效果图模型');await this.runtime.ensure();
   if(!j.promptId&&j.submitAttempted){j.promptId=await this.runtime.reconcile(j.id);if(!j.promptId){await update('SUBMIT_UNKNOWN','上次生成状态待确认，未自动重复提交；可以查看原预览或重新生成');return;}await this.save(j);}
   if(!j.promptId){
    const image=await fs.readFile(path.join(this.dir(j.id),'preview.png'));
    const refs=await Promise.all(j.references.map(async r=>({...r,bytes:await fs.readFile(path.join(this.dir(j.id),r.file))})));
    j.promptId=await this.runtime.submit(j,image,refs,async graph=>{await fs.writeFile(path.join(this.dir(j.id),'workflow.json'),JSON.stringify(graph,null,2));j.submitAttempted=true;await this.save(j);});
    await this.save(j);
   }
   await update('GENERATING','正在生成效果图，首次加载通常需要几分钟');
   const bytes=await this.runtime.wait(j,update),size=pngDimensions(bytes);
   if(size.width!==j.width||size.height!==j.height)throw Error('效果图输出尺寸与当前机位不一致');
   await fs.writeFile(path.join(this.dir(j.id),'result.png.tmp'),bytes);await fs.rename(path.join(this.dir(j.id),'result.png.tmp'),path.join(this.dir(j.id),'result.png'));
   j.resultSha256=digest(bytes);j.completedAt=new Date().toISOString();await update('READY','效果图已生成并保存到电脑项目');
  }catch(e){
   if(j.promptId&&['TimeoutError','AbortError','TypeError'].includes(e.name))e.pending=true;
   if(e.unknown)await update('SUBMIT_UNKNOWN',e.message);
   else if(e.pending)await update('WAITING','生成仍在进行，稍后回来查看即可');
   else if(j.submitAttempted&&!j.promptId)await update('SUBMIT_UNKNOWN','生成提交状态待确认，未自动重复提交；可重新打开查看或重新生成');
   else await update('FAILED',e.message?.slice(0,220)||'生成失败，请稍后重试');
  }finally{await this.runtime.release();}
 }
 async get(id){const j=await this.load(id);if(!terminal.has(j.state))this.enqueue(j);return this.public(j);}
 async list(projectId){
  this.projects.dir(projectId??'');await this.projects.load(projectId);let names;try{names=await fs.readdir(this.base);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const jobs=[];for(const id of names.filter(n=>/^[a-f0-9]{64}$/.test(n))){try{const j=await this.load(id);if(j.projectId===projectId)jobs.push(j);}catch{}}
  jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return jobs.map(j=>this.public(j));
 }
 async latest(projectId,resume=true){
  const j=(await this.list(projectId))[0];if(!j)return null;if(resume&&!terminal.has(j.state))this.enqueue(await this.load(j.id));return j;
 }
 async image(id,preview=false){const j=await this.load(id);if(!preview&&j.state!=='READY')throw Error('效果图尚未生成');return fs.readFile(path.join(this.dir(id),preview?'preview.png':'result.png'));}
}
