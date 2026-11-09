import test from 'node:test';
import assert from 'node:assert/strict';
import {placementDraft,centimeters,imageDimensions,effectDimensions,taskPresentation,photoMeasurements,preparationLabel,planFingerprint} from '../ui_actions.mjs';
test('centimeter edits preserve meter storage and reject incomplete edits instead of saving old values',()=>{
 const fields={x:'1.2',y:'2',z:'0',yaw:'90',width:'80',depth:'70',height:'90'};
 assert.deepEqual(placementDraft(fields),{pose:{x:1.2,y:2,z:0,yaw:Math.PI/2},size:{width:.8,depth:.7,height:.9}});
 assert.equal(centimeters(.803),80.3);
 for(const value of ['','-','Infinity','0','-80'])assert.throws(()=>placementDraft({...fields,width:value}),e=>e.field==='width');
});
test('export dimensions respect portrait and landscape framing',()=>{
 assert.deepEqual(imageDimensions(16/9),{width:1280,height:720});
 assert.deepEqual(imageDimensions(3/4),{width:960,height:1280});
 assert.throws(()=>imageDimensions(0));
});
test('effect preview and capture share the exact supported output aspect at all viewport sizes',()=>{
 assert.deepEqual(effectDimensions('landscape',.5),{width:1024,height:576});assert.deepEqual(effectDimensions('portrait',2),{width:768,height:1024});
 assert.deepEqual(effectDimensions('viewport',.1),{width:256,height:1024});assert.deepEqual(effectDimensions('viewport',8),{width:1024,height:256});
 for(const aspect of [.1,.45,.75,1,16/9,8]){const {width,height}=effectDimensions('viewport',aspect);assert.ok([width,height].every(x=>x>=256&&x<=1024&&x%16===0));assert.deepEqual(effectDimensions('viewport',width/height),{width,height});}
});
test('ambiguous submission never offers a blind new submission; paused known task resumes',()=>{
 assert.equal(taskPresentation('SUBMIT_UNKNOWN',{hasId:false}).action,'核对任务');
 assert.equal(taskPresentation('PAUSED',{hasId:true}).action,'继续完成');
 assert.equal(taskPresentation('FAILED').action,'重新生成');
});

test('partial photo measurements are accepted separately for later proportional inference',()=>{
 assert.deepEqual(photoMeasurements({width:.8},{draft:true}),{draftSize:{width:.8}});
 assert.deepEqual(photoMeasurements({width:.8,depth:.7,height:.9},{draft:true}),{size:{width:.8,depth:.7,height:.9}});
 assert.deepEqual(photoMeasurements(undefined,{draft:true}),{});
 assert.deepEqual(photoMeasurements({width:.8}),{draftSize:{width:.8}});
 for(const width of [NaN,0,-1,21])assert.throws(()=>photoMeasurements({width},{draft:true}),e=>e.field==='width');
 assert.equal(preparationLabel({replacement:true,confirmQuality:true}),'仍然生成');
 assert.equal(preparationLabel({replacement:true}),'用新照片重新生成');
});

test('effect comparison ignores saving, renaming and output resolution but detects visible changes',()=>{
 const scene={projectId:'a',worldId:'w',renderFrame:'landscape',sceneScale:1,structure:{floor:{z:0}},objects:[{id:'1',name:'chair',assetId:'asset',assetKind:'glb',visible:true,pose:{x:0,y:1,z:0,yaw:0},size:{width:.8,depth:.7,height:.9}}],camera:{rows:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,-4000,1500,1]],verticalFov:65,resolution:[1024,576]}};
 const fingerprint=planFingerprint(scene),saved=structuredClone(scene);saved.savedAt='later';saved.activeObjectId='1';saved.objects[0].name='renamed';saved.camera.resolution=[1280,720];
 assert.equal(planFingerprint(saved),fingerprint);
 for(const mutate of [s=>s.objects[0].pose.x++,s=>s.objects[0].size.width++,s=>s.objects[0].visible=false,s=>s.camera.rows[3][0]++,s=>s.renderFrame='portrait']){const changed=structuredClone(scene);mutate(changed);assert.notEqual(planFingerprint(changed),fingerprint);}
});
