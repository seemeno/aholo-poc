import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import zlib from 'node:zlib';
import {LocalProjects} from '../local_projects.mjs';
import {LocalObjectAssets} from '../local_object_assets.mjs';
import {makeScene} from '../scene_state.mjs';
import {LocalEffectRenderer} from '../effect_render.mjs';
import {EffectRuntime} from '../effect_runtime.mjs';
import {effectWorkflow} from '../effect_workflow.mjs';
import {createEditorServer} from '../structure_server.mjs';
import {permittedRemote} from '../network_audit.mjs';
import {planFingerprint} from '../ui_actions.mjs';
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url)));
function crc(buffer){let c=0xffffffff;for(const b of buffer){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;}
export function png(width=512,height=288){const chunk=(type,data)=>{const name=Buffer.from(type),n=Buffer.alloc(4),check=Buffer.alloc(4);n.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([n,name,data,check]);};const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.alloc(height*(width*3+1),80))),chunk('IEND',Buffer.alloc(0))]);}
async function setup(t,{unknown=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-effect-test-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 const projects=new LocalProjects(root),p=await projects.create({mode:'ply'});p.status='READY';p.worldId=fixture.worldId;await projects.save(p);
 await fs.writeFile(path.join(projects.dir(p.id),'room.ply'),'fixture-ply-unchanged');
 const scene=makeScene(structuredClone(fixture));scene.schemaVersion=3;scene.projectId=p.id;scene.camera={rows:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,-4000,1500,1]],verticalFov:65,resolution:[512,288]};
 await projects.scene(p.id,scene);await fs.mkdir(path.join(root,'assets/demo'),{recursive:true});await fs.writeFile(path.join(root,'assets/demo/furniture_reference.png'),png());
 const calls={submit:0,wait:0,release:0};let pending=false;
 const runtime={ensure:async()=>{},submit:async(j,image,refs,before)=>{calls.submit++;assert.equal(refs.length,1);await before({tested:'local workflow'});if(unknown)throw Error('Simulated ambiguous response');return '11111111-1111-4111-8111-111111111111';},wait:async(j,update)=>{calls.wait++;await update('GENERATING','mock rendering');await new Promise(r=>setTimeout(r,20));if(pending){const e=Error('pending');e.pending=true;throw e;}return png();},release:async()=>{calls.release++;},reconcile:async()=>null};
 const effects=new LocalEffectRenderer(root,{runtime,projects});
 return {root,projects,p,scene,calls,runtime,effects,input:{projectId:p.id,scene,preview:'data:image/png;base64,'+png().toString('base64')},setPending:v=>pending=v};
}
async function finish(effects,id,waiting=false){for(let i=0;i<200;i++){const j=await effects.get(id);if(['READY','FAILED','SUBMIT_UNKNOWN',...(waiting?['WAITING']:[])].includes(j.state))return j;await new Promise(r=>setTimeout(r,10));}throw Error('Effect test timed out');}
test('saved effect history retains older completed images, stays project-scoped and never submits work',async t=>{
 const f=await setup(t);const first=await f.effects.start(f.input);await finish(f.effects,first.id);const second=await f.effects.start({...f.input,force:true});await finish(f.effects,second.id);
 const before={...f.calls},history=await f.effects.list(f.p.id);assert.deepEqual(history.map(j=>j.id),[second.id,first.id]);assert.ok(history.every(j=>j.state==='READY'&&j.imageUrl));assert.deepEqual(f.calls,before);
 const other=await f.projects.create({mode:'ply'});assert.deepEqual(await f.effects.list(other.id),[]);assert.deepEqual(await f.effects.image(first.id),png());
});
test('local effect snapshots persist, serialize repeated submissions and serve the actual saved result',async t=>{
 const f=await setup(t),other=new LocalEffectRenderer(f.root,{runtime:f.runtime,projects:f.projects});
 const [a,b]=await Promise.all([f.effects.start(f.input),other.start(f.input)]);assert.equal(a.id,b.id);
 const result=await finish(f.effects,a.id);assert.equal(result.state,'READY',result.message);assert.equal(f.calls.submit,1);assert.equal(f.calls.wait,1);assert.equal(result.referenceCount,1);
 assert.deepEqual(await f.effects.image(a.id),png());assert.deepEqual(await f.effects.image(a.id,true),png());
 assert.equal((await other.start(f.input)).id,a.id);assert.equal(f.calls.submit,1);
 assert.equal((await other.latest(f.p.id)).id,a.id);assert.equal(result.planFingerprint,planFingerprint(f.scene));assert.equal(await fs.readFile(path.join(f.projects.dir(f.p.id),'room.ply'),'utf8'),'fixture-ply-unchanged');
 const next=await f.projects.create({mode:'ply'});assert.equal(await other.latest(next.id),null);
 const stored=await f.effects.load(a.id);assert.deepEqual(stored.scene.camera.resolution,[512,288]);assert.ok(stored.resultSha256);
});
test('stale placements, bad captures and cross-project references reject before model execution',async t=>{
 const f=await setup(t),changed=structuredClone(f.input);changed.scene.objects[0].pose.x+=.5;
 await assert.rejects(f.effects.start(changed),/保存/);
 await assert.rejects(f.effects.start({...f.input,preview:'https://example.com/image.png'}),/截图/);
 await assert.rejects(f.effects.start({...f.input,projectId:'../private'}),/ID/);
 const foreign=structuredClone(f.input);foreign.scene.objects[0].assetId='22222222-2222-4222-8222-222222222222';await assert.rejects(f.effects.start(foreign),/不属于/);assert.equal(f.calls.submit,0);
});
test('lost submit responses never silently create a duplicate GPU job',async t=>{
 const f=await setup(t,{unknown:true}),a=await f.effects.start(f.input);assert.equal((await finish(f.effects,a.id)).state,'SUBMIT_UNKNOWN');
 assert.equal((await f.effects.start(f.input)).state,'SUBMIT_UNKNOWN');assert.equal(f.calls.submit,1);
});
test('a persisted Comfy prompt resumes polling after service replacement without resubmission',async t=>{
 const f=await setup(t);f.setPending(true);const a=await f.effects.start(f.input);assert.equal((await finish(f.effects,a.id,true)).state,'WAITING');
 while(f.effects.pool.running.has(a.id))await new Promise(r=>setTimeout(r,5));
 f.setPending(false);const restored=new LocalEffectRenderer(f.root,{runtime:f.runtime,projects:f.projects});assert.equal((await finish(restored,a.id)).state,'READY');assert.equal(f.calls.submit,1);assert.ok(f.calls.wait>=2);
});
test('workflow uses current images and output dimensions without bedroom-specific prompts',()=>{
 const g=effectWorkflow({image:'new-room.png',references:[{image:'new-art.png',label:'the existing artwork'}],width:768,height:1024,seed:7,prefix:'new-output'});
 assert.equal(g['4'].inputs.image,'new-room.png');assert.equal(g['17'].inputs.height,1024);assert.equal(g['21'].inputs.filename_prefix,'new-output');assert.match(g['5'].inputs.text,/Image 2/);assert.doesNotMatch(g['5'].inputs.text,/bedroom|frame-5|kiri\/final/);assert.equal(g['30'].inputs.image,'new-art.png');
});

test('a restarted inference service cannot leave a missing prompt blocking the render queue forever',async()=>{
 let submissions=0;const runtime=new EffectRuntime('.', {pollMs:0,maxWaitMs:500,request:async url=>{if(String(url).includes('/prompt'))submissions++;return Response.json(String(url).endsWith('/queue')?{queue_running:[],queue_pending:[]}:{});}});
 await assert.rejects(runtime.wait({promptId:'11111111-1111-4111-8111-111111111111',createdAt:'2020-01-01T00:00:00Z'},async()=>{}),e=>e.unknown===true&&/未自动重复/.test(e.message));assert.equal(submissions,0);
});

test('the furniture source accompanies a layout-preserving capture without duplicating art references',async t=>{
 const f=await setup(t),assets=new LocalObjectAssets(f.projects),photo=await assets.store(f.p.id,png(),'chair-reference.png');
 const modelBytes=await fs.readFile(new URL('./fixtures/cabinet.glb',import.meta.url));
 const model=await assets.store(f.p.id,modelBytes,'generated-chair.glb',{sourceAssetId:photo.id,category:'furniture'}),art1=await assets.store(f.p.id,png(512,512),'art-one.png'),art2=await assets.store(f.p.id,png(768,512),'art-two.png');
 const base=f.scene.objects[0];f.scene.objects=[{...base,id:'chair',assetId:model.id,assetKind:'glb',name:'test chair'},{...base,id:'art1',assetId:art1.id,assetKind:'image'},{...base,id:'art2',assetId:art2.id,assetKind:'image'}];
 const refs=await f.effects.references(f.p.id,f.scene);assert.equal(refs.length,1);assert.match(refs[0].label,/furniture/);assert.deepEqual(refs[0].bytes,await fs.readFile(path.join(f.projects.dir(f.p.id),'objects',photo.file)));
 const graph=effectWorkflow({image:'capture.png',references:[],width:1024,height:576,seed:1,prefix:'test'});assert.equal(graph['19'].inputs.latent_image[0],'7');assert.deepEqual(graph['19'].inputs.sigmas,['22',1]);assert.equal(graph['22'].inputs.step,2);assert.equal(graph['18'],undefined);
});
test('runtime rejects unexpected output filenames before reading any file or external URL',async()=>{
 let calls=0;const runtime=new EffectRuntime('.', {request:async()=>{calls++;return Response.json({p:{status:{status_str:'success'},outputs:{'21':{images:[{filename:'../../private.png',subfolder:'',type:'output'}]}}}});}});
 await assert.rejects(runtime.wait({id:'a'.repeat(64),promptId:'p'},async()=>{}),/输出/);assert.equal(calls,1);
 for(const url of ['http://127.0.0.1:8190/system_stats','http://127.0.0.1:8190/history/11111111-1111-4111-8111-111111111111'])assert.equal(permittedRemote(url),true);
 for(const url of ['http://localhost:8190/queue','http://127.0.0.1:8191/queue','http://127.0.0.1:8190/api/keys','http://192.168.0.2:8190/queue'])assert.equal(permittedRemote(url),false);
 assert.equal(permittedRemote('http://127.0.0.1:8190/prompt','POST'),true);assert.equal(permittedRemote('http://127.0.0.1:8190/interrupt','POST'),false);
});
test('phone effect routes retain pairing/origin guards and persist results behind same-origin URLs',async t=>{
 const f=await setup(t),server=createEditorServer(f.root,{lan:true,hosts:['192.168.50.10'],pairCode:'123456'},{effectRuntime:f.runtime});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const port=server.address().port,base=`http://127.0.0.1:${port}`,host=`192.168.50.10:${port}`,origin='http://'+host;
 const request=(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=http.request(base+url,{method,headers:{Host:host,...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)}));});req.on('error',reject);req.end(body);});
 assert.equal((await request('/api/effect-renders?project='+f.p.id)).status,401);
 const paired=await request('/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'code=123456'}),cookie=paired.headers['set-cookie'][0].split(';')[0];
 const data=JSON.stringify(f.input),post=headers=>request('/api/effect-renders',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...headers},body:data});
 assert.equal((await post({Origin:'null'})).status,403);
 const submitted=await post({Origin:origin});assert.equal(submitted.status,202);const job=JSON.parse(submitted.bytes);
 assert.equal((await request(job.previewUrl)).status,401);
 const ready=await finish(f.effects,job.id);const image=await request(ready.imageUrl,{headers:{Cookie:cookie}});assert.equal(image.status,200);assert.deepEqual(image.bytes,png());
 assert.equal((await request(ready.imageUrl,{method:'HEAD',headers:{Cookie:cookie}})).bytes.length,0);
 assert.equal((await request('/local-data/effect-renders/'+job.id+'/job.json',{headers:{Cookie:cookie}})).status,404);
});
