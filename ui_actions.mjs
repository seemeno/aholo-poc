// Shared conversions and project navigation used by the UI.
export function projectStepTargets(projectId){
 if(projectId!=null&&!/^[a-f0-9-]{36}$/.test(projectId))throw Error('项目 ID 无效');
 const editor=projectId?'/structure_editor.html?project='+projectId:null;
 return {prepare:projectId?'/#space/'+projectId:'/#photo',place:editor,effects:editor?editor+'&step=effects':null};
}
export function createStepNavigation({projectId=null,current='prepare',ready=true,onNavigate}={}){
 const targets=projectStepTargets(projectId),nav=document.createElement('nav');nav.className='project-steps';nav.setAttribute('aria-label','空间操作步骤');
 const list=document.createElement('ol');nav.append(list);
 for(const [index,[step,label]]of [['prepare','准备空间'],['place','试摆'],['effects','看效果']].entries()){
  const item=document.createElement('li'),link=document.createElement('a'),number=document.createElement('span');number.className='step-number';number.textContent=index+1;number.setAttribute('aria-hidden','true');
  const title=document.createElement('span');title.className='step-title';title.append(number,document.createTextNode(label));link.append(title);link.dataset.step=step;link.setAttribute('aria-label',(index+1)+' '+label);
  if(targets[step])link.href=targets[step];
  const disabled=!targets[step]||(step!=='prepare'&&!ready);
  if(disabled){link.setAttribute('aria-disabled','true');link.tabIndex=-1;link.title='空间就绪后可进入试摆和看效果';}
  link.addEventListener('click',event=>{if(disabled){event.preventDefault();return;}if(onNavigate)onNavigate(step,event);else if(step===current)event.preventDefault();});item.append(link);list.append(item);
 }
 nav.setCurrent=step=>{for(const link of nav.querySelectorAll('[data-step]')){if(link.dataset.step===step)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');}};
 nav.setCurrent(current);return nav;
}
export function placementDraft(values){
 const result={pose:{},size:{}};
 for(const key of ['x','y','z','yaw','width','depth','height']){
  const raw=String(values[key]??'').trim(),value=Number(raw);
  if(!raw||!Number.isFinite(value)||(['width','depth','height'].includes(key)&&value<=0)){
   const error=Error(['width','depth','height'].includes(key)?'请填写大于 0 的尺寸（厘米）。':'请填写有效的位置或角度。');error.field=key;throw error;
  }
  if(['width','depth','height'].includes(key))result.size[key]=value/100;
  else result.pose[key]=key==='yaw'?value*Math.PI/180:value;
 }
 return result;
}
export const centimeters=value=>Number((value*100).toFixed(4));
// Draft measurements are retained separately until all three axes are known.
export function photoMeasurements(value,{draft=false}={}){
 const keys=['width','depth','height'],size=Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
 if(!Object.keys(size).length)return {};
 const invalid=keys.find(k=>size[k]!==undefined&&(!Number.isFinite(size[k])||size[k]<.01||size[k]>20));
 const missing=keys.find(k=>size[k]===undefined);
 if(invalid||missing&&!draft){const error=Error(invalid?'请填写 1–2000 厘米的尺寸。':'请补全宽、深、高，或先保存草稿，稍后填写。');error.field=invalid??missing;throw error;}
 return missing?{draftSize:size}:{size};
}
export const preparationLabel=({replacement=false,confirmQuality=false}={})=>confirmQuality?'仍然生成':replacement?'用新照片重新生成':'开始生成空间';
// A display fingerprint, never an authorization or integrity check. Works on LAN HTTP too.
export function planFingerprint(scene){
 if(!scene)return null;
 const frame=scene.renderFrame??'viewport',camera=scene.camera;
 const content={projectId:scene.projectId,worldId:scene.worldId,structure:scene.structure,sceneScale:scene.sceneScale,
  objects:scene.objects?.filter(o=>o.visible).map(o=>({assetId:o.assetId,assetKind:o.assetKind,pose:o.pose,size:o.size})),
  camera:camera?{rows:camera.rows,verticalFov:camera.verticalFov,frame,aspect:frame==='viewport'&&camera.resolution?camera.resolution[0]/camera.resolution[1]:undefined}:null};
 const stable=v=>typeof v==='number'?Math.round(v*1e5)/1e5:v&&typeof v==='object'?Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
 let hash=14695981039346656037n;for(const c of JSON.stringify(stable(content))){hash^=BigInt(c.codePointAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}
 return hash.toString(16).padStart(16,'0');
}
export function imageDimensions(aspect,longEdge=1280){
 if(!Number.isFinite(aspect)||aspect<=0)throw Error('画面比例无效');
 return aspect>=1?{width:longEdge,height:Math.max(1,Math.round(longEdge/aspect))}:{width:Math.max(1,Math.round(longEdge*aspect)),height:longEdge};
}
export function effectDimensions(frame,viewportAspect){
 if(!['landscape','portrait','viewport'].includes(frame))throw Error('成图画幅无效');
 const aspect=frame==='landscape'?16/9:frame==='portrait'?3/4:viewportAspect;
 if(!Number.isFinite(aspect)||aspect<=0)throw Error('画面比例无效');
 return aspect>=1?{width:1024,height:Math.max(256,Math.round(1024/aspect/16)*16)}:{width:Math.max(256,Math.round(1024*aspect/16)*16),height:1024};
}
export function taskPresentation(state,{hasId=false}={}){
 if(state==='READY')return {label:'已就绪',action:'放入空间'};
 if(state==='SUBMIT_UNKNOWN')return {label:'待核对',action:'核对任务'};
 if(state==='FAILED')return {label:'未完成',action:'重新生成'};
 if(state==='PAUSED')return {label:'待继续',action:hasId?'继续完成':'核对任务'};
 if(state==='DRAFT')return {label:'待生成',action:'开始生成'};
 return {label:['QUEUED','UPLOADING'].includes(state)?'准备中':'生成中',action:null};
}
