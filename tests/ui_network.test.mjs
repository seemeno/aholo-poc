import test from 'node:test';
import assert from 'node:assert/strict';
import {requestJson,issuePresentation} from '../ui_network.mjs';

test('network, pairing, missing items, server errors and invalid responses have distinct recovery actions',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 for(const [status,kind]of [[401,'auth'],[404,'missing'],[409,'conflict'],[500,'server'],[400,'validation']]){
  globalThis.fetch=async()=>Response.json({error:'specific'},{status});let caught;try{await requestJson('/local');}catch(e){caught=e;}
  assert.equal(caught.kind,kind);assert.equal(caught.status,status);assert.equal(issuePresentation(caught).global,status===401);
 }
 globalThis.fetch=async()=>{throw TypeError('fetch failed');};await assert.rejects(requestJson('/local'),e=>e.kind==='network'&&issuePresentation(e).action==='重新连接');
 globalThis.fetch=async()=>new Response('<html>bad gateway</html>');await assert.rejects(requestJson('/local'),e=>e.kind==='response'&&!issuePresentation(e).global);
 globalThis.fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));await assert.rejects(requestJson('/local',{timeoutMs:5}),e=>e.kind==='timeout');
});
