import {createFloorGesture,touchPairMotion,canDirectDrag} from './simple_gesture.mjs';
import {dimensionDescription,resolveMeasurements} from './try_on.mjs';
import {inPlaceLook} from './editor_room.mjs';

// Presentation and input only. Scene persistence stays with the existing editor.
export function createConsumerEditor(api){
 const $=id=>document.getElementById(id);let simple=true,pointPlacement=false,dragObject=null,boundCanvas=null,cancelInput=()=>{};
 let sizeTarget=null;
 const guideKey='try-on-drag-learned';let learned=false;try{learned=localStorage.getItem(guideKey)==='yes';}catch{}
 const bar=document.createElement('dialog');bar.id='consumerControls';bar.className='space-dialog consumer-dialog';bar.setAttribute('aria-labelledby','consumerToolsTitle');
 bar.innerHTML='<header><h2 id="consumerToolsTitle">更多试摆工具</h2><button id="closeConsumerTools" type="button" aria-label="关闭更多工具">×</button></header><div class="consumer-actions"><button id="turnLeft" type="button">左转 15°</button><button id="turnRight" type="button">右转 15°</button><button id="consumerFocus" type="button">看物品</button><button id="simpleAdjust" type="button" hidden>返回直接拖动</button></div><div class="consumer-extra"></div><p id="consumerSizeNote"></p><p id="consumerGestureHint"></p>';
 $('stage').append(bar);
 const tools=$('transformTools'),more=document.createElement('button');more.id='consumerMore';more.type='button';more.setAttribute('aria-label','更多试摆工具');more.setAttribute('aria-haspopup','dialog');more.setAttribute('aria-controls',bar.id);more.innerHTML='<span class="tool-symbol" aria-hidden="true">⋯</span><span class="tool-label">更多</span>';tools.append(more);
 for(const [id,label]of [['selectScene','浏览'],['translateTool','移动'],['rotateTool','旋转'],['scaleTool','缩放'],['undo','撤销']]){const button=$(id),symbol=document.createElement('span');symbol.className='tool-symbol';symbol.setAttribute('aria-hidden','true');symbol.append(...button.childNodes);const title=document.createElement('span');title.className='tool-label';title.textContent=label;button.append(symbol,title);}
 for(const [id,label]of [['overview','看整个房间'],['inspectObject','物品属性与尺寸'],['toggleGuides','地面与墙面']]){const button=$(id);button.textContent=label;bar.querySelector('.consumer-extra').append(button);button.addEventListener('click',()=>bar.close());}
 const home=document.createElement('button');home.type='button';home.textContent='回到房间中央';home.onclick=()=>{bar.close();api.home();};bar.querySelector('.consumer-extra').prepend(home);
 more.onclick=()=>{if(api.state().busy)return;cancelInput();sync();bar.showModal();};$('closeConsumerTools').onclick=()=>bar.close();bar.addEventListener('close',()=>more.focus({preventScroll:true}));
 const panelSimple=document.createElement('button');panelSimple.type='button';panelSimple.textContent='简易试摆';panelSimple.hidden=true;$('panelTitle').after(panelSimple);panelSimple.onclick=()=>setSimple(true);
 const pending=document.createElement('section');pending.id='pendingTryOn';pending.hidden=true;pending.setAttribute('role','status');
 pending.innerHTML='<strong>这件物品还没有合适的位置</strong><p>暂未找到完整落在地面内且不与新增物品重叠的位置。不会自动缩小物品。</p><div><button type="button" data-point>点选位置</button><button type="button" data-size>修改尺寸</button><button type="button" data-space>校正空间</button></div>';
 $('stage').append(pending);
 const sizes=document.createElement('dialog');sizes.className='space-dialog consumer-dialog';sizes.setAttribute('aria-labelledby','trySizeTitle');
 sizes.innerHTML='<form method="dialog"><h2 id="trySizeTitle">核对物品尺寸</h2><p data-current-size></p><p>选择一项实物尺寸填写，其余两项按当前比例推算。这里不会自动测量物品或校准房间。</p><label>以哪一项为准<select data-axis-choice><option value="width">宽</option><option value="depth">深</option><option value="height" selected>高</option></select></label><label>实物尺寸（厘米）<input data-value type="number" min="1" max="2000" step="0.1" inputmode="decimal"></label><p data-error role="alert"></p><div><button value="cancel" formnovalidate>取消</button><button value="apply">等比应用</button></div></form>';
 document.body.append(sizes);
 sizes.querySelector('form').onsubmit=e=>{if(e.submitter?.value==='cancel')return;e.preventDefault();try{const field=sizes.querySelector('[data-value]');if(!field.value.trim()){sizes.close();return;}if(!sizeTarget)throw Error('请重新选择物品');const input={[sizes.querySelector('[data-axis-choice]').value]:Number(field.value)/100};api.resize(resolveMeasurements(sizeTarget.size,input),sizeTarget.id);sizes.close();sync();}catch(error){sizes.querySelector('[data-error]').textContent=error.message;}};
 function openSizes(usePending=false){
  if(api.state().busy)return;cancelInput();const state=api.state(),item=usePending?state.tryOn:state.object;if(!item?.size)return;bar.close();
  sizeTarget={id:usePending?null:item.id,size:{...item.size}};
  sizes.querySelector('[data-axis-choice]').value='height';sizes.querySelector('[data-value]').value='';sizes.querySelector('[data-value]').placeholder='例如 '+Number((item.size.height*100).toFixed(1));
  sizes.querySelector('[data-current-size]').textContent='当前宽 × 深 × 高：'+['width','depth','height'].map(k=>Number((item.size[k]*100).toFixed(1))).join(' × ')+' 厘米 · '+dimensionDescription(item);
  sizes.querySelector('[data-error]').textContent='';sizes.showModal();
 }
 pending.querySelector('[data-size]').onclick=()=>openSizes(true);
 pending.querySelector('[data-point]').onclick=()=>{pointPlacement=true;api.status('点击地面上的目标位置；拖背景仍可调整视角。');};
 pending.querySelector('[data-space]').onclick=()=>{setSimple(false);api.calibrate();};
 function setSimple(value){if(value&&!api.canLeave()){api.status('请先修正精细调整中标出的尺寸或位置。');return;}cancelInput();simple=value;panelSimple.hidden=value;document.body.dataset.experience=value?'simple':'precise';$('simpleAdjust').hidden=value;api.refresh();sync();if(value)api.closePanel();}
 $('simpleAdjust').onclick=()=>{bar.close();setSimple(true);};
 $('inspectObject').onclick=()=>{bar.close();setSimple(false);api.precise();};
 for(const [id,angle] of [['turnLeft',Math.PI/12],['turnRight',-Math.PI/12]])$(id).onclick=()=>{const o=api.state().object;if(!o)return;api.begin();if(api.apply({...o.pose,yaw:o.pose.yaw+angle}))api.commit();else api.cancel();};
 $('consumerFocus').onclick=()=>{bar.close();api.focus();};
 const gesture=createFloorGesture({apply:(pose,rollback)=>api.apply(pose,dragObject,rollback),onStart:api.begin,onCommit:()=>{learned=true;try{localStorage.setItem(guideKey,'yes');}catch{}api.commit();sync();},onCancel:api.cancel});
 function sync(){const state=api.state(),o=state.object,canMove=o?.visible&&o.mode==='floor'&&Math.abs(o.pose.z-state.floorZ)<.002;
  bar.hidden=state.view==='plan';more.hidden=bar.hidden;if(bar.hidden&&bar.open)bar.close();pending.hidden=state.tryOn?.state!=='pending'||state.view==='plan';
  for(const id of ['turnLeft','turnRight'])$(id).disabled=!canMove||state.busy;$('consumerFocus').disabled=!o?.visible||state.busy;
  $('consumerSizeNote').textContent=o?dimensionDescription(o):'点选新增物品即可调整';
  $('consumerGestureHint').textContent=o&&!canMove?'此物品保留原高度，可用坐标轴调整。':!learned&&o?'移动：直接拖物品或箭头 · 旋转/缩放：拖坐标轴 · 双指平移、捏合缩放':'';
  $('consumerGestureHint').hidden=!$('consumerGestureHint').textContent;
 }
 function bind(){const s=api.state().three;if(!s||boundCanvas===s.renderer.domElement)return;cancelInput();const el=s.renderer.domElement;boundCanvas=el;const {THREE}=s,ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),pointers=new Map();let tap=null,pinch=null,look=null;
  cancelInput=()=>{gesture.cancel();if(s.transform.dragging)s.transform.pointerUp({button:0});dragObject=null;tap=null;pinch=null;look=null;for(const id of pointers.keys())if(el.hasPointerCapture(id))el.releasePointerCapture(id);pointers.clear();s.transform.enabled=true;s.controls.enabled=!api.state().busy&&!s.contextLost;};
  function cast(e){const p=api.canvasPointer(e,el);mouse.set(p.x,p.y);ray.setFromCamera(mouse,s.camera);}
  function ground(e){cast(e);const point=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),-api.state().floorZ),new THREE.Vector3());return point?[point.x,point.y]:null;}
  function pick(e){cast(e);const hit=ray.intersectObject(s.modelRoot,true).find(h=>{for(let p=h.object;p;p=p.parent)if(!p.visible)return false;return true;});let node=hit?.object;while(node&&!node.userData.objectId)node=node.parent;return node?.userData.objectId;}
  const enabled=()=>api.state().view!=='plan'&&!api.state().busy&&!s.contextLost;
  function beginLook(e){const point=api.screenPoint(e);look={id:e.pointerId,x:point[0],y:point[1],position:s.camera.position.toArray(),target:s.controls.target.toArray(),moved:false};s.controls.enabled=false;s.transform.enabled=false;el.setPointerCapture(e.pointerId);e.stopImmediatePropagation();}
  el.addEventListener('pointerdown',e=>{
   if(!enabled()||e.button!==0)return;pointers.set(e.pointerId,api.screenPoint(e));
   if(pointers.size>1){gesture.cancel();dragObject=null;tap=null;look=null;if(s.transform.dragging)s.transform.pointerUp({button:0});api.cancel();s.transform.enabled=false;s.controls.enabled=false;if(!pinch){const right=new THREE.Vector3().setFromMatrixColumn(s.camera.matrix,0);right.z=0;right.normalize();pinch={ids:[...pointers.keys()].slice(0,2),points:[...pointers.values()].slice(0,2),distance:s.camera.position.distanceTo(s.controls.target),position:s.camera.position.clone(),target:s.controls.target.clone(),direction:s.camera.position.clone().sub(s.controls.target).normalize(),right,forward:new THREE.Vector3(-right.y,right.x,0)};}el.setPointerCapture(e.pointerId);e.stopImmediatePropagation();return;}
   tap={id:e.pointerId,x:e.clientX,y:e.clientY};
   // Give the visible gizmo first refusal, including touch devices without hover.
   cast(e);if(s.transform.object&&s.transform.enabled){s.transform.pointerHover({x:mouse.x,y:mouse.y,button:e.button});if(s.transform.axis!==null){tap=null;return;}}
   const id=pick(e);if(api.state().browsing||!id){beginLook(e);return;}if(!api.select(id))return;const state=api.state(),o=state.object,point=ground(e);if(!simple||!canDirectDrag({mode:state.transformMode,object:o,floorZ:state.floorZ})||!point)return;dragObject=id;gesture.begin({pointerId:e.pointerId,screen:[e.clientX,e.clientY],point,pose:o.pose});s.transform.enabled=false;s.controls.enabled=false;el.setPointerCapture(e.pointerId);e.stopImmediatePropagation();
  },true);
  el.addEventListener('pointermove',e=>{
   if(!enabled())return;if(pointers.has(e.pointerId))pointers.set(e.pointerId,api.screenPoint(e));
   if(look&&look.id===e.pointerId){const point=api.screenPoint(e),dx=point[0]-look.x,dy=point[1]-look.y;if(Math.hypot(dx,dy)>6){look.moved=true;tap=null;}if(look.moved){const view=inPlaceLook(look.position,look.target,dx,dy,el.clientWidth,el.clientHeight);s.camera.position.fromArray(view.position);s.controls.target.fromArray(view.target);s.controls.update();}e.stopImmediatePropagation();return;}
   if(pinch){if(pinch.ids.every(id=>pointers.has(id))){const motion=touchPairMotion(pinch.points,pinch.ids.map(id=>pointers.get(id)),pinch.distance,s.camera.fov,el.clientHeight);if(motion){const shift=pinch.right.clone().multiplyScalar(motion.right).addScaledVector(pinch.forward,motion.forward);s.controls.target.copy(pinch.target).add(shift);s.camera.position.copy(pinch.target).add(shift).addScaledVector(pinch.direction,motion.distance);s.controls.update();}}e.stopImmediatePropagation();return;}
   if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>6)tap=null;if(gesture.active){gesture.move({pointerId:e.pointerId,screen:[e.clientX,e.clientY],point:ground(e)});e.stopImmediatePropagation();}
  },true);
  el.addEventListener('pointerup',e=>{const wasActive=gesture.active,wasLooking=look?.id===e.pointerId,moved=wasLooking&&look.moved;gesture.end(e.pointerId);pointers.delete(e.pointerId);if(pinch){if(!pointers.size){pinch=null;s.transform.enabled=true;s.controls.enabled=true;api.cameraCommit();}return;}if(wasActive||wasLooking){look=null;s.transform.enabled=true;s.controls.enabled=true;e.stopImmediatePropagation();if(moved)api.cameraCommit();}if(tap?.id===e.pointerId){if(pointPlacement){const point=ground(e);if(point&&api.place(point))pointPlacement=false;}else{const id=pick(e);if(id)api.select(id);else api.selectScene();}}tap=null;dragObject=null;},true);
  function cancel(e){pointers.delete(e.pointerId);gesture.cancel();if(s.transform.dragging)s.transform.pointerUp({button:0});dragObject=null;tap=null;look=null;if(!pointers.size)pinch=null;s.transform.enabled=!pinch;s.controls.enabled=!pinch;}
  el.addEventListener('pointercancel',cancel,true);el.addEventListener('lostpointercapture',e=>{if(gesture.active||s.transform.dragging||pointers.has(e.pointerId))cancel(e);},true);
 }
 document.body.dataset.experience='simple';api.closePanel();sync();
 return {get simple(){return simple;},sync,bind,suspend:()=>cancelInput(),direct:()=>{if(!simple)setSimple(true);},precise:()=>setSimple(false)};
}
