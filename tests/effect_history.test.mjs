import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryReader} from '../effect_history.mjs';
test('simultaneous effect reads share a request, failures can retry, and no generation is involved',async()=>{
 let calls=0,release;const load=createHistoryReader(()=>{calls++;return new Promise(r=>release=r);});
 const a=load(),b=load();assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);release({jobs:[{id:'old',state:'READY'}]});assert.deepEqual(await a,[{id:'old',state:'READY'}]);
 const next=load();await Promise.resolve();assert.equal(calls,2);release({jobs:[]});assert.deepEqual(await next,[]);
 let attempt=0;const retry=createHistoryReader(async()=>{if(!attempt++)throw Error('offline');return {jobs:[]};});await assert.rejects(retry(),/offline/);assert.deepEqual(await retry(),[]);
});
