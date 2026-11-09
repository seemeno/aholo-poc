const endpoint='https://api-inference.modelscope.cn';
export const PERSONAL_MODEL='Qwen/Qwen-Image-Edit-2511';
export const PERSONAL_RECIPE='modelscope-qwen-image-edit-2511-preserve-layout-v1';
export function modelScopeResultUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(/^[a-z0-9-]+\.oss-(?:cn|ap|eu|us|me)-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname)&&!/(?:internal|vpc)/.test(u.hostname)||u.hostname==='modelscope.cn'||u.hostname.endsWith('.modelscope.cn'));}catch{return false;}}
const prompt='将图1润色为真实室内照片。严格保留图1的相机、透视、房间布局、门窗、家具数量、位置、尺寸比例和朝向，仅统一自然光、材质质感和接触阴影。图2（如提供）仅用于保留图1中已摆家具的外形、门板、把手、腿脚和颜色，不要再添加一件。不要新增或删除家具、植物、装饰、门窗，不要文字水印。';
export class ModelScopeRuntime{
 constructor({credential,request=(...args)=>fetch(...args),pollMs=4000,maxWaitMs=12*60*1000,normalize}={}){this.credential=credential;this.request=request;this.pollMs=pollMs;this.maxWaitMs=maxWaitMs;this.normalize=normalize;}
 async ensure(){this.credential();}
 async call(path,options={}){
  const token=this.credential();let response;try{response=await this.request(endpoint+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers},redirect:'error',signal:AbortSignal.timeout(45000)});}catch(e){throw Object.assign(Error('ModelScope 连接中断，已保留任务记录'),{name:e.name});}
  if(!response.ok){const error=Error(response.status===401||response.status===403?'个人 Token 无效或账号尚无推理权限，请重新配置':response.status===429?'个人魔粒不足或服务限流，请查看个人额度后再操作':`ModelScope 服务返回 HTTP ${response.status}，请稍后查询`);if([401,403].includes(response.status))error.credentialRequired=true;if(response.status===429)error.rateLimited=true;throw error;}
  return response.json();
 }
 async submit(job,image,references,beforeSubmit){
  const payload={model:PERSONAL_MODEL,prompt,image_url:['data:image/png;base64,'+image.toString('base64'),...references.slice(0,1).map(r=>'data:'+r.mime+';base64,'+r.bytes.toString('base64'))],size:job.width+'x'+job.height,seed:job.seed};
  await beforeSubmit({provider:'modelscope',model:PERSONAL_MODEL,width:job.width,height:job.height,referenceCount:references.length});
  const result=await this.call('/v1/images/generations',{method:'POST',headers:{'Content-Type':'application/json','X-ModelScope-Async-Mode':'true'},body:JSON.stringify(payload)});
  if(typeof result.task_id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(result.task_id))throw Error('模型服务未返回可恢复的任务编号');return result.task_id;
 }
 async reconcile(){return null;}
 async wait(job,update){
  const start=Date.now();while(Date.now()-start<this.maxWaitMs){
   let result;try{result=await this.call('/v1/tasks/'+encodeURIComponent(job.promptId),{headers:{'X-ModelScope-Task-Type':'image_generation'}});}catch(e){if(e.rateLimited){e.pending=true;}throw e;}
   if(result.task_status==='SUCCEED'){
    const url=result.output_images?.[0];if(!modelScopeResultUrl(url))throw Error('模型返回了未获支持的结果域名，请核对服务配置；未重复提交');
    const response=await this.request(url,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Object.assign(Error('效果图下载暂未完成，可继续查询原任务'),{pending:true});
    const parts=[];let length=0;for await(const part of response.body){length+=part.length;if(length>20*1024**2)throw Error('模型结果超过 20 MB 限制');parts.push(part);}const bytes=Buffer.concat(parts);return this.normalize?await this.normalize(bytes,job):bytes;
   }
   if(['FAILED','CANCELED','CANCELLED'].includes(result.task_status))throw Error('ModelScope 图片生成未成功，请查看个人服务状态；不会自动重新提交');
   await update(result.task_status==='PENDING'?'QUEUED':'GENERATING',result.task_status==='PENDING'?'个人额度任务正在排队':'正在使用个人额度生成效果图');
   await new Promise(resolve=>setTimeout(resolve,this.pollMs));
  }
  throw Object.assign(Error('个人任务仍在处理，可稍后继续查询，不会自动重提'),{pending:true});
 }
 async release(){}
}
