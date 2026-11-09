import {escapeHtml as esc,objectJson,createObjectPhotoPicker,saveObjectPhotos} from './object_photos.mjs';
import {localDrafts,createDraftWriter,packItems,unpackItems} from './local_drafts.mjs';
import {continueObjectJobs} from './object_submission.mjs';
import {issuePresentation,pairingUrl,humanMessage} from './ui_network.mjs';
const busyStates=new Set(['QUEUED','UPLOADING','RUNNING','DOWNLOADING']);
const stateNames={DRAFT:'待生成',QUEUED:'准备中',UPLOADING:'准备中',RUNNING:'生成中',DOWNLOADING:'生成中',READY:'已就绪',PAUSED:'待继续',FAILED:'未完成',SUBMIT_UNKNOWN:'待核对'};
export function createObjectTaskList(container,{projectId,onAdd,onUpdate=()=>{},onNotify=()=>{},isPlaced=()=>false,heading='我的物品'}={}){
 let jobs=[],signature='',working=false;
 async function action(run){if(working)return;working=true;render(true);try{await run();await onUpdate();}catch(e){onNotify(e.message,true);}finally{working=false;render(true);}}
 function render(force=false){
  const key=JSON.stringify([jobs,working,jobs.map(j=>isPlaced(j.resultAssetId))]);if(!force&&signature===key)return;signature=key;
  const pending=jobs.filter(j=>j.state==='DRAFT');
  container.innerHTML=jobs.length?`<div class="object-task-heading"><h3>我的物品 <span>${jobs.filter(j=>j.state==='READY').length}/${jobs.length} 已就绪</span></h3>${pending.length?`<button type="button" data-start ${working?'disabled':''}>生成待处理物品（${pending.length}）</button>`:''}</div><div class="object-task-list">${jobs.map(j=>`<article class="object-task" data-job="${j.id}"><img src="${esc(j.sourceUrl)}" alt="${esc(j.name)}的参考照片" loading="lazy"><div class="object-task-copy"><div class="object-task-title"><strong>${esc(j.name)}</strong><span class="object-task-state" data-state="${j.state}">${stateNames[j.state]??esc(j.state)}</span></div><p>${esc(j.message)}</p>${j.category==='picture'?'<small>挂画图片</small>':'<small>三维'+(j.category==='decor'?'装饰':'家具')+' · 尺寸需核对</small>'}${j.draftSize?`<small>已保存尺寸：${Object.entries(j.draftSize).map(([key,value])=>({width:"宽",depth:"深",height:"高"}[key])+" "+Number((value*100).toFixed(2))+" 厘米").join("，")}；其余可在放入空间后填写</small>`:""}${onAdd&&j.state==='READY'?`<button type="button" data-add="${j.id}" ${working?'disabled':''}>${isPlaced(j.resultAssetId)?'再放一件':'放入空间'}</button>`:''}${j.canRetry?`<button type="button" data-action="retry" data-id="${j.id}" ${working?'disabled':''}>重新生成这件</button><small>会提交新任务并使用账号额度</small>`:''}${j.canResume?`<button type="button" data-action="resume" data-id="${j.id}" ${working?'disabled':''}>继续完成</button>`:''}${j.state==='SUBMIT_UNKNOWN'?`<details><summary>用已有任务恢复</summary><label>Lux3D 任务编号<input inputmode="numeric" data-taskid="${j.id}" placeholder="已有任务编号"></label><button type="button" data-action="recover" data-id="${j.id}" ${working?'disabled':''}>查询并恢复</button></details>`:''}</div></article>`).join('')}</div>`:'';
  const title=container.querySelector('.object-task-heading h3');if(title&&heading!=='我的物品')title.firstChild.textContent=heading+' ';
  container.querySelector('[data-start]')?.addEventListener('click',()=>action(()=>objectJson(`/api/projects/${projectId}/object-generations/start`,{ids:pending.map(j=>j.id)})));
  container.querySelectorAll('[data-add]').forEach(button=>button.onclick=()=>action(()=>onAdd(jobs.find(j=>j.id===button.dataset.add))));
  container.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>action(()=>{const id=button.dataset.id,taskId=container.querySelector(`[data-taskid="${id}"]`)?.value.trim();return objectJson(`/api/projects/${projectId}/object-generations/${id}/${button.dataset.action}`,taskId?{taskId}:{});}));
 }
 return {setJobs(value){jobs=value;render();},jobs:()=>jobs,hasActive:()=>jobs.some(j=>busyStates.has(j.state))};
}
export function createObjectUploadDialog({projectId,onSaved=()=>{},onNotify=()=>{},onImportModel,onAddPicture,withLibrary=false}){
 const dialog=document.createElement('dialog');dialog.className='object-upload-dialog';dialog.setAttribute('aria-label','添加物品照片');
 dialog.innerHTML='<div class="object-upload-head"><div><small>添加到当前空间</small><h2>拍下想摆的物品</h2></div><button type="button" data-close aria-label="关闭添加物品">×</button></div><div data-picker></div><details data-methods hidden><summary>其他添加方式</summary><button data-model type="button">导入已有模型（GLB）</button><button data-picture type="button">直接添加挂画图片</button></details><p class="object-upload-tip">照片先保存在电脑。点击生成后才发送 AHOLO 并使用账号额度；挂画直接添加。</p><p data-draft role="status"></p><p data-message role="status"></p><a data-pair hidden>重新配对</a><button type="button" data-generate class="primary" disabled>选择物品照片</button><button type="button" data-continue hidden>继续生成已保存的物品</button>';
 document.body.append(dialog);const generate=dialog.querySelector('[data-generate]'),continuation=dialog.querySelector('[data-continue]'),close=dialog.querySelector('[data-close]'),message=dialog.querySelector('[data-message]'),draftStatus=dialog.querySelector('[data-draft]'),pair=dialog.querySelector('[data-pair]');
 dialog.setAttribute('aria-label','添加场景物品');dialog.querySelector('h2').textContent='添加场景物品';
 const tabs=document.createElement('div');tabs.className='object-add-tabs';tabs.hidden=!withLibrary;tabs.setAttribute('role','group');tabs.setAttribute('aria-label','添加方式');const readyTab=document.createElement('button'),photoTab=document.createElement('button');readyTab.type=photoTab.type='button';readyTab.textContent='我的物品';photoTab.textContent='上传新照片';tabs.append(readyTab,photoTab);dialog.querySelector('.object-upload-head').after(tabs);
 const library=document.createElement('section');library.className='object-ready-shelf';library.setAttribute('aria-label','选择我的物品');const photos=document.createElement('div');photos.className='object-new-photos';tabs.after(library,photos);
 for(const node of [...dialog.querySelectorAll('[data-picker],[data-methods],.object-upload-tip,[data-draft],[data-generate],[data-continue]')])photos.append(node);
 function pane(ready){library.hidden=!ready;photos.hidden=ready;readyTab.setAttribute('aria-pressed',String(ready));photoTab.setAttribute('aria-pressed',String(!ready));}readyTab.onclick=()=>pane(true);photoTab.onclick=()=>pane(false);pane(false);
 let sending=false,restoring=false,initialized=false,loadingDraft=false,pendingIds=[];
 const writer=createDraftWriter(localDrafts,'items:'+projectId,{onStatus:(state)=>{draftStatus.textContent=state==='pending'?'正在暂存到本机…':state==='saved'?'未提交内容已暂存在本机':state==='error'?'本机暂存未完成，请离开前重试或保存。':'';}});
 const picker=createObjectPhotoPicker(dialog.querySelector('[data-picker]'),{onChange:()=>{update();remember();}});
 function update(){generate.disabled=sending||loadingDraft||!picker.count();generate.textContent=picker.count()?'生成 / 添加这 '+picker.count()+' 件物品':'选择物品照片';generate.hidden=!picker.count()&&!!pendingIds.length;continuation.classList.toggle('primary',!picker.count());continuation.hidden=!pendingIds.length;continuation.disabled=sending;continuation.textContent='继续生成已保存的 '+pendingIds.length+' 件物品';}
 function remember(){if(!initialized||restoring)return;writer.schedule({items:packItems(picker.snapshot()),pendingIds:[...pendingIds]});}
 async function refreshSaved(saved){try{await onSaved(saved);}catch(e){onNotify(issuePresentation(e,'物品进度').text,true);}}
 function showError(e){const issue=issuePresentation(e,'物品任务');pair.hidden=!issue.auth;pair.href=pairingUrl();message.textContent=(pendingIds.length?'照片已保存，点击“继续生成”可核对并接着处理，无需重新选图。':'')+(issue.global?issue.text:humanMessage(e));}
 async function finish(){
  if(!pendingIds.length&&!picker.count()){await writer.clear().catch(()=>{});dialog.close();onNotify('已添加物品，稍后可从当前空间查看生成进度。');}
  else{remember();message.textContent='已开始处理保存成功的物品。其余照片仍在这里，可以继续重试。';}
 }
 async function send(onlySaved=false){
  if(sending)return;sending=true;close.disabled=true;picker.lock(true);pair.hidden=true;update();
  try{
   if(!onlySaved){const items=await picker.ready();if(!items.length)throw Error('请先选择物品照片');const saved=await saveObjectPhotos(projectId,items,(i,total,name)=>message.textContent='正在保存 '+(i+1)+'/'+total+' · '+name);
    pendingIds=[...new Set([...pendingIds,...saved.jobs.filter(j=>j.state==='DRAFT').map(j=>j.id)])];picker.applySaveResult(saved);remember();await writer.flush().catch(()=>{});await refreshSaved(saved);
    if(saved.errors.length)message.textContent='部分照片未保存成功，填写内容已保留，可重试失败项。';
   }
   if(pendingIds.length){await continueObjectJobs(projectId,pendingIds);pendingIds=[];remember();await writer.flush().catch(()=>{});await refreshSaved({jobs:[],errors:[],failedItems:picker.snapshot()});}
   await finish();
  }catch(e){remember();showError(e);onNotify(message.textContent,true);}
  finally{sending=false;close.disabled=false;picker.lock(false);update();}
 }
 generate.onclick=()=>send();continuation.onclick=()=>send(true);
 close.onclick=()=>{if(!sending){writer.flush().catch(()=>{});dialog.close();}};dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();else writer.flush().catch(()=>{});});
 if(onImportModel||onAddPicture){dialog.querySelector('[data-methods]').hidden=false;for(const [selector,callback]of [['[data-model]',onImportModel],['[data-picture]',onAddPicture]]){const button=dialog.querySelector(selector);button.hidden=!callback;button.onclick=()=>{if(sending)return;dialog.close();callback();};}}
 window.addEventListener('beforeunload',e=>{if(writer.pending()||sending){e.preventDefault();e.returnValue='';}});
 window.addEventListener('pagehide',()=>writer.flush().catch(()=>{}));
 return {library,close:()=>dialog.close(),async open(items,{ready=false}={}){
  pane(ready);
  message.textContent='';pair.hidden=true;if(!dialog.open)dialog.showModal();
  if(!initialized){loadingDraft=true;restoring=true;picker.lock(true);generate.disabled=true;try{const saved=await localDrafts.get('items:'+projectId);if(saved){picker.setItems(unpackItems(saved.items));pendingIds=saved.pendingIds??[];message.textContent='已恢复上次添加的内容，可以继续。';}}catch(e){draftStatus.textContent='本机暂存暂时不可用，请离开前保存。';}finally{restoring=false;initialized=true;loadingDraft=false;picker.lock(false);}}
  if(items?.length){restoring=true;picker.setItems(items);restoring=false;remember();}update();
 }};
}
export function createEditorObjectGeneration({projectId,onAssets,onAdd,onNotify,isPlaced=()=>false,onImportModel,onAddPicture,onSaved=()=>{}}){
 if(!projectId)return {refresh:async()=>{}};
 const section=document.createElement('div');section.className='editor-object-generation';section.innerHTML='<div class="object-generation-intro"><button hidden type="button" class="primary" data-photo-add>＋ 拍照 / 添加多件物品</button></div><div data-connection class="object-task-error" hidden><p data-connection-text role="status"></p><button data-retry type="button">重试物品进度</button><a data-pair hidden>重新配对</a></div><div data-tasks></div>';
 let refreshing=null,libraryAssets=[],builtKey='';
 const builtAssets=document.createElement('div');builtAssets.className='built-asset-grid';section.querySelector('[data-tasks]').after(builtAssets);
 function paintAssets(jobs,assets){const results=new Set(jobs.map(j=>j.resultAssetId)),sources=new Set(assets.filter(a=>a.kind==='glb').map(a=>a.sourceAssetId));libraryAssets=assets.filter(a=>!results.has(a.id)&&(a.kind==='glb'||a.kind==='image'&&!sources.has(a.id)));const key=JSON.stringify(libraryAssets);if(key===builtKey)return;builtKey=key;builtAssets.replaceChildren();for(const a of libraryAssets){const button=document.createElement('button');button.type='button';button.className='built-asset';const title=document.createElement('span');title.textContent=a.name;const source=a.kind==='image'?a.id:a.sourceAssetId;if(source){const img=document.createElement('img');img.src=`/api/projects/${projectId}/objects/${source}`;img.alt='';button.append(img);}else{const icon=document.createElement('span');icon.textContent='◇';button.append(icon);}button.append(title);button.setAttribute('aria-label','添加我的物品 '+a.name);button.onclick=async()=>{button.disabled=true;try{await onAdd({resultAssetId:a.id,name:a.name,size:a.estimatedSize??null});uploader.close();await refresh();}catch(e){onNotify(e.message,true);}finally{button.disabled=false;}};builtAssets.append(button);}}
 const list=createObjectTaskList(section.querySelector('[data-tasks]'),{projectId,onAdd:async job=>{await onAdd(job);uploader.close();},onNotify,isPlaced,onUpdate:()=>refresh(),heading:'我的物品与生成进度'});
 section.querySelector('[data-retry]').onclick=()=>refresh();
 const uploader=createObjectUploadDialog({projectId,onSaved:async()=>{await refresh();await onSaved();},onNotify,onImportModel,onAddPicture,withLibrary:true});section.querySelector('[data-photo-add]').onclick=()=>uploader.open();
 uploader.library.append(section);const noItems=document.createElement('p');noItems.className='note';noItems.textContent='暂无我的物品，可上传新照片或导入已有模型。';section.append(noItems);
 async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
   try{const [jobResult,assetResult]=await Promise.allSettled([objectJson(`/api/projects/${projectId}/object-generations`),objectJson(`/api/projects/${projectId}/objects`)]);const jobs=jobResult.status==='fulfilled'?jobResult.value.jobs:list.jobs();section.querySelector('[data-connection]').hidden=true;list.setJobs(jobs);if(assetResult.status==='fulfilled'){await onAssets(assetResult.value);paintAssets(jobs,assetResult.value);}noItems.hidden=!!(jobs.length||libraryAssets.length);if(jobResult.status==='rejected')throw jobResult.reason;if(assetResult.status==='rejected')throw assetResult.reason;}
   catch(e){const error=section.querySelector('[data-connection]');const issue=issuePresentation(e,'物品进度');error.querySelector('[data-connection-text]').textContent=issue.text;error.querySelector('[data-retry]').hidden=issue.auth;const pair=error.querySelector('[data-pair]');pair.hidden=!issue.auth;pair.href=pairingUrl();error.hidden=false;}
  })().finally(()=>{refreshing=null;});return refreshing;
 }
 refresh();const timer=setInterval(()=>{if(!document.hidden)refresh();},5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});return {refresh,library:uploader.library,open:async()=>{await refresh();return uploader.open(undefined,{ready:list.jobs().length>0||libraryAssets.length>0});}};
}
