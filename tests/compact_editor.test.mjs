import test from 'node:test';
import assert from 'node:assert/strict';
import {Object3D,PerspectiveCamera,Scene,Vector3} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {configureUniformScale,assertUniformSize} from '../uniform_scale.mjs';
import {canDirectDrag,touchPairMotion,createFloorGesture} from '../simple_gesture.mjs';
import {roomEnvelope,roomHomeCamera,insideRoom,inPlaceLook,constrainRoomView} from '../editor_room.mjs';

test('one visible scale lever and its hit target drive uniform scaling without hidden stretch axes',()=>{
 const camera=new PerspectiveCamera(65,1,.03,100);camera.up.set(0,0,1);camera.position.set(4,-4,3);camera.lookAt(0,0,0);camera.updateMatrixWorld();
 const scene=new Scene(),object=new Object3D();object.scale.set(2,1,.5);scene.add(object);
 const canvas={style:{},addEventListener(){},removeEventListener(){}},control=new TransformControls(camera,canvas);configureUniformScale(control);control.setMode('scale');control.attach(object);scene.add(control.getHelper());scene.updateMatrixWorld(true);
 let groups=0,handle,shaft;control.getHelper().traverse(node=>{for(const group of [node.gizmo?.scale,node.picker?.scale])if(group){groups++;assert.ok(group.children.every(c=>c.name==='XYZ'));}if(node.gizmo?.scale){assert.deepEqual(node.gizmo.scale.children.map(c=>c.userData.uniformScalePart),['shaft','handle']);handle=node.gizmo.scale.children.find(c=>c.userData.uniformScalePart==='handle');shaft=node.gizmo.scale.children.find(c=>c.userData.uniformScalePart==='shaft');}});assert.equal(groups,2);
 shaft.geometry.computeBoundingBox();handle.geometry.computeBoundingBox();assert.ok(shaft.geometry.boundingBox.max.z-handle.geometry.boundingBox.min.z>.03,'shaft overlaps its handle instead of leaving an antialiased gap');
 for(const part of [shaft,handle]){assert.equal(part.material.transparent,true,'foreground controls render after transparent Gaussian splats');assert.equal(part.material.opacity,1);assert.equal(part.material.depthTest,false);assert.equal(part.material.depthWrite,false);assert.equal(part.renderOrder,Infinity);}
 control.pointerHover({x:0,y:0,button:0});assert.equal(control.axis,null,'old invisible centre hit target is gone');
 const tip=new Vector3(0,0,.8).applyMatrix4(handle.matrixWorld).project(camera),pivot=new Vector3().project(camera);
 control.pointerHover({x:tip.x,y:tip.y,button:0});assert.equal(control.axis,'XYZ');
 control.pointerDown({x:tip.x,y:tip.y,button:0});control.pointerMove({x:pivot.x+(tip.x-pivot.x)*1.5,y:pivot.y+(tip.y-pivot.y)*1.5,button:-1});control.pointerUp({button:0});
 assert.ok(Math.abs(object.scale.x-2)>.01);assert.ok(Math.abs(object.scale.x/object.scale.y-2)<1e-9);assert.ok(Math.abs(object.scale.y/object.scale.z-2)<1e-9);
 control.dispose();
});
test('scale size guard refuses a stretched candidate without changing stored proportions',()=>{
 const size={width:2,depth:1,height:.5};assert.deepEqual(assertUniformSize(size,{width:4,depth:2,height:1}),{width:4,depth:2,height:1});
 for(const candidate of [{width:4,depth:1,height:.5},{width:NaN,depth:2,height:1},{width:0,depth:0,height:0}])assert.throws(()=>assertUniformSize(size,candidate),/等比/);
 assert.deepEqual(size,{width:2,depth:1,height:.5});
});
test('object dragging never steals rotate, scale, floating objects or a gizmo hit',()=>{
 const object={visible:true,mode:'floor',pose:{z:0}},state={mode:'translate',object,floorZ:0};assert.equal(canDirectDrag(state),true);
 for(const patch of [{mode:'rotate'},{mode:'scale'},{gizmo:true},{added:false},{object:{...object,mode:'free'}},{object:{...object,pose:{z:1}}}])assert.equal(canDirectDrag({...state,...patch}),false);
});
test('two fingers pan without zoom, pinch without pan, and can combine both',()=>{
 const start=[[100,100],[200,100]],pan=touchPairMotion(start,[[120,130],[220,130]],3,65,600);assert.equal(pan.distance,3);assert.ok(pan.right<0&&pan.forward>0);
 const zoom=touchPairMotion(start,[[50,100],[250,100]],3,65,600);assert.equal(zoom.distance,1.5);assert.ok(Math.abs(zoom.right)<1e-12);assert.equal(zoom.forward,0);
 const both=touchPairMotion(start,[[70,130],[270,130]],3,65,600);assert.equal(both.distance,1.5);assert.ok(both.right<0&&both.forward>0);
 assert.equal(touchPairMotion(start,[[1,1],[1,1]],3,65,600),null);assert.equal(touchPairMotion(start,start,3,65,0),null);
});
test('adding a second finger rolls back unfinished furniture movement before camera navigation',()=>{
 const original={x:0,y:0,z:0,yaw:.3};let pose={...original},commits=0;
 const gesture=createFloorGesture({apply:p=>(pose={...p},true),onCommit:()=>commits++});gesture.begin({pointerId:1,screen:[0,0],point:[0,0],pose});gesture.move({pointerId:1,screen:[30,0],point:[1,0]});assert.equal(pose.x,1);
 gesture.cancel();assert.deepEqual(pose,original);assert.equal(commits,0);
});
test('room home recovers a normal eye height in convex and concave spaces without mutating the room',()=>{
 for(const polygon of [[[0,0],[4,0],[4,4],[0,4]],[[0,0],[5,0],[5,1],[1,1],[1,5],[0,5]]]){
  const room=roomEnvelope({floor:{z:0,polygon},walls:[]}),before=JSON.stringify(room),home=roomHomeCamera(room);
  assert.equal(home.position[2],1.4);assert.ok(insideRoom(home.position,room));assert.ok(insideRoom(home.target,room));assert.ok(Math.hypot(home.position[0]-home.target[0],home.position[1]-home.target[1])>.2);assert.equal(JSON.stringify(room),before);
 }
});
test('a full turn is possible in place, including at a wall, and gaze may point outside the room',()=>{
 const room=roomEnvelope({floor:{z:0,polygon:[[0,0],[4,0],[4,4],[0,4]]},walls:[]}),position=[.03,2,1.4],target=[2,2,1.4];
 const turn=inPlaceLook(position,target,300,0,600),view=constrainRoomView(turn.position,turn.target,room,position);
 assert.deepEqual(view.position,position);assert.ok(view.target[0]<0);assert.ok(Math.abs(view.target[1]-2)<1e-9);
 const full=inPlaceLook(position,target,600,0,600);assert.deepEqual(full.position,position);full.target.forEach((v,i)=>assert.ok(Math.abs(v-target[i])<1e-8));
 const vertical=inPlaceLook(position,target,0,1e5,600);assert.deepEqual(vertical.position,position);assert.ok(vertical.target.every(Number.isFinite));
});
test('blocked translation preserves viewing direction and re-entry selects the centre over a saved low corner',()=>{
 const room=roomEnvelope({floor:{z:0,polygon:[[0,0],[4,0],[4,4],[0,4]]},walls:[]});
 const view=constrainRoomView([-2,1,1.4],[-4,2,1.9],room,[.1,1,1.4]);assert.ok(insideRoom(view.position,room));assert.deepEqual(view.target.map((v,i)=>v-view.position[i]),[-2,1,.5]);
 const home=roomHomeCamera(room);assert.deepEqual(home.position,[2,2,1.4]);assert.notDeepEqual(home.position,[.03,.03,.28]);
});
