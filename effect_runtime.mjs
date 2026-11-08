import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {effectWorkflow} from './effect_workflow.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class EffectRuntime{
 constructor(root,{request=(...args)=>fetch(...args),pollMs=2000,maxWaitMs=20*60*1000}={}){this.root=root;this.request=request;this.pollMs=pollMs;this.maxWaitMs=maxWaitMs;this.url='http://127.0.0.1:8190';this.starting=null;}
 async call(endpoint,options={}){return this.request(this.url+endpoint,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}
 async json(endpoint,options={}){const response=await this.call(endpoint,options);const value=await response.json();if(!response.ok)throw Error(`本机渲染服务返回 ${response.status}`);return value;}
 async health(){try{await this.json('/system_stats');return true;}catch{return false;}}
 async ensure(){
  if(!await this.health()){
   if(!this.starting)this.starting=(async()=>{
    const script=path.join(this.root,'scripts/start-local-ai.ps1');
    try{await fs.access(script);await fs.access(path.join(this.root,'runtime/flux/venv/Scripts/python.exe'));await fs.access(path.join(this.root,'runtime/flux/ComfyUI/main.py'));}catch{throw Error('本机尚未安装效果图模型，请按 docs/FLUX_EFFECT_RENDER.md 配置 runtime/flux');}
    const child=spawn('pwsh.exe',['-NoProfile','-File',script],{cwd:this.root,windowsHide:true,stdio:'ignore'});
    let launchError;child.on('error',e=>{launchError=e;});child.unref();
    for(let i=0;i<90;i++){if(launchError)throw Error('无法启动本机效果图服务');if(await this.health())return;await sleep(1000);}
    throw Error('本机效果图服务启动超时，请检查电脑上的运行日志');
   })().finally(()=>{this.starting=null;});
   await this.starting;
  }
  for(const [node,key,file] of [['UNETLoader','unet_name','flux-2-klein-4b-fp8.safetensors'],['CLIPLoader','clip_name','qwen_3_4b.safetensors'],['VAELoader','vae_name','flux2-vae.safetensors']]){
   const info=await this.json('/object_info/'+node);
   if(!info[node]?.input?.required?.[key]?.[0]?.includes(file))throw Error('本机效果图模型不完整，请在电脑上检查模型安装');
  }
 }
 async upload(bytes,name,mime='image/png'){
  const form=new FormData();form.append('image',new Blob([bytes],{type:mime}),name);form.append('overwrite','true');
  const result=await this.json('/upload/image',{method:'POST',body:form});
  if(result.name!==name||result.subfolder)throw Error('本机渲染服务返回了异常的输入文件名');
  return name;
 }
 async submit(job,image,references,beforeSubmit){
  const input=await this.upload(image,`space-${job.id}-input.png`);
  const refs=[];
  for(let i=0;i<references.length;i++){const r=references[i];refs.push({label:r.label,image:await this.upload(r.bytes,`space-${job.id}-ref-${i}${r.ext}`,r.mime)});}
  const graph=effectWorkflow({image:input,references:refs,width:job.width,height:job.height,seed:job.seed,prefix:'space-'+job.id});
  // Durable intent is saved BEFORE sending. A missing response must never silently re-submit.
  await beforeSubmit(graph);
  const result=await this.json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:job.id})});
  if(!/^[a-f0-9-]{36}$/.test(result.prompt_id??''))throw Error('本机渲染服务没有返回任务编号');
  return result.prompt_id;
 }
 async reconcile(id){
  const queue=await this.json('/queue');
  for(const entry of [...queue.queue_running??[],...queue.queue_pending??[]])if(entry[3]?.client_id===id)return entry[1];
  const history=await this.json('/history?max_items=100');
  return Object.entries(history).find(([,value])=>value.prompt?.[3]?.client_id===id)?.[0]??null;
 }
 async wait(job,update){
  const started=Date.now();let missing=0;
  while(Date.now()-started<this.maxWaitMs){
   const history=await this.json('/history/'+job.promptId),result=history[job.promptId];
   if(result){
    if(result.status?.status_str!=='success')throw Error('本机生成失败，可能是显存不足；请关闭其他占用显卡的程序后重试');
    const output=result.outputs?.['21']?.images?.[0];
    if(!output||output.type!=='output'||output.subfolder||!new RegExp('^space-'+job.id+'_[0-9]+_\\.png$').test(output.filename))throw Error('本机渲染输出不符合预期');
    const response=await this.call('/view?'+new URLSearchParams({filename:output.filename,type:'output'}));
    if(!response.ok)throw Error('效果图下载失败');
    if(Number(response.headers.get('content-length'))>12*1024**2)throw Error('效果图超过文件限制');
    const parts=[];let length=0;for await(const part of response.body){length+=part.length;if(length>12*1024**2)throw Error('效果图超过文件限制');parts.push(part);}
    return Buffer.concat(parts);
   }
   const queue=await this.json('/queue');
   const pending=(queue.queue_pending??[]).some(e=>e[1]===job.promptId);
   const running=(queue.queue_running??[]).some(e=>e[1]===job.promptId);
   missing=pending||running?0:missing+1;
   if(missing>=3&&Date.now()-Date.parse(job.createdAt??new Date(started).toISOString())>30000){const error=Error('电脑推理服务已重启，原任务记录无法恢复；未自动重复提交，请按当前摆放重新生成');error.unknown=true;throw error;}
   await update(pending?'QUEUED':'GENERATING',pending?'正在等待电脑渲染':'正在生成效果图，首次加载通常需要几分钟');
   await sleep(this.pollMs);
  }
  const error=Error('生成仍在进行，可稍后回来查看');error.pending=true;throw error;
 }
 async release(){try{const queue=await this.json('/queue');if(!queue.queue_running?.length&&!queue.queue_pending?.length)await this.call('/free',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})});}catch{}}
}
