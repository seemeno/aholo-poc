import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {PersonalCredentials} from '../personal_credentials.mjs';
import {ModelScopeRuntime,modelScopeResultUrl} from '../modelscope_runtime.mjs';
import {PersonalEffects} from '../personal_effects.mjs';
import {LocalProjects} from '../local_projects.mjs';
import {makeScene} from '../scene_state.mjs';
import {createEditorServer} from '../structure_server.mjs';
import {permittedRemote} from '../network_audit.mjs';
const tokenA='ms-'+'A'.repeat(32),tokenB='ms-'+'B'.repeat(32);
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url)));
const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;};
function png(){const chunk=(name,data)=>{const n=Buffer.from(name),len=Buffer.alloc(4),check=Buffer.alloc(4);len.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([n,data])));return Buffer.concat([len,n,data,check]);};const h=Buffer.alloc(13);h.writeUInt32BE(256);h.writeUInt32BE(256,4);h[8]=8;h[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',zlib.deflateSync(Buffer.alloc(256*769))),chunk('IEND',Buffer.alloc(0))]);}
function session(vault,token){const headers={},result=vault.set({headers:{}},{setHeader:(k,v)=>headers[k]=v},token,{secure:false});return result.sessionId;}
async function setup(t){const data=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-personal-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(data)),path.resolve(os.tmpdir()));assert.ok(path.basename(data).startsWith('aholo-personal-'));await fs.rm(data,{recursive:true,force:true});});const projects=new LocalProjects(path.resolve('.'),{dataDir:data,callApi:async()=>{throw Error('No AHOLO calls allowed');}}),p=await projects.create({mode:'ply'});p.status='READY';p.worldId=fixture.worldId;await projects.save(p);await fs.writeFile(path.join(projects.dir(p.id),'room.ply'),'unchanged-synthetic-room');const scene=makeScene(structuredClone(fixture));scene.projectId=p.id;scene.camera={rows:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],verticalFov:65,resolution:[256,256]};await projects.scene(p.id,scene);return {data,projects,p,body:{projectId:p.id,scene,preview:'data:image/png;base64,'+png().toString('base64'),consent:true}};}
test('personal credentials isolate two sessions, expire, and expose neither token nor owner in status',()=>{
 let now=0;const vault=new PersonalCredentials({now:()=>now,ttl:100}),a=session(vault,tokenA),b=session(vault,tokenB);
 assert.equal(vault.read(a).token,tokenA);assert.equal(vault.read(b).token,tokenB);assert.equal(vault.id({headers:{'x-aholo-personal-session':a}}),a);assert.doesNotMatch(JSON.stringify(vault.status(a)),new RegExp(tokenA));
 vault.clear({headers:{'x-aholo-personal-session':a}},{setHeader(){}},{secure:false});assert.throws(()=>vault.read(a),e=>e.credentialRequired);assert.equal(vault.read(b).token,tokenB);now=101;assert.equal(vault.status(b).configured,false);assert.equal(vault.sessions.size,0);
});
test('ModelScope runtime sends two references with the personal token, polls known tasks, and never sends auth to result storage',async()=>{
 const calls=[];let durable=false;const runtime=new ModelScopeRuntime({credential:()=>tokenA,pollMs:0,request:async(url,options={})=>{
  calls.push({url,options});if(url.endsWith('/v1/images/generations')){assert.equal(durable,true);return Response.json({task_id:'personal-task-1'});}if(url.includes('/v1/tasks/'))return Response.json({task_status:'SUCCEED',output_images:['https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png']});assert.equal(options.headers,undefined);return new Response(png());
 }});
 const job={width:256,height:256,seed:1};job.promptId=await runtime.submit(job,png(),[{bytes:png(),mime:'image/png'}],async meta=>{durable=true;assert.doesNotMatch(JSON.stringify(meta),new RegExp(tokenA));});assert.deepEqual(await runtime.wait(job,async()=>{}),png());
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+tokenA);const payload=JSON.parse(calls[0].options.body);assert.equal(payload.image_url.length,2);assert.equal(payload.model,'Qwen/Qwen-Image-Edit-2511');assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
 for(const url of ['http://127.0.0.1/a','https://example.com/a','https://bucket.oss-cn-beijing-internal.aliyuncs.com/a','https://user:pass@modelscope.cn/a'])assert.equal(modelScopeResultUrl(url),false);
 assert.equal(permittedRemote('https://api-inference.modelscope.cn/v1/images/generations','POST'),true);assert.equal(permittedRemote('https://api-inference.modelscope.cn/v1/anything','POST'),false);
});
test('personal jobs require consent and a personal session, deduplicate by owner and never persist tokens',async t=>{
 const {projects,body}=await setup(t),vault=new PersonalCredentials(),a=session(vault,tokenA),b=session(vault,tokenB),submitted=[];
 const effects=new PersonalEffects('.', {projects,credentials:vault,runtimeFactory:({credential})=>({ensure:async()=>credential(),submit:async(j,image,refs,before)=>{submitted.push(credential());await before({model:'mock-personal'});return 'task-'+j.id;},wait:async()=>png(),release:async()=>{}})});
 await assert.rejects(effects.start({...body,consent:false},{sessionId:a}),/确认/);await assert.rejects(effects.start(body),e=>e.credentialRequired);assert.equal(submitted.length,0);
 const [one,duplicate]=await Promise.all([effects.start(body,{sessionId:a}),effects.start(body,{sessionId:a})]);assert.equal(one.id,duplicate.id);const two=await effects.start(body,{sessionId:b});assert.notEqual(two.id,one.id);await effects.pool.tail;assert.deepEqual(submitted,[tokenA,tokenB]);
 for(const j of [one,two]){const raw=await fs.readFile(path.join(effects.dir(j.id),'job.ndjson'),'utf8');assert.equal(raw.includes(tokenA)||raw.includes(tokenB),false);assert.equal((await effects.get(j.id)).state,'READY');assert.equal(Object.hasOwn(await effects.get(j.id),'credentialOwner'),false);}
});
test('restart and token loss preserve known task IDs and cannot resume using another visitor token',async t=>{
 const {projects,body}=await setup(t),vault=new PersonalCredentials(),a=session(vault,tokenA),b=session(vault,tokenB);let submits=0,waits=0;
 const factory=({credential})=>({ensure:async()=>credential(),submit:async(j,image,refs,before)=>{submits++;await before({});return 'known-task';},wait:async()=>{waits++;return png();},release:async()=>{}});
 const first=new PersonalEffects('.',{projects,credentials:vault,runtimeFactory:factory}),created=await first.start(body,{sessionId:a});await first.pool.tail;const record=await first.load(created.id);record.state='WAITING';await first.save(record);
 const restarted=new PersonalEffects('.',{projects,credentials:vault,runtimeFactory:factory});assert.equal((await restarted.get(record.id)).state,'WAITING_CREDENTIALS');assert.equal((await restarted.get(record.id,{sessionId:b})).state,'WAITING_CREDENTIALS');assert.equal(waits,1);
 await restarted.get(record.id,{sessionId:a});await restarted.pool.tail;assert.equal(submits,1);assert.equal(waits,2);assert.equal((await restarted.load(record.id)).promptId,'known-task');
 record.state='QUEUED';record.promptId=null;record.submitAttempted=false;await restarted.save(record);assert.equal((await restarted.get(record.id,{sessionId:a})).state,'NEEDS_CONFIRMATION');assert.equal(submits,1);
});
test('lost personal submission response is not blindly submitted a second time',async t=>{
 const {projects,body}=await setup(t),vault=new PersonalCredentials(),a=session(vault,tokenA);let calls=0;
 const effects=new PersonalEffects('.',{projects,credentials:vault,runtimeFactory:()=>({ensure:async()=>{},submit:async(j,image,refs,before)=>{calls++;await before({});throw Error('lost response');},reconcile:async()=>null,release:async()=>{}})});
 const job=await effects.start(body,{sessionId:a});await effects.pool.tail;assert.equal((await effects.load(job.id)).state,'SUBMIT_UNKNOWN');await effects.start(body,{sessionId:a});await effects.pool.tail;assert.equal(calls,1);
});
test('personal session HTTP endpoints keep origin checks and configuration never starts inference',async t=>{
 const {projects}=await setup(t);const server=createEditorServer('.',{},{projects,deployment:{studio:true,origins:['https://demo.ms.show'],effectsEnabled:false,personalEffectsEnabled:true},personalRuntimeFactory:()=>{throw Error('Configuration must not infer');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const connect=origin=>fetch(base+'/api/personal-inference/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:tokenA})});assert.equal((await connect('https://attacker.example')).status,403);
 const r=await connect('https://demo.ms.show'),value=await r.json();assert.equal(value.configured,true);assert.equal(JSON.stringify(value).includes(tokenA),false);assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 const headers={Origin:'https://demo.ms.show','Content-Type':'application/json','X-Aholo-Personal-Session':value.sessionId};assert.equal((await fetch(base+'/api/personal-inference/session',{headers}).then(r=>r.json())).configured,true);assert.equal((await fetch(base+'/api/personal-inference/session/clear',{method:'POST',headers,body:'{}'})).status,200);assert.equal((await fetch(base+'/api/personal-inference/session',{headers}).then(r=>r.json())).configured,false);
});
