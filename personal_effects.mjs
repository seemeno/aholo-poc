import fs from 'node:fs/promises';
import path from 'node:path';
import {LocalEffectRenderer} from './effect_render.mjs';
import {ModelScopeRuntime,PERSONAL_RECIPE} from './modelscope_runtime.mjs';
const terminal=new Set(['READY','FAILED','SUBMIT_UNKNOWN']);
export class PersonalEffects extends LocalEffectRenderer{
 constructor(root,{projects,credentials,runtimeFactory}={}){super(root,{projects,runtime:{}});this.credentials=credentials;this.contexts=new Map();this.provider='modelscope';this.recipe=PERSONAL_RECIPE;this.runtimeFactory=runtimeFactory??(options=>new ModelScopeRuntime(options));}
 async start(body,context={}){if(body?.consent!==true)throw Object.assign(Error('请确认发送当前截图与参考图，并使用本人 ModelScope 额度'),{statusCode:400});const value=this.credentials.read(context.sessionId);return super.start(body,{sessionId:context.sessionId,credentialOwner:value.owner});}
 bindContext(j,context){const value=this.credentials.read(context.sessionId);if(j.credentialOwner!==value.owner)throw Object.assign(Error('此任务需要提交者原来的个人 Token；不会使用其他体验者额度'),{statusCode:403,credentialRequired:true});this.contexts.set(j.id,context.sessionId);}
 runtimeFor(j){
  const sessionId=this.contexts.get(j.id);return this.runtimeFactory({credential:()=>{const value=this.credentials.read(sessionId);if(value.owner!==j.credentialOwner)throw Object.assign(Error('请重新配置原任务的个人 Token'),{credentialRequired:true});return value.token;},normalize:async(bytes,job)=>{
   const input=path.join(this.dir(job.id),'provider-result.bin'),output=path.join(this.dir(job.id),'normalized.png');await fs.writeFile(input,bytes);const info=await this.projects.py('normalize_effect_image.py',['--input',input,'--output',output,'--width',String(job.width),'--height',String(job.height)]);job.outputLetterboxed=info.letterboxed;await this.save(job);return fs.readFile(output);
  }});
 }
 async list(projectId,context={}){const all=await super.list(projectId);let owner;try{owner=this.credentials.read(context.sessionId).owner;}catch{}const result=[];for(const pub of all){const j=await this.load(pub.id);if(pub.state==='READY'||j.credentialOwner&&j.credentialOwner===owner)result.push(pub);}return result;}
 async latest(projectId,resume=true,context={}){const j=(await this.list(projectId,context))[0];if(j&&resume&&!terminal.has(j.state))await this.get(j.id,context);return j;}
 async get(id,context={}){const j=await this.load(id);if(j.provider==='modelscope'&&!terminal.has(j.state)){
   if(!j.promptId&&!j.submitAttempted&&!this.pool.running.has(j.id))return {...this.public(j),state:'NEEDS_CONFIRMATION',message:'此任务尚未提交。请确认使用个人额度后再生成，配置 Token 本身不会提交。'};
   try{this.bindContext(j,context);this.enqueue(j);}catch(e){if(!e.credentialRequired)throw e;return {...this.public(j),state:'WAITING_CREDENTIALS',message:'配置提交者原 Token 后可继续查询原任务；不会重新扣费提交'};}
  }return this.public(j);}
 async run(j){try{await super.run(j);}finally{this.contexts.delete(j.id);}}
 public(j){return {...super.public(j),outputLetterboxed:!!j.outputLetterboxed};}
}
