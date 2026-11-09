// Shared conversions and project navigation used by the UI.
export function projectStepTargets(projectId){
 if(projectId!=null&&!/^[a-f0-9-]{36}$/.test(projectId))throw Error('项目 ID 无效');
 const editor=projectId?'/structure_editor.html?project='+projectId:null;
 return {prepare:projectId?'/#space/'+projectId:'/#photo',place:editor,effects:editor?editor+'&step=effects':null};
}
export function pageRefreshDelay({screen,roomStates=[],objectStates=[],effectStates=[]}){
 if(screen==='photo')return null;
 const active=['QUEUED','UPLOADING','WAITING','DOWNLOADING','EXTRACTING','RUNNING','PREPARING','GENERATING'];
 return [...roomStates,...objectStates,...effectStates].some(state=>active.includes(state))?4000:15000;
}
// One request at a time; hidden pages sleep until the browser signals a wake-up.
export function createPagePoller({run,delay,visible=()=>true,paused=()=>false,schedule=setTimeout,unschedule=clearTimeout}){
 let stopped=true,timer=null,running=null,wakePending=false;
 const clear=()=>{if(timer!==null)unschedule(timer);timer=null;};
 function arm(){clear();if(stopped||!visible())return;const ms=delay();if(ms!==null)timer=schedule(tick,ms);}
 function tick(){
  clear();if(stopped||!visible()||delay()===null)return Promise.resolve();if(running){wakePending=true;return running;}if(paused()){arm();return Promise.resolve();}
  running=Promise.resolve().then(run).catch(()=>{}).finally(()=>{running=null;if(stopped)return;if(wakePending){wakePending=false;tick();}else arm();});return running;
 }
 return {start(){if(!stopped)return;stopped=false;arm();},stop(){stopped=true;wakePending=false;clear();},wake(){return tick();}};
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
// Partial measurements remain separate from resolved dimensions until model proportions are known.
export function photoMeasurements(value,{draft=false}={}){
 const keys=['width','depth','height'],size=Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
 if(!Object.keys(size).length)return {};
 const invalid=keys.find(k=>size[k]!==undefined&&(!Number.isFinite(size[k])||size[k]<.01||size[k]>20));
 const missing=keys.find(k=>size[k]===undefined);
 if(invalid){const error=Error('请填写 1–2000 厘米的尺寸。');error.field=invalid;throw error;}
 return missing?{draftSize:size}:{size};
}
export const preparationLabel=({replacement=false,confirmQuality=false}={})=>confirmQuality?'仍然生成':replacement?'用新照片重新生成':'开始生成空间';
// A display fingerprint, never an authorization or integrity check. Works on LAN HTTP too.
export function planFingerprint(scene){
 if(!scene)return null;
 const frame=scene.renderFrame??'viewport',camera=scene.camera;
 const content={projectId:scene.projectId,worldId:scene.worldId,structure:scene.structure,sceneScale:scene.sceneScale,
  objects:scene.objects?.filter(o=>o.visible).map(o=>({assetId:o.assetId,assetKind:o.assetKind,pose:o.pose,size:o.size})),
  camera:camera?{rows:camera.rows,verticalFov:camera.verticalFov,frame,aspect:frame==='viewport'?(camera.viewAspect??(camera.resolution?camera.resolution[0]/camera.resolution[1]:undefined)):undefined}:null};
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
// Keep the complete current view; only pad to the inference service's pixel grid.
export function currentViewCapture(aspect){
 const {width,height}=effectDimensions('viewport',aspect),imageWidth=Math.min(width,Math.max(1,Math.round(height*aspect))),imageHeight=Math.min(height,Math.max(1,Math.round(width/aspect)));
 return {width,height,imageWidth,imageHeight,left:Math.floor((width-imageWidth)/2),top:Math.floor((height-imageHeight)/2)};
}
export function createDirectEffectAction({open,canGenerate,generate}){
 let running=false;
 return async()=>{if(running)return false;running=true;try{await open();if(!canGenerate())return false;await generate();return true;}finally{running=false;}};
}
export function canGenerateCurrentView({open,projectId,error,loading,submitting,state,effectsEnabled,personalEnabled,configured,consented}){
 return !!(open&&projectId&&!error&&!loading&&!submitting&&!['QUEUED','PREPARING','GENERATING','WAITING','SUBMIT_UNKNOWN'].includes(state)&&(personalEnabled?configured&&consented:effectsEnabled));
}
export function taskPresentation(state,{hasId=false}={}){
 if(state==='READY')return {label:'已就绪',action:'放入空间'};
 if(state==='SUBMIT_UNKNOWN')return {label:'待核对',action:'核对任务'};
 if(state==='FAILED')return {label:'未完成',action:'重新生成'};
 if(state==='PAUSED')return {label:'待继续',action:hasId?'继续完成':'核对任务'};
 if(state==='DRAFT')return {label:'待生成',action:'开始生成'};
 return {label:['QUEUED','UPLOADING'].includes(state)?'准备中':'生成中',action:null};
}
