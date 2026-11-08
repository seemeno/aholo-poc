import {localDrafts,createDraftWriter} from './local_drafts.mjs';
export function createPhotoDraftUI({form,read,apply,hasContent}){
 const banner=document.createElement('div');banner.className='local-draft-banner';banner.hidden=true;
 banner.innerHTML='<p role="status">这台设备上有尚未提交的内容。</p><button type="button" data-resume>继续上次填写</button><button type="button" data-fresh>开始新的</button>';
 form.before(banner);const status=document.createElement('p');status.className='local-draft-status';status.setAttribute('role','status');form.querySelector('.form-bottom').prepend(status);
 const sessions=new Map();let current=null,blocked=false,token=0;
 const showStatus=state=>{status.textContent=state==='pending'?'正在暂存到本机…':state==='saved'?'未提交内容已暂存在本机，回来可以继续。':state==='error'?'本机暂存未完成，离开前请点击保存草稿。':'';};
 async function switchTo(context){
  if(current)current.writer.flush().catch(()=>{});const generation=++token,key='room:'+context;
  if(!sessions.has(key)){let session;const writer=createDraftWriter(localDrafts,key,{onStatus:state=>{if(current===session){showStatus(state);if(state==='saved'&&hasContent(writer.current()))localDrafts.set('last-room-draft',{key,context,name:writer.current().name}).then(()=>window.dispatchEvent(new Event('local-drafts-updated'))).catch(()=>{});}}});session={key,writer};sessions.set(key,session);}
  const session=sessions.get(key);current=session;blocked=true;form.inert=true;form.hidden=false;banner.hidden=true;status.textContent='正在检查本机草稿…';
  try{
   const value=session.writer.pending()?session.writer.current():await localDrafts.get(key);if(token!==generation)return;
   if(value&&hasContent(value)){
    banner.hidden=false;form.hidden=true;status.textContent='';
    banner.querySelector('[data-resume]').onclick=async()=>{banner.querySelectorAll('button').forEach(b=>b.disabled=true);try{await apply(value);if(token!==generation)return;blocked=false;form.inert=false;form.hidden=false;banner.hidden=true;showStatus('saved');}catch(e){status.textContent='暂时无法恢复：'+e.message;form.inert=false;form.hidden=false;blocked=false;}finally{banner.querySelectorAll('button').forEach(b=>b.disabled=false);}};
    banner.querySelector('[data-fresh]').onclick=async()=>{await session.writer.clear().catch(()=>showStatus('error'));if(token!==generation)return;blocked=false;form.inert=false;form.hidden=false;banner.hidden=true;status.textContent='';};
   }else{blocked=false;form.inert=false;form.hidden=false;status.textContent='';}
  }catch{if(token===generation){blocked=false;form.inert=false;form.hidden=false;showStatus('error');}}
 }
 function schedule(){if(current&&!blocked)current.writer.schedule(read());}
 window.addEventListener('beforeunload',e=>{if([...sessions.values()].some(s=>s.writer.pending())){e.preventDefault();e.returnValue='';}});
 window.addEventListener('pagehide',()=>{for(const s of sessions.values())s.writer.flush().catch(()=>{});});
 return {switchTo,schedule,leave(){const session=current;current=null;blocked=true;++token;session?.writer.flush().catch(()=>{});},async flush(){schedule();await current?.writer.flush();},async clear(){const session=current;current=null;blocked=false;++token;form.inert=false;form.hidden=false;banner.hidden=true;status.textContent='';await session?.writer.clear();const last=await localDrafts.get('last-room-draft');if(last?.key===session?.key)await localDrafts.remove('last-room-draft');window.dispatchEvent(new Event('local-drafts-updated'));}};
}
