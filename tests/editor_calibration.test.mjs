import test from 'node:test';
import assert from 'node:assert/strict';
import {scaleCalibration,needsRecovery} from '../editor_calibration.mjs';
const room=()=>({worldId:'test_world',units:'m',upAxis:'Z',sourceToAligned:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],floor:{z:0,bounds:[[0,0],[5,4]]},walls:[],openings:[]});
test('room scaling is atomic, scales inferred ceiling and positions but keeps real furniture dimensions',()=>{
 const input={structure:room(),objects:[{id:'o',name:'chair',pose:{x:2,y:1,z:0,yaw:1},size:{width:.8,depth:.7,height:1}}],points:[[1,2,2.5]],sceneScale:1,height:2.5};
 const original=structuredClone(input),scaled=scaleCalibration(input,.5);assert.equal(scaled.structure.roomHeight,1.25);assert.deepEqual(scaled.objects[0].size,input.objects[0].size);assert.equal(scaled.objects[0].pose.x,1);assert.deepEqual(scaled.structure.floor.bounds,[[0,0],[2.5,2]]);assert.deepEqual(scaled.points,[[.5,1,1.25]]);
 for(const factor of [0,-1,NaN,Infinity,.01,100])assert.throws(()=>scaleCalibration(input,factor));assert.deepEqual(input,original);
});
test('saved identical backups stay quiet, while hidden items, names, measurements and unfinished fields still recover',()=>{
 const saved={projectId:'p',worldId:'test_world',structure:room(),sceneScale:1,renderFrame:'landscape',objects:[{id:'o',name:'chair',visible:false,pose:{x:1,y:1,z:0,yaw:0},size:{width:.8,depth:.7,height:1}}],camera:{rows:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,1500,1]],verticalFov:65,resolution:[1024,576]}};
 const identical=structuredClone(saved);identical.activeObjectId='o';identical.savedAt='later';identical.camera.resolution=[1280,720];identical.structure.cameraBoundaryMode='walls';assert.equal(needsRecovery({scene:identical},saved),false);
 for(const change of [s=>s.objects[0].name='new name',s=>s.objects[0].visible=true,s=>s.objects[0].pose.x++,s=>s.objects[0].size.width++,s=>s.camera.rows[3][0]++,s=>s.renderFrame='portrait']){const edited=structuredClone(saved);change(edited);assert.equal(needsRecovery({scene:edited},saved),true);}
 assert.equal(needsRecovery({scene:saved,fields:{width:''}},saved),true);assert.equal(needsRecovery(null,saved),false);
});
