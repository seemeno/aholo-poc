import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveMeasurements,findInitialPlacement,quickPreviewReady,initializeQuickTryOn,dimensionDescription} from '../try_on.mjs';
import {floorContains} from '../placement.mjs';
import {objectsOverlap} from '../object_state.mjs';
import {createFloorGesture,pinchDistance} from '../simple_gesture.mjs';
import {withCaptureVisibility,captureComparison} from '../comparison_view.mjs';
import {LocalProjects} from '../local_projects.mjs';
import {LocalObjectAssets} from '../local_object_assets.mjs';
import {ObjectGenerations} from '../object_generation.mjs';
import {makeScene} from '../scene_state.mjs';
const base={width:2,depth:1,height:.5},floor={z:0,bounds:[[0,0],[5,5]]};
for(const [name,input,expected,axes]of [
 ['empty',undefined,base,[]],['one width',{width:1},{width:1,depth:.5,height:.25},['width']],
 ['one height',{height:1},{width:4,depth:2,height:1},['height']],
 ['two axes',{depth:2,height:.8},{width:4,depth:2,height:.8},['depth','height']],
 ['width takes priority',{width:1,height:2},{width:1,depth:.5,height:2},['width','height']],
 ['complete',{width:1,depth:3,height:2},{width:1,depth:3,height:2},['width','depth','height']]
])test('measurement resolution: '+name,()=>{const result=resolveMeasurements(base,input);assert.deepEqual(result.size,expected);assert.deepEqual(result.measuredAxes,axes);assert.deepEqual(base,{width:2,depth:1,height:.5});});
test('invalid dimensions are never inferred away; old metadata remains unverified',()=>{for(const value of [0,-1,NaN,Infinity,21])assert.throws(()=>resolveMeasurements(base,{depth:value}));assert.match(dimensionDescription({}),/未核对/);assert.match(dimensionDescription({measuredAxes:['width']}),/其余按比例/);});
test('initial placement is deterministic, checks concave footprints and visible added objects',()=>{
 const concave={z:0,polygon:[[0,0],[5,0],[5,1],[1,1],[1,5],[0,5]],bounds:[[0,0],[5,5]]},size={width:.6,depth:.6,height:1},pose=findInitialPlacement(concave,size);
 assert.ok(pose);assert.ok(floorContains(pose,size,concave));assert.deepEqual(findInitialPlacement(concave,size),pose);
 const other={id:'other',visible:true,size,pose},second=findInitialPlacement(concave,size,[other]);assert.ok(second);assert.equal(objectsOverlap(other,{visible:true,size,pose:second}),false);
 assert.equal(findInitialPlacement(concave,{width:3,depth:3,height:1}),null);
 const huge={width:10,depth:10,height:1};assert.equal(findInitialPlacement(floor,huge),null);assert.equal(huge.width,10);
});
test('readiness accepts either completion order and rejects interrupted jobs',()=>{const project={experience:'quick-try-on',status:'WAITING',quickTryOnJobId:'first'},job={id:'first',state:'READY',resultAssetId:'asset'};assert.equal(quickPreviewReady(project,[job]),false);project.status='READY';for(const state of ['DRAFT','FAILED','PAUSED','RUNNING','SUBMIT_UNKNOWN'])assert.equal(quickPreviewReady(project,[{...job,state}]),false);assert.equal(quickPreviewReady(project,[job]),true);assert.equal(quickPreviewReady({...project,experience:'standard'},[job]),false);});
test('gesture keeps last legal pose, commits once, cancel restores original including elevation',()=>{
 let current={x:0,y:0,z:2,yaw:0},starts=0,commits=0,cancels=0;const original={...current};
 const g=createFloorGesture({apply:(next,rollback)=>{if(!rollback&&next.x>3)return false;current={...next};return true;},onStart:()=>starts++,onCommit:()=>commits++,onCancel:()=>cancels++});
 const begin=()=>g.begin({pointerId:1,screen:[0,0],point:[0,0],pose:current}),move=x=>g.move({pointerId:1,screen:[x*10,0],point:[x,0]});
 begin();move(.1);assert.equal(starts,0);move(2);move(4);g.end(1);assert.equal(current.x,2);assert.equal(commits,1);assert.equal(starts,1);
 current={...original};begin();move(1);g.cancel();assert.deepEqual(current,original);assert.equal(cancels,1);assert.equal(commits,1);
 begin();move(1);g.begin({pointerId:2,screen:[0,0],point:[0,0],pose:original});assert.deepEqual(current,original);g.cancel();
});
test('pinch zoom keeps camera distance positive and bounded without changing a placement',()=>{assert.equal(pinchDistance(4,100,200),2);assert.equal(pinchDistance(4,100,50),8);assert.equal(pinchDistance(4,100,0),null);assert.equal(pinchDistance(4,100,100000),.12);assert.equal(pinchDistance(4,100,1),30);});
test('comparison capture restores scene after success and failure without touching object visibility or camera',async()=>{
 const state={modelRoot:{visible:false},proxies:{visible:true},selectionBox:{visible:true},transform:{getHelper:()=>helper}},helper={visible:true},objects=[{visible:false},{visible:true}],camera={position:[1,2,3]},before=JSON.stringify({objects,camera});
 const seen=[];const capture=include=>withCaptureVisibility(state,include,async()=>{seen.push(state.modelRoot.visible);assert.equal(state.proxies.visible,false);return {width:1280,height:720,camera:JSON.stringify(camera)};});
 await captureComparison(capture,(a,b)=>{assert.deepEqual(a,b);});assert.deepEqual(seen,[false,true]);assert.equal(state.modelRoot.visible,false);assert.equal(helper.visible,true);
 await assert.rejects(withCaptureVisibility(state,true,async()=>{throw Error('encoder failed');}),/encoder/);assert.equal(state.modelRoot.visible,false);assert.equal(state.proxies.visible,true);assert.equal(before,JSON.stringify({objects,camera}));
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-quick-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-quick-'));await fs.rm(root,{recursive:true,force:true});});const projects=new LocalProjects(root),assets=new LocalObjectAssets(projects),jobs=new ObjectGenerations(root,{projects,assets}),p=await projects.create({experience:'quick-try-on'}),source=await assets.store(p.id,await fs.readFile(new URL('./fixtures/image.png',import.meta.url)),'photo.png'),[job]=await jobs.create(p.id,[{category:'furniture',sourceAssetId:source.id}]);return {projects,assets,jobs,p,job};}
test('project experience is optional and first task registration validates ownership and floor category',async t=>{
 const {projects,p,job,jobs,assets}=await fixture(t);assert.equal(projects.public(await projects.create({})).experience,'standard');await assert.rejects(projects.create({experience:'bad'}));
 const other=await projects.create({experience:'quick-try-on'});await assert.rejects(projects.updateDraft(other.id,{version:other.updatedAt,quickTryOnJobId:job.id}),/不属于/);
 const source=await assets.store(p.id,await fs.readFile(new URL('./fixtures/image.png',import.meta.url)),'photo.png'),[picture]=await jobs.create(p.id,[{category:'picture',sourceAssetId:source.id}]);await assert.rejects(projects.updateDraft(p.id,{version:p.updatedAt,quickTryOnJobId:picture.id}),/落地/);
 projects.draftUpdating.add(p.id);await assert.rejects(projects.start(p.id),e=>e.statusCode===409);await assert.rejects(projects.updateDraft(p.id,{version:p.updatedAt,quickTryOnJobId:job.id}),e=>e.statusCode===409);projects.draftUpdating.delete(p.id);
 const registered=await projects.updateDraft(p.id,{version:p.updatedAt,quickTryOnJobId:job.id});assert.equal(registered.quickTryOnJobId,job.id);assert.equal(projects.public(await projects.load(p.id)).quickTryOnJobId,job.id);
});
test('two initializers save exactly once and reopening a deleted/cleared first object never reinserts it',async t=>{
 const {projects,p,job}=await fixture(t);await projects.updateDraft(p.id,{version:p.updatedAt,quickTryOnJobId:job.id});const record=await projects.load(p.id),structure=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url)));record.worldId=structure.worldId;record.status='READY';await projects.save(record);
 let builds=0;const restored=[],scene={...makeScene(structure),schemaVersion:3,objects:[],activeObjectId:null,projectId:p.id,tryOn:{jobId:job.id,state:'placed',objectId:'deleted_first'}};
 const read=async()=>{try{return await projects.scene(p.id);}catch(e){if(e.code==='ENOENT')e.status=404;throw e;}},save=async value=>{try{return await projects.scene(p.id,value);}catch(e){e.status=e.statusCode;throw e;}};
 const run=()=>initializeQuickTryOn({project:projects.public(record),read,save,build:async()=>{builds++;return structuredClone(scene);},restore:value=>restored.push(value)});
 const results=await Promise.all([run(),run()]);assert.equal(results.filter(Boolean).length,1);assert.equal(restored.length,2);assert.equal(restored[0].savedAt,restored[1].savedAt);assert.equal((await read()).objects.length,0);
 await run();assert.equal(builds,2);assert.equal(restored.at(-1).objects.length,0);assert.equal(restored.at(-1).tryOn.objectId,'deleted_first');
 const old={...record,experience:'standard'};assert.equal(await initializeQuickTryOn({project:old,read:()=>{throw Error('must not read');}}),false);
});
test('pending initialization persists original oversized dimensions; refresh only restores and permission failures propagate',async()=>{
 const project={experience:'quick-try-on',quickTryOnJobId:'a'.repeat(64)},size={width:20,depth:20,height:2};let saved=null,builds=0;
 const read=async()=>{if(!saved)throw Object.assign(Error('missing'),{status:404});return saved;},build=async()=>{builds++;return {objects:[],tryOn:{jobId:project.quickTryOnJobId,state:'pending',size}};},save=async scene=>{assert.equal(scene.expectedSavedAt,null);saved={...scene,savedAt:'v1'};return saved;},restore=scene=>{assert.deepEqual(scene.tryOn.size,size);assert.equal(scene.objects.length,0);};
 await initializeQuickTryOn({project,read,build,save,restore});await initializeQuickTryOn({project,read,build,save,restore});assert.equal(builds,1);
 await assert.rejects(initializeQuickTryOn({project,read:async()=>{throw Object.assign(Error('pair again'),{status:401});},build,save,restore}),/pair again/);assert.equal(builds,1);
});
test('initial CAS retries a briefly busy room without rebuilding or overwriting a winner',async()=>{
 let attempts=0,builds=0,saved=null;const scene={objects:[],tryOn:{state:'pending'}},project={experience:'quick-try-on',quickTryOnJobId:'a'.repeat(64)};
 const read=async()=>{if(saved)return saved;throw Object.assign(Error('not yet saved'),{status:404});};
 const result=await initializeQuickTryOn({project,read,build:async()=>{builds++;return scene;},save:async body=>{assert.equal(body.expectedSavedAt,null);if(++attempts===1)throw Object.assign(Error('room worker busy'),{status:409});saved={...body,savedAt:'winner'};return saved;},restore:value=>assert.equal(value.savedAt,'winner')});
 assert.equal(result,true);assert.equal(builds,1);assert.equal(attempts,2);
});
