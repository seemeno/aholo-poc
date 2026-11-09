import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {api,unwrap,sanitize} from './api_client.mjs';
import {uploadAsset} from './asset_upload.mjs';
import {structureGlb} from './structure_mesh.mjs';
import {validateScene} from './scene_state.mjs';
import {LocalObjectAssets} from './local_object_assets.mjs';
import {writeJsonAtomic} from './file_storage.mjs';
import {findPython} from './python_runtime.mjs';
import {dataDirectory} from './runtime_config.mjs';
import {showcaseAvailable,openShowcase} from './showcase.mjs';
const exec=promisify(execFile),idPattern=/^[a-f0-9-]{36}$/;
const sceneSavesByRoot=new Map();
export class LocalProjects{
 constructor(root,{callApi=api,transfer=uploadAsset,pollMs=8000,dataDir=dataDirectory(root)}={}){this.root=root;this.base=path.join(dataDir,'projects');this.callApi=callApi;this.transfer=transfer;this.pollMs=pollMs;this.busy=new Set();this.draftUpdating=new Set();this.uploading=new Set();const key=path.resolve(this.base);if(!sceneSavesByRoot.has(key))sceneSavesByRoot.set(key,new Set());this.sceneSaving=sceneSavesByRoot.get(key);this.keyPromise=null;}
 dir(id){if(!idPattern.test(id))throw Error('项目 ID 无效');return path.join(this.base,id);}
 deletedFile(id){this.dir(id);return path.join(this.base,'.deleted',id+'.json');}
 async loadRecord(id){return JSON.parse(await fs.readFile(path.join(this.dir(id),'project.json'),'utf8'));}
 async load(id){try{await fs.access(this.deletedFile(id));}catch(e){if(e.code==='ENOENT')return this.loadRecord(id);throw e;}throw Object.assign(Error('空间已移到最近删除，请先恢复后再打开。'),{code:'ENOENT'});}
 async deleted(){let files;try{files=await fs.readdir(path.join(this.base,'.deleted'));}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];for(const file of files.filter(f=>idPattern.test(f.slice(0,-5))&&f.endsWith('.json'))){const id=file.slice(0,-5);try{const [p,record]=await Promise.all([this.loadRecord(id),fs.readFile(this.deletedFile(id),'utf8').then(JSON.parse)]);result.push({...this.public(p),deletedAt:record.deletedAt});}catch(e){if(e.code!=='ENOENT')throw e;}}return result.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));}
 async remove(id){
  if(this.busy.has(id)||this.draftUpdating.has(id)||this.uploading.has(id)||this.sceneSaving.has(id))throw Object.assign(Error('空间正在处理或保存，请完成后再删除。'),{statusCode:409});
  const p=await this.load(id);if(['QUEUED','UPLOADING','WAITING','DOWNLOADING','EXTRACTING'].includes(p.status))throw Object.assign(Error('空间正在生成或处理，请完成后再删除。'),{statusCode:409});
  const record={id,deletedAt:new Date().toISOString()};await fs.mkdir(path.dirname(this.deletedFile(id)),{recursive:true});await writeJsonAtomic(this.deletedFile(id),record);return {ok:true,...record};
 }
 async restore(id){await fs.readFile(this.deletedFile(id),'utf8');const p=await this.loadRecord(id);await fs.unlink(this.deletedFile(id));return this.public(p);}
 async save(p){p.updatedAt=new Date(Math.max(Date.now(),(Date.parse(p.updatedAt)||0)+1)).toISOString();await writeJsonAtomic(path.join(this.dir(p.id),'project.json'),sanitize(p));return p;}
 public(p){return {id:p.id,name:p.name,mode:p.mode,experience:p.experience??'standard',showcaseVersion:p.showcaseVersion??null,quickTryOnJobId:p.quickTryOnJobId??null,status:p.status,processing:this.busy.has(p.id),message:p.message,worldId:p.worldId??null,prompt:p.prompt,createdAt:p.createdAt,updatedAt:p.updatedAt,counts:p.counts??null,error:p.error??null,upAxis:p.upAxis??'Z',uploads:p.uploads.map(({id,name,kind,size,check,sha256})=>({id,name,kind,size,check,sha256})),sceneAttempts:(p.sceneAttempts??[]).map(({id,archivedAt,status,worldId,error})=>({id,archivedAt,status,worldId,error})),editorUrl:`/structure_editor.html?project=${p.id}`,hasScene:!!p.hasScene};}
 async visit(id){await this.load(id);const lastOpenedAt=new Date().toISOString();await writeJsonAtomic(path.join(this.dir(id),'last_visit.json'),{lastOpenedAt});return {ok:true,lastOpenedAt};}
 async list(){await fs.mkdir(this.base,{recursive:true});const out=[];for(const id of await fs.readdir(this.base)){if(!idPattern.test(id))continue;try{const p=this.public(await this.load(id));let opened;try{opened=JSON.parse(await fs.readFile(path.join(this.dir(id),'last_visit.json'),'utf8')).lastOpenedAt;}catch{}p.lastUsedAt=[p.createdAt,p.updatedAt,opened].filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))).sort().at(-1)??p.createdAt;out.push(p);}catch{}}return out.sort((a,b)=>b.lastUsedAt.localeCompare(a.lastUsedAt)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));}
 async create(body){if(body.experience!==undefined&&!['quick-try-on','standard'].includes(body.experience))throw Error('体验类型无效');if(!['generation','reconstruction','ply'].includes(body.mode??'generation'))throw Error('选择 AI 生成、实景重建或 PLY 导入');const p={id:crypto.randomUUID(),name:String(body.name??'我的空间').trim().slice(0,100)||'我的空间',mode:body.mode??'generation',experience:body.experience??'standard',prompt:String(body.prompt??'').trim().slice(0,4000),status:'DRAFT',message:'选择素材后开始处理',uploads:[],createdAt:new Date().toISOString()};await fs.mkdir(path.join(this.dir(p.id),'inputs'),{recursive:true});return this.save(p);}
 async updateDraft(id,body){if(this.draftUpdating.has(id))throw Object.assign(Error('草稿正在另一处更新，请刷新后重试。'),{statusCode:409});this.draftUpdating.add(id);try{const p=await this.load(id);if(p.status!=='DRAFT'||this.busy.has(id)||this.uploading.has(id))throw Object.assign(Error('空间已开始处理，不能再修改生成前的照片说明。'),{statusCode:409});if(body.version!==p.updatedAt)throw Object.assign(Error('草稿已在另一处变化，请返回空间查看最新内容。'),{statusCode:409});if(body.quickTryOnJobId!==undefined){if(p.experience!=='quick-try-on')throw Error('此项目不支持首次试摆任务');await this.validateQuickJob(id,body.quickTryOnJobId);if(p.quickTryOnJobId&&p.quickTryOnJobId!==body.quickTryOnJobId)throw Error('首次物品任务不能更换');p.quickTryOnJobId=body.quickTryOnJobId;}p.name=String(body.name??p.name).trim().slice(0,100)||'我的空间';p.prompt=String(body.prompt??p.prompt).trim().slice(0,4000);await this.save(p);return this.public(p);}finally{this.draftUpdating.delete(id);}}
 async validateQuickJob(id,jobId){if(!/^[a-f0-9]{64}$/.test(jobId??''))throw Error('首次物品任务无效');let job;try{const lines=(await fs.readFile(path.join(this.dir(id),'object-generations',jobId,'job.ndjson'),'utf8')).trim().split('\n');job=JSON.parse(lines.at(-1));}catch{throw Error('首次物品任务不属于当前项目');}if(job.projectId!==id||job.id!==jobId||!['furniture','decor'].includes(job.category))throw Error('首次物品任务不属于当前项目或不是落地物品');return job;}
 async python(){return this.pythonPromise??=findPython();}
 async py(script,args,timeout=120000){const result=await exec(await this.python(),[path.join(this.root,'offline_runner.py'),path.join(this.root,script),...args],{cwd:this.root,windowsHide:true,timeout,maxBuffer:2*1024*1024,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',OPENBLAS_NUM_THREADS:'2'}});return JSON.parse(result.stdout.trim());}
 async key(){if(process.env.AHOLO_API_KEY)return true;if(!this.keyPromise)this.keyPromise=(async()=>{if(process.platform==='win32'){const r=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetEnvironmentVariable('AHOLO_API_KEY','User')"],{windowsHide:true,timeout:10000});if(r.stdout.trim())process.env.AHOLO_API_KEY=r.stdout.trim();}return !!process.env.AHOLO_API_KEY;})();return this.keyPromise;}
 async doctor(){let python=false,runtime={};try{await this.python();python=true;runtime=await this.py('runtime_check.py',[],15000);}catch{}return {apiKeyConfigured:await this.key(),pythonAvailable:python,geometryAvailable:runtime.numpy?.available===true,mediaChecksAvailable:runtime.cv2?.available===true,runtime,storage:'local-data/projects',structureMethod:'LOCAL_GEOMETRY_NO_LLM',remoteCompute:'AHOLO World + Lux3D; optional personal ModelScope image inference',localProcessingNetwork:'DENIED_BY_PYTHON_AUDIT_HOOK'};}
 async upload(id,req,name,{replaceRoom=false,version}={}){
  if(this.draftUpdating.has(id))throw Object.assign(Error('草稿正在更新，请完成后再上传。'),{statusCode:409});if(this.uploading.has(id))throw Error('当前项目有文件正在检查，请等待完成');this.uploading.add(id);try{
  const p=await this.load(id);
  if(replaceRoom){
   if(p.mode!=='generation'||!['FAILED','DRAFT'].includes(p.status)||this.busy.has(id)||this.sceneSaving.has(id))throw Object.assign(Error('只能在生成失败或待提交时替换场景图片；正在处理或结果不明的任务请先核对。'),{statusCode:409});
   if(!version||version!==p.updatedAt)throw Object.assign(Error('项目已发生变化，请刷新后重新选择场景图片。'),{statusCode:409});
  }else if(p.status!=='DRAFT'||this.busy.has(id))throw Error('处理已开始，不能再替换素材');
  const ext=path.extname(name).toLowerCase(),image=['.jpg','.jpeg','.png','.webp'].includes(ext),video=['.mp4','.mov'].includes(ext),kind=image?'image':video?'video':ext==='.ply'?'ply':null;if(!kind)throw Error('支持 JPG/PNG/WebP、MP4/MOV、PLY');
  if(replaceRoom&&!image)throw Error('请选择一张 JPG、PNG 或 WebP 场景图片');
  const max=video?1024**3:kind==='ply'?500*1024**2:30*1024**2;
  if(Number(req.headers['content-length'])>max)throw Error('文件超过本地 demo 限制（图片 30MB、视频 1GB、PLY 500MB）');
  if(p.uploads.length>=100)throw Error('每个项目最多 100 个素材');
  const uploadId=crypto.randomUUID(),file=uploadId+ext,target=path.join(this.dir(id),'inputs',file),handle=await fs.open(target,'wx'),sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');let size=0,header=Buffer.alloc(0);
  try{for await(const part of req){size+=part.length;if(size>max)throw Error('文件过大');if(header.length<16)header=Buffer.concat([header,part]).subarray(0,16);sha.update(part);md5.update(part);await handle.write(part);}await handle.close();if(size<16)throw Error('文件为空或损坏');
   const signature=image?(ext==='.png'?header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.webp'?header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP':header[0]===255&&header[1]===216):video?['ftyp','moov','mdat','wide'].includes(header.toString('ascii',4,8)):header.toString('ascii',0,3)==='ply';if(!signature)throw Error('文件内容与扩展名不匹配');
   const hash=sha.digest('hex');if(!replaceRoom&&p.uploads.some(u=>u.sha256===hash)){await fs.unlink(target);return {duplicate:true,project:this.public(p)};}
   const check=kind==='ply'?{kind:'ply',warnings:[]}:await this.py('media_check.py',[target],60000);
   const uploaded={id:uploadId,file,name:path.win32.basename(path.posix.basename(name)).slice(0,150),kind,size,sha256:hash,md5:md5.digest('hex'),check};
   if(replaceRoom)await this.replaceRoom(p,uploaded);else{p.uploads.push(uploaded);await this.save(p);}return {duplicate:false,project:this.public(p)};
  }catch(e){try{await handle.close();}catch{}try{await fs.unlink(target);}catch{}throw Error(e.killed?'本地素材检查超时':e.message.includes('Command failed')?'无法解码素材，请使用未损坏的标准格式':e.message);}
  }finally{this.uploading.delete(id);}
 }
 async replaceRoom(p,uploaded){
  // The new image is fully received and decoded before touching the old attempt.
  // Keep source files and object jobs; archive room outputs before resetting only
  // the room task. Roll back moves if the atomic metadata commit fails.
  const attempt={id:crypto.randomUUID(),archivedAt:new Date().toISOString(),status:p.status,worldId:p.worldId??null,error:p.error??null};
  const dir=this.dir(p.id),archive=path.join(dir,'scene-attempts',attempt.id),moved=[];
  await fs.mkdir(archive,{recursive:true});await writeJsonAtomic(path.join(archive,'project.json'),sanitize(p));
  const old={...p};
  try{
   for(const name of ['submit_response.json','world_latest.json','extraction_error.log','room.ply','room.ply.part','cover.jpg','structure.json','structure.glb','point_preview.json','placement.json','placement.json.bak','user_structure.glb']){
    try{await fs.rename(path.join(dir,name),path.join(archive,name));moved.push(name);}catch(e){if(e.code!=='ENOENT')throw e;}
   }
   p.sceneAttempts=[...(p.sceneAttempts??[]),attempt];p.uploads=[uploaded];p.status='DRAFT';p.message='新场景图片已保存，请确认后重新生成；已有物品已保留';p.hasScene=false;
   for(const key of ['worldId','submission','remoteStatus','error','counts','upAxis'])delete p[key];
   await this.save(p);
  }catch(e){for(const key of Object.keys(p))delete p[key];Object.assign(p,old);for(const name of moved.reverse())await fs.rename(path.join(archive,name),path.join(dir,name));throw e;}
 }
 validateStart(p,options={}){
  const images=p.uploads.filter(u=>u.kind==='image'),videos=p.uploads.filter(u=>u.kind==='video'),ply=p.uploads.filter(u=>u.kind==='ply');
  if(p.mode==='generation'&&(images.length>1||videos.length||ply.length||(!p.prompt&&!images.length)))throw Error('AI 生成需要文字或一张参考图；视频请使用实景重建');
  if(p.mode==='reconstruction'){
   if(ply.length||!((videos.length===1&&images.length===0)||(images.length>=20&&videos.length===0)))throw Error('实景重建需要一段视频，或至少 20 张不重复照片，不能混传');
   const checklist=['staticScene','movingCamera','overlap','coverage','stableExposure'];if(!checklist.every(k=>options.captureChecklist?.[k]===true))throw Error('请确认全部拍摄要求后再提交实景重建');
   if(p.uploads.some(u=>u.check?.warnings?.length)&&options.ackWarnings!==true)throw Error('素材存在质量提示，请查看并确认后继续');
  }
  if(p.mode==='ply'&&(ply.length!==1||images.length||videos.length))throw Error('请选择一个已有 PLY 场景');
 }
 async start(id,options={}){
  if(this.draftUpdating.has(id))throw Object.assign(Error('草稿正在更新，请完成后再生成。'),{statusCode:409});if(this.uploading.has(id))throw Error('请等待素材上传与检查完成');if(this.sceneSaving.has(id))throw Error('请等待摆放保存完成');
  if(this.busy.has(id))return this.public(await this.load(id));
  // Claim synchronously before any filesystem or keychain await so parallel tabs
  // cannot both pass preflight and race while writing project.json.tmp.
  this.busy.add(id);let handedToRun=false;
  try{
   const p=await this.load(id);
   if(p.status==='SUBMIT_UNKNOWN')throw Error('上次提交结果不明，请用已有 World ID 恢复，避免重复扣费');
   if(p.status==='READY')return this.public(p);
   if(!p.worldId){if(p.status==='FAILED'&&!p.submission)p.status='DRAFT';if(p.status!=='DRAFT')throw Error('该项目不能再次提交；请查看错误或恢复已有 World ID');this.validateStart(p,options);if(p.experience==='quick-try-on'){if(!p.quickTryOnJobId)throw Error('请先添加一件落地物品，再开始试摆');await this.validateQuickJob(id,p.quickTryOnJobId);}if(p.mode!=='ply'&&!await this.key())throw Error('请先在本机配置 AHOLO_API_KEY，然后重启本地 demo');}
   p.status=p.worldId?'WAITING':'QUEUED';p.message=p.worldId?'继续查询既有任务':'准备处理素材';p.error=null;await this.save(p);
   handedToRun=true;this.run(id).catch(()=>{}).finally(()=>this.busy.delete(id));return this.public(p);
  }finally{if(!handedToRun)this.busy.delete(id);}
 }
 async download(url,target){const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)(aholo3d\.cn|kujiale\.com)$/.test(u.hostname))throw Error('服务返回了未核对的场景下载域名');const r=await fetch(u,{signal:AbortSignal.timeout(180000),redirect:'error'});if(!r.ok)throw Error(`场景下载 HTTP ${r.status}`);const file=await fs.open(target+'.part','w');let count=0;try{for await(const bytes of r.body){count+=bytes.length;if(count>1024**3)throw Error('场景文件超过 1GB');await file.write(bytes);}}finally{await file.close();}await fs.rename(target+'.part',target);return count;}
 async extract(p){p.status='EXTRACTING';p.message='本地计算地面与墙面候选（无 LLM）';await this.save(p);const dir=this.dir(p.id);let result;try{result=await this.py('local_geometry.py',['--input',path.join(dir,'room.ply'),'--out',dir,'--world',p.worldId??`local-${p.id}`,'--up',p.upAxis??'Z']);}catch(e){await fs.writeFile(path.join(dir,'extraction_error.log'),sanitize(e.stderr??e.message));throw Error(e.killed?'本地结构提取超时；请缩小场景后重试。':'未能提取可靠结构，请检查 PLY 和源向上轴；技术详情见本机 extraction_error.log。');}const s=JSON.parse(await fs.readFile(path.join(dir,'structure.json'),'utf8'));await fs.writeFile(path.join(dir,'structure.glb'),structureGlb(s));p.counts=result;p.status='READY';p.message=`已提取 ${result.floor} 个地面、${result.walls} 段墙候选；可进入编辑器核对与摆放`;await this.save(p);}
 async run(id){let p=await this.load(id);try{
  const dir=this.dir(id);
  if(p.mode==='ply'){if(p.uploads[0])await fs.copyFile(path.join(dir,'inputs',p.uploads[0].file),path.join(dir,'room.ply'));else await fs.access(path.join(dir,'room.ply'));p.worldId??=`local-${id}`;await this.extract(p);return;}
  await this.key();
  if(!p.worldId){p.status='UPLOADING';p.message='上传素材到 AHOLO 计算服务';await this.save(p);
   for(const u of p.uploads){if(!u.remoteUrl){u.remoteUrl=await this.transfer(path.join(dir,'inputs',u.file),{md5:u.md5,name:u.name,size:u.size});await this.save(p);}}
   const body=p.mode==='generation'?{name:p.name,...(p.prompt?{prompt:p.prompt}:{}),...(p.uploads.length?{resources:p.uploads.map(u=>({url:u.remoteUrl,type:'image'}))}:{})}:{name:p.name,scene:'space',taskQuality:'high',resources:p.uploads.map(u=>({url:u.remoteUrl,type:u.kind}))};
   p.status='SUBMIT_UNKNOWN';p.message='正在提交；如连接中断将保留记录，不自动重复扣费';p.submission={at:new Date().toISOString(),sha256:crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')};await this.save(p);
   const r=await this.callApi(p.mode==='generation'?'/world/v1/generations':'/world/v1/reconstructions',body);await fs.writeFile(path.join(dir,'submit_response.json'),JSON.stringify(sanitize(r),null,2));
   if(!r.ok){p.status='FAILED';throw Error(`AHOLO 拒绝提交 HTTP ${r.http}：${r.body.message??r.body.m??'请检查素材和账号额度'}`);}
   const d=unwrap(r.body);if(!d.worldId)throw Error('服务未返回 World ID，需核对账号任务后恢复');p.worldId=String(d.worldId);p.status='WAITING';await this.save(p);
  }
  for(let i=0;i<180;i++){
   const r=await this.callApi('/world/v1/'+encodeURIComponent(p.worldId));await fs.writeFile(path.join(dir,'world_latest.json'),JSON.stringify(sanitize(r),null,2));if(!r.ok)throw Error(`查询任务 HTTP ${r.http}，已有 World ID 已保留`);const world=unwrap(r.body);p.remoteStatus=world.status;
   if(world.status==='SUCCEEDED'){
    const url=world.assets?.splats?.urls?.plyPath;if(!url)throw Error('任务成功但没有返回 PLY');p.status='DOWNLOADING';p.message='下载真实三维场景到本机';p.upAxis=world.assets?.semanticsMetadata?.upAxis==='Y'?'Y':'Z';await this.save(p);await this.download(url,path.join(dir,'room.ply'));
    const pano=world.assets?.imagery?.panoUrl;if(pano)try{await this.download(pano,path.join(dir,'cover.jpg'));}catch{}
    await this.extract(p);return;
   }
   if(['FAILED','CANCELED','TIMEOUT','REJECTED'].includes(world.status)){p.status='FAILED';throw Error(`AHOLO 任务 ${world.status}。请核查拍摄素材/服务错误；不会自动重提。`);}
   p.status='WAITING';p.message=`AHOLO ${world.status}，可关闭页面，稍后继续查询`;await this.save(p);await new Promise(r=>setTimeout(r,Math.min(20000,this.pollMs+Math.floor(i/6)*1000)));
  }
  p.status='PAUSED';p.message='等待时间较长，World ID 已保存，点击继续查询即可';await this.save(p);
 }catch(e){p.error=sanitize(e.message);if(p.status!=='SUBMIT_UNKNOWN')p.status=p.worldId&&p.status!=='FAILED'?'PAUSED':'FAILED';p.message=p.status==='SUBMIT_UNKNOWN'?'提交结果不明，请恢复已有 World ID，禁止盲目重提':p.error;await this.save(p);}finally{this.busy.delete(id);}}
 async reextract(id,up){if(this.busy.has(id)||this.sceneSaving.has(id))throw Error('项目正在处理');const p=await this.load(id);if(!['Y','Z'].includes(up))throw Error('请选择 Y 或 Z 为源坐标向上轴');await fs.access(path.join(this.dir(id),'room.ply'));this.busy.add(id);p.upAxis=up;p.error=null;try{await this.extract(p);}catch(e){p.status='PAUSED';p.error=e.message;p.message='结构提取失败，可调整向上轴后重试：'+e.message;await this.save(p);}finally{this.busy.delete(id);}return this.public(p);}
 async recover(id,worldId){if(this.busy.has(id))throw Error('项目正在处理');if(!/^[A-Za-z0-9_-]{5,80}$/.test(worldId))throw Error('World ID 无效');await this.key();const r=await this.callApi('/world/v1/'+encodeURIComponent(worldId));if(!r.ok)throw Error('无法读取该 World，请检查 ID/密钥');const p=await this.load(id);if(p.worldId&&p.worldId!==worldId)throw Error('已有 World ID 不能更换');p.worldId=worldId;p.status='PAUSED';await this.save(p);return this.start(id);}
 async example(){if(await showcaseAvailable(this.root))return openShowcase(this);const source=path.join(this.root,'assets/demo/room.ply');try{await fs.access(source);}catch(e){if(e.code!=='ENOENT')throw e;throw Error('此电脑未安装可选示例素材，请先上传自己的房间照片。');}const existing=(await this.list()).find(p=>p.name==='示例客厅 · 本地算法');if(existing)return existing;const p=await this.create({name:'示例客厅 · 本地算法',mode:'ply'});p.worldId='3FO4K4RIGVTB';p.upAxis='Z';p.provenance='Reused existing AI World; no new cloud task';await fs.copyFile(source,path.join(this.dir(p.id),'room.ply'));await this.extract(p);return this.public(p);}
 async scene(id,value){
  await this.load(id);const target=path.join(this.dir(id),'placement.json');
  if(value===undefined)return JSON.parse(await fs.readFile(target,'utf8'));
  if(this.busy.has(id)||this.sceneSaving.has(id))throw Object.assign(Error('项目正在处理或保存，请稍后再保存'),{statusCode:409});
  this.sceneSaving.add(id);
  try{
   let previous=null;try{previous=JSON.parse(await fs.readFile(target,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(Object.hasOwn(value,'expectedSavedAt')&&value.expectedSavedAt!==(previous?.savedAt??null))throw Object.assign(Error('另一台设备已保存此空间。当前修改未覆盖，请先导出布局，再重新载入已保存方案。'),{statusCode:409});
   const p=await this.load(id),scene=validateScene({...value});delete scene.expectedSavedAt;
   if(scene.worldId!==p.worldId||scene.projectId!==id)throw Error('摆放文件不属于此项目');
   if(scene.tryOn){if(p.experience!=='quick-try-on'||scene.tryOn.jobId!==p.quickTryOnJobId)throw Error('首次试摆任务不属于当前项目');await this.validateQuickJob(id,scene.tryOn.jobId);}
   await new LocalObjectAssets(this).validateReferences(id,scene);
   try{await fs.copyFile(target,target+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}
   scene.kind='user_saved';scene.savedAt=new Date(Math.max(Date.now(),(Date.parse(previous?.savedAt)||0)+1)).toISOString();
   await writeJsonAtomic(target,scene);await fs.writeFile(path.join(this.dir(id),'user_structure.glb'),structureGlb(scene.structure,{floorOnly:true}));p.hasScene=true;await this.save(p);return {ok:true,savedAt:scene.savedAt};
  }finally{this.sceneSaving.delete(id);}
 }
}
