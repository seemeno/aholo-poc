import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryReader,roomEffectRecords,createRoomEffectHistory} from '../effect_history.mjs';
test('simultaneous effect reads share a request, failures can retry, and no generation is involved',async()=>{
 let calls=0,release;const load=createHistoryReader(()=>{calls++;return new Promise(r=>release=r);});
 const a=load(),b=load();assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);release({jobs:[{id:'old',state:'READY'}]});assert.deepEqual(await a,[{id:'old',state:'READY'}]);
 const next=load();await Promise.resolve();assert.equal(calls,2);release({jobs:[]});assert.deepEqual(await next,[]);
 let attempt=0;const retry=createHistoryReader(async()=>{if(!attempt++)throw Error('offline');return {jobs:[]};});await assert.rejects(retry(),/offline/);assert.deepEqual(await retry(),[]);
});

const job=(id,projectId,state='READY',createdAt='2026-11-09T01:00:00Z')=>({id:id.repeat(64),projectId,state,createdAt});

test('room gallery keeps every completed image and every task, orders newest first, and excludes other rooms',()=>{
 const jobs=[job('a','room'),job('b','room','GENERATING','2026-11-09T03:00:00Z'),job('c','room','FAILED','2026-11-09T02:00:00Z'),job('d','other'),job('e','room','READY','2026-11-09T04:00:00Z')];
 const records=roomEffectRecords('room',jobs);assert.deepEqual(records.jobs.map(j=>j.id[0]),['e','b','c','a']);assert.deepEqual(records.images.map(j=>j.id[0]),['e','a']);assert.deepEqual(records.tasks.map(j=>j.id[0]),['b','c']);assert.equal(records.running.length,1);assert.equal(jobs[0].id[0],'a');
 assert.throws(()=>roomEffectRecords('room',null),/记录格式/);
});

test('late history reads cannot replace the selected room and duplicate reads share the same request',async()=>{
 const resolve={},calls={},published=[];
 const history=createRoomEffectHistory({read:id=>{calls[id]=(calls[id]??0)+1;return new Promise(r=>resolve[id]=r);},onChange:value=>published.push(value.projectId)});
 history.select('first');const first=history.refresh(),same=history.refresh();await Promise.resolve();assert.equal(calls.first,1);
 history.select('second');const second=history.refresh();await Promise.resolve();resolve.second({jobs:[job('b','second')]});await second;
 const count=published.length;resolve.first({jobs:[job('a','first')]});await Promise.all([first,same]);assert.equal(published.length,count);assert.equal(history.state.projectId,'second');assert.equal(history.state.jobs[0].id[0],'b');
 history.select('first');assert.equal(history.state.jobs[0].id[0],'a');
});

test('history refresh failure preserves completed images and task progress; retry clears the error without submitting',async()=>{
 let fail=false,calls=0;const history=createRoomEffectHistory({read:async()=>{calls++;if(fail)throw Error('network unavailable');return {jobs:[job('a','room'),job('b','room','QUEUED')]};}});
 history.select('room');await history.refresh();const saved=history.state.jobs;fail=true;await assert.rejects(history.refresh(),/network unavailable/);assert.equal(history.state.jobs,saved);assert.equal(history.state.known,true);assert.equal(history.state.loading,false);assert.ok(history.state.error);
 fail=false;await history.refresh();assert.equal(history.state.error,null);assert.equal(calls,3);assert.equal(history.state.jobs.length,2);
});
