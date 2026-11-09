import {getDeployment,serviceText} from './deployment_ui.mjs';
export class RequestError extends Error{
 constructor(message,{kind='request',status=0}={}){super(message);this.kind=kind;this.status=status;}
}
export async function requestJson(url,{body,rawBody,headers={},method=body===undefined&&rawBody===undefined?'GET':'POST',timeoutMs=20000}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  let response;try{response=await fetch(url,{method,signal:controller.signal,headers:{...headers,...(rawBody!==undefined?{'Content-Type':'application/octet-stream'}:body===undefined?{}:{'Content-Type':'application/json'})},...(rawBody!==undefined?{body:rawBody}:body===undefined?{}:{body:JSON.stringify(body)})});}
  catch(e){throw new RequestError(controller.signal.aborted?'连接等待较久，请重试。':serviceText('暂时无法连接电脑。'),{kind:controller.signal.aborted?'timeout':'network'});}
  let value;try{value=await response.json();}catch{if(response.ok)throw new RequestError('返回内容暂时无法读取，请重试。',{kind:'response',status:response.status});}
  if(!response.ok)throw new RequestError(value?.error??'本次请求未完成，请重试。',{status:response.status,kind:response.status===401?'auth':response.status===404?'missing':response.status===409?'conflict':response.status>=500?'server':'validation'});
  return value;
 }finally{clearTimeout(timer);}
}
export function issuePresentation(error,scope='内容'){
 const kind=error?.kind??'request';
 if(getDeployment().deployment==='modelscope'){
  if(kind==='auth')return {global:true,auth:false,text:'创空间访问暂时受限，请刷新应用页面后重试。',action:'重新连接'};
  if(kind==='network'||kind==='timeout')return {global:true,auth:false,text:'服务连接暂时中断，已填写内容会保留；若创空间正在唤醒，请稍后重试。',action:'重新连接'};
 }
 if(kind==='auth')return {global:true,auth:true,text:'手机配对已失效，重新配对后可以继续。',action:'重新配对'};
 if(kind==='network'||kind==='timeout')return {global:true,auth:false,text:'电脑连接暂时中断，已填写的内容会保留。',action:'重新连接'};
 return {global:false,auth:false,text:kind==='missing'?scope+'暂时不可用，请检查最近删除或返回空间列表。':scope+'暂时未能读取，可重试这一项。',action:'重试这一项'};
}
export const pairingUrl=()=>'/pair?next='+encodeURIComponent(location.pathname+location.search+location.hash);
export const humanMessage=error=>/AHOLO_API_KEY|密钥未配置/.test(error?.message??'')?'电脑暂未启用生成服务，请在电脑端完成配置后再继续。':error?.message??'本次操作未完成，请重试。';
