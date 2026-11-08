import test from 'node:test';
import assert from 'node:assert/strict';
import {changeWall,removeWall,manualWallBoundary} from '../wall_edit.mjs';
import {roomEnvelope,insideRoom} from '../editor_room.mjs';
const base=()=>({worldId:'test_world',units:'m',upAxis:'Z',sourceToAligned:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],floor:{z:0,bounds:[[0,0],[5,4]]},roomHeight:2.5,walls:[],openings:[]});
test('manual wall endpoints keep unit perpendicular normals, connected joints and valid openings',()=>{
 let s=changeWall(base(),'a',[0,0],[5,0]);s=changeWall(s,'b',[5,0],[5,4]);s.openings=[{id:'door',wallId:'a',center:[2.5,0,1],width:.8,height:2}];
 s.openings.push({id:'window',wallId:'b',center:[5,2,1.5],width:1,height:1});
 const next=changeWall(s,'a',[0,0],[4,0]);assert.deepEqual(next.walls[1].a,[4,0,0]);assert.deepEqual(next.openings[0].center,[2,0,1]);assert.deepEqual(next.openings[1].center,[4.5,2,1.5]);assert.equal(next.walls[0].source,'MANUAL');assert.equal(s.walls[0].b[0],5);
 const deleted=removeWall(next,'a');assert.equal(deleted.walls.length,1);assert.equal(deleted.openings.length,1);assert.equal(deleted.openings[0].id,'window');
 assert.throws(()=>changeWall(s,'a',[0,0],[.01,0]),/5 厘米/);assert.throws(()=>changeWall(s,'a',[NaN,0],[1,1]),/无效/);
});
test('closed manual perimeter survives internal dangling walls and detects sub-centimetre floor notches',()=>{
 let s=base();const poly=[[0,0],[5,0],[5,4],[0,4]];poly.forEach((a,i)=>s=changeWall(s,'w'+i,a,poly[(i+1)%4],{connect:false}));s=changeWall(s,'internal',[0,0],[1,1]);assert.equal(manualWallBoundary(s).length,4);
 s.floor.polygon=[[0,0],[5,0],[5,4],[2.011,4],[2.011,2],[2.005,2],[2.005,4],[0,4]];assert.equal(manualWallBoundary(s),null);
});
test('manual closed concave walls constrain views while incomplete or outside perimeters do not replace the floor',()=>{
 let s=base();const poly=[[0,0],[5,0],[5,4],[3,4],[3,2],[0,2]];poly.forEach((a,i)=>{s=changeWall(s,'w'+i,a,poly[(i+1)%poly.length],{connect:false});});
 assert.equal(manualWallBoundary(s).length,6);const room=roomEnvelope(s);assert.equal(room.wallCount,6);assert.ok(!insideRoom([1,3,1],room));assert.ok(insideRoom([4,3,1],room));
 assert.equal(manualWallBoundary(removeWall(s,'w0')),null);
 const outside=changeWall(s,'w2',[5,4],[6,4]);assert.equal(manualWallBoundary(outside),null);
});
test('a partial manually drawn internal wall never becomes an infinite camera barrier',()=>{
 let s=base();const ends=[[[0,0],[5,0]],[[5,0],[5,4]],[[5,4],[0,4]],[[0,4],[0,0]]];ends.forEach(([a,b],i)=>{s=changeWall(s,'w'+i,a,b,{connect:false});Object.assign(s.walls.at(-1),{source:'DETECTED',supportRatio:.2,supportCount:3000,rmse:.01});});
 s=changeWall(s,'internal',[1,2],[2,2]);const room=roomEnvelope(s);assert.equal(room.wallCount,4);assert.ok(insideRoom([2.5,3,1],room));assert.ok(insideRoom([2.5,1,1],room));
});
