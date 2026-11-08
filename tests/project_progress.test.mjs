import test from 'node:test';
import assert from 'node:assert/strict';
import {projectProgress,roomProgress,projectStepProgress} from '../project_progress.mjs';
import {LocalProjects} from '../local_projects.mjs';
import {photoQuality} from '../photo_checks.mjs';
import {handleEffectRoutes} from '../effect_routes.mjs';

test('a ready room never hides a pending, failed or unconfirmed object',()=>{
 const p={status:'READY'},jobs=[{state:'READY'},{state:'FAILED'},{state:'RUNNING'}];
 assert.equal(projectProgress(p,{jobs}).label,'需要关注');
 assert.match(projectProgress(p,{jobs}).title,/其余继续/);
 assert.equal(projectProgress(p,{jobs:[{state:'DRAFT'}]}).label,'待生成物品');
 assert.equal(projectProgress(p,{jobs:null}).label,'读取进度');
 assert.equal(projectProgress(p,{jobs:[],jobsError:'offline'}).label,'需要关注');
 assert.equal(projectProgress(p,{jobs:[{state:'SUBMIT_UNKNOWN'}]}).label,'需要关注');
 assert.equal(projectProgress(p,{jobs:[]}).label,'可以试摆');
});
test('room worker state distinguishes active generation from interrupted polling without a new submission',()=>{
 const manager=new LocalProjects(process.cwd()),p={id:'room',uploads:[],status:'WAITING',worldId:'existing'};
 assert.equal(manager.public(p).processing,false);
 assert.equal(roomProgress(manager.public(p)).needsResume,true);
 manager.busy.add(p.id);
 assert.equal(manager.public(p).processing,true);
 assert.equal(roomProgress(manager.public(p)).needsResume,false);
 assert.equal(projectProgress(manager.public(p),{jobs:[]}).label,'处理中');
 manager.busy.delete(p.id);
 assert.equal(projectProgress(manager.public(p),{jobs:[]}).label,'需要关注');
 assert.equal(roomProgress({...p,status:'SUBMIT_UNKNOWN'}).needsResume,false);
});
test('effects and saved placement are separate from readiness, including optional and failed effects',()=>{
 const p={status:'READY',hasScene:true};
 assert.equal(projectProgress(p,{jobs:[],effect:{state:'GENERATING'}}).title,'正在生成空间效果图');
 assert.equal(projectProgress(p,{jobs:[],effect:{state:'FAILED'}}).label,'需要关注');
 const model=projectStepProgress(p,{jobs:[],effectKnown:true});
 assert.equal(model.steps.prepare.state,'done');assert.equal(model.steps.place.state,'done');
 assert.equal(model.steps.effects.state,'pending');assert.match(model.steps.effects.lines[0].text,/可选/);assert.equal(model.showDetails,false);
 assert.equal(projectStepProgress(p,{jobs:[],effect:{state:'FAILED'},effectKnown:true}).showDetails,true);
});

test('merged steps retain partial failures and keep independent running work visible',()=>{
 const p={status:'READY',hasScene:true},jobs=[{id:'ok',state:'READY'},{id:'bad',state:'FAILED'},{id:'work',state:'RUNNING'}];
 const model=projectStepProgress(p,{jobs,effectKnown:true});
 assert.equal(model.steps.prepare.state,'attention');assert.match(model.steps.prepare.lines[1].text,/1\/3/);assert.equal(model.steps.place.state,'done');assert.equal(model.showDetails,true);
 assert.equal(model.steps.prepare.lines[2].text,'1 件需处理');
 const running=projectStepProgress(p,{jobs:[jobs[0],jobs[2]],effectKnown:true});assert.equal(running.steps.prepare.state,'running');assert.equal(running.showDetails,true);
 assert.equal(running.steps.prepare.lines[2].text,'1 件生成中');
 assert.notEqual(model.attentionKey,running.attentionKey);
});

test('merged step status does not report stale or unread progress as completed',()=>{
 const p={status:'READY'},jobs=[{id:'one',state:'READY'}];
 const stale=projectStepProgress(p,{jobs,jobsError:'offline',effect:{state:'READY'},effectKnown:true,effectError:'offline'});
 assert.equal(stale.steps.prepare.state,'attention');assert.match(stale.steps.prepare.lines[1].text,/1\/1.*暂未更新/);assert.equal(stale.steps.effects.state,'attention');assert.equal(stale.showDetails,true);
 const unread=projectStepProgress(p,{jobs:null,effectKnown:false});assert.match(unread.steps.prepare.lines[1].text,/读取中/);assert.equal(unread.steps.effects.state,'unknown');assert.notEqual(unread.steps.prepare.state,'done');
 const stopped=projectStepProgress({status:'WAITING',worldId:'existing',processing:false},{jobs:[],effectKnown:true});assert.equal(stopped.steps.prepare.state,'attention');assert.match(stopped.steps.prepare.lines[0].text,/待继续/);
});
test('photo warnings are available before uploads and distinguish readability from quality',()=>{
 assert.deepEqual(photoQuality({width:1200,height:800,sharpness:80}).warnings,[]);
 assert.equal(photoQuality({width:200,height:400,sharpness:0}).warnings.length,2);
 assert.equal(photoQuality({width:1200,height:800,sharpness:0}).warnings.length,1);
});
test('project overview reads effect status without resuming a worker; editor reads still resume',async()=>{
 const calls=[],effects={latest:async(id,resume)=>{calls.push([id,resume]);return null;}},res={writeHead(){},end(){}};
 for(const query of ['?project=space&resume=0','?project=space'])await handleEffectRoutes({method:'GET'},res,new URL('http://localhost/api/effect-renders'+query),effects,()=>{});
 assert.deepEqual(calls,[['space',false],['space',true]]);
});
