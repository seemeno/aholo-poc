import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreWhenReady} from '../restore_gate.mjs';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('a delayed restore is discarded if export begins before the loaded value is applied',async()=>{
 const loaded=deferred(),applied=[],messages=[];let exporting=false;
 const pending=restoreWhenReady(()=>loaded.promise,{isBusy:()=>exporting,apply:value=>applied.push(value),onBusy:()=>messages.push('export in progress')});
 exporting=true;loaded.resolve({objects:[{id:'new-state'}]});
 assert.equal(await pending,false);assert.deepEqual(applied,[]);assert.deepEqual(messages,['export in progress']);
});

test('restore continues normally when the export lock stays clear',async()=>{
 const applied=[];const result=await restoreWhenReady(async()=>({objects:[{id:'saved'}]}),{isBusy:()=>false,apply:value=>applied.push(value),onBusy:()=>assert.fail('unexpected busy state')});
 assert.equal(result,true);assert.equal(applied[0].objects[0].id,'saved');
});
