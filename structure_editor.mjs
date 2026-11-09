import {createEditorCapture} from './editor_capture.mjs';
import {createEditorUI} from './editor_ui.mjs';
import {createEditorPersistence} from './editor_persistence.mjs';
import {createConsumerEditor} from './consumer_editor.mjs';
import {installButtonHints} from './button_hints.mjs';
import {createAppOrientation} from './app_orientation.mjs';
import {assertUniformSize} from './uniform_scale.mjs';
import {configureDeployment,getDeployment,rewriteServiceCopy} from './deployment_ui.mjs';
import {findInitialPlacement,initializeQuickTryOn,resizedPlacement,resolveMeasurements} from './try_on.mjs';
import {createEditorViewport} from './editor_viewport.mjs';
import {footprint,snapFloor,columnMatrix,placementWarnings,floorContains} from './placement.mjs';
import {floorPolygon,floorTriangles,wallTriangles,validateStructure} from './geometry.mjs';
import {changeWall,removeWall} from './wall_edit.mjs';
import {scaleCalibration} from './editor_calibration.mjs';
import {validateScene,ASSETS} from './scene_state.mjs';
import {structureGlb} from './structure_mesh.mjs';
import {legacyObject,BUILTIN_OBJECT,objectsOverlap,placementCamera,randomUuidV4} from './object_state.mjs';
import {restoreWhenReady} from './restore_gate.mjs';
import {createEffectView} from './effect_ui.mjs';
import {createEditorObjectGeneration} from './object_generation_ui.mjs';
import {requestJson,issuePresentation,pairingUrl} from './ui_network.mjs';
import {placementDraft,centimeters,planFingerprint,projectStepTargets} from './ui_actions.mjs';
import {roomEnvelope,gizmoPlacement} from './editor_room.mjs';
import {createSceneObjectList} from './scene_object_list.mjs';
await configureDeployment();
const $=id=>document.getElementById(id),ctx=$('plan').getContext('2d');
const editorMain=$('editorMain');let mobileLayout=matchMedia('(max-width: 900px), (max-height: 520px) and (max-width: 1100px)').matches;
const appOrientation=createAppOrientation(document,[document.querySelector('.editor-header'),$('saveRecovery'),$('loadError'),editorMain]);
editorMain.classList.add('compact');
$('panelToggle').textContent=mobileLayout?'打开面板':'收起面板';$('panelToggle').setAttribute('aria-expanded',String(!mobileLayout));
const projectId=new URLSearchParams(location.search).get('project');
if(projectId&&!/^[a-f0-9-]{36}$/.test(projectId))throw Error('项目 ID 无效');
if(projectId){$('projectProgressLink').href='/#space/'+projectId;$('projectProgressLink').hidden=false;}
let projectInfo=null,consumerUI=null,tryOnState;
const projectBase=projectId?'/api/projects/'+projectId:null,sceneEndpoint=projectBase?projectBase+'/scene':'/api/scene';
const asset=name=>projectBase?projectBase+'/assets/'+name:'./assets/demo/'+name;
const sceneLoad=document.createElement('section');sceneLoad.id='sceneLoadState';sceneLoad.setAttribute('role','status');sceneLoad.innerHTML='<strong>正在准备空间</strong><p data-message>正在读取空间文件，加载完成后即可继续试摆。</p><button type="button" hidden>重试三维画面</button>';$('stage').append(sceneLoad);
const sceneCover=document.createElement('img');sceneCover.id='sceneLoadingCover';sceneCover.alt='房间照片预览，正在准备三维空间';sceneCover.src=projectBase?projectBase+'/reference':'/assets/ui/room.png';sceneCover.onerror=()=>{sceneCover.removeAttribute('src');sceneCover.style.display='none';};$('stage').append(sceneCover);
function loadingScene(message,error=false){sceneLoad.hidden=!message;sceneCover.hidden=!message||error;sceneLoad.dataset.error=String(error);sceneLoad.querySelector('strong').textContent=error?'三维画面暂不可用':'正在准备空间';sceneLoad.querySelector('[data-message]').textContent=message??'';sceneLoad.querySelector('button').hidden=!error;}
const readJson=async url=>{for(;;){try{const value=await requestJson(url);$('loadError').hidden=true;return value;}catch(e){const issue=issuePresentation(e,'空间文件');$('loadErrorText').textContent=issue.text;$('retryLoad').hidden=issue.auth;$('pairLoad').hidden=!issue.auth;$('pairLoad').href=pairingUrl();$('loadError').hidden=false;await new Promise(resolve=>$('retryLoad').onclick=()=>{$('loadError').hidden=true;resolve();});}}};
let structure=await readJson(asset('structure.json'));
let preview=await readJson(asset('point_preview.json'));
const initialTransform=structuredClone(structure.sourceToAligned);const sourcePreview=preview.sourceXyz??preview.xyz.map(p=>p.map((v,i)=>(v-initialTransform[i][3])/initialTransform[i][i]));
let pose={x:0,y:3,z:structure.floor.z,yaw:0},size={width:1.8,depth:.4,height:.55},sceneScale=1,currentView='plan',pendingCamera=null;
let objects=[],activeObjectId=null,objectAssets=[],rememberedCamera=null,history=[],historyIndex=-1,historyTimer=null;
let selectionKind='scene',transformMode='translate',cameraRoom=roomEnvelope(structure,preview.xyz);
const interactionTools=document.createElement('div');interactionTools.id='transformTools';interactionTools.setAttribute('role','group');interactionTools.setAttribute('aria-label','物品坐标轴操作');interactionTools.innerHTML='<button id="selectScene" type="button" aria-label="选中场景，浏览视角" title="选中场景，浏览视角">◉</button><button id="translateTool" type="button" aria-label="平移物品" title="平移物品">✥</button><button id="rotateTool" type="button" aria-label="旋转物品" title="绕竖轴旋转物品">↻</button><button id="scaleTool" type="button" aria-label="缩放物品" title="缩放物品">⤢</button><button id="inspectObject" type="button" aria-label="精确尺寸与物品操作" title="精确尺寸与物品操作">☷</button>';$('stage').append(interactionTools);
const selectionLabel=document.createElement('div');selectionLabel.id='selectionState';selectionLabel.setAttribute('role','status');$('stage').append(selectionLabel);
for(const [id,label,symbol]of [['expandScene','放大三维视图','⛶']]){const button=document.createElement('button');Object.assign(button,{id,type:'button',textContent:symbol,title:label});button.setAttribute('aria-label',label);$('toolbar').append(button);}
const sceneList=createSceneObjectList($('stage'),{storageKey:'scene-list:'+(projectId??structure.worldId),onSelect:id=>selectObject(id),onVisibility:id=>toggleSceneObject(id),onFocus:async id=>{if(selectObject(id))await furnitureCamera(1);},onRemove:id=>{if(selectObject(id))$('removeObject').click();},onAdd:()=>{objectGeneration.open?.();}});
function updateSceneList(){sceneList.update(objects,selectionKind==='object'?activeObjectId:null,objectAssets,projectBase);}
function toggleSceneObject(id){if(effectCapture.busy||!flushPlacementEdits())return;const object=objects.find(o=>o.id===id);if(!object)return;recordHistory();commitObject();object.visible=!object.visible;objectMenu();draw();refreshThree();checkpoint();status(object.name+(object.visible?'已显示。':'已隐藏，可在列表中恢复。'));}
const ceilingControl=document.createElement('label');ceilingControl.innerHTML='室内层高（米）<input id="roomHeight" type="number" min="0.5" max="20" step="0.05"><small id="roomBoundaryNote"></small>';$('structureTools').prepend(ceilingControl);
$('roomHeight').onchange=()=>{const height=number('roomHeight');if(!Number.isFinite(height)||height<.5||height>20){$('roomHeight').value=cameraRoom.height.toFixed(2);status('层高请输入 0.5 到 20 米，已保留原层高。');return;}structure.roomHeight=height;for(const w of structure.walls)if(w.source==='MANUAL')w.height=height;refreshRoomEnvelope();draw();refreshThree();checkpoint();status('已更新室内层高与视角边界。');};
// Keep calibration inside the plan viewport; reuse the existing controls and handlers.
const planCalibration=document.createElement('section');planCalibration.id='planCalibration';planCalibration.dataset.planOnly='';planCalibration.hidden=true;planCalibration.setAttribute('aria-label','2D 空间校正');
planCalibration.innerHTML='<header><h2>空间校正 <small>米</small></h2><div id="planActions" role="group" aria-label="平面绘制与历史"></div></header><div id="planWallTools"><button id="drawWall" type="button">＋ 画墙线</button><span id="wallEditInfo">点选墙线，拖动圆点修改</span><button id="deleteWall" type="button" title="删除选中墙线" aria-label="删除选中墙线" disabled>⌫</button></div><div id="planLevels" class="plan-fields"></div><div id="planScale"></div><small id="planBoundaryNote"></small><p id="planFeedback" role="status" aria-live="polite" hidden></p>';
$('stage').append(planCalibration);
const floorLevel=$('floorZ').closest('label');floorLevel.firstChild.textContent='地面高度';ceilingControl.firstChild.textContent='室内层高';
$('planLevels').append(floorLevel,ceilingControl);$('floorform').remove();
const scaleControl=$('scale').closest('label');scaleControl.firstChild.textContent='房间比例';$('calibrate').textContent='应用比例';$('planScale').append(scaleControl,$('calibrate'));
$('roomBoundaryNote').remove();
const planActions=$('planActions');planActions.append($('drawFloor'));
$('drawFloor').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 17 2-11 11-2 2 14-15-1Z"/><path d="M3 15h4v4H3Zm2-11h4v4H5Zm11-2h4v4h-4Zm2 14h4v4h-4Z" fill="currentColor" stroke="none"/></svg>画轮廓';$('drawFloor').setAttribute('aria-label','画地面轮廓');
for(const [id,label,symbol,delta]of [['planUndo','撤销空间校正','↶',-1],['planRedo','重做空间校正','↷',1]]){const button=document.createElement('button');Object.assign(button,{id,type:'button',title:label,textContent:symbol,disabled:true});button.setAttribute('aria-label',label);button.onclick=()=>undoRedo(delta);planActions.append(button);}
const preciseContour=$('polygon').closest('details');preciseContour.querySelector('summary').textContent='精确轮廓数据';document.querySelector('.app-help').append(preciseContour);
$('stage').append($('structure3d'));$('structureDrawTools').remove();$('structureTools').remove();
const renderFrame='viewport';
const effectCapture=createEditorCapture({projectId,viewport:()=>viewport.state,view:()=>currentView,requireEdits:requirePlacementEdits,commitObject,objects:()=>objects,openView:view,ensureObjects,snapshot,persist:scene=>persistScene(scene),sync:()=>consumerUI?.sync()});
let placementDirty=false,placementSizeAxis=null,editorReady=false;
const placementFields=['x','y','z','yaw','width','depth','height'];
function syncSize(){for(const key of ['width','depth','height'])$(key).value=centimeters(size[key]);}
function clearPlacementError(){for(const key of placementFields){$(key).setCustomValidity('');$(key).removeAttribute('aria-invalid');}$('placementError').hidden=true;}
function flushPlacementEdits(){
 if(!placementDirty){placementSizeAxis=null;return true;}
 clearPlacementError();
 try{const draft=placementDraft(Object.fromEntries(placementFields.map(key=>[key,$(key).value]))),resolved=placementSizeAxis?resolveMeasurements(size,{[placementSizeAxis]:draft.size[placementSizeAxis]}):null;if(resolved)draft.size=resolved.size;assertUniformSize(size,draft.size);if(!apply(draft.pose,draft.size))throw Error($('status').textContent);if(resolved&&activeObject())Object.assign(activeObject(),{measuredAxes:resolved.measuredAxes,sizeBasis:resolved.sizeBasis});placementDirty=false;placementSizeAxis=null;syncSize();return true;}
 catch(e){$('placementError').textContent=e.message;$('placementError').hidden=false;if(e.field){$(e.field).setCustomValidity(e.message);$(e.field).setAttribute('aria-invalid','true');}return false;}
}
function requirePlacementEdits(){if(!flushPlacementEdits()){if(currentView==='plan')view('gaussian');openPanel('objects','placementSection');throw Error('请先修正标出的尺寸或位置，本次操作尚未执行。');}}

const persistence=createEditorPersistence({$,editorMain,projectId,endpoint:sceneEndpoint,recoveryKey:'scene-recovery:'+(projectId??structure.worldId),placementFields,
 snapshot,restore,recordHistory,checkpoint,status:text=>status(text),busy:()=>effectCapture.busy,isDirty:()=>placementDirty,wallDragging:()=>!!wallDrag,requireEdits:requirePlacementEdits,
 restoreFields:fields=>{for(const key of placementFields)$(key).value=fields[key];placementDirty=true;}
});
const {persistScene,scheduleAutoSave,showRecovery,keepLocalCopy,restoreSaved,paintSaveButton}=persistence;persistence.bind();
const viewport=createEditorViewport({$,structure:()=>structure,room:()=>cameraRoom,objects:()=>objects,view:()=>currentView,busy:()=>effectCapture.busy,ready:()=>editorReady,mobile:()=>mobileLayout,
 pendingCamera:()=>pendingCamera,rememberCamera:value=>{pendingCamera=value;},pointer:(event,canvas)=>appOrientation.pointer(event,canvas),
 suspend:()=>consumerUI?.suspend(),bindInput:()=>consumerUI?.bind(),openView:view,loading:loadingScene,status:text=>status(text),asset,
 onCameraCommit:checkpoint,onSelection:updateSelectionTools,refresh:refreshThree,ensureObjects,loadTemplate:objectTemplate,
 onTransformDrag:dragging=>{if(dragging){recordHistory();persistence.cancelAutoSave();}else{updateSelectionTools();recordHistory();scheduleAutoSave();}},onTransformChange:applyTransformChange,
 onHidden:()=>{if(editorReady&&!effectCapture.busy&&(placementDirty||persistence.state.dirty))keepLocalCopy().catch(()=>{});}
});
const {setupThree,loadSplat,layoutThree,constrainCamera,cameraRows,restoreCamera,centerSceneCamera,syncViewerActivity}=viewport;viewport.bindLifecycle();sceneLoad.querySelector('button').onclick=viewport.recoverViewer;
const editorUI=createEditorUI({$,main:editorMain,orientation:appOrientation,mobile:()=>mobileLayout,view:()=>currentView,editing:()=>editMode,busy:()=>effectCapture.busy,wallDragging:()=>!!wallDrag,
 viewport:()=>viewport.state,tools:interactionTools,suspend:()=>consumerUI?.suspend(),precise:()=>consumerUI?.precise(),minimizeObjects:()=>sceneList.minimize(),draw,layout:layoutThree,openView:view,requireEdits:requirePlacementEdits,paintSaveButton:()=>paintSaveButton(persistence.state.version?'saved':'idle')});
const {status,setPanelGroup,openPanel,closePanel,syncViewTools}=editorUI;editorUI.bind();
function applyTransformChange(s){
 const {transform,transformProxy}=s;
   if(!transform.dragging||effectCapture.busy)return;let candidate;try{const position=transformProxy.position.toArray();position[2]-=transformProxy.scale.z/2;candidate=gizmoPlacement(position,transformProxy.rotation.z,transformProxy.scale.toArray());if(transformMode==='scale'){assertUniformSize(size,candidate.size);candidate.pose={...pose};}}catch(e){status(e.message);resetTransformProxy();return;}
   const previousMode=$('mode').value;if(transformMode==='translate'&&transform.axis?.includes('Z'))$('mode').value='free';
   if(!apply(candidate.pose,candidate.size)){$('mode').value=previousMode;resetTransformProxy();}else{syncSize();resetTransformProxy();}

}

const activeObject=()=>objects.find(o=>o.id===activeObjectId);
function commitObject(){const o=activeObject();if(o)Object.assign(o,{pose:{...pose},size:{...size},mode:$('mode').value,selectedWall:'',gap:.02,back:activeObject()?.back??'+Y',align:false});}
function objectMenu(){
  if($('objectEmptyHint'))$('objectEmptyHint').hidden=objects.length>0;
  const o=activeObject();$('objectName').value=o?.name??'';
  for(const id of ['objectName','removeObject','duplicateObject','replaceAsset','apply','x','y','z','yaw','width','depth','height','mode'])$(id).disabled=!o;
  updateSelectionTools();
}
function selectObject(id){if(effectCapture.busy||!flushPlacementEdits())return;commitObject();const o=objects.find(o=>o.id===id);if(!o)return;selectionKind='object';activeObjectId=id;pose={...o.pose};size={...o.size};syncSize();$('mode').value=o.mode==='free'||Math.abs(o.pose.z-structure.floor.z)>.002?'free':'floor';sync();objectMenu();draw();refreshThree();return true;}
function selectScene(){if(effectCapture.busy||!flushPlacementEdits())return;consumerUI?.direct();selectionKind='scene';updateSelectionTools();draw();status('已选中场景：拖动背景原地转头，双指平移或捏合缩放；轻点物品开始调整。');}
function updateSelectionTools(){
 const o=selectionKind==='object'?activeObject():null,editable=!!o&&o.visible;
 selectionLabel.textContent=o?'已选物品 · '+o.name+(o.visible?'':'（隐藏）'):'';selectionLabel.hidden=!o;selectionLabel.dataset.selection=o?'object':'scene';
 $('selectScene').setAttribute('aria-pressed',String(!o));updateSceneList();consumerUI?.sync();
 for(const [id,mode]of [['translateTool','translate'],['rotateTool','rotate'],['scaleTool','scale']]){$(id).disabled=!editable;$(id).setAttribute('aria-pressed',String(editable&&transformMode===mode));}
 $('inspectObject').disabled=!o;
 const s=viewport.state;if(!s?.transform)return;
 const available=editable&&currentView!=='plan'&&!effectCapture.busy;
 if(!available){s.transform.detach();s.selectionBox.visible=false;return;}
 if(!s.transform.dragging){s.transformProxy.position.set(o.pose.x,o.pose.y,o.pose.z+o.size.height/2);s.transformProxy.rotation.set(0,0,o.pose.yaw);s.transformProxy.scale.set(o.size.width,o.size.depth,o.size.height);}
 s.transform.setMode(transformMode);s.transform.setSpace(transformMode==='translate'?'world':'local');s.transform.showX=transformMode!=='rotate';s.transform.showY=transformMode!=='rotate';s.transform.showZ=!(consumerUI?.simple&&transformMode==='translate');
 if(s.transform.object!==s.transformProxy)s.transform.attach(s.transformProxy);
 const root=s.roots.get(o.id);s.selectionBox.visible=!!root;if(root){root.updateMatrixWorld(true);s.selectionBox.setFromObject(root);}
}
async function chooseTransform(mode){if(effectCapture.busy||!flushPlacementEdits())return;if(!activeObject()||selectionKind!=='object')return status('先点选画面中的物品。');consumerUI?.suspend();consumerUI?.direct();transformMode=mode;if(currentView==='plan')await view('gaussian');updateSelectionTools();status(({translate:consumerUI?.simple?'直接拖物品或水平箭头贴地移动；离地高度在物品属性中调整。':'拖动彩色箭头或轴面平移，蓝色轴调整离地高度。',rotate:'拖动蓝色圆环旋转物品，保持物品直立。',scale:'拖动金色单轴末端手柄等比缩放，宽、深、高一起变化；请核对实物尺寸。'})[mode]);}
for(const [id,mode]of [['translateTool','translate'],['rotateTool','rotate'],['scaleTool','scale']])$(id).onclick=()=>chooseTransform(mode);
$('selectScene').onclick=selectScene;$('inspectObject').onclick=()=>openPanel('objects','placementSection');
function refreshRoomEnvelope(){structure.cameraBoundaryMode='walls';cameraRoom=roomEnvelope(structure,preview.xyz);$('roomHeight').value=cameraRoom.height.toFixed(2);$('planBoundaryNote').textContent=cameraRoom.wallCount?'围合视角边界 · '+cameraRoom.wallCount+' 条墙线':'墙线未形成可靠围合，视角暂用地面轮廓';if(viewport.state){viewport.state.lastCamera=null;constrainCamera();}}
function checkpoint(){clearTimeout(historyTimer);if(!viewport.state?.transform?.dragging)historyTimer=setTimeout(()=>recordHistory(),180);if(!editorReady)return;persistence.changed();if(!viewport.state?.transform?.dragging)scheduleAutoSave();}
function recordHistory(){clearTimeout(historyTimer);const state=snapshot(),signature=v=>JSON.stringify({objects:v.objects,structure:v.structure,sceneScale:v.sceneScale,rememberedCamera:v.rememberedCamera??null,renderFrame:v.renderFrame??'viewport'});if(history[historyIndex]&&signature(JSON.parse(history[historyIndex]))===signature(state))return;const value=JSON.stringify(state);history=history.slice(0,historyIndex+1);history.push(value);if(history.length>40)history.shift();historyIndex=history.length-1;historyButtons();}
function historyButtons(){for(const id of ['undo','planUndo'])$(id).disabled=historyIndex<=0;$('planRedo').disabled=historyIndex>=history.length-1;consumerUI?.sync();}
function undoRedo(delta){if(effectCapture.busy||editMode||wallDrag)return;placementDirty=false;clearPlacementError();recordHistory();const i=historyIndex+delta;if(i<0||i>=history.length)return;historyIndex=i;restore(JSON.parse(history[i]));historyButtons();checkpoint();status(delta<0?'已撤销。':'已重做。');}
const number=id=>$(id).value.trim()?Number($(id).value):NaN;
function populate(){
  refreshRoomEnvelope();
  $('floorZ').value=structure.floor.z;
  updateWallTools();
  $('polygon').value=JSON.stringify(floorPolygon(structure.floor));
}
function sync(){$('z').readOnly=$('mode').value!=='free';for(const k of ['x','y','z'])$(k).value=pose[k].toFixed(4);$('yaw').value=(pose.yaw*180/Math.PI).toFixed(2);}
function apply(next=pose,requestedSize=Object.fromEntries(['width','depth','height'].map(k=>[k,number(k)/100])),saveChange=true){
  if(effectCapture.busy)return false;
  if(!activeObject())return false;
  if(!Object.values(requestedSize).every(v=>Number.isFinite(v)&&v>0)||!Object.values(next).every(Number.isFinite)){status('请输入有效位置及正数尺寸。');return false;}
  let result={ok:true,pose:next};
  if($('mode').value!=='free')result=snapFloor(next,requestedSize,structure.floor);
  if(!result.ok){status(result.reason);return false;}
  try{assertUniformSize(size,requestedSize);}catch(e){status(e.message);return false;}
  if(['width','depth','height'].some(k=>Math.abs(requestedSize[k]-size[k])>1e-8))Object.assign(activeObject(),{measuredAxes:[],sizeBasis:'UNMEASURED_SCALED_PROPORTIONS'});
  size=requestedSize;pose=result.pose;commitObject();sync();draw();refreshThree();if(saveChange)checkpoint();
  const current=activeObject(),warnings=placementWarnings(pose,size,structure);
  for(const other of objects)if(other.id!==activeObjectId&&objectsOverlap(current,other))warnings.push(`与新增物品“${other.name}”重叠`);
  status(`已应用 ${current.name} · ${$('mode').value==='floor'?'已贴地':'底高 '+pose.z.toFixed(2)+' m'}。${warnings.length?'⚠ '+warnings.join('；'):'修改会自动保存。'}`);return true;
}
let editMode=null,sketch=[],selectedWallId=null,wallDrag=null,wallHover=null;
function updateWallTools(){const wall=structure.walls.find(w=>w.id===selectedWallId);if(!wall)selectedWallId=null;$('deleteWall').disabled=!wall||!!editMode;$('wallEditInfo').textContent=wall?'墙线 '+Math.hypot(wall.b[0]-wall.a[0],wall.b[1]-wall.a[1]).toFixed(2)+' 米 · 拖动圆点':'点选墙线，拖动圆点修改';}
let map={};
function draw(){
  const canvas=$('plan'),rect={width:$('stage').clientWidth,height:$('stage').clientHeight};canvas.width=rect.width*devicePixelRatio;canvas.height=rect.height*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.fillStyle='#eaf0eb';ctx.fillRect(0,0,rect.width,rect.height);
  const card=$('planCalibration'),plan=currentView==='plan'&&!card.hidden,side=plan&&rect.width>=700;
  const left=16,top=76,right=side?card.offsetWidth+36:16,bottom=plan&&!side?card.offsetHeight+28:36;
  const width=Math.max(60,rect.width-left-right),height=Math.max(60,rect.height-top-bottom);
  const [a,b]=structure.floor.bounds,scale=Math.max(.1,Math.min(width/(b[0]-a[0]+1.2),height/(b[1]-a[1]+1.2)));
  map=wallDrag?.map??{scale,cx:left+width/2,cy:top+height/2,mx:(a[0]+b[0])/2,my:(a[1]+b[1])/2};
  const xy=([x,y])=>[map.cx+(x-map.mx)*map.scale,map.cy-(y-map.my)*map.scale];
  ctx.fillStyle='#fff';ctx.beginPath();floorPolygon(structure.floor).forEach((p,i)=>i?ctx.lineTo(...xy(p)):ctx.moveTo(...xy(p)));ctx.closePath();ctx.fill();
  ctx.strokeStyle='#d9e2db';ctx.lineWidth=1;
  for(let x=Math.floor(a[0]);x<=b[0];x++){ctx.beginPath();ctx.moveTo(...xy([x,a[1]]));ctx.lineTo(...xy([x,b[1]]));ctx.stroke();}
  for(let y=Math.floor(a[1]);y<=b[1];y++){ctx.beginPath();ctx.moveTo(...xy([a[0],y]));ctx.lineTo(...xy([b[0],y]));ctx.stroke();}
  preview.xyz.forEach((p,i)=>{if(p[2]>structure.floor.z+2.8||p[2]<structure.floor.z-.1)return;const c=preview.rgb[i];ctx.fillStyle=`rgba(${c.join(',')},.4)`;ctx.fillRect(...xy(p),1.5,1.5);});
  ctx.strokeStyle='#396a58';ctx.lineWidth=2;ctx.beginPath();cameraRoom.polygon.forEach((p,i)=>i?ctx.lineTo(...xy(p)):ctx.moveTo(...xy(p)));ctx.closePath();ctx.stroke();
  if(currentView==='plan'||$('showFloor').checked){ctx.save();for(const wall of structure.walls.filter(w=>w.enabled!==false)){const chosen=wall.id===selectedWallId;ctx.setLineDash(chosen||wall.source==='MANUAL'?[]:[6,5]);ctx.strokeStyle=chosen?'#167aaa':wall.source==='MANUAL'?'#3b7290':'#bb7839';ctx.lineWidth=chosen?4:2;ctx.beginPath();ctx.moveTo(...xy(wall.a));ctx.lineTo(...xy(wall.b));ctx.stroke();if(chosen){ctx.setLineDash([]);for(const end of [wall.a,wall.b]){ctx.beginPath();ctx.arc(...xy(end),9,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.stroke();}}}ctx.restore();}
  if(sketch.length){ctx.strokeStyle='#1485bd';ctx.lineWidth=3;ctx.beginPath();sketch.forEach((p,i)=>i?ctx.lineTo(...xy(p)):ctx.moveTo(...xy(p)));ctx.stroke();for(const p of sketch){const v=xy(p);ctx.beginPath();ctx.arc(v[0],v[1],4,0,Math.PI*2);ctx.fillStyle='#1485bd';ctx.fill();}}
  if(editMode==='wall'&&sketch.length===1&&wallHover){ctx.strokeStyle='#1485bd';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(...xy(sketch[0]));ctx.lineTo(...xy(wallHover));ctx.stroke();ctx.setLineDash([]);}
  for(const o of objects.filter(o=>o.visible)){
    const selected=selectionKind==='object'&&o.id===activeObjectId,corners=footprint(o.pose,o.size).map(xy);ctx.beginPath();corners.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle=selected?'#e8a565d9':'#73a1b7b0';ctx.fill();ctx.strokeStyle=selected?'#a75a25':'#426c80';ctx.lineWidth=selected?3:1;ctx.stroke();
    const front=[o.pose.x+Math.sin(o.pose.yaw)*o.size.depth/2,o.pose.y-Math.cos(o.pose.yaw)*o.size.depth/2];ctx.beginPath();ctx.moveTo(...xy([o.pose.x,o.pose.y]));ctx.lineTo(...xy(front));ctx.stroke();ctx.fillStyle='#25483c';ctx.fillText(o.name,...xy([o.pose.x,o.pose.y+.15]));
  }
  ctx.fillStyle='#315a49';ctx.font='11px system-ui';ctx.fillText(`地面范围 ${(b[0]-a[0]).toFixed(2)} × ${(b[1]-a[1]).toFixed(2)} 米 · 网格 1 米`,left,rect.height-bottom+17);
}
function pointer(e){const canvas=$('plan'),p=appOrientation.pointer(e,canvas);return {x:map.mx+(p.u*canvas.clientWidth-map.cx)/map.scale,y:map.my-(p.v*canvas.clientHeight-map.cy)/map.scale,z:pose.z,yaw:pose.yaw};}
const wallPoint=e=>{const p=pointer(e);return [p.x,p.y];};
function snapWallPoint(p,exclude){const points=structure.walls.filter(w=>w.id!==exclude&&w.enabled!==false).flatMap(w=>[w.a,w.b]);const near=points.find(q=>Math.hypot(q[0]-p[0],q[1]-p[1])*map.scale<12);return near?near.slice(0,2):p;}
$('plan').onpointerdown=e=>{
 if(effectCapture.busy||e.pointerType==='touch'&&!e.isPrimary)return;
 const p=wallPoint(e);
 if(editMode){const v=editMode==='wall'?snapWallPoint(p):p;if(!sketch.length||Math.hypot(v[0]-sketch.at(-1)[0],v[1]-sketch.at(-1)[1])>.03)sketch.push(v);if(editMode==='wall'&&sketch.length===2)finishSketch();else draw();return;}
 const walls=structure.walls.filter(w=>w.enabled!==false),selected=walls.find(w=>w.id===selectedWallId);
 const end=selected&&['a','b'].find(key=>Math.hypot(selected[key][0]-p[0],selected[key][1]-p[1])*map.scale<22);
 if(end){recordHistory();persistence.cancelAutoSave();wallDrag={id:selected.id,end,base:structuredClone(structure),map:{...map},pointer:e.pointerId,changed:false};$('plan').setPointerCapture(e.pointerId);return;}
 let best=null,distance=16/map.scale;for(const w of walls){const dx=w.b[0]-w.a[0],dy=w.b[1]-w.a[1],t=Math.max(0,Math.min(1,((p[0]-w.a[0])*dx+(p[1]-w.a[1])*dy)/(dx*dx+dy*dy)));const d=Math.hypot(p[0]-w.a[0]-t*dx,p[1]-w.a[1]-t*dy);if(d<distance){best=w;distance=d;}}
 selectedWallId=best?.id??null;updateWallTools();draw();
};
$('plan').onpointermove=e=>{if(wallDrag&&wallDrag.pointer===e.pointerId){const w=wallDrag.base.walls.find(w=>w.id===wallDrag.id),p=snapWallPoint(wallPoint(e),w.id);try{structure=changeWall(wallDrag.base,w.id,wallDrag.end==='a'?p:w.a,wallDrag.end==='b'?p:w.b);wallDrag.changed=true;refreshRoomEnvelope();updateWallTools();draw();}catch{}}else if(editMode==='wall'){wallHover=wallPoint(e);draw();}};
function finishWallDrag(e,cancel=false){if(!wallDrag||e.pointerId!==wallDrag.pointer)return;const gesture=wallDrag;wallDrag=null;if(cancel)structure=gesture.base;populate();draw();refreshThree();if(gesture.changed&&!cancel){checkpoint();status('墙线已修改，连接端点同步更新。');}else scheduleAutoSave();}
$('plan').onpointerup=e=>finishWallDrag(e);$('plan').onpointercancel=e=>finishWallDrag(e,true);$('plan').onlostpointercapture=e=>finishWallDrag(e,true);
$('apply').onclick=()=>{placementDirty=true;flushPlacementEdits();};
for(const key of placementFields){$(key).addEventListener('input',()=>{placementDirty=true;if(['width','depth','height'].includes(key))placementSizeAxis=key;clearPlacementError();$('saveState').textContent='正在编辑…';});$(key).addEventListener('change',flushPlacementEdits);$(key).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();flushPlacementEdits();}if(e.key==='Escape'){placementDirty=false;clearPlacementError();sync();syncSize();$('saveState').textContent=persistence.state.revision>persistence.state.savedRevision?'有修改待保存':persistence.state.version?'已保存到电脑':'尚未修改';scheduleAutoSave();status('已取消本次数值修改。');}});}
function rotateActiveObject(delta){if(!flushPlacementEdits())return;if(!activeObject())return status('请先选择一件物品');apply({...pose,yaw:pose.yaw+delta});}
$('rotateLeft').onclick=()=>rotateActiveObject(-Math.PI/12);$('rotateRight').onclick=()=>rotateActiveObject(Math.PI/12);
$('mode').onchange=()=>apply();
$('showFloor').onchange=()=>{const shown=$('showFloor').checked;$('toggleGuides').setAttribute('aria-pressed',String(shown));draw();refreshThree();};
$('floorZ').onchange=()=>{
  const z=number('floorZ');if(!Number.isFinite(z)){$('floorZ').value=structure.floor.z;status('地面高度请输入有效数值，已保留原高度。');return;}
  commitObject();const delta=z-structure.floor.z,manualIds=new Set(structure.walls.filter(w=>w.source==='MANUAL').map(w=>w.id));for(const w of structure.walls)if(manualIds.has(w.id)){w.a[2]+=delta;w.b[2]+=delta;}for(const opening of structure.openings)if(manualIds.has(opening.wallId))opening.center[2]+=delta;structure.floor.z=z;
  for(const o of objects)if(o.mode==='floor')o.pose.z=z;
  if(activeObject())pose={...activeObject().pose};refreshRoomEnvelope();sync();draw();refreshThree();checkpoint();status('已调整地面高度，贴地物品同步更新。');
};
$('calibrate').onclick=()=>{try{commitObject();const next=scaleCalibration({structure,objects,points:preview.xyz,sceneScale,height:cameraRoom.height},number('scale'));recordHistory();structure=next.structure;objects=next.objects;preview.xyz=next.points;sceneScale=next.sceneScale;if(activeObject()){pose={...activeObject().pose};size={...activeObject().size};}populate();sync();draw();refreshThree();checkpoint();$('scale').value=1;status('房间比例已更新；物品实物尺寸保持不变。');}catch(e){status(e.message);}};
function snapshot(){
  commitObject();
  const camera=viewport.state?{rows:cameraRows(),verticalFov:viewport.state.camera.fov,viewAspect:viewport.state.camera.aspect,resolution:[viewport.state.renderer.getSize(new viewport.state.THREE.Vector2()).x,viewport.state.renderer.getSize(new viewport.state.THREE.Vector2()).y].map(v=>Math.min(4500,Math.max(1,Math.round(v))))}:pendingCamera;
  return validateScene({schemaVersion:3,projectId:projectId??undefined,worldId:structure.worldId,upAxis:'Z',units:'m',sceneScale,renderFrame,tryOn:tryOnState,structure,size,pose,mode:$('mode').value,selectedWall:'',gap:.02,back:activeObject()?.back??'+Y',align:false,assets:ASSETS,objects,activeObjectId,rememberedCamera,furnitureBottomOrigin:true,placementMatrix:columnMatrix(pose),scaleBasis:structure.scaleBasis,placementPolicy:'floor-only',collisionValidation:'FLOOR_AND_NEW_OBJECTS_ONLY',camera});
}
window.placementSnapshot=snapshot;
function download(bytes,name,type='application/json'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>{try{requirePlacementEdits();download(JSON.stringify(snapshot(),null,2),'room_placement.json');}catch(e){status(e.message);}};
$('meshExport').onclick=()=>download(structureGlb(structure,{floorOnly:true}),'floor.glb','model/gltf-binary');
function restore(value){
  if(effectCapture.busy){status('图片导出进行中，请结束后重新载入摆放。');return false;}
  if(value.worldId!==structure.worldId||(projectId&&value.projectId!==projectId))throw Error('摆放不属于当前项目');
  const v=validateScene(structuredClone(value));preview.xyz=sourcePreview.map(p=>v.structure.sourceToAligned.slice(0,3).map(r=>r[0]*p[0]+r[1]*p[1]+r[2]*p[2]+r[3]));
  placementDirty=false;clearPlacementError();tryOnState=v.tryOn;sceneScale=v.sceneScale;structure=v.structure;objects=v.objects;activeObjectId=null;size=v.size;pose=v.pose;syncSize();populate();
  $('mode').value=v.mode;
  if(v.activeObjectId)selectObject(v.activeObjectId);else{sync();objectMenu();draw();refreshThree();}
  layoutThree();pendingCamera=v.camera??null;rememberedCamera=v.rememberedCamera??null;restoreCamera(pendingCamera);status('已恢复物品、摆放与结构。');return true;
}
$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{await restoreWhenReady(()=>file.text().then(text=>JSON.parse(text)),{isBusy:()=>effectCapture.busy,apply:value=>{recordHistory();if(!restore(value))return false;checkpoint();return true;},onBusy:()=>status('图片导出进行中，请结束后重新载入摆放。')});}catch(e){status('导入失败：'+e.message);}};
$('updatePolygon').onclick=()=>{try{const candidate=structuredClone(structure);candidate.floor.polygon=JSON.parse($('polygon').value);validateStructure(candidate);const poly=candidate.floor.polygon;candidate.floor.bounds=[[Math.min(...poly.map(p=>p[0])),Math.min(...poly.map(p=>p[1]))],[Math.max(...poly.map(p=>p[0])),Math.max(...poly.map(p=>p[1]))]];candidate.floor.source='MANUALLY_EDITED';structure=candidate;populate();draw();refreshThree();status('已更新手工地面轮廓。');}catch(e){status('地面修改失败：'+e.message);}};
function resetTransformProxy(){const s=viewport.state,o=activeObject();if(!s||!o)return;s.transformProxy.position.set(o.pose.x,o.pose.y,o.pose.z+o.size.height/2);s.transformProxy.rotation.set(0,0,o.pose.yaw);s.transformProxy.scale.set(o.size.width,o.size.depth,o.size.height);}
function refreshThree(){
  if(!viewport.state)return;const s=viewport.state,{THREE}=s,showAux=$('showFloor').checked||currentView==='structure';
  s.modelRoot.visible=true;s.proxies.visible=true;
  for(const [id,root] of s.roots){const o=objects.find(o=>o.id===id);if(!o||root.userData.assetId!==o.assetId){s.modelRoot.remove(root);s.roots.delete(id);continue;}root.visible=o.visible;root.position.set(o.pose.x,o.pose.y,o.pose.z);root.rotation.z=o.pose.yaw;const extent=root.userData.extent;root.children[0].scale.set(o.size.width/extent.x,o.size.depth/extent.y,o.size.height/extent.z);}
  ensureObjects().then(()=>{$('assetError').hidden=true;updateSelectionTools();}).catch(e=>{$('assetErrorText').textContent='有物品未能载入，其他摆放会保留。';$('assetError').hidden=false;status('物品加载失败：'+e.message);});
  if(s.splat){const t=structure.sourceToAligned;s.splat.matrixAutoUpdate=false;s.splat.matrix.set(...t.flat());s.splat.matrixWorldNeedsUpdate=true;s.splat.visible=currentView==='gaussian';}
  while(s.proxies.children.length){const m=s.proxies.children[0];s.proxies.remove(m);m.geometry?.dispose();m.material?.dispose();}
  const geometry=vertices=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return g;};
  // These are translucent reference overlays, kept visible over noisy Gaussian depth.
  const floorMesh=new THREE.Mesh(geometry(floorTriangles(structure.floor)),new THREE.MeshBasicMaterial({color:0x78b399,side:THREE.DoubleSide,transparent:true,opacity:showAux?.20:0,depthWrite:false,depthTest:false,forceSinglePass:true}));floorMesh.renderOrder=5;s.proxies.add(floorMesh);s.floorMesh=floorMesh;
  if(showAux){const vertices=[],walls=[],z=structure.floor.z,top=z+cameraRoom.height;cameraRoom.polygon.forEach((a,i)=>{const b=cameraRoom.polygon[(i+1)%cameraRoom.polygon.length];vertices.push(...a,z,...b,z,...a,top,...b,top,...a,z,...a,top);walls.push(...a,z,...b,z,...b,top,...a,z,...b,top,...a,top);});
    if(structure.walls.some(w=>w.source==='MANUAL')){walls.length=0;for(const w of structure.walls.filter(w=>w.enabled!==false))walls.push(...wallTriangles(w,structure.openings));}
    const wallMesh=new THREE.Mesh(geometry(walls),new THREE.MeshBasicMaterial({color:0x94b7d0,side:THREE.DoubleSide,transparent:true,opacity:.13,depthWrite:false,depthTest:false,forceSinglePass:true}));wallMesh.renderOrder=6;s.proxies.add(wallMesh);
    const lines=new THREE.BufferGeometry();lines.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));s.proxies.add(new THREE.LineSegments(lines,new THREE.LineBasicMaterial({color:0x3e987b,transparent:true,opacity:.65})));}
  updateSelectionTools();
}
async function view(kind){try{if(kind!=='plan'&&editMode){endSketch();status('已取消未完成的地面绘制，已保留原轮廓。');}currentView=kind;syncViewTools();for(const [id,v]of [['planBtn','plan'],['view3d','gaussian'],['structureView','structure'],['structure3d','structure']]){$(id).classList.toggle('primary',kind===v);$(id).setAttribute('aria-pressed',String(kind===v));}if(kind==='plan'){$('three').style.display='none';$('plan').style.display='block';loadingScene(null);syncViewerActivity();draw();consumerUI?.sync();return;}$('three').style.display='block';$('plan').style.display='none';await setupThree();if(kind==='gaussian')await loadSplat();refreshThree();loadingScene(null);syncViewerActivity();consumerUI?.sync();}catch(e){$('error').textContent='三维加载失败：'+e.message+'。俯视摆放仍可使用。';currentView='plan';syncViewTools();$('three').style.display='none';$('plan').style.display='block';$('planBtn').classList.add('primary');$('planBtn').setAttribute('aria-pressed','true');for(const id of ['view3d','structureView','structure3d']){$(id).classList.remove('primary');$(id).setAttribute('aria-pressed','false');}syncViewerActivity();consumerUI?.sync();loadingScene('加载暂未完成，可原地重试。当前摆放已保留。',true);draw();status('三维暂不可用，可继续俯视摆放；点击“重试三维画面”恢复。');}}
if(projectId){const [a,b]=structure.floor.bounds;pose={x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,z:structure.floor.z,yaw:0};if(!floorContains(pose,size,structure.floor)){outer:for(let x=a[0]+1;x<b[0];x+=.4)for(let y=a[1]+.3;y<b[1];y+=.4){const p={...pose,x,y};if(floorContains(p,size,structure.floor)){pose=p;break outer;}}}const info=await readJson(projectBase);fetch(projectBase+'/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});projectInfo=info;document.querySelector('h1').textContent=info.name;document.querySelector('header small').textContent='空间工坊 · 本地项目 · 尺寸请按实物核对';$('coverageNote').textContent='默认只吸附当前地面；可调整地面高度、范围与场景比例。墙体和原场景家具不参与碰撞检查，新增物品之间保留重叠提示。在下方选择移动后，可直接拖动物品或箭头；选择浏览后拖动背景转动视角。摆放修改会自动保存。使用微调中的 ±15° 按钮或 Q/E 旋转。';}
populate();sync();draw();status('已载入真实场景。初始为测试姿态，默认仅吸附地面；请核对地面高度与范围后保存。');window.addEventListener('resize',()=>{const next=matchMedia('(max-width: 900px), (max-height: 520px) and (max-width: 1100px)').matches;if(next!==mobileLayout){mobileLayout=next;editorUI.setMobile(next);editorMain.classList.toggle('compact',next||consumerUI?.simple===true);$('panelToggle').textContent=next?'打开面板':'收起面板';$('panelToggle').setAttribute('aria-expanded',String(!next));setPanelGroup(editorUI.group);}syncViewTools();draw();});


async function furnitureCamera(side){if(effectCapture.busy)return;if(!activeObject())return status('请先添加物品');await view('gaussian');if(effectCapture.busy||!viewport.state)return;const s=viewport.state,candidate=placementCamera(activeObject(),{...structure,floor:{...structure.floor,polygon:cameraRoom.polygon}},objects,side,s.camera.fov,s.camera.aspect);s.lastCamera=null;s.camera.position.set(...candidate.position);s.controls.target.set(...candidate.target);constrainCamera();checkpoint();status('已聚焦选中物品，可拖动背景调整角度。');}

function setSketchControls(disabled){for(const element of planCalibration.querySelectorAll('input,button'))element.disabled=disabled;if(!disabled)historyButtons();}
function endSketch(){$('stage').classList.remove('sketching');editMode=null;sketch=[];wallHover=null;setSketchControls(false);updateWallTools();$('finishFloor').hidden=true;$('cancelSketch').hidden=true;if(['finishFloor','cancelSketch'].includes(document.activeElement?.id))$('drawFloor').focus({preventScroll:true});draw();}
async function beginSketch(kind='floor'){if(effectCapture.busy||wallDrag||!flushPlacementEdits())return;await view('plan');editMode=kind;$('stage').classList.add('sketching');sketch=[];setSketchControls(true);$('finishFloor').textContent=kind==='wall'?'完成墙线':'完成绘制';$('finishFloor').hidden=false;$('cancelSketch').hidden=false;status(kind==='wall'?'点击墙线起点和终点；靠近已有端点会自动连接。':'依次点击地面边界顶点，点“完成绘制”结束；可随时取消。');$('cancelSketch').focus({preventScroll:true});draw();}
function finishSketch(){try{recordHistory();const kind=editMode;if(kind==='wall'){if(sketch.length<2)throw Error('请点击墙线的起点和终点');const id='wall_'+randomUuidV4();structure=changeWall({...structure,roomHeight:structure.roomHeight??cameraRoom.height},id,sketch[0],sketch[1]);selectedWallId=id;}else{if(sketch.length<3)throw Error('地面至少需要 3 个顶点');const candidate=structuredClone(structure);candidate.floor.polygon=sketch.map(p=>[...p]);candidate.floor.bounds=[[Math.min(...sketch.map(p=>p[0])),Math.min(...sketch.map(p=>p[1]))],[Math.max(...sketch.map(p=>p[0])),Math.max(...sketch.map(p=>p[1]))]];candidate.floor.source='MANUAL_DRAWING';validateStructure(candidate);structure=candidate;}endSketch();populate();draw();refreshThree();checkpoint();status(kind==='wall'?'墙线已添加，可拖动圆点继续修改。':'已更新手绘地面轮廓。');}catch(e){status(e.message);}}
$('drawFloor').onclick=()=>beginSketch();$('drawWall').onclick=()=>beginSketch('wall');$('deleteWall').onclick=()=>{if(!selectedWallId||editMode||wallDrag)return;recordHistory();structure=removeWall(structure,selectedWallId);selectedWallId=null;populate();draw();refreshThree();checkpoint();status('已删除选中墙线，可撤销恢复。');};$('finishFloor').onclick=finishSketch;$('cancelSketch').onclick=()=>{if(editMode){endSketch();status('已取消绘制。');}};$('plan').ondblclick=()=>{if(!effectCapture.busy&&editMode==='floor')finishSketch();};window.addEventListener('keydown',e=>{if(effectCapture.busy||$('usageDialog').open||e.key!=='Escape')return;if(editMode){endSketch();status('已取消绘制。');return;}if(mobileLayout&&!editorMain.classList.contains('compact'))closePanel(true);});

await initializeObjects();
if(projectInfo?.hasScene){try{await restoreWhenReady(()=>readJson(sceneEndpoint),{isBusy:()=>effectCapture.busy,apply:restoreSaved,onBusy:()=>status('图片导出进行中，请结束后重新载入摆放。')});}catch(e){status('自动恢复失败：'+e.message+'；可手动载入备份。');}}
recordHistory();

async function initializeObjects(){
  if(projectBase){try{objectAssets=await readJson(projectBase+'/objects');}catch(e){status('素材库读取失败：'+e.message);}}
  updateLibrary();
  if(!objects.length&&!projectBase){objects=[legacyObject({pose,size,mode:'floor',selectedWall:'',gap:.02,back:'+Y',align:false})];activeObjectId=objects[0].id;}
  objectMenu();draw();
  $('uploadObject').disabled=!projectBase;
  if(!projectBase)$('uploadObject').title='请从“我的空间”打开项目后导入自己的物品';
}
function updateLibrary(){
  $('assetLibrary').replaceChildren(...[{id:BUILTIN_OBJECT,name:'内置电视柜'},...objectAssets].map(a=>Object.assign(document.createElement('option'),{value:a.id,textContent:a.name})));
  updateSceneList();
}
async function objectTemplate(assetId){
  const s=viewport.state,{THREE}=s;
  if(s.templates.has(assetId))return s.templates.get(assetId);
  if(s.loading.has(assetId))return s.loading.get(assetId);
  const promise=(async()=>{
    const meta=objectAssets.find(a=>a.id===assetId),url=assetId===BUILTIN_OBJECT?'./assets/demo/furniture.glb':projectBase+'/objects/'+assetId;
    if(assetId!==BUILTIN_OBJECT&&!meta)throw Error('当前项目没有这份素材，请先导入文件');
    const model=new THREE.Group();
    if(meta?.kind==='image'){
      const texture=await new THREE.TextureLoader().loadAsync(url);texture.colorSpace=THREE.SRGBColorSpace;
      const board=new THREE.Mesh(new THREE.BoxGeometry(1,.025,1),new THREE.MeshStandardMaterial({color:0x302a23,roughness:.8}));board.position.z=.5;model.add(board);
      const face=new THREE.Mesh(new THREE.PlaneGeometry(.94,.94),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));face.rotation.x=Math.PI/2;face.position.set(0,-.013,.5);model.add(face);
    }else{const gltf=await s.gltfLoader.loadAsync(url);model.add(gltf.scene);model.rotation.x=Math.PI/2;}
    model.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(model),extent=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    if(![extent.x,extent.y,extent.z].every(v=>Number.isFinite(v)&&v>1e-6))throw Error('模型没有有效三维尺寸，请检查 GLB');
    const normalized=new THREE.Group();normalized.add(model);model.position.set(-center.x,-center.y,-bounds.min.z);
    const result={normalized,extent};s.templates.set(assetId,result);return result;
  })();s.loading.set(assetId,promise);try{return await promise;}finally{s.loading.delete(assetId);}
}
async function ensureObjects(){
  const s=viewport.state;if(!s)return;await s.ensureObjectRoots();
}
async function addObject(assetId=BUILTIN_OBJECT,copy=null,requestedSize=null){
  if(effectCapture.busy)return null;
  if(!flushPlacementEdits())return null;
  if(objects.length>=40){status('最多摆放 40 件物品，请先移除部分物品');return null;}
  recordHistory();commitObject();const meta=objectAssets.find(a=>a.id===assetId),image=meta?.kind==='image';
  let initialSize=requestedSize??meta?.estimatedSize??(image?{width:1,depth:.03,height:.75}:{width:1.8,depth:.4,height:.55});
  if(image&&!copy&&!requestedSize){try{const img=new Image();img.src=projectBase+'/objects/'+assetId;await img.decode();initialSize={width:1,depth:.03,height:img.naturalHeight/img.naturalWidth};}catch{status('图片无法解码，请重新导入');return null;}if(effectCapture.busy)return null;}
  const o=copy?structuredClone(copy):legacyObject({pose:{...pose,z:structure.floor.z},size:initialSize,mode:'floor',selectedWall:'',gap:.02,back:'+Y',align:false});
  Object.assign(o,{id:'obj_'+randomUuidV4(),name:copy?(copy.name.slice(0,75)+' 副本'):(meta?.name?.replace(/\.[^.]+$/,'')??'电视柜'),assetId,assetKind:image?'image':'glb',visible:true});
  const legal=findInitialPlacement(structure.floor,o.size,objects,o.pose.yaw);if(!legal){status('没有找到合适的位置，请先修改尺寸或校正空间；未缩小物品，也未添加重叠实例。');return null;}o.pose={...legal,z:copy?.mode==='free'?copy.pose.z:legal.z};
  if(!copy){o.measuredAxes=meta?.measuredAxes??[];o.sizeBasis=meta?.sizeBasis;}objects.push(o);selectObject(o.id);checkpoint();status(image?'已添加图片模型，默认落地。填写实物宽高；需要调整高度时可使用手动位置。':'已添加物品。填写实物尺寸，拖动摆放，再切换三维预览。');return o;
}
$('objectName').oninput=()=>{const o=activeObject();if(!o)return;o.name=$('objectName').value.trim().slice(0,80)||'未命名物品';updateSelectionTools();draw();checkpoint();};
$('addBuiltin').onclick=()=>addObject();$('addAsset').onclick=()=>addObject($('assetLibrary').value);
$('duplicateObject').onclick=()=>{if(activeObject())addObject(activeObject().assetId,activeObject());};
$('removeObject').onclick=()=>{if(!activeObject())return;placementDirty=false;clearPlacementError();recordHistory();objects=objects.filter(o=>o.id!==activeObjectId);activeObjectId=null;if(objects.length)selectObject(objects.at(-1).id);else{$('mode').value='free';objectMenu();draw();refreshThree();}checkpoint();status('已从摆放方案移除物品，素材仍在本地素材库；可以撤销。');};
$('undo').onclick=()=>undoRedo(-1);
window.addEventListener('keydown',e=>{if(effectCapture.busy||document.querySelector('dialog[open]')||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();if(!e.shiftKey||currentView==='plan')undoRedo(e.shiftKey?1:-1);}});
$('uploadObject').onclick=()=>$('objectFile').click();
$('objectFile').onchange=async()=>{
  const file=$('objectFile').files[0];if(!file||effectCapture.busy)return;$('uploadObject').disabled=true;status('正在保存物品到本机…');
  try{const r=await fetch(projectBase+'/objects?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file}),a=await r.json();if(!r.ok)throw Error(a.error);if(!objectAssets.some(o=>o.id===a.id))objectAssets.push(a);updateLibrary();$('assetLibrary').value=a.id;
    if(a.kind==='image'){const added=await addObject(a.id);if(!added)return;apply();}
    else{await setupThree();await objectTemplate(a.id);if(effectCapture.busy)return;addObject(a.id);}
  }catch(e){status('导入失败：'+e.message);}finally{$('uploadObject').disabled=false;$('objectFile').value='';}
};

$('updatePolygon').addEventListener('click',checkpoint);
$('replaceAsset').onclick=()=>{const o=activeObject();if(!o)return;recordHistory();const id=$('assetLibrary').value,meta=objectAssets.find(a=>a.id===id);o.assetId=id;o.assetKind=meta?.kind??'glb';o.name=meta?.name?.replace(/\.[^.]+$/,'')??'电视柜';objectMenu();draw();refreshThree();checkpoint();status('已替换当前物品，保留位置与尺寸；请按实物重新核对尺寸。');};
$('overview').onclick=async()=>{
  if(effectCapture.busy)return;await view('gaussian');if(effectCapture.busy||!viewport.state)return;
  const points=cameraRoom.polygon,lo=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),structure.floor.z],hi=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1])),structure.floor.z+cameraRoom.height];
  const group={id:'overview',pose:{x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:lo[2],yaw:activeObject()?.pose.yaw??0},size:{width:Math.hypot(hi[0]-lo[0],hi[1]-lo[1]),depth:0,height:hi[2]-lo[2]}};
  const s=viewport.state,c=placementCamera(group,{...structure,floor:{...structure.floor,polygon:cameraRoom.polygon}},objects,1,s.camera.fov,s.camera.aspect);s.lastCamera=null;s.camera.position.set(...c.position);s.controls.target.set(...c.target);constrainCamera();checkpoint();status('已按房间范围取景，可拖动背景继续调整视角。');
};
function clearLegacyEffectLink(){const url=new URL(location.href);url.searchParams.delete('step');window.history.replaceState(null,'',url);updateSelectionTools();refreshThree();consumerUI?.sync();}
const effects=createEffectView({projectId,capture:effectCapture.captureEffect,getPlanFingerprint:()=>planFingerprint(snapshot()),onOpenChange:()=>consumerUI?.suspend()});
const generateView=document.createElement('button');Object.assign(generateView,{id:'generateView',type:'button',title:'生成当前视角效果图'});generateView.setAttribute('aria-label','生成当前视角效果图');generateView.setAttribute('aria-haspopup','dialog');generateView.dataset.tooltip='按当前视角生成效果图，画幅随横竖屏变化';generateView.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v13H4Z"/><circle cx="12" cy="13" r="4"/></svg>';
let generatingView=false;
generateView.onclick=async()=>{if(generatingView||effectCapture.busy||wallDrag||viewport.state?.transform?.dragging)return;if(editMode){status('请先完成或取消地面绘制，再生成效果图。');return;}generatingView=true;generateView.disabled=true;try{requirePlacementEdits();consumerUI?.suspend();await view('gaussian');if(currentView!=='gaussian')throw Error('请等待房间三维场景加载完成');layoutThree();await effects.renderCurrent();}catch(e){status(e.message);}finally{generatingView=false;generateView.disabled=false;}};
const objectEmpty=document.createElement('p');objectEmpty.id='objectEmptyHint';objectEmpty.textContent='先添加物品照片，三维模型就绪后，点击“放入空间”开始摆放。';objectEmpty.hidden=objects.length>0;$('objectSection').prepend(objectEmpty);
const objectGeneration=createEditorObjectGeneration({projectId,onImportModel:()=>importObject('.glb'),onAddPicture:()=>importObject('.jpg,.jpeg,.png,.webp'),isPlaced:assetId=>objects.some(o=>o.assetId===assetId),onNotify:message=>status(message),onAssets:async assets=>{const selected=$('assetLibrary').value;objectAssets=assets;updateLibrary();if([...$('assetLibrary').options].some(o=>o.value===selected))$('assetLibrary').value=selected;},onAdd:async job=>{if(effectCapture.busy)throw Error('正在准备图片，请稍后添加');const object=await addObject(job.resultAssetId,null,job.size);if(!object)throw Error('没有添加物品，请检查数量和模型');object.measuredAxes=job.measuredAxes??object.measuredAxes;object.sizeBasis=job.sizeBasis??object.sizeBasis;consumerUI?.sync();status(`已添加 ${job.name}，可点选后使用坐标轴摆放；尺寸与方向在属性中核对。`);}});
const editorBack=$('editorBack');editorBack.href=projectStepTargets(projectId).prepare;editorBack.onclick=returnToRoom;
function syncBackLayout(){
 const landscape=document.body.classList.contains('view-expanded')||(document.body.dataset.appMobile==='true'&&document.body.dataset.appOrientation==='landscape');
 editorMain.classList.toggle('landscape-editor',landscape);
 const parent=landscape?editorMain:document.querySelector('.editor-header');
 if(editorBack.parentElement!==parent)parent.prepend(editorBack);
}
syncBackLayout();
let returningToRoom=false;
async function returnToRoom(event){
 event?.preventDefault();if(returningToRoom)return;
 if(effectCapture.busy||wallDrag||viewport.state?.transform?.dragging){status('请结束当前拖动或图片准备后再返回房间详情。');return;}
 effects.close();consumerUI?.suspend();
 if(editMode){status('请先完成或取消当前地面轮廓绘制，再返回房间详情。');$('cancelSketch').focus({preventScroll:true});return;}
 if(persistence.state.conflict||persistence.state.errorKind==='auth'){showRecovery();return;}
 try{requirePlacementEdits();}catch(e){status(e.message);return;}
 returningToRoom=true;editorBack.setAttribute('aria-busy','true');const wasInert=editorMain.inert;editorMain.inert=true;persistence.cancelAutoSave();
 try{await persistence.wait();if(persistence.state.revision>persistence.state.savedRevision||!persistence.state.version)await persistScene(snapshot());persistence.allowNavigation();location.assign(projectStepTargets(projectId).prepare);}
 catch(e){status('未能返回房间详情：'+e.message);}
 finally{returningToRoom=false;editorBack.removeAttribute('aria-busy');editorMain.inert=wasInert;}
}
function importObject(accept){$('objectFile').accept=accept;$('uploadObject').click();}
$('retryAssets').onclick=async()=>{try{await view('gaussian');await ensureObjects();$('assetError').hidden=true;}catch(e){$('assetErrorText').textContent=e.message;}};
editorUI.mountToolbar(generateView,objectGeneration.library);
function applySimple(next,id=activeObjectId,rollback=false){
 const o=objects.find(o=>o.id===id);if(!o||effectCapture.busy)return false;
 if(rollback){o.pose={...next};if(o.id===activeObjectId)pose={...next};sync();draw();refreshThree();return true;}
 if(o.mode!=='floor'||Math.abs(o.pose.z-structure.floor.z)>.002){status('此物品保留原高度，请进入精细调整。');return false;}
 const candidate={...o,pose:{...next,z:structure.floor.z}};
 if(!floorContains(candidate.pose,candidate.size,structure.floor)||objects.some(other=>other.id!==o.id&&objectsOverlap(candidate,other))){status('这个位置超出地面或与新增物品重叠，保留最后有效位置。');return false;}
 return apply(candidate.pose,o.size,false);
}
function placeFirst(point=null){
 if(tryOnState?.state!=='pending')return false;
 const t=tryOnState,position=point?{x:point[0],y:point[1],z:structure.floor.z,yaw:0}:findInitialPlacement(structure.floor,t.size,objects);
 if(!position||!floorContains(position,t.size,structure.floor)||objects.some(o=>objectsOverlap({visible:true,pose:position,size:t.size},o))){status('这里放不下完整物品，请调整位置、尺寸或空间轮廓。');return false;}
 recordHistory();const object=legacyObject({pose:position,size:t.size,mode:'floor',gap:.02,back:'+Y',align:false});
 Object.assign(object,{id:'try_'+t.jobId,name:t.name??'我的物品',assetId:t.assetId,assetKind:'glb',visible:true,measuredAxes:t.measuredAxes??[],sizeBasis:t.sizeBasis});
 objects.push(object);tryOnState={...t,state:'placed',objectId:object.id};selectObject(object.id);checkpoint();consumerUI?.sync();status('暂定位置 · 尺寸待核对。原房间家具不参与占用检查。');return true;
}
async function initializeFirst(){
 if(projectInfo?.experience!=='quick-try-on')return;
 const wasReady=editorReady;editorReady=false;editorMain.inert=true;
 try{
  const initialized=await initializeQuickTryOn({project:projectInfo,read:()=>requestJson(sceneEndpoint),restore:restoreSaved,save:scene=>requestJson(sceneEndpoint,{body:scene}),build:async()=>{
   const {jobs}=await requestJson(projectBase+'/object-generations'),job=jobs.find(j=>j.id===projectInfo.quickTryOnJobId&&j.state==='READY');if(!job)return null;
   objectAssets=await requestJson(projectBase+'/objects');updateLibrary();
   tryOnState={jobId:job.id,state:'pending',assetId:job.resultAssetId,name:job.name,size:job.size,measuredAxes:job.measuredAxes??[],sizeBasis:job.sizeBasis};
   objects=objects.filter(o=>o.id!=='try_'+job.id);placeFirst();if(tryOnState.state==='placed'){await ensureObjects();await furnitureCamera(1);}return snapshot();
  }});
  // Automatic initialization is a baseline, not a user edit or undo target.
  persistence.cancelAutoSave();clearTimeout(historyTimer);persistence.resetBaseline();history=[];historyIndex=-1;recordHistory();
  if(initialized&&tryOnState?.state==='placed')status('暂定位置 · 尺寸待核对。拖动物品试摆，原房间家具不参与占用检查。');
 }catch(e){status('首次试摆暂未完成：'+e.message);const retry=document.createElement('button');retry.type='button';retry.id='retryFirstTryOn';retry.textContent='重试首次试摆';retry.onclick=async()=>{retry.remove();await initializeFirst();};$('stage').append(retry);}
 finally{editorReady=wasReady;editorMain.inert=false;consumerUI?.sync();}
}
consumerUI=createConsumerEditor({
 state:()=>({three:viewport.state,object:selectionKind==='object'?activeObject():null,browsing:selectionKind==='scene',transformMode,tryOn:tryOnState,view:currentView,floorZ:structure.floor.z,busy:effectCapture.busy}),
 status,screenPoint:e=>appOrientation.point(e),canvasPointer:(e,el)=>appOrientation.pointer(e,el),canLeave:flushPlacementEdits,refresh:()=>{refreshThree();updateSelectionTools();},select:selectObject,selectScene,apply:applySimple,
 begin:()=>{requirePlacementEdits();recordHistory();persistence.cancelAutoSave();},commit:()=>{recordHistory();checkpoint();},cancel:()=>{if(viewport.state)viewport.state.controls.enabled=!effectCapture.busy;scheduleAutoSave();},cameraCommit:checkpoint,
 focus:()=>furnitureCamera(1),home:async()=>{if(effectCapture.busy||!flushPlacementEdits())return;await centerSceneCamera();selectScene();},precise:()=>openPanel('objects','placementSection'),calibrate:()=>view('plan'),closePanel,place:placeFirst,
 resize:(resolved,id)=>{
  if(effectCapture.busy)throw Error('正在准备图片，请稍后调整尺寸');requirePlacementEdits();
  if(id===null){if(tryOnState?.state!=='pending')throw Error('物品状态已改变，请重新选择');recordHistory();Object.assign(tryOnState,resolved);if(!placeFirst())checkpoint();consumerUI?.sync();return;}
  const object=objects.find(o=>o.id===id);if(!object||activeObjectId!==id)throw Error('选中物品已改变，请重新打开尺寸核对');
  assertUniformSize(object.size,resolved.size);const next=resizedPlacement(object,resolved,structure.floor,objects);
  recordHistory();persistence.cancelAutoSave();Object.assign(object,next);size={...next.size};pose={...next.pose};syncSize();sync();draw();refreshThree();recordHistory();checkpoint();consumerUI?.sync();status('物品尺寸已更新，可撤销；房间尺度与物品高度位置保持不变。');
 }
});
rewriteServiceCopy($('coverageNote'));
syncSize();setPanelGroup('objects');document.querySelector('main').inert=false;editorReady=true;
persistence.startRecovery();
const planResize=new ResizeObserver(()=>draw());planResize.observe($('stage'));planResize.observe(planCalibration);
// Initialize the real renderer only after the saved project and its camera have restored.
await view('gaussian');
consumerUI.bind();await initializeFirst();
if(!tryOnState?.objectId)selectionKind='scene';updateSelectionTools();
installButtonHints(document,appOrientation);
window.addEventListener('apporientationchange',()=>{consumerUI?.suspend();syncBackLayout();syncViewTools();draw();layoutThree();});
await centerSceneCamera();if(new URLSearchParams(location.search).get('step')==='effects'){clearLegacyEffectLink();await effects.open();}

window.addEventListener('keydown',e=>{if(consumerUI?.simple||effectCapture.busy||document.querySelector('dialog[open]')||selectionKind!=='object'||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||!['q','e'].includes(e.key.toLowerCase())||currentView==='plan')return;rotateActiveObject((e.key.toLowerCase()==='q'?1:-1)*Math.PI/36,5);});
