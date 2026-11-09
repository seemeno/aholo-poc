// One drag is one history entry. Model units are independent from screen pixels.
export function pinchDistance(initialCameraDistance,initialTouchDistance,currentTouchDistance){
 if(![initialCameraDistance,initialTouchDistance,currentTouchDistance].every(v=>Number.isFinite(v)&&v>0))return null;
 return Math.max(.12,Math.min(30,initialCameraDistance*initialTouchDistance/currentTouchDistance));
}
export function canDirectDrag({mode,object,floorZ,gizmo=false,added=true}){
 return added&&!gizmo&&mode==='translate'&&object?.visible===true&&object.mode==='floor'&&Math.abs(object.pose.z-floorZ)<.002;
}
// Screen-centre translation and span changes are independent, so two fingers can
// pan and zoom together without changing the selected furniture.
export function touchPairMotion(start,current,distance,fov,height){
 if(![start,current].every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))||!Number.isFinite(fov)||fov<=0||fov>=179||!Number.isFinite(height)||height<=0)return null;
 const span=pair=>Math.hypot(pair[1][0]-pair[0][0],pair[1][1]-pair[0][1]),next=pinchDistance(distance,span(start),span(current));if(next===null)return null;
 const delta=[0,1].map(i=>(current[0][i]+current[1][i]-start[0][i]-start[1][i])/2),scale=2*distance*Math.tan(fov*Math.PI/360)/height;
 return {distance:next,right:-delta[0]*scale,forward:delta[1]*scale};
}
export function createFloorGesture({apply,onStart=()=>{},onCommit=()=>{},onCancel=()=>{}}){
 let gesture=null;
 return {
  get active(){return !!gesture;},
  begin({pointerId,screen,point,pose}){if(gesture)this.cancel();gesture={pointerId,screen,point,original:{...pose},last:{...pose},started:false};},
  move({pointerId,screen,point}){
   const g=gesture;if(!g||g.pointerId!==pointerId||!point)return false;
   if(!g.started&&Math.hypot(screen[0]-g.screen[0],screen[1]-g.screen[1])<6)return false;
   const next={...g.original,x:g.original.x+point[0]-g.point[0],y:g.original.y+point[1]-g.point[1]};
   if(!g.started){g.started=true;onStart();}
   if(apply(next)){g.last=next;return true;}return false;
  },
  end(pointerId){const g=gesture;if(!g||g.pointerId!==pointerId)return;gesture=null;if(g.started){if(JSON.stringify(g.last)!==JSON.stringify(g.original))onCommit();else onCancel();}},
  cancel(){const g=gesture;if(!g)return;gesture=null;if(g.started){apply(g.original,true);onCancel();}}
 };
}
