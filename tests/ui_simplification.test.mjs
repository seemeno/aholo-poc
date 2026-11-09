import test from 'node:test';
import assert from 'node:assert/strict';
import {createPagePoller,pageRefreshDelay} from '../ui_actions.mjs';
import {roomItemLibrary} from '../object_state.mjs';

test('polling is fast for live tasks, slower when idle, and stops on photo entry',()=>{
 assert.equal(pageRefreshDelay({screen:'photo',roomStates:['WAITING']}),null);
 assert.equal(pageRefreshDelay({screen:'project',roomStates:['READY']}),15000);
 for(const key of ['roomStates','objectStates','effectStates'])assert.equal(pageRefreshDelay({screen:'project',[key]:['GENERATING']}),4000);
});

test('hidden pages make no new requests, wake immediately, and stop clears timers',async()=>{
 let visible=true,calls=0;const timers=new Map();let id=0;
 const poller=createPagePoller({run:async()=>calls++,delay:()=>15000,visible:()=>visible,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},unschedule:key=>timers.delete(key)});
 poller.start();assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,15000);
 visible=false;await poller.wake();assert.equal(calls,0);assert.equal(timers.size,0);
 visible=true;await poller.wake();assert.equal(calls,1);assert.equal(timers.size,1);
 poller.stop();assert.equal(timers.size,0);await poller.wake();assert.equal(calls,1);
});

test('wake during a request does not overlap requests, but refreshes the latest route afterward',async()=>{
 let release,calls=0,concurrent=0,max=0;const running=new Promise(resolve=>release=resolve);
 const poller=createPagePoller({run:async()=>{calls++;concurrent++;max=Math.max(max,concurrent);if(calls===1)await running;concurrent--;},delay:()=>15000,schedule:()=>1,unschedule:()=>{}});
 poller.start();const first=poller.wake();await Promise.resolve();const duplicate=poller.wake();assert.equal(calls,1);release();await Promise.all([first,duplicate]);await Promise.resolve();assert.equal(max,1);assert.equal(calls,2);poller.stop();
});

test('upload pause and photo editing do not send polling requests',async()=>{
 let paused=true,photo=false,calls=0;const poller=createPagePoller({run:async()=>calls++,delay:()=>photo?null:15000,paused:()=>paused,schedule:()=>1,unschedule:()=>{}});
 poller.start();await poller.wake();assert.equal(calls,0);paused=false;photo=true;await poller.wake();assert.equal(calls,0);photo=false;await poller.wake();assert.equal(calls,1);poller.stop();
});

test('imported furniture appears in room details even without a generation task; its reference photo is not duplicated',()=>{
 const assets=[{id:'photo',name:'实物.jpg',kind:'image'},{id:'model',name:'猫爬架.glb',kind:'glb',sourceAssetId:'photo'}];
 assert.deepEqual(roomItemLibrary(assets),[{id:'model',name:'猫爬架',kind:'glb',category:'furniture',sourceAssetId:'photo'}]);
});

test('ready jobs and assets merge into one item; a completed job is visible before the asset list catches up',()=>{
 const job={name:'座椅',state:'READY',resultAssetId:'chair',sourceAssetId:'source',category:'furniture'};
 const first=roomItemLibrary([], [job]);assert.equal(first.length,1);assert.equal(first[0].name,'座椅');
 const later=roomItemLibrary([{id:'chair',name:'chair.glb',kind:'glb',sourceAssetId:'source'}],[job]);assert.deepEqual(later,first);
});

test('pending object photos stay in task progress, while ready pictures stay in the room item list',()=>{
 const assets=[{id:'pending',name:'沙发.jpg',kind:'image'},{id:'art',name:'画作.jpg',kind:'image'}],jobs=[{state:'RUNNING',category:'furniture',sourceAssetId:'pending'},{name:'挂画',state:'READY',category:'picture',sourceAssetId:'art',resultAssetId:'art'}];
 const list=roomItemLibrary(assets,jobs);assert.equal(list.length,1);assert.equal(list[0].name,'挂画');assert.equal(list[0].kind,'image');
});
