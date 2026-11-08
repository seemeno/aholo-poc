import {createObjectPhotoPicker,saveObjectPhotos} from './object_photos.mjs';
import {createObjectTaskList,createObjectUploadDialog} from './object_generation_ui.mjs';
import {requestJson,RequestError,issuePresentation,pairingUrl} from './ui_network.mjs';
import {localDrafts,packFile,unpackFile,packItems,unpackItems} from './local_drafts.mjs';
import {createPhotoDraftUI} from './photo_draft_ui.mjs';
import {preparationLabel,createStepNavigation,projectStepTargets} from './ui_actions.mjs';
import {projectStepProgress,roomProgress} from './project_progress.mjs';
import {checkPhotoCanvas,roomPhotoDimensions,restoreRoomPhoto} from './photo_checks.mjs';
const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const projectObjectJobs=new Map(),projectUploaders=new Map(),failedObjectPhotos=new Map();
const projectEffects=new Map(),projectProgressIssues=new Map();
$('photoCheck').after($('photoWarnings'));
const diagnostics=document.createElement('dialog');diagnostics.className='space-dialog project-diagnostics';diagnostics.setAttribute('aria-labelledby','diagnosticsTitle');diagnostics.innerHTML='<div class="deleted-heading"><h2 id="diagnosticsTitle">项目与结构信息</h2><button type="button" aria-label="关闭帮助与诊断">×</button></div><div data-diagnostics></div>';
document.body.append(diagnostics);diagnostics.querySelector('button').onclick=()=>diagnostics.close();
const objectPhotosSection=document.createElement('section');objectPhotosSection.id='roomObjectPhotos';objectPhotosSection.className='room-object-photos';$('newProject').insertBefore(objectPhotosSection,$('name').previousElementSibling);
const roomObjectPicker=createObjectPhotoPicker(objectPhotosSection,{onChange:()=>photoDrafts.schedule()});
let photoSteps=createStepNavigation({current:'prepare',ready:false}),photoStepsKey='';document.querySelector('.steps').replaceWith(photoSteps);
const projectIssueBox=$('projectIssue');
const projectSteps=document.createElement('div');projectSteps.id='projectSteps';$('projectIssue').before(projectSteps);
document.querySelector('.home-intro .sub').textContent='一张房间照片，加上喜欢的物品，一起开始试摆。';
const names={DRAFT:'素材待提交',QUEUED:'准备处理',UPLOADING:'传输到 AHOLO',SUBMIT_UNKNOWN:'提交结果待核对',WAITING:'生成 / 重建中',DOWNLOADING:'下载场景',EXTRACTING:'本地提取结构',READY:'可以编辑',FAILED:'处理失败',PAUSED:'需要继续处理'};
Object.assign(names,{DRAFT:'待生成',QUEUED:'准备中',UPLOADING:'准备中',WAITING:'生成中',DOWNLOADING:'生成中',EXTRACTING:'生成中',READY:'可以摆放',PAUSED:'待继续',FAILED:'未完成',SUBMIT_UNKNOWN:'待核对'});
let draftProjectId=null,preparedPhoto=null,qualityAcknowledged=false,skipFailedItems=false,roomPhotoCheck=null;
let files=[],selectedPhoto=null,photoPromise=Promise.resolve(),selectionToken=0,previewUrl=null,selected=null,projects=[],preparing=false,lastDetail='',checks=new Map(),doctor=null,replacementId=null,replacementVersion=null,photoContextId='';
let connectionError=null;
let lastRouteHash='',resumeGeneration=0;
async function updateResumeDraft(){const generation=++resumeGeneration;try{const last=await localDrafts.get('last-room-draft'),value=last?await localDrafts.get(last.key):null;if(generation!==resumeGeneration)return;const present=!!value&&(value.roomFile||value.items?.length||value.prompt||value.name!=='我的客厅');$('resumePhotoBanner').hidden=!present;if(present){$('resumePhotoDraft').href=last.context==='new'?'#photo':'#photo/'+last.context;$('resumePhotoName').textContent=value.name??'';}}catch{$('resumePhotoBanner').hidden=true;}}
window.addEventListener('local-drafts-updated',updateResumeDraft);
let noticeTimer,pendingDelete=null,projectMutation=false,deletedProjects=[],lastDeleted='';
const photoDrafts=createPhotoDraftUI({form:$('newProject'),hasContent:value=>!!(value.roomFile||value.items?.length||value.prompt||value.name!=='我的客厅'),
 read:()=>({roomFile:packFile(selectedPhoto),items:packItems(roomObjectPicker.snapshot()),name:$('name').value,prompt:$('prompt').value,draftProjectId,prepared:!!selectedPhoto&&preparedPhoto===selectedPhoto,replacementVersion}),
 apply:async value=>{const token=++selectionToken;photoPromise=restoreRoomPhoto(unpackFile(value.roomFile),value.prepared,normalizeRoomImage);const restored=await photoPromise;if(token!==selectionToken)return;
 selectedPhoto=restored.file;roomPhotoCheck=restored.check;files=selectedPhoto?[selectedPhoto]:[];draftProjectId=value.draftProjectId??null;replacementVersion=value.replacementVersion??replacementVersion;preparedPhoto=restored.prepared?selectedPhoto:null;$('name').value=value.name??'我的客厅';$('prompt').value=value.prompt??'';roomObjectPicker.setItems(unpackItems(value.items));qualityAcknowledged=false;updatePreparationAction();$('photoWarnings').hidden=true;
 if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=selectedPhoto?URL.createObjectURL(selectedPhoto):null;$('previewWrap').hidden=!selectedPhoto;$('photoEmpty').hidden=!!selectedPhoto;if(selectedPhoto){$('roomPreview').src=previewUrl;$('chosen').textContent='已从本机恢复，图片已按兼容尺寸准备';showPhotoCheck(selectedPhoto,roomPhotoCheck);}}
});
for(const id of ['name','prompt'])$(id).addEventListener('input',()=>photoDrafts.schedule());

function notice(text,error=false){$('noticeText').textContent=text;$('notice').hidden=false;$('notice').classList.toggle('error',error);clearTimeout(noticeTimer);if(!error)noticeTimer=setTimeout(()=>$('notice').hidden=true,6500);}
$('closeNotice').onclick=()=>{$('notice').hidden=true;clearTimeout(noticeTimer);};
function route(){
 if(preparing)return;lastRouteHash=location.hash;
 const hash=location.hash.slice(1),match=/^space\/([a-f0-9-]{36})$/.exec(hash),photoMatch=/^photo\/([a-f0-9-]{36})$/.exec(hash),screen=hash==='photo'||photoMatch?'photo':match?'project':'home';
 replacementId=photoMatch?.[1]??null;
 document.body.dataset.screen=screen;if(screen==='home')updateResumeDraft();
 $('openProjectDiagnostics').hidden=screen!=='project'||!projects.some(p=>p.id===match?.[1]);
 for(const name of ['home','photo','project'])$(name+'Screen').hidden=name!==screen;
 if(match){selected=match[1];rememberProject(selected);const p=projects.find(p=>p.id===selected);if(p){detail(p);lastDetail=JSON.stringify(p);}else{projectSteps.replaceChildren();$('detail').innerHTML='<p class="empty-state">正在读取项目…</p>';}}
 if(screen==='photo'){if(replacementId)rememberProject(replacementId);configurePhoto();}
 document.title='空间工坊 · '+(screen==='photo'&&replacementId?'重新上传场景图片':{home:'我的空间',photo:'新建空间',project:'你的空间'}[screen]);window.scrollTo(0,0);
}
window.addEventListener('hashchange',route);queueMicrotask(route);
function rememberProject(id){return api('/api/projects/'+id+'/visit',{}).catch(()=>{});}
function openProject(id){location.hash='space/'+id;}
function configurePhoto(){
 const context=replacementId??'new';
 const changed=photoContextId!==context;if(changed){photoDrafts.leave();choose([]);roomObjectPicker.clear();$('media').value='';$('cameraMedia').value='';replacementVersion=null;preparedPhoto=null;draftProjectId=null;continueSaved.hidden=true;photoContextId=context;if(!replacementId){$('name').value='我的客厅';$('prompt').value='';}}
 const p=projects.find(p=>p.id===replacementId);
 const stepsKey=JSON.stringify([replacementId,p?.status==='READY']);if(stepsKey!==photoStepsKey){photoStepsKey=stepsKey;const nextSteps=createStepNavigation({projectId:replacementId,current:'prepare',ready:p?.status==='READY',onNavigate:async(step,event)=>{event.preventDefault();if(step==='prepare')return;const target=projectStepTargets(replacementId)[step];try{await photoDrafts.flush();location.assign(target);}catch(e){notice('照片草稿未能保存，请稍后重试切换。',true);}}});photoSteps.replaceWith(nextSteps);photoSteps=nextSteps;}
 if(replacementId&&p&&replacementVersion===null){$('name').value=p.name;$('prompt').value=p.prompt??'';replacementVersion=p.updatedAt;}
 $('photoTitle').textContent=replacementId?'重新上传场景图片':'新建空间';
 $('photoScreen').querySelector('.page-heading .back').href=replacementId?'#space/'+replacementId:'#home';
 $('photoScreen').querySelector('.page-heading .back').setAttribute('aria-label',replacementId?'返回当前空间':'返回我的空间');
 $('photoScreen').querySelector('.page-heading .tiny').textContent=replacementId?'保留当前项目':'一张就可以';
 objectPhotosSection.hidden=!!replacementId;
 $('name').hidden=!!replacementId;$('name').required=!replacementId;document.querySelector('label[for="name"]').hidden=!!replacementId;$('prompt').closest('details').hidden=!!replacementId;
 $('saveDraft').textContent=replacementId?'仅保存新照片，稍后生成':'仅保存草稿';
 $('generationConsent').textContent='照片先在本机检查与保存。点击“'+preparationLabel({replacement:!!replacementId})+'”后才会发送 AHOLO 并使用账号额度；可以离开，稍后回来查看。';
 document.querySelector('label[for="name"]').textContent=replacementId?'当前空间':'给空间起个名字';
 updatePreparationAction();
 let info=$('roomReplaceInfo');if(!info){info=document.createElement('p');info.id='roomReplaceInfo';info.className='tip';$('newProject').prepend(info);}
 if(changed)photoDrafts.switchTo(context);
 info.hidden=!replacementId;info.textContent='正在更新“'+(p?.name??'当前空间')+'”的房间照片。已有物品与旧任务记录会保留；重新生成仍在这个空间内进行。';
}
function updatePreparationAction(){$('prepare').textContent=preparationLabel({replacement:!!replacementId,confirmQuality:qualityAcknowledged});}
// Quality warnings are visible before the user confirms generation.
function showPhotoCheck(file,check){
 $('photoCheck').hidden=false;$('photoCheckTitle').textContent=check.warnings.length?'照片可读取，有质量提醒':'照片检查完成';
 $('photoCheckInfo').textContent=`${file.name} · ${(file.size/1024**2).toFixed(1)} MB · ${check.width} × ${check.height} 像素 · ${file.type==='image/png'?'PNG':'JPEG'}`;
 $('photoWarnings').hidden=!check.warnings.length;$('photoWarningText').textContent=check.warnings.join('；');qualityAcknowledged=!!check.warnings.length;updatePreparationAction();
}
$('warningChoose').onclick=()=>$('replacePhoto').click();
function reselectRoomPhoto(p){
 if(preparing)return;
 photoContextId='';location.hash='photo/'+p.id;
 notice('请选择新的场景图片，保留当前项目和已有物品。确认开始生成后才会提交新任务。');
}
function bindImages(scope){scope.querySelectorAll('img[data-fallback]').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;},{once:true}));}

const api=(url,body,method=body===undefined?'GET':'POST')=>requestJson(url,{body,method});
const deleteIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg>';
function requestDelete(p){if(!p)return notice('空间列表已变化，请刷新后重试。',true);pendingDelete=p;$('deleteProjectName').textContent=p.name;$('deleteError').hidden=true;$('deleteDialog').showModal();}
async function refreshAfterMutation(){await refreshPromise?.catch(()=>{});lastLibrary='';lastDetail='';await refresh();}
function renderDeleted(){
 $('deletedCount').textContent=deletedProjects.length?' · '+deletedProjects.length:'';
 const key=JSON.stringify(deletedProjects);if(lastDeleted===key)return;lastDeleted=key;
 $('deletedLibrary').innerHTML=deletedProjects.length?deletedProjects.map(p=>`<div class="deleted-space"><div><strong>${escape(p.name)}</strong><span class="muted">${escape(new Date(p.deletedAt).toLocaleString('zh-CN'))} 移除</span></div><button type="button" data-restore="${p.id}" aria-label="恢复空间 ${escape(p.name)}">恢复</button></div>`).join(''):'<p class="empty-state">最近没有删除的空间。</p>';
 $('deletedLibrary').querySelectorAll('[data-restore]').forEach(button=>button.onclick=async()=>{
  if(projectMutation)return;projectMutation=true;button.disabled=true;
  try{const p=await api(`/api/deleted-projects/${button.dataset.restore}/restore`,{});checks.delete(p.id);await refreshAfterMutation();notice('已恢复“'+p.name+'”，可以从我的空间重新打开。');}
  catch(e){$('deletedError').textContent=e.message;$('deletedError').hidden=false;button.disabled=false;}finally{projectMutation=false;}
 });
}
$('openDeleted').onclick=()=>{$('deletedError').hidden=true;$('deletedDialog').showModal();refresh().catch(e=>{$('deletedError').textContent=e.message;$('deletedError').hidden=false;});};$('closeDeleted').onclick=()=>$('deletedDialog').close();
$('cancelDelete').onclick=()=>{if(!projectMutation)$('deleteDialog').close();};$('deleteDialog').addEventListener('cancel',e=>{if(projectMutation)e.preventDefault();});
$('confirmDelete').onclick=async()=>{
 if(!pendingDelete||projectMutation)return;const p=pendingDelete;projectMutation=true;$('confirmDelete').disabled=true;$('cancelDelete').disabled=true;$('deleteError').hidden=true;
 try{
  await api('/api/projects/'+p.id,undefined,'DELETE');$('deleteDialog').close();pendingDelete=null;checks.delete(p.id);projectObjectJobs.delete(p.id);projectUploaders.delete(p.id);
  if(selected===p.id){selected=null;location.hash='home';}
  await refreshAfterMutation();notice('已将“'+p.name+'”移到最近删除。');
 }catch(e){$('deleteError').textContent=e.message;$('deleteError').hidden=false;notice(e.message,true);}
 finally{projectMutation=false;$('confirmDelete').disabled=false;$('cancelDelete').disabled=false;}
};

const potentialImage=file=>file?.type?.startsWith('image/')||/\.(jpe?g|png|webp|heic|heif)$/i.test(file?.name??'');
async function decodeRoomImage(file){
 if(typeof createImageBitmap==='function'){
  try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch{}
  try{return await createImageBitmap(file);}catch{}
 }
 return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('无法在此浏览器解码这张照片。若是 HEIC/HEIF，请在手机照片中导出为 JPEG 后再选。'));};image.src=url;});
}
async function normalizeRoomImage(file){
 if(!potentialImage(file))throw Error('请选择一张照片；不支持视频或其他文件。');
 if(file.size>120*1024**2)throw Error('照片超过 120 MB，无法在本机安全处理。请先缩小图片再选择。');
 let image;try{image=await decodeRoomImage(file);}catch(e){throw Error(e.message.includes('无法在此浏览器')?e.message:'照片解码失败；若是 HEIC/HEIF，请在手机照片中导出为 JPEG 后再选。');}
 try{
  const dimensions=roomPhotoDimensions(image.width??image.naturalWidth,image.height??image.naturalHeight),canvas=document.createElement('canvas');canvas.width=dimensions.width;canvas.height=dimensions.height;
  const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('本机浏览器无法创建图片处理画布。');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.type!=='image/png')throw Error('无法准备 PNG 照片，请重新选择。');
  if(blob.size>30*1024**2)throw Error('处理后的照片仍超过 30 MB，请选择较小的图片。');
  const base=file.name.replace(/\.[^.]+$/,'')||'room-photo';return {file:new File([blob],base+'.png',{type:'image/png',lastModified:file.lastModified}),check:checkPhotoCanvas(canvas)};
 }finally{image.close?.();}
}
function choose(list){
 if(preparing)return;
 const token=++selectionToken;roomPhotoCheck=null;$('photoCheck').hidden=true;qualityAcknowledged=false;skipFailedItems=false;$('photoWarnings').hidden=true;updatePreparationAction();files=Array.from(list);selectedPhoto=null;photoPromise=Promise.resolve();$('photoError').hidden=true;$('previewWrap').hidden=true;$('photoEmpty').hidden=false;
 if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
 if(files.length!==1){$('chosen').textContent=files.length?files.map(f=>f.name).join('、'):'尚未选择照片';if(files.length)notice('请只选择一张房间照片。多张照片或视频不能用于此创建入口。',true);return;}
 const source=files[0];if(!potentialImage(source)){ $('chosen').textContent=source.name;notice('请选择 JPG、PNG、WebP 照片；视频不能用于此创建入口。',true);return; }
 $('chosen').textContent=`正在本机检查与处理 ${source.name}…`;
 photoPromise=(async()=>{try{const {file:ready,check}=await normalizeRoomImage(source);if(token!==selectionToken)return;selectedPhoto=ready;files=[ready];roomPhotoCheck=check;showPhotoCheck(ready,check);$('chosen').textContent='已在本机校正方向并准备上传';previewUrl=URL.createObjectURL(ready);$('roomPreview').src=previewUrl;$('previewWrap').hidden=false;$('photoEmpty').hidden=true;photoDrafts.schedule();}catch(e){if(token!==selectionToken)return;$('chosen').textContent=source.name;$('photoError').textContent=e.message;$('photoError').hidden=false;notice(e.message,true);}})();
}
$('media').onchange=()=>choose($('media').files);$('cameraMedia').onchange=()=>choose($('cameraMedia').files);$('cameraButton').onclick=()=>$('cameraMedia').click();$('albumButton').onclick=()=>$('media').click();$('replacePhoto').onclick=()=>{if(preparing)return;$('media').value='';$('cameraMedia').value='';$('media').click();};$('drop').ondragover=e=>{if(preparing)return;e.preventDefault();$('drop').classList.add('drag');};$('drop').ondragleave=()=>$('drop').classList.remove('drag');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('drag');if(preparing){notice('正在处理当前照片，请等待完成后再替换。',true);return;}choose(e.dataTransfer.files);};
function upload(id,file,index,total,version){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',`/api/projects/${id}/${version?'room-photo':'uploads'}?name=${encodeURIComponent(file.name)}${version?'&version='+encodeURIComponent(version):''}`);xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.upload.onprogress=e=>{if(e.lengthComputable){$('progress').value=e.loaded/e.total*100;$('uploadText').textContent=`保存到电脑本地 ${index+1}/${total} · ${file.name} · ${Math.round(e.loaded/e.total*100)}%`;}};xhr.timeout=90000;xhr.onerror=()=>reject(new RequestError('本地文件传输中断',{kind:'network'}));xhr.ontimeout=()=>reject(new RequestError('本地照片检查等待较久，可稍后重试。',{kind:'timeout'}));xhr.onload=()=>{try{const value=JSON.parse(xhr.responseText);if(xhr.status>=400)throw new RequestError(value.error??'照片保存未完成',{status:xhr.status,kind:xhr.status===401?'auth':'validation'});resolve(value);}catch(e){reject(e);}};xhr.send(file);});}
const continueSaved=document.createElement('button');continueSaved.id='continueSaved';continueSaved.type='button';continueSaved.className='text-button';continueSaved.hidden=true;continueSaved.textContent='先生成已保存的空间与物品';$('prepare').after(continueSaved);
continueSaved.onclick=()=>{skipFailedItems=true;$('newProject').requestSubmit();};
$('saveDraft').onclick=()=>submitPreparation(false);
$('newProject').onsubmit=e=>{e.preventDefault();submitPreparation(true);};
async function submitPreparation(generate){
 if(preparing)return;
 const controls=['prepare','saveDraft','cameraButton','albumButton','replacePhoto','media','cameraMedia','continueSaved','warningChoose'];
 preparing=true;roomObjectPicker.lock(true);controls.forEach(id=>$(id).disabled=true);$('photoError').hidden=true;$('uploadProgress').hidden=false;$('uploadText').textContent='正在检查与保存照片…';
 let p=null,attemptedStart=false;
 try{
  if(files.length!==1)throw Error('请先选择一张房间照片。');await photoPromise;if(!selectedPhoto)throw Error('照片尚未通过检查，请重新选择。');
  const items=replacementId||skipFailedItems?[]:await roomObjectPicker.ready({draft:!generate});
  p=replacementId||draftProjectId?await api('/api/projects/'+(replacementId??draftProjectId)):null;
  if(!p){p=await api('/api/projects',{name:$('name').value,mode:'generation',prompt:$('prompt').value.trim()});draftProjectId=p.id;}
  if(!['DRAFT','FAILED'].includes(p.status)){openProject(p.id);throw Error('空间已开始处理，请在任务页继续查看，未重复提交。');}
  if(replacementVersion!==null&&replacementVersion!==p.updatedAt){replacementVersion=p.updatedAt;preparedPhoto=null;qualityAcknowledged=false;updatePreparationAction();throw Error('空间已在另一处更新，所选照片和物品已保留。请核对后再次点击生成，使用当前照片更新这个空间。');}
  if(preparedPhoto!==selectedPhoto){
   const version=p.uploads.length?(replacementVersion??p.updatedAt):undefined;
   const result=await upload(p.id,selectedPhoto,0,1,version);p=result.project;preparedPhoto=selectedPhoto;replacementVersion=p.updatedAt;
  }
  if(!replacementId&&(p.name!==$('name').value.trim()||p.prompt!==$('prompt').value.trim())){p=await api(`/api/projects/${p.id}/details`,{name:$('name').value,prompt:$('prompt').value.trim(),version:p.updatedAt});replacementVersion=p.updatedAt;}
  const saved=items.length?await saveObjectPhotos(p.id,items,(i,total,name)=>$('uploadText').textContent=`保存物品 ${i+1}/${total} · ${name}`):{jobs:[],errors:[],failedItems:failedObjectPhotos.get(p.id)??[]};
  if(items.length){roomObjectPicker.applySaveResult(saved);failedObjectPhotos.set(p.id,saved.failedItems);}
  if(saved.errors.length&&!skipFailedItems){continueSaved.hidden=false;throw Error('部分物品未保存成功，照片和填写内容已保留。可再次点击重试失败项，也可先生成已保存的内容。');}
  await photoDrafts.flush().catch(()=>{});
  const warnings=p.uploads.flatMap(u=>u.check?.warnings??[]),newWarnings=warnings.some(w=>!roomPhotoCheck?.warnings.includes(w));$('photoWarnings').hidden=!warnings.length;$('photoWarningText').textContent=warnings.join('；');if(newWarnings)qualityAcknowledged=false;
  if(roomPhotoCheck)roomPhotoCheck.warnings=[...new Set([...roomPhotoCheck.warnings,...warnings])];
  if(generate&&warnings.length&&!qualityAcknowledged){qualityAcknowledged=true;updatePreparationAction();$('photoWarnings').scrollIntoView({block:'nearest',behavior:'smooth'});return;}
  if(generate){
   attemptedStart=true;await api(`/api/projects/${p.id}/start`,{});
   const {jobs}=await api(`/api/projects/${p.id}/object-generations`),pending=jobs.filter(j=>j.state==='DRAFT');
   if(pending.length)await api(`/api/projects/${p.id}/object-generations/start`,{ids:pending.map(j=>j.id)});
  }
  await refresh();await photoDrafts.clear().catch(()=>{});openProject(p.id);roomObjectPicker.clear();draftProjectId=null;preparedPhoto=null;skipFailedItems=false;qualityAcknowledged=false;continueSaved.hidden=true;photoContextId='';
  notice(generate?'已开始处理，可以先离开，稍后回来查看。':'草稿已保存，尚未提交生成。');
 }catch(e){if(issuePresentation(e).global)setConnection(e);photoDrafts.schedule();$('photoError').textContent=e.message;$('photoError').hidden=false;if(attemptedStart&&p){await refresh().catch(()=>{});openProject(p.id);notice('请查看此空间的任务状态；未自动重复提交。'+e.message,true);}}
 finally{preparing=false;if(lastRouteHash!==location.hash)route();if(!$('photoScreen').hidden)photoDrafts.schedule();roomObjectPicker.lock(false);controls.forEach(id=>$(id).disabled=false);$('uploadProgress').hidden=true;}
}
let refreshPromise=null,lastLibrary='';
async function refresh(){
 if(refreshPromise)return refreshPromise;
 refreshPromise=(async()=>{
  projects=await api('/api/projects');$('libraryIssue').hidden=true;
  try{deletedProjects=await api('/api/deleted-projects');}catch(e){if($('deletedDialog').open){$('deletedError').textContent=issuePresentation(e,'最近删除').text;$('deletedError').hidden=false;}}
  renderDeleted();$('projectCount').textContent=projects.length+' 个项目';
  if(!$('photoScreen').hidden)configurePhoto();
  const libraryKey=JSON.stringify(projects.map(p=>[p.id,p.name,p.status,p.updatedAt,p.hasScene]));
  if(lastLibrary!==libraryKey){
   $('library').innerHTML=projects.length?projects.map(p=>`<div class="space-row"><button class="project" data-project="${p.id}">${p.status==='READY'||p.uploads.some(u=>u.kind==='image')?`<img class="project-image" data-fallback src="/api/projects/${p.id}/reference" alt="${escape(p.name)}的房间照片" loading="lazy">`:'<span class="project-placeholder" aria-hidden="true">◇</span>'}<span class="project-meta"><h3>${escape(p.name)}</h3><span class="status" data-status="${escape(p.status)}">${escape(names[p.status]??p.status)}</span><div class="muted">${p.hasScene?'已有保存方案':p.status==='READY'?'空间已就绪 · 开始试摆':p.mode==='generation'?'AI 空间生成':p.mode==='reconstruction'?'实景重建':'本地空间'}</div></span><span class="project-arrow" aria-hidden="true">›</span></button><button class="space-delete" type="button" data-delete="${p.id}" aria-label="删除空间 ${escape(p.name)}" title="删除空间">${deleteIcon}</button></div>`).join(''):'<p class="empty-state">这里还没有空间。拍一张房间照片，开始第一个项目。</p>';
   $('library').querySelectorAll('[data-project]').forEach(el=>el.onclick=async()=>{const p=projects.find(p=>p.id===el.dataset.project);if(p?.status==='READY'){await rememberProject(p.id);location.href=p.editorUrl;}else openProject(el.dataset.project);});$('library').querySelectorAll('[data-delete]').forEach(el=>el.onclick=()=>requestDelete(projects.find(p=>p.id===el.dataset.delete)));bindImages($('library'));lastLibrary=libraryKey;
  }
  const p=projects.find(p=>p.id===selected);
  if(p&&!$('projectScreen').hidden){
   const results=await Promise.allSettled([api(`/api/projects/${p.id}/object-generations`),api(`/api/effect-renders?project=${p.id}&resume=0`)]),issues={};
   if(results[0].status==='fulfilled')projectObjectJobs.set(p.id,results[0].value.jobs);else issues.jobs=results[0].reason;
   if(results[1].status==='fulfilled')projectEffects.set(p.id,results[1].value.latest);else issues.effect=results[1].reason;
   projectProgressIssues.set(p.id,issues);
   const signature=JSON.stringify([p,projectObjectJobs.get(p.id),projectEffects.get(p.id),Object.entries(issues).map(([key,e])=>[key,e.message])]);
   if(signature!==lastDetail){detail(p);lastDetail=signature;}
   const error=issues.jobs??issues.effect,box=$('projectIssue');box.hidden=!error;
   if(error){const issue=issuePresentation(error,issues.jobs?'物品进度':'效果图进度');box.querySelector('p').textContent=issue.text;box.querySelector('button').textContent='重试项目进度';box.querySelector('button').hidden=issue.auth;box.querySelector('a').hidden=!issue.auth;box.querySelector('a').href=pairingUrl();}
  }
  else if(!p&&!$('projectScreen').hidden){$('openProjectDiagnostics').hidden=true;$('detail').innerHTML='<p class="empty-state">没有找到这个项目，请返回“我的空间”选择已有项目。</p>';}
 })().then(value=>{setConnection(null);return value;}).catch(e=>{const issue=issuePresentation(e,'空间列表');if(issue.global)setConnection(e);else{setConnection(null);$('libraryIssue').hidden=false;$('libraryIssue').querySelector('p').textContent=issue.text;}throw e;}).finally(()=>refreshPromise=null);
 return refreshPromise;
}
function detail(p){const ui=checks.get(p.id)??{};checks.set(p.id,ui);
  const warnings=p.uploads.flatMap(u=>(u.check?.warnings??[]).map(w=>`${u.name}：${w}`)),isRecon=p.mode==='reconstruction',singleImageDraft=p.status==='DRAFT'&&p.mode==='generation'&&p.uploads.length===1&&p.uploads[0].kind==='image',message=singleImageDraft?'房间图片已就绪，开始生成三维空间。':p.message;
 $('projectTitle').textContent=p.name;
 $('openProjectDiagnostics').hidden=false;
 const progressIssues=projectProgressIssues.get(p.id)??{},jobs=projectObjectJobs.get(p.id)??[],draftJobs=jobs.filter(j=>j.state==='DRAFT');
 const progress=projectStepProgress(p,{jobs:projectObjectJobs.get(p.id),effect:projectEffects.get(p.id),effectKnown:projectEffects.has(p.id),jobsError:progressIssues.jobs?.message,effectError:progressIssues.effect?.message});
 if(progress.showDetails&&ui.detailsAttention!==progress.attentionKey){ui.detailsOpen=true;ui.detailsUserControlled=false;}else if(!progress.showDetails&&!ui.detailsUserControlled)ui.detailsOpen=false;ui.detailsAttention=progress.attentionKey;
 const nav=createStepNavigation({projectId:p.id,current:'prepare',ready:p.status==='READY',onNavigate:(step,event)=>{if(step!=='prepare')return;event.preventDefault();const details=$('preparationDetails');ui.detailsUserControlled=true;details.open=!details.open;ui.detailsOpen=details.open;event.currentTarget.setAttribute('aria-expanded',String(details.open));if(details.open)details.scrollIntoView({block:'nearest',behavior:'smooth'});}});projectSteps.replaceChildren(nav);
 projectIssueBox.remove();
 $('detail').innerHTML=`<details id="preparationDetails" class="preparation-details" ${ui.detailsOpen?'open':''}><summary>照片与物品详情<span class="tiny">${progress.total?' · '+progress.total+' 件物品':''}</span></summary><div id="preparationBody">
 <section class="preparation-room-state" data-state="${progress.room.state}"><strong>场景${escape(progress.room.label)}</strong><p>${escape(progress.room.needsResume?'电脑上的处理已中断，可继续已有场景任务。':p.status==='READY'?'场景已就绪，可通过上方试摆进入空间。':progress.room.state==='attention'?(p.error||message):message)}</p>${progress.room.state==='running'?'<progress aria-label="场景处理进度"></progress>':''}</section>
 ${progress.effectState==='attention'||progress.effectState==='running'?`<section class="preparation-effect-state" data-state="${progress.effectState}"><strong>空间效果图</strong><p>${escape(progress.effectError?'效果图进度暂未更新，请重试读取。':progress.effect?.message??'可在看效果中查看任务详情。')}</p>${p.status==='READY'?`<a href="${projectStepTargets(p.id).effects}">${progress.effectState==='attention'?'查看与重试效果图':'查看效果图进度'}</a>`:''}</section>`:''}
 
 <div class="project-actions">${p.status==='READY'?'':p.status==='DRAFT'?`<button id="start" class="primary">${singleImageDraft?'开始生成三维空间':p.mode==='generation'?'开始 AI 生成':isRecon?'开始实景重建':'开始本地提取'}</button>`:roomProgress(p).needsResume?'<button id="start">继续处理场景</button>':''}</div>
 ${p.uploads.some(u=>u.kind==='image')||p.status==='READY'?`<img class="project-cover" data-fallback src="/api/projects/${p.id}/reference" alt="${escape(p.name)}的参考照片">`:''}

 ${p.status==='FAILED'&&p.mode==='generation'?'<section class="room-retry"><button id="reselectRoom" class="primary" type="button">重新上传场景图片</button><p class="muted">替换当前项目的场景图片，保留已有物品和旧任务记录。照片先保存在电脑，确认开始生成后才会提交新的 AHOLO 任务并使用账号额度。</p><p class="muted">建议拍到地面、墙角与房间整体布局，避免只对着一面墙。</p></section>':''}
 ${p.status==='DRAFT'&&p.mode!=='ply'?'<div class="tip"><span>ⓘ</span><p>点击开始后，素材将发送到 AHOLO 并使用电脑上的账号额度。你可以离开此页，稍后从“我的空间”查看真实进度。</p></div>':''}
 ${p.counts&&p.status==='READY'?'<div class="tip"><span>ⓘ</span><p>空间已就绪。摆放前请核对地面高度、范围和物品实物尺寸。AI 补全的区域可能与真实房间不同。</p></div>':''}
 ${warnings.length&&p.status==='DRAFT'?`<div class="warn">照片有质量提醒。${p.mode==='generation'?'<button type="button" id="reviewRoomPhoto">返回选图检查</button>':warnings.map(escape).join('<br>')}</div>`:''}
 ${p.status==='DRAFT'&&isRecon?`<div class="capture"><h3>确认你的拍摄满足这些要求</h3>${[['staticScene','场景静态，没有明显移动的人或物'],['movingCamera','相机有平稳移动和视差，不只是原地旋转'],['overlap','相邻视角有充分重叠（建议至少约 70%）'],['coverage','已覆盖地面、墙角和复杂区域，未剪辑跳转'],['stableExposure','曝光与焦距稳定，没有严重模糊或剧烈变焦']].map(([id,label])=>`<label><input type="checkbox" data-check="${id}" ${ui[id]?'checked':''}> ${label}</label>`).join('')}${warnings.length?`<label><input type="checkbox" data-check="ackWarnings" ${ui.ackWarnings?'checked':''}> 已查看质量提示，仍希望继续重建</label>`:''}<p class="muted">自动检查无法核实所有覆盖、重叠及场景运动情况。</p></div>`:''}

 ${p.status==='SUBMIT_UNKNOWN'?'<button type="button" id="reviewExistingTask">核对已有场景任务</button>':''}
 ${p.status==='DRAFT'&&p.sceneAttempts?.length?'<button id="reselectRoom" type="button">再次更换场景图片</button>':''}
 </div></details>`;
 const preparationBody=$('preparationBody'),preparationDetails=$('preparationDetails'),prepareLink=nav.querySelector('[data-step=prepare]');preparationBody.prepend(projectIssueBox);prepareLink.setAttribute('aria-controls','preparationDetails');prepareLink.setAttribute('aria-expanded',String(preparationDetails.open));preparationDetails.querySelector('summary').addEventListener('click',()=>{ui.detailsUserControlled=true;});preparationDetails.addEventListener('toggle',()=>{if(!preparationDetails.isConnected)return;ui.detailsOpen=preparationDetails.open;prepareLink.setAttribute('aria-expanded',String(preparationDetails.open));});
 const deleteAction=document.createElement('button');deleteAction.type='button';deleteAction.className='delete-space-detail';deleteAction.textContent='删除这个空间';deleteAction.onclick=()=>requestDelete(p);$('detail').append(deleteAction);
 bindImages($('detail'));
 if($('reselectRoom'))$('reselectRoom').onclick=()=>reselectRoomPhoto(p);
 $('detail').querySelectorAll('[data-check]').forEach(el=>el.onchange=()=>{ui[el.dataset.check]=el.checked;});
 const taskSection=document.createElement('section');taskSection.className='project-object-tasks';taskSection.innerHTML='<p class="project-object-intro">空间与物品分别处理，可以离开页面，稍后继续。三维物品下载后仍需核对实物尺寸。</p><div data-project-tasks></div><button type="button" class="project-object-add">＋ 继续添加家具 / 装饰照片</button>';preparationBody.append(taskSection);$('detail').append(deleteAction);
 const priority=state=>['FAILED','PAUSED','SUBMIT_UNKNOWN'].includes(state)?0:['QUEUED','UPLOADING','RUNNING','DOWNLOADING'].includes(state)?1:state==='DRAFT'?2:3;
 const taskList=createObjectTaskList(taskSection.querySelector('[data-project-tasks]'),{projectId:p.id,onNotify:notice,onUpdate:async()=>{lastDetail='';await refresh();}});taskList.setJobs([...jobs].sort((a,b)=>priority(a.state)-priority(b.state)));const roomRetry=preparationBody.querySelector('.room-retry');if(roomRetry)preparationBody.querySelector('.preparation-room-state').after(roomRetry);if(['attention','running'].includes(progress.itemState))(roomRetry??preparationBody.querySelector('.preparation-room-state')).after(taskSection);preparationBody.append(deleteAction);
 $('openProjectDiagnostics').onclick=()=>openProjectDiagnostics(p);
 if($('reviewExistingTask'))$('reviewExistingTask').onclick=()=>openProjectDiagnostics(p);
 if($('reviewRoomPhoto'))$('reviewRoomPhoto').onclick=()=>reselectRoomPhoto(p);
 if(p.status==='DRAFT')taskSection.querySelector('[data-start]')?.setAttribute('hidden','');
 if(!projectUploaders.has(p.id))projectUploaders.set(p.id,createObjectUploadDialog({projectId:p.id,onNotify:notice,onSaved:async saved=>{failedObjectPhotos.set(p.id,saved.failedItems);lastDetail='';await refresh();}}));
 if(failedObjectPhotos.get(p.id)?.length)taskSection.querySelector('.project-object-add').textContent='重试未保存的 '+failedObjectPhotos.get(p.id).length+' 件物品';
 taskSection.querySelector('.project-object-add').onclick=()=>projectUploaders.get(p.id).open(failedObjectPhotos.get(p.id));
 if($('start')&&singleImageDraft&&draftJobs.length)$('start').textContent=`生成空间与 ${draftJobs.length} 件三维物品`;
 if($('start'))$('start').onclick=async()=>{try{$('start').disabled=true;await api(`/api/projects/${p.id}/start`,{captureChecklist:ui,ackWarnings:!!ui.ackWarnings});if(p.status==='DRAFT'&&draftJobs.length)await api(`/api/projects/${p.id}/object-generations/start`,{ids:draftJobs.map(j=>j.id)});lastDetail='';await refresh();}catch(e){notice(e.message,true);lastDetail='';await refresh().catch(()=>{});if($('start'))$('start').disabled=false;}};
}
function openProjectDiagnostics(p){
 document.querySelector('.app-help').open=false;
 diagnostics.querySelector('[data-diagnostics]').innerHTML=`<p>${escape(p.name)} · ${escape(names[p.status]??p.status)}</p><div class="project-meta-details"><p>${p.worldId?'World '+escape(p.worldId)+' · ':''}电脑项目 ${escape(p.id)}</p>${p.counts?`<p>${p.counts.floor} 个地面 · ${p.counts.walls} 段墙候选 · 地面拟合误差 ${(p.counts.rmse*100).toFixed(1)} cm（非测量精度）</p>`:''}<p>文件保存在电脑本地：local-data/projects/${escape(p.id)}。候选墙体不参与吸附或碰撞。</p><p>处理记录：${escape(p.message)}</p>${p.error?`<p class="error">${escape(p.error)}</p>`:''}</div>
 ${p.uploads.length?`<details><summary>已保存照片与检查记录</summary>${p.uploads.map(u=>`<div class="input-item">${escape(u.name)}<p>${(u.size/1024**2).toFixed(1)} MB${u.check?.width?` · ${u.check.width} × ${u.check.height} 像素`:''}</p>${(u.check?.warnings??[]).map(w=>'<p>'+escape(w)+'</p>').join('')}</div>`).join('')}</details>`:''}
 ${p.status==='READY'?`<details><summary>高级设置与结构修复</summary><label>源坐标向上轴<select id="upAxis"><option ${p.upAxis==='Z'?'selected':''}>Z</option><option ${p.upAxis==='Y'?'selected':''}>Y</option></select></label><button id="extractAgain" type="button">重新提取结构</button></details>`:''}
 ${['SUBMIT_UNKNOWN','FAILED','PAUSED'].includes(p.status)?`<details ${p.status==='SUBMIT_UNKNOWN'?'open':''}><summary>核对已有任务（高级恢复）</summary><label for="recoverId">已有场景任务编号</label><input id="recoverId" type="text" placeholder="从 AHOLO 任务记录中复制 World ID" value="${escape(p.worldId??'')}"><button id="recover" type="button">查询并恢复</button></details>`:''}
 ${p.sceneAttempts?.length?`<details><summary>场景任务历史 · ${p.sceneAttempts.length} 条</summary>${p.sceneAttempts.map(a=>`<div class="input-item">${escape(names[a.status]??a.status)} · ${escape(new Date(a.archivedAt).toLocaleString('zh-CN'))}${a.worldId?'<p>World '+escape(a.worldId)+'</p>':''}${a.error?'<p>'+escape(a.error)+'</p>':''}</div>`).join('')}</details>`:''}`;
 if($('recover'))$('recover').onclick=async()=>{const button=$('recover');try{button.disabled=true;await api(`/api/projects/${p.id}/recover`,{worldId:$('recoverId').value.trim()});diagnostics.close();lastDetail='';await refresh();}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
 if($('extractAgain'))$('extractAgain').onclick=async()=>{const button=$('extractAgain');try{button.disabled=true;const result=await api(`/api/projects/${p.id}/extract`,{upAxis:$('upAxis').value});if(result.status!=='READY')throw Error(result.error??result.message);diagnostics.close();lastDetail='';await refresh();notice('结构已更新，请重新打开空间核对。');}catch(e){notice(e.message,true);}finally{button.disabled=false;}};
 if(!diagnostics.open)diagnostics.showModal();
}
function setConnection(error){connectionError=error;const issue=error?issuePresentation(error):null;$('connectionBar').hidden=!error;$('refresh').hidden=true;$('refreshProject').hidden=true;$('retryConnection').hidden=!!issue?.auth;$('pairConnection').hidden=!issue?.auth;$('pairConnection').href=pairingUrl();if(error){$('connectionBar').querySelector('span').textContent=issue.text;$('doctor').textContent=issue.auth?'手机需要重新配对':'电脑连接暂时中断';}else $('doctor').textContent='电脑已连接'+(doctor?(doctor.geometryAvailable&&doctor.mediaChecksAvailable?' · 本地处理可用':' · 本地依赖需检查'):'');}
for(const id of ['libraryIssue','projectIssue'])$(id).querySelector('button').onclick=()=>refresh().catch(()=>{});
$('retryConnection').onclick=()=>refresh().catch(()=>{});
$('refresh').onclick=()=>refresh().catch(()=>{});$('refreshProject').onclick=$('refresh').onclick;
$('example').onclick=async()=>{try{$('example').disabled=true;notice('正在打开已有客厅，首次使用会在电脑上提取结构…');const p=await api('/api/example',{});await refresh();openProject(p.id);}catch(e){notice(e.message,true);}finally{$('example').disabled=false;}};
api('/api/doctor').then(value=>{doctor=value;if(!connectionError)setConnection(null);if(!doctor.apiKeyConfigured)notice('AHOLO 密钥未配置；已有空间仍可查看和试摆。');}).catch(e=>{if(issuePresentation(e).global)setConnection(e);else $('doctor').textContent='电脑已连接 · 本地状态待检查';});
await refresh().catch(()=>{});
setInterval(()=>{if(!preparing&&!projectMutation)refresh().catch(()=>{});},4000);
