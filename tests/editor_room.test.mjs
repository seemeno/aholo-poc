import test from 'node:test';
import assert from 'node:assert/strict';
import {roomEnvelope,insideRoom,clampRoomPoint,constrainRoomMotion,gizmoPlacement} from '../editor_room.mjs';
import {validateScene,makeScene} from '../scene_state.mjs';
const structure=(polygon=[[0,0],[5,0],[5,4],[0,4]])=>({worldId:'world_123',upAxis:'Z',units:'m',sourceToAligned:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],floor:{z:0,bounds:[[0,0],[5,4]],polygon},walls:[],openings:[]});
test('camera position stays between floor, ceiling and floor perimeter for large movements',()=>{
 const room=roomEnvelope(structure());
 for(const point of [[-20,2,1],[2,90,1],[2,2,-7],[2,2,90],[-50,-50,80],[20,20,-20]]){
  assert.ok(insideRoom(clampRoomPoint(point,room),room));assert.ok(insideRoom(constrainRoomMotion([2,2,1],point,room),room));
 }
 assert.deepEqual(constrainRoomMotion([2,2,1],[3,3,1.2],room),[3,3,1.2]);
});
test('large camera gestures cannot tunnel across a concave room gap with an inside endpoint',()=>{
 const room=roomEnvelope(structure([[0,0],[5,0],[5,4],[4,4],[4,1],[1,1],[1,4],[0,4]]));
 const result=constrainRoomMotion([.5,3,1],[4.5,3,1],room);
 assert.ok(insideRoom(result,room));assert.ok(result[0]<1);
});
test('ceiling estimate excludes extreme outliers and uses a validated manual height when supplied',()=>{
 const s=structure(),points=Array.from({length:100},()=>[1,1,2.8]);points.push([0,0,400]);
 assert.equal(roomEnvelope(s,points).height,2.8);s.roomHeight=3.1;assert.equal(roomEnvelope(s,points).top,3.02);
 assert.doesNotThrow(()=>validateScene(makeScene(s)));s.roomHeight=-1;assert.throws(()=>makeScene(s),/层高/);
});
test('candidate internal wall lines do not become unverified camera obstacles',()=>{
 const s=structure();s.walls=[{id:'wall_1',a:[2,0,0],b:[2,4,0],height:2.6,normal:[1,0,0],status:'CANDIDATE'}];
 const room=roomEnvelope(s);assert.deepEqual(constrainRoomMotion([1,2,1],[3,2,1],room),[3,2,1]);
});
test('only supported enclosing wall planes narrow the camera room; manual floor override is retained',()=>{
 const s=structure(),metadata={height:2.6,status:'CANDIDATE',enabled:true,supportRatio:.1,supportCount:3000,rmse:.02};
 s.walls=[{id:'left',a:[1,0,0],b:[1,4,0],normal:[1,0,0]},{id:'right',a:[4,0,0],b:[4,4,0],normal:[-1,0,0]},{id:'front',a:[0,.5,0],b:[5,.5,0],normal:[0,1,0]},{id:'back',a:[0,3.5,0],b:[5,3.5,0],normal:[0,-1,0]}].map(w=>({...w,...metadata}));
 let room=roomEnvelope(s);assert.equal(room.wallCount,4);assert.ok(!insideRoom([.5,2,1],room));assert.ok(insideRoom(clampRoomPoint([.5,2,1],room),room));
 s.cameraBoundaryMode='floor';room=roomEnvelope(s);assert.equal(room.wallCount,0);assert.ok(insideRoom([.5,2,1],room));
 assert.equal(validateScene(makeScene(s)).structure.cameraBoundaryMode,'floor');s.cameraBoundaryMode='invalid';assert.throws(()=>makeScene(s),/边界/);
});
test('gizmo produces persistent Z-up position, yaw and actual dimensions and rejects mirroring or invalid scale',()=>{
 assert.deepEqual(gizmoPlacement([1,2,.3],Math.PI/4,[.5,.4,1]),{pose:{x:1,y:2,z:.3,yaw:Math.PI/4},size:{width:.5,depth:.4,height:1}});
 for(const scale of [[-1,1,1],[0,1,1],[NaN,1,1],[1001,1,1]])assert.throws(()=>gizmoPlacement([0,0,0],0,scale));
});
