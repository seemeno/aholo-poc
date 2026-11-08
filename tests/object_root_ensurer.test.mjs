import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectRootEnsurer} from '../object_root_ensurer.mjs';

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('replacement during template load mounts only the captured current asset',async()=>{
 const oldLoad=deferred(),newLoad=deferred(),items=[{id:'chair',assetId:'old'}],mounted=new Map(),loads=[],mounts=[];
 const ensure=createObjectRootEnsurer({getItems:()=>items,getMountedAssetId:id=>mounted.get(id),loadTemplate:id=>{loads.push(id);return id==='old'?oldLoad.promise:newLoad.promise;},mountRoot:(item,template,{id,assetId})=>{mounts.push(assetId);mounted.set(id,assetId);}});
 const pending=ensure();await Promise.resolve();items[0].assetId='new';assert.equal(ensure(),pending);
 oldLoad.resolve({assetId:'old'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(loads,['old','new']);assert.deepEqual(mounts,[]);
 newLoad.resolve({assetId:'new'});await pending;
 assert.deepEqual(mounts,['new']);assert.equal(mounted.get('chair'),'new');
});

test('shared ensure promise drains items added while an earlier template is loading',async()=>{
 const loadA=deferred(),loadB=deferred(),items=[{id:'a',assetId:'A'}],mounted=new Map(),loads=[];
 const ensure=createObjectRootEnsurer({getItems:()=>items,getMountedAssetId:id=>mounted.get(id),loadTemplate:id=>{loads.push(id);return id==='A'?loadA.promise:loadB.promise;},mountRoot:(item,template,{id,assetId})=>mounted.set(id,assetId)});
 const pending=ensure();let complete=false;pending.then(()=>{complete=true;});await Promise.resolve();items.push({id:'b',assetId:'B'});assert.equal(ensure(),pending);
 loadA.resolve({assetId:'A'});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(loads,['A','B']);assert.equal(complete,false);assert.equal(mounted.get('a'),'A');assert.equal(mounted.has('b'),false);
 loadB.resolve({assetId:'B'});await pending;
 assert.equal(complete,true);assert.deepEqual([...mounted.entries()].sort(),[['a','A'],['b','B']]);
});
