import {requestJson,pairingUrl} from './ui_network.mjs';
import {localDrafts} from './local_drafts.mjs';
import {serviceText} from './deployment_ui.mjs';
import {needsRecovery} from './editor_calibration.mjs';
import {restoreWhenReady} from './restore_gate.mjs';

// Owns revisions and CAS versions. A queued save uses the preceding save's version.
export function createSceneSaveState({projectId,endpoint,request=requestJson,onChange=()=>{}}){
 let revision=0,savedRevision=0,version=null,conflict=false,errorKind='',pending=0,lastScene=null,queue=Promise.resolve();
 const state=()=>({revision,savedRevision,version,conflict,errorKind,pending,lastScene,dirty:revision>savedRevision});
 const emit=(type,error)=>onChange(type,state(),error);
 async function persist(input,atRevision=revision){
  const scene=structuredClone(input);pending++;emit('queued');
  const result=queue.catch(()=>{}).then(async()=>{
   if(conflict)throw Error('另一处已保存，当前修改未覆盖。可保留本机副本后查看已保存版本。');
   emit('saving');
   let value;try{value=await request(endpoint,{body:{...scene,...(projectId?{expectedSavedAt:version}:{})}});}catch(error){if(error.status===409)conflict=true;throw error;}
   errorKind='';version=value.savedAt??version;lastScene=scene;savedRevision=Math.max(savedRevision,atRevision);emit('saved');return value;
  });queue=result;
  try{return await result;}catch(error){errorKind=error.kind??'request';emit('error',error);throw error;}finally{pending--;emit('settled');}
 }
 return {
  get state(){return state();},persist,wait:()=>queue.catch(()=>{}),
  changed(){revision++;emit('changed');},
  adopt(scene,{clean=true}={}){lastScene=structuredClone(scene);version=scene.savedAt??null;conflict=false;errorKind='';if(clean)savedRevision=revision;emit('restored');},
  resetBaseline(){revision=savedRevision=0;emit('baseline');}
 };
}

// Persistence UI receives scene operations; it does not own placement or camera state.
export function createEditorPersistence(api){
 const {$,editorMain,projectId,endpoint,recoveryKey,placementFields}=api;
 const request=api.request??requestJson,drafts=api.drafts??localDrafts;
 let timer=null,recoveryBusy=false,allowNavigation=false;
 const cancelAutoSave=()=>{clearTimeout(timer);timer=null;};
 const store=createSceneSaveState({projectId,endpoint,request,onChange:(type,state,error)=>{
  $('save').disabled=state.pending>0||recoveryBusy;
  if(type==='saving'){$('saveState').textContent='正在保存…';paintSaveButton('saving');}
  if(type==='changed'){$('saveState').textContent='有修改待保存';paintSaveButton(state.conflict?'error':'pending');}
  if(type==='saved'){$('saveState').textContent=state.dirty?'有修改待保存':serviceText('已保存到电脑');$('saveState').classList.remove('error');paintSaveButton(state.dirty?'pending':'saved');}
  if(type==='error'){$('saveState').textContent=state.conflict?'保存冲突 · 未覆盖':'保存未完成';$('saveState').classList.add('error');if(state.conflict||state.errorKind==='auth')showRecovery(error);paintSaveButton('error');api.status(state.conflict?'另一处已保存，当前修改未覆盖。请在提示中保留本机副本或查看已保存版本。':error.message);}
 }});
 function paintSaveButton(state='idle'){
  const button=$('save');button.hidden=false;button.dataset.state=state;button.classList.toggle('save-error',state==='error');button.setAttribute('aria-busy',String(state==='saving'));
  const label=store.state.conflict?'处理保存冲突':store.state.errorKind==='auth'?'重新配对后保存':state==='saving'?'正在保存方案':state==='error'?'重试保存方案':'保存方案';button.title=label;button.setAttribute('aria-label',label);
  if(!button.querySelector('svg'))button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8"/></svg><span class="save-indicator" aria-hidden="true"></span>';
 }
 function scheduleAutoSave(){
  cancelAutoSave();if(!projectId||store.state.conflict||!store.state.dirty)return;
  timer=setTimeout(()=>{if(api.busy()){scheduleAutoSave();return;}if(api.isDirty())return;store.persist(api.snapshot()).catch(()=>{});},1200);
 }
 function showRecovery(error){
  cancelAutoSave();$('saveRecovery').hidden=false;$('restoreLocal').hidden=$('localBackup').hidden;const auth=(error?.kind??store.state.errorKind)==='auth';$('pairSave').hidden=!auth;$('pairSave').href=pairingUrl();
  $('recoveryMessage').textContent=auth?'配对已失效。先保留本机修改，再重新配对即可继续。':store.state.conflict?'另一处已保存，当前修改仍在这里。可以保留本机副本，再查看已保存版本。':'这台设备上保留了修改副本。恢复后可继续编辑，修改将自动保存。';
 }
 async function keepLocalCopy(){
  const record={scene:api.snapshot(),fields:api.isDirty()?Object.fromEntries(placementFields.map(key=>[key,$(key).value])):null,baseSavedAt:store.state.version,keptAt:Date.now()};
  await drafts.set(recoveryKey,record);$('localBackup').hidden=false;$('restoreLocal').hidden=false;$('recoveryMessage').textContent='当前修改已保留在此设备，可查看已保存版本，稍后恢复本机修改。';return record;
 }
 async function recoverAction(action){
  if(recoveryBusy||api.busy())return;recoveryBusy=true;const wasInert=editorMain.inert;editorMain.inert=true;$('save').disabled=true;for(const button of $('saveRecovery').querySelectorAll('button'))button.disabled=true;
  try{cancelAutoSave();await store.wait();await action();}catch(error){$('recoveryMessage').textContent=error.message;$('saveRecovery').hidden=false;}
  finally{editorMain.inert=wasInert;$('save').disabled=store.state.pending>0;for(const button of $('saveRecovery').querySelectorAll('button'))button.disabled=false;recoveryBusy=false;}
 }
 function restoreSaved(value){
  const restored=api.restore(value);if(restored){store.adopt(value);$('saveState').textContent='已载入保存方案';$('saveState').classList.remove('error');paintSaveButton('saved');}return restored;
 }
 function bind(){
  $('keepLocal').onclick=()=>recoverAction(keepLocalCopy);
  $('viewSaved').onclick=()=>recoverAction(async()=>{if(store.state.conflict||api.isDirty()||store.state.dirty)await keepLocalCopy();const value=await request(endpoint);api.recordHistory();restoreSaved(value);api.recordHistory();$('saveRecovery').hidden=true;api.status('正在查看已保存版本；本机修改副本已保留。');});
  $('restoreLocal').onclick=()=>recoverAction(async()=>{
   const record=await drafts.get(recoveryKey);if(!record){$('localBackup').hidden=true;throw Error('本机副本已过期，请使用已保存方案。');}
   const latest=await request(endpoint);api.recordHistory();if(!api.restore(record.scene))return;store.adopt(latest,{clean:false});paintSaveButton();$('saveState').classList.remove('error');
   if(record.fields)api.restoreFields(record.fields);api.checkpoint();$('saveRecovery').hidden=true;api.status('已恢复本机修改，可以继续编辑。');
  });
  $('pairSave').onclick=event=>{event.preventDefault();recoverAction(async()=>{await keepLocalCopy();allowNavigation=true;location.href=pairingUrl();});};
  $('localBackup').onclick=()=>showRecovery();$('closeRecovery').onclick=()=>{$('saveRecovery').hidden=true;($('localBackup').hidden?$('save'):$('localBackup')).focus();};
  $('save').onclick=async()=>{if($('save').disabled||api.wallDragging())return;if(store.state.conflict||store.state.errorKind==='auth'){showRecovery();return;}$('save').disabled=true;try{api.requireEdits();await store.persist(api.snapshot());api.status('方案已保存，可以继续摆放或查看效果图。');}catch(error){api.status(error.message);}finally{$('save').disabled=store.state.pending>0;}};
  $('reload').onclick=async()=>{if(store.state.dirty||api.isDirty()){api.status('当前还有修改未保存。请先导出布局文件，再次点击载入时确认。');if(!confirm('重新载入会替换当前未保存的修改。已导出布局文件，继续载入？'))return;}try{await restoreWhenReady(()=>request(endpoint),{isBusy:api.busy,apply:restoreSaved,onBusy:()=>api.status('图片导出进行中，请结束后重新载入摆放。')});}catch(error){api.status(error.message);}};
 }
 function startRecovery(win=window){
  drafts.get(recoveryKey).then(value=>{if(value){$('localBackup').hidden=false;if(needsRecovery(value,store.state.lastScene))showRecovery();}}).catch(()=>{});
  win.addEventListener('beforeunload',event=>{if(!allowNavigation&&(api.isDirty()||store.state.dirty)){event.preventDefault();event.returnValue='';}});
 }
 return {get state(){return store.state;},persistScene:store.persist,wait:store.wait,changed:store.changed,resetBaseline:()=>{cancelAutoSave();store.resetBaseline();},paintSaveButton,scheduleAutoSave,cancelAutoSave,showRecovery,keepLocalCopy,restoreSaved,bind,startRecovery,allowNavigation:()=>{allowNavigation=true;}};
}
