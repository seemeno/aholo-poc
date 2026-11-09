import {requestJson,issuePresentation,pairingUrl} from './ui_network.mjs';
import {createHistoryReader} from './effect_history.mjs';
import {getDeployment,rewriteServiceCopy} from './deployment_ui.mjs';
import {createPersonalEffectSettings} from './personal_effect_ui.mjs';
import {createDirectEffectAction,canGenerateCurrentView} from './ui_actions.mjs';
const active=new Set(['QUEUED','PREPARING','GENERATING','WAITING']);
export function createEffectView({projectId,capture,getPlanFingerprint=()=>null,onHistory=()=>{},onGallery=()=>{},onHistoryError=()=>{},onOpenChange=()=>{}}){
 const dialog=document.createElement('dialog');dialog.id='effectDialog';dialog.className='effect-dialog';dialog.setAttribute('aria-labelledby','effectTitle');
 dialog.innerHTML=`<div class="effect-shell"><header class="effect-head"><div><small>当前视角 / 空间效果图</small><h2 id="effectTitle">生成当前视角效果图</h2></div><button id="effectBack" class="effect-back" type="button">返回摆放</button></header><p class="effect-intro">按当前机位生成 AI 氛围效果，统一物品与房间的光影和质感。选好摆法后再生成。</p><p id="effectMessage" class="effect-status" role="status" aria-live="polite">调整好物品与机位后，点击下方按钮。</p><progress id="effectProgress" class="effect-progress" aria-label="正在生成效果图" hidden></progress><p id="effectWait" class="effect-wait" hidden></p><div id="effectStage" class="effect-stage"><div id="effectEmpty" class="effect-empty"><span aria-hidden="true">◩</span>让摆放方案成为一张完整的空间效果图<br>生成过程由电脑完成，手机无需一直停留在这里</div><img id="effectImage" alt="当前摆放方案的空间效果图" hidden></div><div id="effectSwitch" class="effect-switch" hidden><button id="effectResult" type="button" aria-pressed="true">AI 氛围效果</button><button id="effectPreview" type="button" aria-pressed="false">摆放预览</button></div><div class="effect-actions"><button id="effectGenerate" class="primary" type="button">生成效果图</button><a id="effectDownload" class="effect-download" hidden>保存效果图 ↓</a><a id="effectOpen" class="effect-open" target="_blank" rel="noopener" hidden>打开原图 ↗</a></div><p class="effect-foot">AI 可能改变个别材质与细节，请结合摆放预览查看。图片与生成时的方案一起保存在电脑项目中。</p><details class="effect-foot"><summary>生成详情</summary><p id="effectDetail"></p><p>本地 Flux 使用电脑显卡生成，无需再次提交云端生成。</p></details></div>`;
 document.body.append(dialog);rewriteServiceCopy(dialog);const $=id=>dialog.querySelector('#'+id);
 const historyLabel=document.createElement('label');historyLabel.className='effect-history';historyLabel.hidden=true;historyLabel.textContent='已保存的效果图';const historyPicker=document.createElement('select');historyPicker.setAttribute('aria-label','选择已保存的效果图');historyLabel.append(historyPicker);dialog.querySelector('.effect-intro').after(historyLabel);
 historyPicker.onchange=()=>refresh(historyPicker.value);
 const show=()=>{if(!dialog.open){dialog.showModal();onOpenChange(true);}};
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
 const retry=document.createElement('button');retry.id='effectRetry';retry.type='button';retry.textContent='重新加载';retry.hidden=true;$('effectMessage').after(retry);const pair=document.createElement('a');pair.textContent='重新配对';pair.hidden=true;retry.after(pair);function showIssue(e,fallback){const issue=issuePresentation(e,'效果图');pair.hidden=!issue.auth;pair.href=pairingUrl();return issue.global?issue.text:fallback;}
 $('effectOpen').hidden=true;$('effectOpen').style.display='none';
 const unknownActions=document.createElement('details');unknownActions.hidden=true;unknownActions.innerHTML='<summary>已核对任务，仍需重新生成？</summary><p class="effect-foot">确认电脑上没有仍在运行的旧任务后，可以明确创建一个新的本地任务。</p><button type="button">确认创建新的效果图任务</button>';$('effectGenerate').after(unknownActions);unknownActions.querySelector('button').onclick=()=>generate(true);
 const zoom=document.createElement('dialog');zoom.className='image-zoom';zoom.innerHTML='<button type="button">返回效果图</button><img alt="效果图原图">';document.body.append(zoom);zoom.querySelector('button').onclick=()=>zoom.close();
 $('effectImage').tabIndex=0;$('effectImage').setAttribute('role','button');$('effectImage').setAttribute('aria-label','放大查看图片');$('effectImage').onclick=()=>{zoom.querySelector('img').src=$('effectImage').src;zoom.showModal();};$('effectImage').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('effectImage').click();}};
 let job=null,latestJob=null,jobs=[],timer=null,clock=null,sequence=0,historyRevision=0,historyKey='',submitting=false,showPreview=false,loading=false,lastError='',retryKind='',lastImage='';
 const personal=createPersonalEffectSettings(dialog,{onChange:()=>render(),onSessionChange:()=>refresh()});if(personal.enabled)dialog.dataset.personal='true';
 if(personal.enabled){dialog.querySelector('.effect-foot').textContent='AI 效果仅供视觉参考，可能改变家具和结构细节；若服务返回不同画幅，会完整保留画面并留白适配。结果与原摆放快照保存到共享项目。';dialog.querySelector('details.effect-foot p:last-child').textContent='Qwen-Image-Edit-2511 · ModelScope API · 仅使用提交者个人额度';$('effectEmpty').lastChild.textContent='可继续三维试摆和保存；实时 AI 出图需配置个人 Token 并确认。';unknownActions.querySelector('p').textContent='请先核对 ModelScope 原任务。没有任务编号时无法自动确认是否已扣额；明确创建新任务可能再次消耗个人魔粒。';}
 function publishHistory(){historyRevision++;onHistory(latestJob);onGallery(jobs.filter(j=>j.state==='READY'));onHistoryError('');}
 function paintHistory(){const ready=jobs.filter(j=>j.state==='READY'),options=[latestJob?.state!=='READY'?latestJob:null,...ready].filter(Boolean);historyLabel.hidden=!ready.length;const key=JSON.stringify(options.map(j=>[j.id,j.state,j.message,j.completedAt,j.width,j.height]));if(key!==historyKey){historyKey=key;historyPicker.replaceChildren();for(const j of options){const option=document.createElement('option');option.value=j.id;option.textContent=j.state==='READY'?new Date(j.completedAt??j.createdAt).toLocaleString('zh-CN')+' · '+j.width+'×'+j.height:'当前任务 · '+j.message;historyPicker.append(option);}}historyPicker.value=job?.id??'';historyPicker.disabled=loading||submitting;}
 const message=(text,error=false)=>{$('effectMessage').textContent=text;$('effectMessage').classList.toggle('effect-error',error);};
 function image(url,force=false){if(lastImage!==url||force){lastImage=url;$('effectImage').src=url+(force?(url.includes('?')?'&':'?')+'retry='+Date.now():'');}$('effectImage').hidden=false;$('effectEmpty').hidden=true;}
 function render(){
  const busy=submitting||active.has(job?.state);$('effectGenerate').disabled=!(getDeployment().effectsEnabled||personal.enabled)||busy||active.has(latestJob?.state)||loading||!projectId||(personal.enabled&&(!personal.configured()||!personal.consented()));
  unknownActions.querySelector('button').disabled=personal.enabled&&(!personal.configured()||!personal.consented());
  $('effectGenerate').textContent=submitting?'正在保存当前机位…':active.has(job?.state)?'正在生成…':job?.state==='SUBMIT_UNKNOWN'?'核对已有任务':job?'按当前摆放重新生成':'生成效果图';
  $('effectGenerate').classList.toggle('primary',job?.state!=='READY');retry.hidden=!retryKind;
  unknownActions.hidden=job?.state!=='SUBMIT_UNKNOWN';
  $('effectProgress').hidden=!busy;$('effectWait').hidden=!busy;
  $('effectSwitch').hidden=submitting||job?.state!=='READY';
  $('effectDownload').hidden=submitting||job?.state!=='READY';$('effectOpen').hidden=submitting||job?.state!=='READY';
  if(job){
   const success=job.state==='READY';message(job.message,['FAILED','SUBMIT_UNKNOWN'].includes(job.state));
   if(job.previewUrl)image(success&&!showPreview?job.imageUrl:job.previewUrl);
   $('effectTitle').textContent=success?'你的空间效果图':'看看摆放后的空间';
   $('effectDetail').textContent=`${job.backend??"本地 Flux"} · 生成时的方案与机位 · ${job.width} × ${job.height}${success?' · '+new Date(job.completedAt).toLocaleString('zh-CN'):''}${job.planFingerprint&&getPlanFingerprint()&&job.planFingerprint!==getPlanFingerprint()?' · 当前摆放或机位已变化，此图保留生成时的方案。':''} · 点击图片可放大`;
   if(success){$('effectDownload').textContent=showPreview?'保存摆放预览 ↓':'保存效果图 ↓';$('effectImage').alt=showPreview?'生成时的摆放预览':'生成的空间效果图';$('effectDownload').href=showPreview?job.previewUrl:job.imageUrl;$('effectDownload').download=(showPreview?'摆放预览-':'空间效果图-')+job.id.slice(0,8)+'.png';$('effectOpen').href=showPreview?job.previewUrl:job.imageUrl;}
  }
  $('effectResult').setAttribute('aria-pressed',String(!showPreview));$('effectPreview').setAttribute('aria-pressed',String(showPreview));
  if(lastError)message(lastError,true);
  if(personal.enabled){if(job?.state==='WAITING_CREDENTIALS')$('effectGenerate').textContent='继续查询原任务';if(!personal.configured()&&!busy)$('effectGenerate').textContent='先配置个人 Token';else if(!personal.consented()&&!busy)$('effectGenerate').textContent='请先确认使用个人额度';}
  else if(!getDeployment().effectsEnabled){$('effectGenerate').textContent='当前服务未启用效果图生成';message('当前服务未启用实时 AI 出图，可以继续三维试摆和保存方案。');}
  paintHistory();
 }
 const json=(url,options)=>requestJson(url,{headers:personal.headers(),method:options?.method,body:options?.body?JSON.parse(options.body):undefined});
 const readHistory=createHistoryReader(()=>json('/api/effect-renders?project='+encodeURIComponent(projectId)+'&history=1'));
 function applyHistory(next){jobs=next;latestJob=jobs[0]??null;publishHistory();}
 function schedule(){clearTimeout(timer);if(dialog.open&&active.has(job?.state))timer=setTimeout(poll,2500);}
 async function poll(){const token=sequence;try{const updated=await json('/api/effect-renders/'+job.id);if(token!==sequence)return;job=updated;if(latestJob?.id===job.id)latestJob=job;jobs=[job,...jobs.filter(j=>j.id!==job.id)];retryKind='';publishHistory();render();schedule();}catch(e){if(token!==sequence)return;retryKind='poll';retry.hidden=false;message(showIssue(e,'效果图进度暂时无法读取，可以重试，原任务会保留。'),true);if(e.kind==='auth'){retry.hidden=true;return;}if(dialog.open)timer=setTimeout(poll,5000);}}
 async function refresh(selectedId){const token=++sequence;clearTimeout(timer);loading=true;lastError='';pair.hidden=true;render();try{const next=await readHistory();if(token!==sequence)return;applyHistory(next);job=selectedId?jobs.find(j=>j.id===selectedId):latestJob;if(selectedId&&!job)throw Error('这张效果图已不可用，请重新选择');showPreview=false;retryKind='';if(!job){lastImage='';$('effectImage').hidden=true;$('effectEmpty').hidden=false;$('effectDetail').textContent='';message('调整好物品与机位后，点击下方按钮。');}render();schedule();}catch(e){if(token===sequence){lastError=showIssue(e,'暂时无法读取效果图，点击重新加载即可，当前摆放会保留。');retryKind=e.kind==='auth'?'':'history';onHistoryError(lastError);}}finally{if(token===sequence){loading=false;render();}}}
 async function generate(confirmedUnknown=false){
  if(!getDeployment().effectsEnabled&&!personal.enabled)return;
  if(personal.enabled&&(!personal.configured()||!personal.consented()))return;
  if(submitting||loading||active.has(latestJob?.state)||active.has(job?.state))return;
  if(job?.state==='WAITING_CREDENTIALS'){await poll();return;}
  if(latestJob?.state==='SUBMIT_UNKNOWN'&&confirmedUnknown!==true){await refresh();return;}
  const force=!!latestJob;submitting=true;lastError='';const token=++sequence;clearTimeout(timer);render();message('正在保存摆放方案并准备当前画面…');
  try{
   const payload=await capture();
   job=null;render();image(payload.preview);message('当前画面已保存，正在排队生成…');
   const result=await json('/api/effect-renders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,projectId,force,...(personal.enabled?{consent:true}:{})})});
   if(token!==sequence)return;job=latestJob=result;jobs=[job,...jobs.filter(j=>j.id!==job.id)];showPreview=false;publishHistory();render();schedule();
  }catch(e){if(token===sequence)lastError=showIssue(e,'生成未完成：'+e.message);}finally{if(token===sequence){submitting=false;if(personal.enabled)personal.reset();render();}}
 }
 $('effectBack').textContent='返回试摆';$('effectGenerate').onclick=()=>generate();$('effectBack').onclick=()=>dialog.close();
 $('effectResult').onclick=()=>{showPreview=false;render();};$('effectPreview').onclick=()=>{showPreview=true;render();};
 $('effectImage').onerror=()=>{retryKind='image';retry.hidden=false;message('图片暂时无法载入，可在这里重新加载。',true);};
 retry.onclick=()=>{const kind=retryKind;retryKind='';retry.hidden=true;lastError='';if(kind==='image')image(lastImage,true);else if(kind==='poll'){clearTimeout(timer);poll();}else refresh();};
 dialog.addEventListener('close',()=>{clearTimeout(timer);clearInterval(clock);onOpenChange(dialog.open);});
 async function open(selectedId){if(!projectId){message('请从“我的空间”打开一个项目后生成效果图。',true);render();show();return;}show();if(personal.enabled)await personal.refresh();clearInterval(clock);clock=setInterval(()=>{if(active.has(job?.state))$('effectWait').textContent=`${personal.enabled?'个人额度任务':'电脑正在处理'} · 已等待 ${Math.max(0,Math.floor((Date.now()-Date.parse(job.createdAt))/1000))} 秒 · 可以返回继续查看项目`;},1000);if(submitting)return;await refresh(selectedId);}
 const renderCurrent=createDirectEffectAction({open,canGenerate:()=>canGenerateCurrentView({open:dialog.open,projectId,error:lastError,loading,submitting,state:latestJob?.state,effectsEnabled:getDeployment().effectsEnabled,personalEnabled:personal.enabled,configured:personal.configured(),consented:personal.consented()}),generate});
 return {close:()=>{if(dialog.open){dialog.close();onOpenChange(false);}},open,renderCurrent,refreshHistory:async()=>{if(!projectId)return false;const token=sequence,revision=historyRevision;try{const next=await readHistory();if(token!==sequence||revision!==historyRevision||submitting)return false;applyHistory(next);return true;}catch(e){if(token===sequence&&revision===historyRevision)onHistoryError(issuePresentation(e,'效果图记录').text);return false;}}};
}
