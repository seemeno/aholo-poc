import test from 'node:test';
import assert from 'node:assert/strict';
import {currentViewCapture,createDirectEffectAction,canGenerateCurrentView,planFingerprint} from '../ui_actions.mjs';
import {makeScene,validateScene} from '../scene_state.mjs';
import fs from 'node:fs/promises';

test('current-view captures follow screen orientation and pad rather than crop to the model pixel grid',()=>{
 for(const [w,h]of [[320,740],[390,844],[740,320],[844,390],[1440,900],[900,1440],[1000,1000],[100,2000],[2000,100]]){
  const aspect=w/h,c=currentViewCapture(aspect);
  assert.ok(c.width>=256&&c.height>=256&&c.width%16===0&&c.height%16===0);
  assert.ok(c.imageWidth<=c.width&&c.imageHeight<=c.height&&c.left>=0&&c.top>=0);
  assert.ok(Math.abs(c.imageWidth-c.imageHeight*aspect)<=Math.max(1,aspect));
  assert.equal(Math.sign(c.width-c.height),Math.sign(w-h));
 }
});

test('a direct click waits for task recovery, submits once, and prevents overlapping clicks',async()=>{
 let release,opened=0,submitted=0;const waiting=new Promise(resolve=>release=resolve);
 const action=createDirectEffectAction({open:async()=>{opened++;await waiting;},canGenerate:()=>true,generate:async()=>submitted++});
 const first=action();assert.equal(await action(),false);assert.equal(submitted,0);release();assert.equal(await first,true);assert.equal(opened,1);assert.equal(submitted,1);
 assert.equal(await action(),true);assert.equal(submitted,2);
});

test('closed dialogs, unavailable inference, ambiguous tasks and missing personal consent never auto-submit',async()=>{
 const ready={open:true,projectId:'project',effectsEnabled:true,state:'READY'};
 assert.equal(canGenerateCurrentView(ready),true);
 for(const patch of [{open:false},{projectId:null},{error:'offline'},{loading:true},{submitting:true},{effectsEnabled:false},...['QUEUED','PREPARING','GENERATING','WAITING','SUBMIT_UNKNOWN'].map(state=>({state})),{personalEnabled:true,configured:false,consented:true},{personalEnabled:true,configured:true,consented:false}]){
  let submits=0;const action=createDirectEffectAction({open:async()=>{},canGenerate:()=>canGenerateCurrentView({...ready,...patch}),generate:async()=>submits++});
  assert.equal(await action(),false);assert.equal(submits,0);
 }
 assert.equal(canGenerateCurrentView({...ready,effectsEnabled:false,personalEnabled:true,configured:true,consented:true}),true);
});

test('a failed direct action can be retried without leaving the click guard stuck',async()=>{
 let fail=true,calls=0;const action=createDirectEffectAction({open:async()=>{if(fail)throw Error('history unavailable');},canGenerate:()=>true,generate:async()=>calls++});
 await assert.rejects(action(),/history unavailable/);fail=false;assert.equal(await action(),true);assert.equal(calls,1);
});

test('output padding does not mark an unchanged view as edited, while actual view changes do',async()=>{
 const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url))),scene=makeScene(fixture);
 scene.renderFrame='viewport';scene.camera={rows:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,1500,1]],verticalFov:65,viewAspect:844/390,resolution:[844,390]};
 const output=structuredClone(scene),{width,height}=currentViewCapture(scene.camera.viewAspect);output.camera.resolution=[width,height];
 assert.equal(planFingerprint(output),planFingerprint(scene));assert.doesNotThrow(()=>validateScene(output));
 output.camera.viewAspect=390/844;assert.notEqual(planFingerprint(output),planFingerprint(scene));
 output.camera.viewAspect=0;assert.throws(()=>validateScene(output),/视野比例/);
});
