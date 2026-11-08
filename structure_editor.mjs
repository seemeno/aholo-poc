import {footprint,snapFloor,columnMatrix,placementWarnings,floorContains} from './placement.mjs';
import {floorPolygon,floorTriangles,wallTriangles,validateStructure,pointInside} from './geometry.mjs';
import {changeWall,removeWall} from './wall_edit.mjs';
import {scaleCalibration,needsRecovery} from './editor_calibration.mjs';
import {validateScene,ASSETS} from './scene_state.mjs';
import {structureGlb} from './structure_mesh.mjs';
import {legacyObject,BUILTIN_OBJECT,objectsOverlap,placementCamera,randomUuidV4} from './object_state.mjs';
import {createObjectRootEnsurer} from './object_root_ensurer.mjs';
import {restoreWhenReady} from './restore_gate.mjs';
import {createEffectView} from './effect_ui.mjs';
import {createEditorObjectGeneration} from './object_generation_ui.mjs';
import {requestJson,issuePresentation,pairingUrl} from './ui_network.mjs';
import {localDrafts} from './local_drafts.mjs';
import {placementDraft,centimeters,imageDimensions,effectDimensions,planFingerprint,createStepNavigation,projectStepTargets} from './ui_actions.mjs';
import {roomEnvelope,clampRoomPoint,constrainRoomMotion,gizmoPlacement} from './editor_room.mjs';
import {createSceneObjectList} from './scene_object_list.mjs';
const $=id=>document.getElementById(id),ctx=$('plan').getContext('2d');
const editorMain=$('editorMain');let mobileLayout=matchMedia('(max-width: 900px), (max-height: 520px) and (max-width: 1100px)').matches;
editorMain.classList.add('compact');
$('panelToggle').textContent=mobileLayout?'打开面板':'收起面板';$('panelToggle').setAttribute('aria-expanded',String(!mobileLayout));
const projectId=new URLSearchParams(location.search).get('project');
if(projectId&&!/^[a-f0-9-]{36}$/.test(projectId))throw Error('项目 ID 无效');
if(projectId){$('projectProgressLink').href='/#space/'+projectId;$('projectProgressLink').hidden=false;}
let projectInfo=null;
const projectBase=projectId?'/api/projects/'+projectId:null,sceneEndpoint=projectBase?projectBase+'/scene':'/api/scene';
const asset=name=>projectBase?projectBase+'/assets/'+name:'./assets/demo/'+name;
const readJson=async url=>{for(;;){try{const value=await requestJson(url);$('loadError').hidden=true;return value;}catch(e){const issue=issuePresentation(e,'空间文件');$('loadErrorText').textContent=issue.text;$('retryLoad').hidden=issue.auth;$('pairLoad').hidden=!issue.auth;$('pairLoad').href=pairingUrl();$('loadError').hidden=false;await new Promise(resolve=>$('retryLoad').onclick=()=>{$('loadError').hidden=true;resolve();});}}};
let structure=await readJson(asset('structure.json'));
let preview=await readJson(asset('point_preview.json'));
const initialTransform=structuredClone(structure.sourceToAligned);const sourcePreview=preview.sourceXyz??preview.xyz.map(p=>p.map((v,i)=>(v-initialTransform[i][3])/initialTransform[i][i]));
let pose={x:0,y:3,z:structure.floor.z,yaw:0},size={width:1.8,depth:.4,height:.55},sceneScale=1,threeState=null,currentView='plan',pendingCamera=null;
let objects=[],activeObjectId=null,objectAssets=[],rememberedCamera=null,history=[],historyIndex=-1,historyTimer=null;
let editorStep='place',latestEffectJob=null,selectionKind='scene',transformMode='translate',cameraRoom=roomEnvelope(structure,preview.xyz);
const interactionTools=document.createElement('div');interactionTools.id='transformTools';interactionTools.setAttribute('role','group');interactionTools.setAttribute('aria-label','物品坐标轴操作');interactionTools.innerHTML='<button id="selectScene" type="button" aria-label="选中场景，浏览视角" title="选中场景，浏览视角">◉</button><button id="translateTool" type="button" aria-label="平移物品" title="平移物品">✥</button><button id="rotateTool" type="button" aria-label="旋转物品" title="绕竖轴旋转物品">↻</button><button id="scaleTool" type="button" aria-label="缩放物品" title="缩放物品">⤢</button><button id="inspectObject" type="button" aria-label="精确尺寸与物品操作" title="精确尺寸与物品操作">☷</button>';$('stage').append(interactionTools);
const selectionLabel=document.createElement('div');selectionLabel.id='selectionState';selectionLabel.setAttribute('role','status');$('stage').append(selectionLabel);
for(const [id,label,symbol]of [['expandScene','放大三维视图','⛶']]){const button=document.createElement('button');Object.assign(button,{id,type:'button',textContent:symbol,title:label});button.setAttribute('aria-label',label);$('toolbar').append(button);}
const sceneList=createSceneObjectList($('stage'),{storageKey:'scene-list:'+(projectId??structure.worldId),onSelect:id=>selectObject(id),onVisibility:id=>toggleSceneObject(id),onFocus:async id=>{if(selectObject(id))await furnitureCamera(1);},onRemove:id=>{if(selectObject(id))$('removeObject').click();},onAdd:()=>objectGeneration.open?.()});
function updateSceneList(){sceneList.update(objects,selectionKind==='object'?activeObjectId:null,objectAssets,projectBase);}
function toggleSceneObject(id){if(exportInProgress||!flushPlacementEdits())return;const object=objects.find(o=>o.id===id);if(!object)return;recordHistory();commitObject();object.visible=!object.visible;objectMenu();draw();refreshThree();checkpoint();status(object.name+(object.visible?'已显示。':'已隐藏，可在列表中恢复。'));}
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
let renderFrame='landscape';
const renderComposer=document.createElement('div');renderComposer.id='renderComposer';renderComposer.hidden=true;renderComposer.setAttribute('role','group');renderComposer.setAttribute('aria-label','成图设置');$('stage').append(renderComposer);
const frameLabel=document.createElement('label');frameLabel.innerHTML='成图画幅<select id="renderFrame"><option value="landscape">横图 16:9 · 展示空间</option><option value="portrait">竖图 3:4 · 展示物品</option><option value="viewport">跟随当前窗口</option></select>';renderComposer.append(frameLabel);
const renderAction=document.createElement('button');Object.assign(renderAction,{id:'renderSceneButton',type:'button',className:'primary',textContent:'渲染'});renderComposer.append(renderAction);
const savedEffectsLabel=document.createElement('label');savedEffectsLabel.id='savedEffectsLabel';savedEffectsLabel.hidden=true;savedEffectsLabel.textContent='已有渲染图';const savedEffectsPicker=document.createElement('select');savedEffectsPicker.id='savedEffectsPicker';savedEffectsPicker.setAttribute('aria-label','选择已有渲染图');savedEffectsLabel.append(savedEffectsPicker);renderComposer.prepend(savedEffectsLabel);
const effectHistoryStatus=document.createElement('p');effectHistoryStatus.id='effectHistoryStatus';effectHistoryStatus.hidden=true;effectHistoryStatus.setAttribute('role','status');renderComposer.prepend(effectHistoryStatus);let savedEffectsKey='';
function paintSavedEffects(jobs){savedEffectsLabel.hidden=!jobs.length;const key=JSON.stringify(jobs.map(j=>[j.id,j.completedAt,j.createdAt,j.width,j.height]));if(key===savedEffectsKey)return;savedEffectsKey=key;const value=savedEffectsPicker.value;savedEffectsPicker.replaceChildren(new Option('选择查看…',''));for(const j of jobs)savedEffectsPicker.append(new Option(new Date(j.completedAt??j.createdAt).toLocaleString('zh-CN')+' · '+j.width+'×'+j.height,j.id));savedEffectsPicker.value=[...savedEffectsPicker.options].some(o=>o.value===value)?value:'';}
savedEffectsPicker.onchange=()=>{if(savedEffectsPicker.value)effects.open(savedEffectsPicker.value);};
$('renderFrame').onchange=()=>{renderFrame=$('renderFrame').value;layoutThree();checkpoint();paintRenderAction();};
let threeSetupPromise=null;
let exportInProgress=false;
let placementDirty=false,editorReady=false,editRevision=0,savedRevision=0,savedVersion=null,saveConflict=false,autoSaveTimer,saveQueue=Promise.resolve();
let recoveryBusy=false,saveErrorKind='',allowRecoveryNavigation=false;
let pendingSaves=0,lastSavedScene=null,effectHistoryError='';
function paintSaveButton(state='idle'){
 const button=$('save');button.hidden=false;button.dataset.state=state;button.classList.toggle('save-error',state==='error');button.setAttribute('aria-busy',String(state==='saving'));
 const label=saveConflict?'处理保存冲突':saveErrorKind==='auth'?'重新配对后保存':state==='saving'?'正在保存方案':state==='error'?'重试保存方案':'保存方案';button.title=label;button.setAttribute('aria-label',label);
 if(!button.querySelector('svg'))button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8"/></svg><span class="save-indicator" aria-hidden="true"></span>';
}
const recoveryKey='scene-recovery:'+(projectId??structure.worldId);
const placementFields=['x','y','z','yaw','width','depth','height'];
function syncSize(){for(const key of ['width','depth','height'])$(key).value=centimeters(size[key]);}
function clearPlacementError(){for(const key of placementFields){$(key).setCustomValidity('');$(key).removeAttribute('aria-invalid');}$('placementError').hidden=true;}
function flushPlacementEdits(){
 if(!placementDirty)return true;
 clearPlacementError();
 try{const draft=placementDraft(Object.fromEntries(placementFields.map(key=>[key,$(key).value])));if(!apply(draft.pose,draft.size))throw Error($('status').textContent);placementDirty=false;return true;}
 catch(e){$('placementError').textContent=e.message;$('placementError').hidden=false;if(e.field){$(e.field).setCustomValidity(e.message);$(e.field).setAttribute('aria-invalid','true');}return false;}
}
function requirePlacementEdits(){if(!flushPlacementEdits()){if(currentView==='plan')view('gaussian');openPanel('objects','placementSection');throw Error('请先修正标出的尺寸或位置，本次操作尚未执行。');}}
async function persistScene(input,revision=editRevision){
 const scene=structuredClone(input);
 pendingSaves++;$('save').disabled=true;
 const run=async()=>{
  if(saveConflict)throw Error('另一处已保存，当前修改未覆盖。可保留本机副本后查看已保存版本。');
  $('saveState').textContent='正在保存…';paintSaveButton('saving');
  const body={...scene,...(projectId?{expectedSavedAt:savedVersion}:{})};
  let value;try{value=await requestJson(sceneEndpoint,{body});}catch(e){if(e.status===409)saveConflict=true;throw e;}
  saveErrorKind='';savedVersion=value.savedAt??savedVersion;lastSavedScene=scene;savedRevision=Math.max(savedRevision,revision);$('saveState').textContent=editRevision>savedRevision?'有修改待保存':'已保存到电脑';$('saveState').classList.remove('error');paintSaveButton(editRevision>savedRevision?'pending':'saved');return value;
 };
 const result=saveQueue.catch(()=>{}).then(run);saveQueue=result;
 try{return await result;}catch(e){$('saveState').textContent=saveConflict?'保存冲突 · 未覆盖':'保存未完成';$('saveState').classList.add('error');saveErrorKind=e.kind??'request';if(saveConflict||saveErrorKind==='auth')showRecovery(e);paintSaveButton('error');status(saveConflict?'另一处已保存，当前修改未覆盖。请在提示中保留本机副本或查看已保存版本。':e.message);throw e;}finally{pendingSaves--;$('save').disabled=!!pendingSaves;}
}
function showRecovery(error){
 clearTimeout(autoSaveTimer);$('saveRecovery').hidden=false;$('restoreLocal').hidden=$('localBackup').hidden;const auth=(error?.kind??saveErrorKind)==='auth';$('pairSave').hidden=!auth;$('pairSave').href=pairingUrl();
 $('recoveryMessage').textContent=auth?'配对已失效。先保留本机修改，再重新配对即可继续。':saveConflict?'另一处已保存，当前修改仍在这里。可以保留本机副本，再查看已保存版本。':'这台设备上保留了修改副本。恢复后可继续编辑，修改将自动保存。';
}
async function keepLocalCopy(){
 const record={scene:snapshot(),fields:placementDirty?Object.fromEntries(placementFields.map(key=>[key,$(key).value])):null,baseSavedAt:savedVersion,keptAt:Date.now()};
 await localDrafts.set(recoveryKey,record);$('localBackup').hidden=false;$('restoreLocal').hidden=false;$('recoveryMessage').textContent='当前修改已保留在此设备，可查看已保存版本，稍后恢复本机修改。';return record;
}
async function recoverAction(action){
 if(recoveryBusy||exportInProgress)return;recoveryBusy=true;const wasInert=editorMain.inert;editorMain.inert=true;$('save').disabled=true;for(const button of $('saveRecovery').querySelectorAll('button'))button.disabled=true;
 try{clearTimeout(autoSaveTimer);await saveQueue.catch(()=>{});await action();}
 catch(e){$('recoveryMessage').textContent=e.message;$('saveRecovery').hidden=false;}
 finally{editorMain.inert=wasInert;$('save').disabled=false;for(const button of $('saveRecovery').querySelectorAll('button'))button.disabled=false;recoveryBusy=false;}
}
$('keepLocal').onclick=()=>recoverAction(keepLocalCopy);
$('viewSaved').onclick=()=>recoverAction(async()=>{if(saveConflict||placementDirty||editRevision>savedRevision)await keepLocalCopy();const value=await requestJson(sceneEndpoint);recordHistory();restoreSaved(value);recordHistory();$('saveRecovery').hidden=true;status('正在查看已保存版本；本机修改副本已保留。');});
$('restoreLocal').onclick=()=>recoverAction(async()=>{
 const record=await localDrafts.get(recoveryKey);if(!record){$('localBackup').hidden=true;throw Error('本机副本已过期，请使用已保存方案。');}
 const latest=await requestJson(sceneEndpoint);recordHistory();if(!restore(record.scene))return;lastSavedScene=structuredClone(latest);savedVersion=latest.savedAt??null;saveConflict=false;saveErrorKind='';paintSaveButton();$('saveState').classList.remove('error');
 if(record.fields){for(const key of placementFields)$(key).value=record.fields[key];placementDirty=true;}checkpoint();$('saveRecovery').hidden=true;status('已恢复本机修改，可以继续编辑。');
});
$('pairSave').onclick=e=>{e.preventDefault();recoverAction(async()=>{await keepLocalCopy();allowRecoveryNavigation=true;location.href=pairingUrl();});};
$('localBackup').onclick=()=>showRecovery();$('closeRecovery').onclick=()=>{$('saveRecovery').hidden=true;($('localBackup').hidden?$('save'):$('localBackup')).focus();};
const activeObject=()=>objects.find(o=>o.id===activeObjectId);
function commitObject(){const o=activeObject();if(o)Object.assign(o,{pose:{...pose},size:{...size},mode:$('mode').value,selectedWall:'',gap:.02,back:activeObject()?.back??'+Y',align:false});}
function objectMenu(){
  if($('objectEmptyHint'))$('objectEmptyHint').hidden=objects.length>0;
  const o=activeObject();$('objectName').value=o?.name??'';
  for(const id of ['objectName','removeObject','duplicateObject','replaceAsset','apply','x','y','z','yaw','width','depth','height','mode'])$(id).disabled=!o;
  updateSelectionTools();
}
function selectObject(id){if(editorStep==='effects'||exportInProgress||!flushPlacementEdits())return;commitObject();const o=objects.find(o=>o.id===id);if(!o)return;selectionKind='object';activeObjectId=id;pose={...o.pose};size={...o.size};syncSize();$('mode').value=o.mode==='free'?'free':'floor';sync();objectMenu();draw();refreshThree();return true;}
function selectScene(){if(exportInProgress||!flushPlacementEdits())return;selectionKind='scene';updateSelectionTools();draw();status('已选中场景：拖动背景查看，双指或滚轮缩放；点物品显示操作坐标轴。');}
function updateSelectionTools(){
 const o=selectionKind==='object'?activeObject():null,editable=!!o&&o.visible;
 selectionLabel.textContent=o?'已选物品 · '+o.name+(o.visible?'':'（隐藏）'):'';selectionLabel.hidden=!o;selectionLabel.dataset.selection=o?'object':'scene';
 $('selectScene').setAttribute('aria-pressed',String(!o));updateSceneList();
 for(const [id,mode]of [['translateTool','translate'],['rotateTool','rotate'],['scaleTool','scale']]){$(id).disabled=!editable;$(id).setAttribute('aria-pressed',String(editable&&transformMode===mode));}
 $('inspectObject').disabled=!o;
 const s=threeState;if(!s?.transform)return;
 const available=editable&&editorStep==='place'&&currentView!=='plan'&&!exportInProgress;
 if(!available){s.transform.detach();s.selectionBox.visible=false;return;}
 if(!s.transform.dragging){s.transformProxy.position.set(o.pose.x,o.pose.y,o.pose.z+o.size.height/2);s.transformProxy.rotation.set(0,0,o.pose.yaw);s.transformProxy.scale.set(o.size.width,o.size.depth,o.size.height);}
 s.transform.setMode(transformMode);s.transform.setSpace(transformMode==='translate'?'world':'local');s.transform.showX=transformMode!=='rotate';s.transform.showY=transformMode!=='rotate';s.transform.showZ=true;
 if(s.transform.object!==s.transformProxy)s.transform.attach(s.transformProxy);
 const root=s.roots.get(o.id);s.selectionBox.visible=!!root;if(root){root.updateMatrixWorld(true);s.selectionBox.setFromObject(root);}
}
async function chooseTransform(mode){if(exportInProgress||!flushPlacementEdits())return;if(!activeObject()||selectionKind!=='object')return status('先点选画面中的物品。');transformMode=mode;if(currentView==='plan')await view('gaussian');updateSelectionTools();status(({translate:'拖动彩色箭头或轴面平移，蓝色轴调整离地高度。',rotate:'拖动蓝色圆环旋转物品，保持物品直立。',scale:'拖动彩色方块缩放，白色中心块等比缩放；请核对实物尺寸。'})[mode]);}
for(const [id,mode]of [['translateTool','translate'],['rotateTool','rotate'],['scaleTool','scale']])$(id).onclick=()=>chooseTransform(mode);
$('selectScene').onclick=selectScene;$('inspectObject').onclick=()=>openPanel('objects','placementSection');
function refreshRoomEnvelope(){structure.cameraBoundaryMode='walls';cameraRoom=roomEnvelope(structure,preview.xyz);$('roomHeight').value=cameraRoom.height.toFixed(2);$('planBoundaryNote').textContent=cameraRoom.wallCount?'围合视角边界 · '+cameraRoom.wallCount+' 条墙线':'墙线未形成可靠围合，视角暂用地面轮廓';if(threeState){threeState.lastCamera=null;constrainCamera();}}
function constrainCamera(){
 const s=threeState;if(!s||s.constraining||s.exporting)return;s.constraining=true;
 try{const p=s.camera.position.toArray(),safe=s.lastCamera?constrainRoomMotion(s.lastCamera,p,cameraRoom):clampRoomPoint(p,cameraRoom);s.camera.position.fromArray(safe);s.controls.target.fromArray(clampRoomPoint(s.controls.target.toArray(),cameraRoom));if(s.camera.position.distanceTo(s.controls.target)<.05)s.controls.target.fromArray(clampRoomPoint([safe[0]+.1,safe[1]+.1,safe[2]],cameraRoom));s.lastCamera=safe;s.controls.update();}finally{s.constraining=false;}
}
function scheduleAutoSave(){clearTimeout(autoSaveTimer);if(projectId&&!saveConflict&&editRevision>savedRevision)autoSaveTimer=setTimeout(()=>{if(exportInProgress){scheduleAutoSave();return;}if(placementDirty)return;persistScene(snapshot()).catch(()=>{});},1200);}
function checkpoint(){clearTimeout(historyTimer);if(!threeState?.transform?.dragging)historyTimer=setTimeout(()=>recordHistory(),180);if(!editorReady)return;editRevision++;$('saveState').textContent='有修改待保存';paintSaveButton(saveConflict?'error':'pending');if(!threeState?.transform?.dragging)scheduleAutoSave();if(editorStep==='effects')paintRenderAction();}
function recordHistory(){clearTimeout(historyTimer);const state=snapshot(),signature=v=>JSON.stringify({objects:v.objects,structure:v.structure,sceneScale:v.sceneScale,rememberedCamera:v.rememberedCamera??null,renderFrame:v.renderFrame??'viewport'});if(history[historyIndex]&&signature(JSON.parse(history[historyIndex]))===signature(state))return;const value=JSON.stringify(state);history=history.slice(0,historyIndex+1);history.push(value);if(history.length>40)history.shift();historyIndex=history.length-1;historyButtons();}
function historyButtons(){for(const id of ['undo','planUndo'])$(id).disabled=historyIndex<=0;for(const id of ['redo','planRedo'])$(id).disabled=historyIndex>=history.length-1;}
function undoRedo(delta){if(exportInProgress||editorStep==='effects'||editMode||wallDrag)return;placementDirty=false;clearPlacementError();recordHistory();const i=historyIndex+delta;if(i<0||i>=history.length)return;historyIndex=i;restore(JSON.parse(history[i]));historyButtons();checkpoint();status(delta<0?'已撤销，可重做。':'已重做。');}
const status=text=>{$('status').textContent=text;const feedback=$('planFeedback');if(feedback){feedback.textContent=currentView==='plan'?text:'';feedback.hidden=currentView!=='plan';}};
const number=id=>$(id).value.trim()?Number($(id).value):NaN;
function populate(){
  refreshRoomEnvelope();
  $('floorZ').value=structure.floor.z;
  updateWallTools();
  $('polygon').value=JSON.stringify(floorPolygon(structure.floor));
}
function sync(){$('z').readOnly=$('mode').value!=='free';for(const k of ['x','y','z'])$(k).value=pose[k].toFixed(4);$('yaw').value=(pose.yaw*180/Math.PI).toFixed(2);}
function apply(next=pose,requestedSize=Object.fromEntries(['width','depth','height'].map(k=>[k,number(k)/100]))){
  if(exportInProgress)return false;
  if(!activeObject())return false;
  if(!Object.values(requestedSize).every(v=>Number.isFinite(v)&&v>0)||!Object.values(next).every(Number.isFinite)){status('请输入有效位置及正数尺寸。');return false;}
  let result={ok:true,pose:next};
  if($('mode').value!=='free')result=snapFloor(next,requestedSize,structure.floor);
  if(!result.ok){status(result.reason);return false;}
  size=requestedSize;pose=result.pose;commitObject();sync();draw();refreshThree();checkpoint();
  const current=activeObject(),warnings=placementWarnings(pose,size,structure);
  for(const other of objects)if(other.id!==activeObjectId&&objectsOverlap(current,other))warnings.push(`与新增物品“${other.name}”重叠`);
  status(`已应用 ${current.name} · ${$('mode').value==='floor'?'已贴地':'底高 '+pose.z.toFixed(2)+' m'}。${warnings.length?'⚠ '+warnings.join('；'):'修改会自动保存，可直接对比。'}`);return true;
}
let editMode=null,sketch=[],selectedWallId=null,wallDrag=null,wallHover=null;
function updateWallTools(){const wall=structure.walls.find(w=>w.id===selectedWallId);if(!wall)selectedWallId=null;$('deleteWall').disabled=!wall||!!editMode;$('wallEditInfo').textContent=wall?'墙线 '+Math.hypot(wall.b[0]-wall.a[0],wall.b[1]-wall.a[1]).toFixed(2)+' 米 · 拖动圆点':'点选墙线，拖动圆点修改';}
let map={};
function draw(){
  const canvas=$('plan'),rect=$('stage').getBoundingClientRect();canvas.width=rect.width*devicePixelRatio;canvas.height=rect.height*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.fillStyle='#eaf0eb';ctx.fillRect(0,0,rect.width,rect.height);
  const card=$('planCalibration'),plan=currentView==='plan'&&!card.hidden,side=plan&&rect.width>=700;
  const left=16,top=document.body.classList.contains('view-expanded')?120:76,right=side?card.offsetWidth+36:16,bottom=plan&&!side?card.offsetHeight+28:36;
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
function pointer(e){const r=$('plan').getBoundingClientRect();return {x:map.mx+(e.clientX-r.left-map.cx)/map.scale,y:map.my-(e.clientY-r.top-map.cy)/map.scale,z:pose.z,yaw:pose.yaw};}
const wallPoint=e=>{const p=pointer(e);return [p.x,p.y];};
function snapWallPoint(p,exclude){const points=structure.walls.filter(w=>w.id!==exclude&&w.enabled!==false).flatMap(w=>[w.a,w.b]);const near=points.find(q=>Math.hypot(q[0]-p[0],q[1]-p[1])*map.scale<12);return near?near.slice(0,2):p;}
$('plan').onpointerdown=e=>{
 if(exportInProgress||e.pointerType==='touch'&&!e.isPrimary)return;
 const p=wallPoint(e);
 if(editMode){const v=editMode==='wall'?snapWallPoint(p):p;if(!sketch.length||Math.hypot(v[0]-sketch.at(-1)[0],v[1]-sketch.at(-1)[1])>.03)sketch.push(v);if(editMode==='wall'&&sketch.length===2)finishSketch();else draw();return;}
 const walls=structure.walls.filter(w=>w.enabled!==false),selected=walls.find(w=>w.id===selectedWallId);
 const end=selected&&['a','b'].find(key=>Math.hypot(selected[key][0]-p[0],selected[key][1]-p[1])*map.scale<22);
 if(end){recordHistory();clearTimeout(autoSaveTimer);wallDrag={id:selected.id,end,base:structuredClone(structure),map:{...map},pointer:e.pointerId,changed:false};$('plan').setPointerCapture(e.pointerId);return;}
 let best=null,distance=16/map.scale;for(const w of walls){const dx=w.b[0]-w.a[0],dy=w.b[1]-w.a[1],t=Math.max(0,Math.min(1,((p[0]-w.a[0])*dx+(p[1]-w.a[1])*dy)/(dx*dx+dy*dy)));const d=Math.hypot(p[0]-w.a[0]-t*dx,p[1]-w.a[1]-t*dy);if(d<distance){best=w;distance=d;}}
 selectedWallId=best?.id??null;updateWallTools();draw();
};
$('plan').onpointermove=e=>{if(wallDrag&&wallDrag.pointer===e.pointerId){const w=wallDrag.base.walls.find(w=>w.id===wallDrag.id),p=snapWallPoint(wallPoint(e),w.id);try{structure=changeWall(wallDrag.base,w.id,wallDrag.end==='a'?p:w.a,wallDrag.end==='b'?p:w.b);wallDrag.changed=true;refreshRoomEnvelope();updateWallTools();draw();}catch{}}else if(editMode==='wall'){wallHover=wallPoint(e);draw();}};
function finishWallDrag(e,cancel=false){if(!wallDrag||e.pointerId!==wallDrag.pointer)return;const gesture=wallDrag;wallDrag=null;if(cancel)structure=gesture.base;populate();draw();refreshThree();if(gesture.changed&&!cancel){checkpoint();status('墙线已修改，连接端点同步更新。');}else scheduleAutoSave();}
$('plan').onpointerup=e=>finishWallDrag(e);$('plan').onpointercancel=e=>finishWallDrag(e,true);$('plan').onlostpointercapture=e=>finishWallDrag(e,true);
$('apply').onclick=()=>{placementDirty=true;flushPlacementEdits();};
for(const key of placementFields){$(key).addEventListener('input',()=>{placementDirty=true;clearPlacementError();$('saveState').textContent='正在编辑…';});$(key).addEventListener('change',flushPlacementEdits);$(key).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();flushPlacementEdits();}if(e.key==='Escape'){placementDirty=false;clearPlacementError();sync();syncSize();$('saveState').textContent=editRevision>savedRevision?'有修改待保存':savedVersion?'已保存到电脑':'尚未修改';scheduleAutoSave();status('已取消本次数值修改。');}});}
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
  const output=threeState&&editorStep==='effects'?effectDimensions(renderFrame,threeState.camera.aspect):null;
  const camera=threeState?{rows:cameraRows(),verticalFov:threeState.camera.fov,resolution:output?[output.width,output.height]:[threeState.renderer.getSize(new threeState.THREE.Vector2()).x,threeState.renderer.getSize(new threeState.THREE.Vector2()).y].map(v=>Math.min(4500,Math.max(1,Math.round(v))))}:pendingCamera;
  return validateScene({schemaVersion:3,projectId:projectId??undefined,worldId:structure.worldId,upAxis:'Z',units:'m',sceneScale,renderFrame,structure,size,pose,mode:$('mode').value,selectedWall:'',gap:.02,back:activeObject()?.back??'+Y',align:false,assets:ASSETS,objects,activeObjectId,rememberedCamera,furnitureBottomOrigin:true,placementMatrix:columnMatrix(pose),scaleBasis:structure.scaleBasis,placementPolicy:'floor-only',collisionValidation:'FLOOR_AND_NEW_OBJECTS_ONLY',camera});
}
function restoreCamera(saved){if(!saved||!threeState)return;threeState.lastCamera=null;const m=new threeState.THREE.Matrix4().fromArray(saved.rows.flat());m.elements[12]/=1000;m.elements[13]/=1000;m.elements[14]/=1000;m.decompose(threeState.camera.position,threeState.camera.quaternion,new threeState.THREE.Vector3());threeState.camera.fov=saved.verticalFov;const forward=new threeState.THREE.Vector3(0,0,-1).applyQuaternion(threeState.camera.quaternion);threeState.controls.target.copy(threeState.camera.position).addScaledVector(forward,3);threeState.controls.update();constrainCamera();}
function cameraRows(){const c=threeState.camera;c.updateMatrixWorld();const e=c.matrixWorld.elements;return [[e[0],e[1],e[2],0],[e[4],e[5],e[6],0],[e[8],e[9],e[10],0],[e[12]*1000,e[13]*1000,e[14]*1000,1]];}
window.placementSnapshot=snapshot;
function download(bytes,name,type='application/json'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>{try{requirePlacementEdits();download(JSON.stringify(snapshot(),null,2),'room_placement.json');}catch(e){status(e.message);}};
$('meshExport').onclick=()=>download(structureGlb(structure,{floorOnly:true}),'floor.glb','model/gltf-binary');
function restore(value){
  if(exportInProgress){status('图片导出进行中，请结束后重新载入摆放。');return false;}
  if(value.worldId!==structure.worldId||(projectId&&value.projectId!==projectId))throw Error('摆放不属于当前项目');
  const v=validateScene(structuredClone(value));preview.xyz=sourcePreview.map(p=>v.structure.sourceToAligned.slice(0,3).map(r=>r[0]*p[0]+r[1]*p[1]+r[2]*p[2]+r[3]));
  placementDirty=false;clearPlacementError();sceneScale=v.sceneScale;structure=v.structure;objects=v.objects;activeObjectId=null;size=v.size;pose=v.pose;syncSize();populate();
  $('mode').value=v.mode;
  if(v.activeObjectId)selectObject(v.activeObjectId);else{sync();objectMenu();draw();refreshThree();}
  renderFrame=v.renderFrame??'viewport';$('renderFrame').value=renderFrame;layoutThree();pendingCamera=v.camera??null;rememberedCamera=v.rememberedCamera??null;restoreCamera(pendingCamera);status('已恢复物品、摆放与结构。');return true;
}
$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{await restoreWhenReady(()=>file.text().then(text=>JSON.parse(text)),{isBusy:()=>exportInProgress,apply:value=>{recordHistory();if(!restore(value))return false;checkpoint();return true;},onBusy:()=>status('图片导出进行中，请结束后重新载入摆放。')});}catch(e){status('导入失败：'+e.message);}};
$('save').onclick=async()=>{if($('save').disabled||wallDrag)return;if(saveConflict||saveErrorKind==='auth'){showRecovery();return;}$('save').disabled=true;try{requirePlacementEdits();await persistScene(snapshot());status('方案已保存，可以继续摆放或查看效果图。');}catch(e){status(e.message);}finally{$('save').disabled=false;}};
function restoreSaved(value){const restored=restore(value);if(restored){lastSavedScene=structuredClone(value);savedVersion=value.savedAt??null;saveConflict=false;saveErrorKind='';savedRevision=editRevision;$('saveState').textContent='已载入保存方案';$('saveState').classList.remove('error');paintSaveButton('saved');}return restored;}
$('reload').onclick=async()=>{if(editRevision>savedRevision||placementDirty){status('当前还有修改未保存。请先导出布局文件，再次点击载入时确认。');if(!confirm('重新载入会替换当前未保存的修改。已导出布局文件，继续载入？'))return;}try{await restoreWhenReady(async()=>{const r=await fetch(sceneEndpoint);if(!r.ok)throw Error('尚无用户保存文件');return r.json();},{isBusy:()=>exportInProgress,apply:restoreSaved,onBusy:()=>status('图片导出进行中，请结束后重新载入摆放。')});}catch(e){status(e.message);}};
$('updatePolygon').onclick=()=>{try{const candidate=structuredClone(structure);candidate.floor.polygon=JSON.parse($('polygon').value);validateStructure(candidate);const poly=candidate.floor.polygon;candidate.floor.bounds=[[Math.min(...poly.map(p=>p[0])),Math.min(...poly.map(p=>p[1]))],[Math.max(...poly.map(p=>p[0])),Math.max(...poly.map(p=>p[1]))]];candidate.floor.source='MANUALLY_EDITED';structure=candidate;populate();draw();refreshThree();status('已更新手工地面轮廓。');}catch(e){status('地面修改失败：'+e.message);}};
function setupThree(){if(threeState)return Promise.resolve();if(!threeSetupPromise)threeSetupPromise=setupThreeBody().catch(e=>{threeSetupPromise=null;throw e;});return threeSetupPromise;}
async function setupThreeBody(){
  if(threeState)return;
  status('正在加载三维查看器…');
  const THREE=await import('three');const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');const {TransformControls}=await import('three/addons/controls/TransformControls.js');
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor('#e5eae6');$('three').append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(65,1,.03,100),controls=new OrbitControls(camera,renderer.domElement);camera.up.set(0,0,1);
  controls.addEventListener('end',()=>{if(editorReady&&!exportInProgress)checkpoint();});
  const [lo,hi]=structure.floor.bounds,center=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2],origin=structure.sourceToAligned.slice(0,3).map(row=>row[3]);
  // Start inside the space, near the source capture position, rather than outside its shell.
  const eye=pointInside(origin,floorPolygon(structure.floor))&&Math.hypot(origin[0]-center[0],origin[1]-center[1])>.4?origin:[center[0],center[1]-Math.min(hi[1]-lo[1],hi[0]-lo[0])*.2,structure.floor.z+1.4];
  camera.position.set(eye[0],eye[1],Math.max(structure.floor.z+1.25,eye[2]));controls.target.set(center[0],center[1],structure.floor.z+.8);controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x68725c,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(3,-3,7);scene.add(sun);
  const proxies=new THREE.Group(),modelRoot=new THREE.Group();scene.add(proxies,modelRoot);
  controls.minDistance=.12;controls.maxDistance=30;controls.enabled=!exportInProgress;threeState={THREE,renderer,scene,camera,controls,proxies,modelRoot,roots:new Map(),templates:new Map(),loading:new Map(),gltfLoader:new GLTFLoader(),splat:null,spark:null};
  const transformProxy=new THREE.Object3D();scene.add(transformProxy);const transform=new TransformControls(camera,renderer.domElement);transform.setSize(mobileLayout?1.15:.9);transform.setRotationSnap(Math.PI/180);scene.add(transform.getHelper());
  const selectionBox=new THREE.BoxHelper(new THREE.Object3D(),0x55bd98);selectionBox.material.depthTest=false;selectionBox.material.transparent=true;selectionBox.material.opacity=.85;selectionBox.renderOrder=1000;selectionBox.visible=false;scene.add(selectionBox);Object.assign(threeState,{transform,transformProxy,selectionBox});
  transform.addEventListener('dragging-changed',event=>{controls.enabled=!event.value&&!exportInProgress;if(event.value){threeState.gizmoGesture=true;recordHistory();clearTimeout(autoSaveTimer);}else{updateSelectionTools();recordHistory();scheduleAutoSave();}});
  transform.addEventListener('objectChange',()=>{
   if(!transform.dragging||exportInProgress)return;let candidate;try{const position=transformProxy.position.toArray();position[2]-=transformProxy.scale.z/2;candidate=gizmoPlacement(position,transformProxy.rotation.z,transformProxy.scale.toArray());}catch(e){status(e.message);resetTransformProxy();return;}
   const previousMode=$('mode').value;if(transformMode==='translate'&&transform.axis?.includes('Z'))$('mode').value='free';
   if(!apply(candidate.pose,candidate.size)){$('mode').value=previousMode;resetTransformProxy();}else{syncSize();resetTransformProxy();}
  });
  controls.addEventListener('change',constrainCamera);constrainCamera();
  const s=threeState;s.ensureObjectRoots=createObjectRootEnsurer({
    getItems:()=>objects,
    getMountedAssetId:id=>s.roots.get(id)?.userData.assetId,
    loadTemplate:assetId=>objectTemplate(assetId),
    mountRoot:(o,{normalized,extent},{id,assetId})=>{
      const old=s.roots.get(id);if(old){s.modelRoot.remove(old);s.roots.delete(id);}
      const root=new THREE.Group(),wrapper=normalized.clone(true);root.add(wrapper);root.userData={objectId:id,assetId,extent};
      root.position.set(o.pose.x,o.pose.y,o.pose.z);root.rotation.z=o.pose.yaw;root.visible=o.visible;wrapper.scale.set(o.size.width/extent.x,o.size.depth/extent.y,o.size.height/extent.z);s.roots.set(id,root);s.modelRoot.add(root);updateSelectionTools();
    }
  });restoreCamera(pendingCamera);try{await ensureObjects();}catch(e){$('assetErrorText').textContent='有物品未能载入，可以在原处重试，空间仍可浏览。';$('assetError').hidden=false;status(e.message);}refreshThree();installDrag();
  renderer.setAnimationLoop(()=>{if(!threeState.exporting)layoutThree();controls.update();renderer.render(scene,camera);});
}
function resetTransformProxy(){const s=threeState,o=activeObject();if(!s||!o)return;s.transformProxy.position.set(o.pose.x,o.pose.y,o.pose.z+o.size.height/2);s.transformProxy.rotation.set(0,0,o.pose.yaw);s.transformProxy.scale.set(o.size.width,o.size.depth,o.size.height);}
function layoutThree(){
 if(!threeState||threeState.exporting)return;
 const s=threeState,r=$('stage').getBoundingClientRect(),composing=editorStep==='effects',top=composing&&document.body.classList.contains('view-expanded')?60:0,bottom=composing?renderComposer.offsetHeight+24:0,available=Math.max(1,r.height-top-bottom),viewportAspect=r.width/available;
 const output=composing?effectDimensions(renderFrame,viewportAspect):null,aspect=output?output.width/output.height:document.body.classList.contains('landscape-mode')?16/9:r.width/Math.max(1,r.height);
 const width=Math.max(1,Math.min(r.width,(composing?available:r.height)*aspect)),height=width/aspect,key=width+'x'+height+':'+r.width+'x'+r.height+':'+top+':'+bottom;
 if(s.frameKey===key)return;s.frameKey=key;s.renderer.setSize(Math.round(width),Math.round(height),false);Object.assign(s.renderer.domElement.style,{position:'absolute',width:width+'px',height:height+'px',left:(r.width-width)/2+'px',top:top+((composing?available:r.height)-height)/2+'px'});s.camera.aspect=aspect;s.camera.updateProjectionMatrix();if(editorReady&&composing)paintRenderAction();
}
async function loadSplat(){
  if(threeState.splat){if(threeState.splat.initialized)await threeState.splat.initialized;return;}
  const {SparkRenderer,SplatMesh}=await import('@sparkjsdev/spark');
  threeState.spark=new SparkRenderer({renderer:threeState.renderer});threeState.scene.add(threeState.spark);
  status('正在解码原始高斯 PLY…');
  const splat=new SplatMesh({url:asset('room.ply'),onLoad:()=>status('点选物品后使用下方坐标轴工具；拖动背景查看空间。')});
  threeState.splat=splat;threeState.scene.add(splat);refreshThree();
  if(splat.initialized)await splat.initialized;window.mixedPreviewReady={worldId:structure.worldId,gaussianCount:splat.numSplats??null,model:true};
}
function refreshThree(){
  if(!threeState)return;const s=threeState,{THREE}=s,showAux=$('showFloor').checked||currentView==='structure';
  s.modelRoot.visible=true;s.proxies.visible=editorStep!=='effects';
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
function syncViewTools(){const plan=currentView==='plan';editorMain.dataset.view=plan?'plan':'3d';for(const element of document.querySelectorAll('[data-plan-only]'))element.hidden=!plan;$('fileTools').hidden=mobileLayout;$('moreButton').hidden=plan||mobileLayout;if(plan){editorMain.classList.add('compact');$('planFeedback').hidden=true;}if(activePanelGroup==='more')$('panelTitle').textContent='视角与高级设置';syncExpandButton();}
function syncExpandButton(){const expanded=document.body.classList.contains('view-expanded'),label=expanded?'退出横屏':'横屏 · 16:9 取景';iconButton('expandScene',label,'');$('expandScene').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="m8 3-3 2 3 2m8 14 3-2-3-2"/></svg>';}
async function view(kind){try{if(kind!=='plan'&&editMode){endSketch();status('已取消未完成的地面绘制，已保留原轮廓。');}currentView=kind;syncViewTools();for(const [id,v]of [['planBtn','plan'],['view3d','gaussian'],['structureView','structure'],['structure3d','structure']]){$(id).classList.toggle('primary',kind===v);$(id).setAttribute('aria-pressed',String(kind===v));}if(kind==='plan'){$('three').style.display='none';$('plan').style.display='block';draw();return;}$('three').style.display='block';$('plan').style.display='none';await setupThree();if(kind==='gaussian')await loadSplat();refreshThree();}catch(e){$('error').textContent='三维加载失败：'+e.message+'。俯视摆放仍可使用。';currentView='plan';syncViewTools();$('three').style.display='none';$('plan').style.display='block';$('planBtn').classList.add('primary');$('planBtn').setAttribute('aria-pressed','true');for(const id of ['view3d','structureView','structure3d']){$(id).classList.remove('primary');$(id).setAttribute('aria-pressed','false');}draw();status('三维加载暂不可用，已切换到俯视图。可继续摆放和保存，或点击效果重试。');}}
$('planBtn').onclick=async()=>{if(exportInProgress)return;try{requirePlacementEdits();await view('plan');}catch(e){status(e.message);}};$('view3d').onclick=async()=>{if(exportInProgress)return;await view('gaussian');if(currentView==='gaussian')closePanel();};$('structureView').onclick=()=>view('structure');
if(projectId){const [a,b]=structure.floor.bounds;pose={x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,z:structure.floor.z,yaw:0};if(!floorContains(pose,size,structure.floor)){outer:for(let x=a[0]+1;x<b[0];x+=.4)for(let y=a[1]+.3;y<b[1];y+=.4){const p={...pose,x,y};if(floorContains(p,size,structure.floor)){pose=p;break outer;}}}const info=await readJson(projectBase);fetch(projectBase+'/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});projectInfo=info;document.querySelector('h1').textContent=info.name;document.querySelector('header small').textContent='空间工坊 · 本地项目 · 尺寸请按实物核对';$('coverageNote').textContent='默认只吸附当前地面；可调整地面高度、范围与场景比例。墙体和原场景家具不参与碰撞检查，新增物品之间保留重叠提示。在画面下方点“拖动物品”，按住新增物品拖动；点“完成拖动”恢复浏览。原场景、摆放后和保存都在同一画面。使用微调中的 ±15° 按钮或 Q/E 旋转。';}
populate();sync();draw();status('已载入真实场景。初始为测试姿态，默认仅吸附地面；请核对地面高度与范围后保存。');window.addEventListener('resize',()=>{const next=matchMedia('(max-width: 900px), (max-height: 520px) and (max-width: 1100px)').matches;if(next!==mobileLayout){mobileLayout=next;editorMain.classList.toggle('compact',next);$('panelToggle').textContent=next?'打开面板':'收起面板';$('panelToggle').setAttribute('aria-expanded',String(!next));setPanelGroup(activePanelGroup);}syncViewTools();draw();});

function installDrag(){
 const s=threeState,{THREE}=s,ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),el=s.renderer.domElement;
 const cast=e=>{const r=el.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,s.camera);};
 let tap=null;const pointers=new Set();
 el.addEventListener('pointerdown',e=>{pointers.add(e.pointerId);if(pointers.size>1){tap=null;if(s.transform.dragging)s.transform.pointerUp({button:0});s.transform.enabled=false;return;}if(exportInProgress||e.button!==0)return;tap={id:e.pointerId,x:e.clientX,y:e.clientY,gizmo:s.transform.dragging||s.transform.axis!==null};},true);
 el.addEventListener('pointermove',e=>{if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>7)tap=null;});
 el.addEventListener('pointerup',e=>{pointers.delete(e.pointerId);if(!pointers.size)s.transform.enabled=true;const down=tap,gizmo=s.gizmoGesture;tap=null;s.gizmoGesture=false;if(!down||down.id!==e.pointerId||down.gizmo||gizmo||s.transform.dragging||exportInProgress||editorStep==='effects')return;cast(e);const hit=ray.intersectObject(s.modelRoot,true).find(h=>{for(let node=h.object;node;node=node.parent)if(!node.visible)return false;return true;});let picked=hit?.object;while(picked&&!picked.userData.objectId)picked=picked.parent;if(picked){selectObject(picked.userData.objectId);status('已选中 '+activeObject().name+'，在下方切换平移、旋转或缩放。');}else selectScene();});
 el.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);if(!pointers.size)s.transform.enabled=true;tap=null;if(s.transform.dragging){s.transform.pointerUp({button:0});updateSelectionTools();}});
 window.addEventListener('keydown',e=>{if(exportInProgress||editorStep==='effects'||selectionKind!=='object'||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||!['q','e'].includes(e.key.toLowerCase())||currentView==='plan')return;rotateActiveObject((e.key.toLowerCase()==='q'?1:-1)*Math.PI/36,5);});
}
async function furnitureCamera(side){if(exportInProgress)return;if(!activeObject())return status('请先添加物品');await view('gaussian');if(exportInProgress||!threeState)return;const s=threeState,candidate=placementCamera(activeObject(),{...structure,floor:{...structure.floor,polygon:cameraRoom.polygon}},objects,side,s.camera.fov,s.camera.aspect);s.lastCamera=null;s.camera.position.set(...candidate.position);s.controls.target.set(...candidate.target);constrainCamera();checkpoint();status('已聚焦选中物品，可拖动背景调整角度。');}

let activePanelGroup='objects';
let panelReturnFocus=null;
function setPanelGroup(group){if(group==='placement')group='objects';activePanelGroup=group;$('panelTitle').textContent=group==='objects'?'物品属性':currentView==='plan'?'2D 空间校正':'视角与高级设置';editorMain.dataset.panelGroup=group;for(const section of document.querySelectorAll('#editorPanel [data-panel-group]')){const hidden=section.dataset.panelGroup!==group;section.hidden=hidden;section.setAttribute('aria-hidden',String(hidden));}for(const [id,value] of [['desktopObjects','objects'],['desktopPlace','objects'],['desktopMore','more'],['mobileObjects','objects']])$(id).setAttribute('aria-pressed',String(group===value&&(id!=='mobileObjects'||!editorMain.classList.contains('compact'))));syncViewTools();}
function openPanel(group,target){if(document.fullscreenElement){document.exitFullscreen().then(()=>openPanel(group,target)).catch(e=>status(e.message));return;}if(editorMain.classList.contains('compact'))panelReturnFocus=document.activeElement;editorMain.classList.remove('compact');setPanelGroup(group);$('panelToggle').textContent='收起面板';$('panelToggle').setAttribute('aria-expanded','true');requestAnimationFrame(()=>{const section=$(target);if(!section)return;section.scrollIntoView({block:'start',behavior:'smooth'});const focusTarget=section.matches('details')?section.querySelector('summary'):section.querySelector('h2,summary,button:not([hidden]),input,select,textarea');if(focusTarget){if(!focusTarget.hasAttribute('tabindex'))focusTarget.tabIndex=-1;focusTarget.focus({preventScroll:true});}});if(editMode)status('绘制仍在进行；请用画面上的“完成绘制”或“取消绘制”结束后再继续其他编辑。');draw();}
function closePanel(restoreFocus=false){editorMain.classList.add('compact');$('mobileObjects').setAttribute('aria-pressed','false');$('panelToggle').textContent='打开面板';$('panelToggle').setAttribute('aria-expanded','false');if(restoreFocus){const target=panelReturnFocus?.isConnected&&!panelReturnFocus.closest('[hidden]')?panelReturnFocus:$('panelToggle');target.focus({preventScroll:true});}draw();}
$('panelToggle').onclick=()=>{if(!mobileLayout)return;if(!editorMain.classList.contains('compact'))closePanel();else openPanel(activePanelGroup,activePanelGroup==='objects'?'objectSection':activePanelGroup==='placement'?'placementSection':'moreTools');};
$('closePanel').onclick=()=>closePanel(true);$('savedContinue').onclick=()=>$('saveDialog').close();
$('moreButton').onclick=()=>openPanel('more','moreTools');
$('desktopObjects').onclick=()=>openPanel('objects','objectSection');$('desktopPlace').onclick=()=>openPanel('placement','placementSection');$('desktopMore').onclick=()=>openPanel('more','moreTools');
function toggleMobilePanel(group,target){if(activePanelGroup===group&&!editorMain.classList.contains('compact'))closePanel(true);else openPanel(group,target);}
$('mobileObjects').onclick=()=>toggleMobilePanel('objects',activeObject()?'currentObjectDetails':'objectSection');$('mobilePlace').onclick=()=>toggleMobilePanel('placement','placementSection');

function setSketchControls(disabled){for(const element of planCalibration.querySelectorAll('input,button'))element.disabled=disabled;if(!disabled)historyButtons();}
function endSketch(){$('stage').classList.remove('sketching');editMode=null;sketch=[];wallHover=null;setSketchControls(false);updateWallTools();$('finishFloor').hidden=true;$('cancelSketch').hidden=true;if(['finishFloor','cancelSketch'].includes(document.activeElement?.id))$('drawFloor').focus({preventScroll:true});draw();}
async function beginSketch(kind='floor'){if(exportInProgress||wallDrag||!flushPlacementEdits())return;await view('plan');editMode=kind;$('stage').classList.add('sketching');sketch=[];setSketchControls(true);$('finishFloor').textContent=kind==='wall'?'完成墙线':'完成绘制';$('finishFloor').hidden=false;$('cancelSketch').hidden=false;status(kind==='wall'?'点击墙线起点和终点；靠近已有端点会自动连接。':'依次点击地面边界顶点，点“完成绘制”结束；可随时取消。');$('cancelSketch').focus({preventScroll:true});draw();}
function finishSketch(){try{recordHistory();const kind=editMode;if(kind==='wall'){if(sketch.length<2)throw Error('请点击墙线的起点和终点');const id='wall_'+randomUuidV4();structure=changeWall({...structure,roomHeight:structure.roomHeight??cameraRoom.height},id,sketch[0],sketch[1]);selectedWallId=id;}else{if(sketch.length<3)throw Error('地面至少需要 3 个顶点');const candidate=structuredClone(structure);candidate.floor.polygon=sketch.map(p=>[...p]);candidate.floor.bounds=[[Math.min(...sketch.map(p=>p[0])),Math.min(...sketch.map(p=>p[1]))],[Math.max(...sketch.map(p=>p[0])),Math.max(...sketch.map(p=>p[1]))]];candidate.floor.source='MANUAL_DRAWING';validateStructure(candidate);structure=candidate;}endSketch();populate();draw();refreshThree();checkpoint();status(kind==='wall'?'墙线已添加，可拖动圆点继续修改。':'已更新手绘地面轮廓。');}catch(e){status(e.message);}}
$('drawFloor').onclick=()=>beginSketch();$('drawWall').onclick=()=>beginSketch('wall');$('deleteWall').onclick=()=>{if(!selectedWallId||editMode||wallDrag)return;recordHistory();structure=removeWall(structure,selectedWallId);selectedWallId=null;populate();draw();refreshThree();checkpoint();status('已删除选中墙线，可撤销恢复。');};$('finishFloor').onclick=finishSketch;$('cancelSketch').onclick=()=>{if(editMode){endSketch();status('已取消绘制。');}};$('plan').ondblclick=()=>{if(!exportInProgress&&editMode==='floor')finishSketch();};window.addEventListener('keydown',e=>{if(exportInProgress||$('usageDialog').open||e.key!=='Escape')return;if(editMode){endSketch();status('已取消绘制。');return;}if(mobileLayout&&!editorMain.classList.contains('compact'))closePanel(true);});

await initializeObjects();
if(projectInfo?.hasScene){try{await restoreWhenReady(()=>readJson(sceneEndpoint),{isBusy:()=>exportInProgress,apply:restoreSaved,onBusy:()=>status('图片导出进行中，请结束后重新载入摆放。')});}catch(e){status('自动恢复失败：'+e.message+'；可手动载入备份。');}}
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
  const s=threeState,{THREE}=s;
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
  const s=threeState;if(!s)return;await s.ensureObjectRoots();
}
async function addObject(assetId=BUILTIN_OBJECT,copy=null,requestedSize=null){
  if(exportInProgress)return null;
  if(!flushPlacementEdits())return null;
  if(objects.length>=40){status('最多摆放 40 件物品，请先移除部分物品');return null;}
  recordHistory();commitObject();const meta=objectAssets.find(a=>a.id===assetId),image=meta?.kind==='image';
  let initialSize=requestedSize??meta?.estimatedSize??(image?{width:1,depth:.03,height:.75}:{width:1.8,depth:.4,height:.55});
  if(image&&!copy&&!requestedSize){try{const img=new Image();img.src=projectBase+'/objects/'+assetId;await img.decode();initialSize={width:1,depth:.03,height:img.naturalHeight/img.naturalWidth};}catch{status('图片无法解码，请重新导入');return null;}if(exportInProgress)return null;}
  const o=copy?structuredClone(copy):legacyObject({pose:{...pose,z:structure.floor.z},size:initialSize,mode:'floor',selectedWall:'',gap:.02,back:'+Y',align:false});
  Object.assign(o,{id:'obj_'+randomUuidV4(),name:copy?(copy.name.slice(0,75)+' 副本'):(meta?.name?.replace(/\.[^.]+$/,'')??'电视柜'),assetId,assetKind:image?'image':'glb',visible:true});
  const original={...o.pose};outer:for(const [dx,dy] of [[.5,0],[0,.6],[-.5,0],[0,-.6],[1.2,0],[0,1.2],[0,0]]){o.pose={...original,x:original.x+dx,y:original.y+dy};if(floorContains(o.pose,o.size,structure.floor)&&!objects.some(other=>objectsOverlap(o,other)))break outer;}
  objects.push(o);selectObject(o.id);checkpoint();status(image?'已添加图片模型，默认落地。填写实物宽高；需要调整高度时可使用手动位置。':'已添加物品。填写实物尺寸，拖动摆放，再切换三维预览。');return o;
}
$('objectName').oninput=()=>{const o=activeObject();if(!o)return;o.name=$('objectName').value.trim().slice(0,80)||'未命名物品';updateSelectionTools();draw();checkpoint();};
$('addBuiltin').onclick=()=>addObject();$('addAsset').onclick=()=>addObject($('assetLibrary').value);
$('duplicateObject').onclick=()=>{if(activeObject())addObject(activeObject().assetId,activeObject());};
$('removeObject').onclick=()=>{if(!activeObject())return;placementDirty=false;clearPlacementError();recordHistory();objects=objects.filter(o=>o.id!==activeObjectId);activeObjectId=null;if(objects.length)selectObject(objects.at(-1).id);else{$('mode').value='free';objectMenu();draw();refreshThree();}checkpoint();status('已从摆放方案移除物品，素材仍在本地素材库；可以撤销。');};
$('undo').onclick=()=>undoRedo(-1);$('redo').onclick=()=>undoRedo(1);
window.addEventListener('keydown',e=>{if(exportInProgress||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoRedo(e.shiftKey?1:-1);}});
$('uploadObject').onclick=()=>$('objectFile').click();
$('objectFile').onchange=async()=>{
  const file=$('objectFile').files[0];if(!file||exportInProgress)return;$('uploadObject').disabled=true;status('正在保存物品到本机…');
  try{const r=await fetch(projectBase+'/objects?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file}),a=await r.json();if(!r.ok)throw Error(a.error);if(!objectAssets.some(o=>o.id===a.id))objectAssets.push(a);updateLibrary();$('assetLibrary').value=a.id;
    if(a.kind==='image'){const added=await addObject(a.id);if(!added)return;apply();}
    else{await setupThree();await objectTemplate(a.id);if(exportInProgress)return;addObject(a.id);}
  }catch(e){status('导入失败：'+e.message);}finally{$('uploadObject').disabled=false;$('objectFile').value='';}
};

async function captureFrame(){
  const s=threeState,visibility=s.modelRoot.visible,aux=s.proxies.visible,helper=s.transform.getHelper(),gizmo=helper.visible,box=s.selectionBox.visible;s.modelRoot.visible=true;s.proxies.visible=false;helper.visible=false;s.selectionBox.visible=false;
  try{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);s.renderer.render(s.scene,s.camera);const result=document.createElement('canvas');result.width=s.renderer.domElement.width;result.height=s.renderer.domElement.height;result.getContext('2d').drawImage(s.renderer.domElement,0,0);return result;}finally{s.modelRoot.visible=visibility;s.proxies.visible=aux;helper.visible=gizmo;s.selectionBox.visible=box;}
}
async function exportPicture(){
  if(exportInProgress)return;
  try{requirePlacementEdits();}catch(e){status(e.message);return;}
  exportInProgress=true;
  const buttons=[$('exportImage')],buttonStates=buttons.map(button=>button.disabled),main=document.querySelector('main'),wasInert=main.inert,controlsWereEnabled=threeState?.controls.enabled??true;let restoreRenderer=null;
  if(threeState)threeState.controls.enabled=false;
  buttons.forEach(button=>button.disabled=true);main.inert=true;
  try{
    await view('gaussian');if(!threeState?.splat)throw Error('请等待高斯场景加载完成');await ensureObjects();
    const s=threeState,oldRatio=s.renderer.getPixelRatio(),oldSize=s.renderer.getSize(new s.THREE.Vector2()),oldAspect=s.camera.aspect;
    restoreRenderer=()=>{s.controls.enabled=controlsWereEnabled;s.renderer.setPixelRatio(oldRatio);s.renderer.setSize(oldSize.x,oldSize.y,false);s.camera.aspect=oldAspect;s.camera.updateProjectionMatrix();s.exporting=false;};
    const frame=imageDimensions(renderFrame==='landscape'?16/9:renderFrame==='portrait'?3/4:oldAspect);s.controls.enabled=false;s.exporting=true;s.renderer.setPixelRatio(1);s.renderer.setSize(frame.width,frame.height,false);s.camera.aspect=frame.width/frame.height;s.camera.updateProjectionMatrix();
    const canvas=await captureFrame(),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片编码失败');download(blob,'placement_preview.png','image/png');status('已导出当前摆放 PNG（按所选画幅导出）。');
  }catch(e){status('导出失败：'+e.message);}finally{restoreRenderer?.();if(threeState)threeState.controls.enabled=controlsWereEnabled;main.inert=wasInert;buttons.forEach((button,i)=>button.disabled=buttonStates[i]);exportInProgress=false;}
}
$('exportImage').onclick=exportPicture;

$('updatePolygon').addEventListener('click',checkpoint);
$('replaceAsset').onclick=()=>{const o=activeObject();if(!o)return;recordHistory();const id=$('assetLibrary').value,meta=objectAssets.find(a=>a.id===id);o.assetId=id;o.assetKind=meta?.kind??'glb';o.name=meta?.name?.replace(/\.[^.]+$/,'')??'电视柜';objectMenu();draw();refreshThree();checkpoint();status('已替换当前物品，保留位置与尺寸；请按实物重新核对尺寸。');};
$('overview').onclick=async()=>{
  if(exportInProgress)return;await view('gaussian');if(exportInProgress||!threeState)return;
  const points=cameraRoom.polygon,lo=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),structure.floor.z],hi=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1])),structure.floor.z+cameraRoom.height];
  const group={id:'overview',pose:{x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:lo[2],yaw:activeObject()?.pose.yaw??0},size:{width:Math.hypot(hi[0]-lo[0],hi[1]-lo[1]),depth:0,height:hi[2]-lo[2]}};
  const s=threeState,c=placementCamera(group,{...structure,floor:{...structure.floor,polygon:cameraRoom.polygon}},objects,1,s.camera.fov,s.camera.aspect);s.lastCamera=null;s.camera.position.set(...c.position);s.controls.target.set(...c.target);constrainCamera();checkpoint();status('已按房间范围取景，可拖动背景继续调整视角。');
};
async function captureEffect(){
 if(exportInProgress)throw Error('正在准备其他图片，请稍后重试');
 if(!projectId)throw Error('请先从“我的空间”打开项目');
 requirePlacementEdits();
 commitObject();if(!objects.some(o=>o.visible))throw Error('请先添加或显示物品');
 exportInProgress=true;const main=document.querySelector('main'),oldInert=main.inert,controlsEnabled=threeState?.controls.enabled??true;main.inert=true;let restoreRenderer;
 try{
  await view('gaussian');await ensureObjects();if(!threeState?.splat||currentView!=='gaussian')throw Error('请等待房间三维场景加载完成');
  const s=threeState,oldRatio=s.renderer.getPixelRatio(),oldSize=s.renderer.getSize(new s.THREE.Vector2()),oldAspect=s.camera.aspect;
  restoreRenderer=()=>{s.renderer.setPixelRatio(oldRatio);s.renderer.setSize(oldSize.x,oldSize.y,false);s.camera.aspect=oldAspect;s.camera.updateProjectionMatrix();s.exporting=false;s.controls.enabled=controlsEnabled;};
  const {width,height}=effectDimensions(renderFrame,oldAspect);
  s.controls.enabled=false;s.exporting=true;s.renderer.setPixelRatio(1);s.renderer.setSize(width,height,false);s.camera.aspect=width/height;s.camera.updateProjectionMatrix();
  const image=await captureFrame(),scene=snapshot();scene.camera.resolution=[width,height];
  await persistScene(scene);
  return {scene,preview:image.toDataURL('image/png')};
 }finally{restoreRenderer?.();main.inert=oldInert;exportInProgress=false;}
}
function setEditorStep(step){editorStep=step;editorMain.dataset.step=step;flow.setCurrent(step);renderComposer.hidden=step!=='effects';const url=new URL(location.href);if(step==='effects')url.searchParams.set('step','effects');else url.searchParams.delete('step');window.history.replaceState(null,'',url);updateSelectionTools();refreshThree();paintRenderAction();}
function paintRenderAction(){if(!editorReady)return;if(effectHistoryError){renderAction.textContent='重新读取';return;}const job=latestEffectJob,changed=job?.state==='READY'&&job.planFingerprint&&job.planFingerprint!==planFingerprint(snapshot());renderAction.textContent=['QUEUED','PREPARING','GENERATING','WAITING'].includes(job?.state)?'查看进度':job?.state==='SUBMIT_UNKNOWN'?'核对任务':job?.state==='READY'&&!changed?'查看效果':job?.state==='FAILED'?'重新渲染':'渲染';}
const effects=createEffectView({projectId,capture:captureEffect,getPlanFingerprint:()=>planFingerprint(snapshot()),onGallery:paintSavedEffects,onHistoryError:message=>{effectHistoryError=message;effectHistoryStatus.hidden=!message;effectHistoryStatus.textContent=message?'已有图片暂未更新，请重新读取；当前摆放会保留。':'';paintRenderAction();},onHistory:job=>{latestEffectJob=job;paintRenderAction();const label='看效果与渲染';iconButton('generateEffect',label,'✧');$('mobileRender').textContent=label;}});
const objectEmpty=document.createElement('p');objectEmpty.id='objectEmptyHint';objectEmpty.textContent='先添加物品照片，三维模型就绪后，点击“放入空间”开始摆放。';objectEmpty.hidden=objects.length>0;$('objectSection').prepend(objectEmpty);
const objectGeneration=createEditorObjectGeneration({projectId,onImportModel:()=>importObject('.glb'),onAddPicture:()=>importObject('.jpg,.jpeg,.png,.webp'),isPlaced:assetId=>objects.some(o=>o.assetId===assetId),onNotify:message=>status(message),onAssets:async assets=>{const selected=$('assetLibrary').value;objectAssets=assets;updateLibrary();if([...$('assetLibrary').options].some(o=>o.value===selected))$('assetLibrary').value=selected;},onAdd:async job=>{if(exportInProgress)throw Error('正在准备图片，请稍后添加');const object=await addObject(job.resultAssetId,null,job.size);if(!object)throw Error('没有添加物品，请检查数量和模型');status(`已添加 ${job.name}，可点选后使用坐标轴摆放；尺寸与方向在属性中核对。`);}});
const flow=createStepNavigation({projectId,current:'place',onNavigate:navigateEditorStep});flow.classList.add('editor-flow');document.querySelector('.editor-header').append(flow);
let stepNavigating=false;
async function navigateEditorStep(step,event){
 event?.preventDefault();if(stepNavigating)return;
 if(exportInProgress||wallDrag||threeState?.transform?.dragging){status('请结束当前拖动或图片准备后再切换步骤。');return;}
 if(step==='place'){effects.close();setEditorStep('place');return;}
 if(step==='effects'){try{requirePlacementEdits();if(editMode){status('请先完成或取消地面绘制，再进入看效果。');return;}if($('saveDialog').open)$('saveDialog').close();effects.close();await view('gaussian');if(currentView!=='gaussian')return;closePanel();setEditorStep('effects');await effects.refreshHistory();}catch(e){status(e.message);}return;}
 effects.close();
 if(editMode){status('请先完成或取消当前地面轮廓绘制，再返回准备空间。');$('cancelSketch').focus({preventScroll:true});return;}
 if(saveConflict||saveErrorKind==='auth'){showRecovery();return;}
 try{requirePlacementEdits();}catch(e){status(e.message);return;}
 stepNavigating=true;flow.setAttribute('aria-busy','true');const wasInert=editorMain.inert;editorMain.inert=true;clearTimeout(autoSaveTimer);
 try{await saveQueue.catch(()=>{});if(editRevision>savedRevision||!savedVersion)await persistScene(snapshot());allowRecoveryNavigation=true;location.assign(projectStepTargets(projectId).prepare);}
 catch(e){setEditorStep('place');status('未能切换步骤：'+e.message);}
 finally{stepNavigating=false;flow.removeAttribute('aria-busy');editorMain.inert=wasInert;}
}
for(const id of ['generateEffect','mobileRender','savedRender'])$(id).onclick=()=>navigateEditorStep('effects');
renderAction.onclick=()=>effectHistoryError?effects.refreshHistory():effects.renderCurrent();effects.refreshHistory();
function importObject(accept){$('objectFile').accept=accept;$('uploadObject').click();}
$('retryAssets').onclick=async()=>{try{await view('gaussian');await ensureObjects();$('assetError').hidden=true;}catch(e){$('assetErrorText').textContent=e.message;}};
function iconButton(id,label,symbol){const button=$(id);button.textContent=symbol;button.title=label;button.setAttribute('aria-label',label);}
for(const [id,label,symbol]of [['planBtn','2D 平面','2D'],['moreButton','视角与高级设置','⋯'],['generateEffect','看效果与渲染','✧'],['undo','撤销（Ctrl+Z）','↶'],['redo','重做（Ctrl+Shift+Z）','↷']])iconButton(id,label,symbol);
const usageButton=document.createElement('button');Object.assign(usageButton,{id:'usageButton',type:'button',title:'使用说明'});usageButton.setAttribute('aria-label','使用说明');usageButton.setAttribute('aria-haspopup','dialog');usageButton.setAttribute('aria-controls','usageDialog');usageButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.6 2.6 0 0 1 5 1c0 2-2.5 2-2.5 4M12 16.5v.1"/></svg>';
const stageActions=document.createElement('div');stageActions.id='stageProjectActions';stageActions.setAttribute('role','group');stageActions.setAttribute('aria-label','项目操作');stageActions.append($('generateEffect'),$('expandScene'),$('moreButton'),usageButton,$('save'));$('toolbar').append(stageActions);$('stage').append($('saveState'));paintSaveButton(savedVersion?'saved':'idle');
usageButton.onclick=()=>$('usageDialog').showModal();$('closeUsage').onclick=()=>$('usageDialog').close();
const usageDialog=$('usageDialog');let usageOutsideDown=false;const outsideUsage=e=>{const r=usageDialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};usageDialog.addEventListener('pointerdown',e=>{usageOutsideDown=outsideUsage(e);});usageDialog.addEventListener('pointerup',e=>{if(usageOutsideDown&&outsideUsage(e))usageDialog.close();usageOutsideDown=false;});usageDialog.addEventListener('pointercancel',()=>{usageOutsideDown=false;});usageDialog.addEventListener('keydown',e=>e.stopPropagation());usageDialog.addEventListener('close',()=>{usageOutsideDown=false;usageButton.focus({preventScroll:true});});
const guideButton=document.createElement('button');Object.assign(guideButton,{id:'toggleGuides',type:'button',title:'显示地面与墙面'});guideButton.setAttribute('aria-label','显示地面与墙面');guideButton.setAttribute('aria-pressed',String($('showFloor').checked));guideButton.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 16V6l8-3 10 4v10l-9 4-9-5Zm0 0 9-4 9 5M12 12v9M11 3v9"/><path d="m7 14 9 5m-9-1 9-4"/></svg>';guideButton.onclick=()=>{$('showFloor').checked=!$('showFloor').checked;$('showFloor').onchange();};interactionTools.append(guideButton);
$('generateEffect').classList.remove('stage-effect');$('sceneActions').append($('undo'),$('redo'));interactionTools.append($('sceneActions'));$('overview').hidden=false;iconButton('overview','看整个房间','⌂');$('overview').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6M8 12l4-4 4 4v5H8Z"/></svg>';interactionTools.insertBefore($('overview'),$('toggleGuides'));
$('mobileActions').hidden=true;$('mobileObjects').hidden=true;$('moveObjectMode').hidden=true;$('mobilePlace').hidden=true;
$('objectSection').querySelector('h2').hidden=true;$('desktopObjects').textContent='物品属性';
objectGeneration.library?.append($('assetDetails'));$('assetDetails').querySelector('summary').textContent='替换当前选中物品（可选）';$('assetDetails').querySelector('.note').textContent='选择已有模型后替换当前物品，保留当前摆放位置与实物尺寸。';$('addAsset').hidden=true;
$('expandScene').onclick=async()=>{
 if(exportInProgress||wallDrag)return;const expanded=!document.body.classList.contains('view-expanded');document.body.classList.toggle('view-expanded',expanded);document.body.classList.toggle('landscape-mode',expanded);$('expandScene').setAttribute('aria-pressed',String(expanded));syncExpandButton();
 if(expanded){renderFrame='landscape';$('renderFrame').value='landscape';closePanel();checkpoint();status('已切换 16:9 横图取景；横放手机可获得更大操作空间。');if(matchMedia('(pointer: coarse)').matches&&screen.orientation?.lock&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen();await screen.orientation.lock('landscape');}catch{status('已切换 16:9 横图取景，请横放手机。');}}}
 else{try{screen.orientation?.unlock?.();if(document.fullscreenElement===document.documentElement)await document.exitFullscreen();}catch{}}
 draw();layoutThree();
};
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&matchMedia('(pointer: coarse)').matches){document.body.classList.remove('view-expanded','landscape-mode');$('expandScene').setAttribute('aria-pressed','false');syncExpandButton();draw();layoutThree();}});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('usageDialog').open&&document.body.classList.contains('view-expanded'))$('expandScene').click();});
$('coverageNote').innerHTML='<h3>试摆物品</h3><p>点选新增物品后，用底部的平移、旋转、缩放图标调出坐标轴；旋转保持物品直立。点背景或圆点图标选中场景，再拖动背景浏览，双指缩放。右下角列表可以选中、隐藏、聚焦物品，标题图片加号可选择已建物品或上传新照片；垃圾桶只删除当前摆放，已建模型仍可添加。</p><h3>校正空间</h3><p>点击 2D，点击画轮廓后依次点选地面顶点，完成或取消绘制。墙线默认显示：点选后拖动端点可修改，画墙线添加新墙，删除图标移除选中墙；支持撤销。绿色是围合视角边界，橙色虚线是候选墙线，蓝色实线是已校正墙线。比例统一缩放房间，家具保持实物尺寸。物品编辑请切回 3D，底部立方体图标可显示半透明地面与墙面。</p><p>视角受地面、估算层高与可靠围合墙线限制；未围合时使用地面轮廓。墙线与尺寸需要核对，原场景家具不参与碰撞检查。</p><h3>保存与效果图</h3><p>摆放自动保存，右上角磁盘图标也可手动保存。点击看效果，保留当前三维画面，在底部选择成图画幅并点击渲染，使用电脑上的本地 Flux 生成效果图。底部四角房间图标可查看整个房间，横屏图标切换 16:9 取景，横放手机后菜单会适配横屏。已有渲染图可在看效果中选择查看。</p>';
syncSize();setPanelGroup('objects');document.querySelector('main').inert=false;editorReady=true;
localDrafts.get(recoveryKey).then(value=>{if(value){$('localBackup').hidden=false;if(needsRecovery(value,lastSavedScene))showRecovery();}}).catch(()=>{});
window.addEventListener('beforeunload',e=>{if(!allowRecoveryNavigation&&(placementDirty||editRevision>savedRevision)){e.preventDefault();e.returnValue='';}});
const planResize=new ResizeObserver(()=>draw());planResize.observe($('stage'));planResize.observe(planCalibration);
// Initialize the real renderer only after the saved project and its camera have restored.
await view('gaussian');
selectionKind='scene';updateSelectionTools();
if(new URLSearchParams(location.search).get('step')==='effects')await navigateEditorStep('effects');
