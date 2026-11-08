import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalProjects} from '../local_projects.mjs';
import {LocalObjectAssets} from '../local_object_assets.mjs';
import {ObjectGenerations} from '../object_generation.mjs';
import {Lux3DRuntime,modelProportions} from '../lux3d_runtime.mjs';
import {createEditorServer} from '../structure_server.mjs';
import {permittedRemote} from '../network_audit.mjs';

const realGlb=await fs.readFile(new URL('./fixtures/cabinet.glb',import.meta.url));
const realImage=await fs.readFile(new URL('./fixtures/image.png',import.meta.url));
async function fixture(t,{unknown=false,downloadFail=false,terminal=false,inspectFail=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-lux-test-'));
 t.after(async()=>{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('aholo-lux-test-'));await fs.rm(target,{recursive:true,force:true});});
 const projects=new LocalProjects(root);projects.key=async()=>true;
 const p=await projects.create({name:'照片同批测试'}),assets=new LocalObjectAssets(projects);
 const source=await assets.store(p.id,realImage,'chair.png');
 const calls={upload:0,submit:0,wait:0,download:0},runtime={
  inspectSource:async()=>{if(inspectFail)throw Error('invalid photo');return {width:1500,height:1500};},
  upload:async()=>{calls.upload++;return 'https://holo-cos.aholo3d.cn/test/photo.png';},
  submit:async()=>{calls.submit++;if(unknown)throw Error('lost response');return String(700000+calls.submit);},
  query:async taskId=>({taskId,status:1}),
  wait:async()=>{calls.wait++;if(terminal){const e=Error('remote failed');e.terminal=true;throw e;}return 'https://qhsmodel.kujiale.com/test/model.glb';},
  download:async()=>{calls.download++;if(downloadFail)throw Error('download interrupted');return realGlb;}
 };
 const generations=new ObjectGenerations(root,{projects,assets,runtime});
 return {root,projects,p,assets,source,calls,runtime,generations};
}
async function settle(manager,projectId,id){for(let i=0;i<200;i++){const j=await manager.load(projectId,id);if(['READY','FAILED','PAUSED','SUBMIT_UNKNOWN'].includes(j.state)&&!manager.pool.running.has(projectId+':'+id))return j;await new Promise(r=>setTimeout(r,10));}throw Error('object generation did not settle');}

test('room drafts accept mixed object photos; creating a batch never starts paid work',async t=>{
 const f=await fixture(t),[chair,picture]=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture',name:'椅子',size:{width:.7,depth:.6,height:.9}},{sourceAssetId:f.source.id,category:'picture',name:'挂画'}]);
 assert.equal((await f.projects.load(f.p.id)).status,'DRAFT');assert.equal(chair.state,'DRAFT');assert.equal(picture.state,'READY');assert.equal(picture.resultAssetId,f.source.id);assert.equal(f.calls.submit,0);
 const duplicate=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture'}]);assert.equal(duplicate[0].id,chair.id);assert.equal((await f.generations.list(f.p.id)).length,2);
 await assert.rejects(f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture',size:{width:1}}]),/全部/);
});

test('partial draft dimensions persist across reload and retain the entered axis when a model completes',async t=>{
 const f=await fixture(t),[job]=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture',draftSize:{width:.8}}]);
 assert.equal(job.state,'DRAFT');assert.equal(job.size,null);assert.deepEqual(job.draftSize,{width:.8});assert.equal(f.calls.submit,0);
 const reloaded=new ObjectGenerations(f.root,{projects:f.projects,assets:f.assets,runtime:f.runtime});
 assert.deepEqual((await reloaded.list(f.p.id,{resume:false}))[0].draftSize,{width:.8});
 await reloaded.start(f.p.id,[job.id]);const result=await settle(reloaded,f.p.id,job.id);
 assert.equal(result.state,'READY');assert.equal(result.size.width,.8);assert.ok(result.size.depth>0);assert.ok(result.size.height>0);
 await assert.rejects(reloaded.create(f.p.id,[{sourceAssetId:f.source.id,category:'decor',draftSize:{width:100}}]),/尺寸/);
});

test('concurrent starts submit each item once and register a textured model with its original photo',async t=>{
 const f=await fixture(t),[job]=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture',size:{width:.7,depth:.6,height:.9}}]);
 const second=new ObjectGenerations(f.root,{projects:f.projects,assets:f.assets,runtime:f.runtime});
 await Promise.all([f.generations.start(f.p.id),second.start(f.p.id)]);
 const result=await settle(f.generations,f.p.id,job.id);assert.equal(result.state,'READY',result.message);assert.equal(f.calls.submit,1);assert.equal(f.calls.upload,1);
 const asset=(await f.assets.get(f.p.id,result.resultAssetId));assert.deepEqual(asset.bytes,realGlb);assert.equal(asset.meta.sourceAssetId,f.source.id);assert.equal(asset.meta.lux3dTaskId,'700001');assert.deepEqual(asset.meta.estimatedSize,{width:.7,depth:.6,height:.9});
 await second.start(f.p.id);assert.equal(f.calls.submit,1);
 const size=modelProportions(realGlb);assert.ok(Math.abs(Math.max(size.width,size.depth,size.height)-1)<1e-7);assert.ok(size.width>size.height);
});

test('ambiguous submission persists before the POST and never silently creates a duplicate',async t=>{
 const f=await fixture(t,{unknown:true}),[job]=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'decor'}]);await f.generations.start(f.p.id);
 const result=await settle(f.generations,f.p.id,job.id);assert.equal(result.state,'SUBMIT_UNKNOWN');assert.equal(result.submitAttempted,true);assert.ok(result.submittedAt);
 const restarted=new ObjectGenerations(f.root,{projects:f.projects,assets:f.assets,runtime:f.runtime});await restarted.start(f.p.id);await restarted.list(f.p.id);assert.equal(f.calls.submit,1);
 await assert.rejects(restarted.action(f.p.id,job.id,'retry'),/明确失败/);
 await restarted.action(f.p.id,job.id,'recover',{taskId:'812345'});const recovered=await settle(restarted,f.p.id,job.id);assert.equal(recovered.state,'READY');assert.equal(recovered.taskId,'812345');assert.equal(f.calls.submit,1);
});

test('download interruptions resume the saved task; explicit remote failures can retry individually',async t=>{
 const f=await fixture(t,{downloadFail:true}),[job]=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture'}]);await f.generations.start(f.p.id);assert.equal((await settle(f.generations,f.p.id,job.id)).state,'PAUSED');
 f.runtime.download=async()=>realGlb;await f.generations.action(f.p.id,job.id,'resume');assert.equal((await settle(f.generations,f.p.id,job.id)).state,'READY');assert.equal(f.calls.submit,1);
 const g=await fixture(t,{terminal:true}),[failed]=await g.generations.create(g.p.id,[{sourceAssetId:g.source.id,category:'decor'}]);await g.generations.start(g.p.id);assert.equal((await settle(g.generations,g.p.id,failed.id)).state,'FAILED');
 g.runtime.wait=async()=> 'https://qhsmodel.kujiale.com/test/model.glb';await g.generations.action(g.p.id,failed.id,'retry');const retried=await settle(g.generations,g.p.id,failed.id);assert.equal(retried.state,'READY');assert.equal(retried.attempt,2);assert.equal(g.calls.submit,2);assert.equal(retried.previousTasks.length,1);
});

test('invalid and foreign source photos reject before uploads or paid submissions',async t=>{
 const f=await fixture(t,{inspectFail:true}),other=await f.projects.create({});
 await assert.rejects(f.generations.create(other.id,[{sourceAssetId:f.source.id,category:'furniture'}]),/不属于/);
 const [job]=await f.generations.create(f.p.id,[{sourceAssetId:f.source.id,category:'furniture'}]);await f.generations.start(f.p.id);assert.equal((await settle(f.generations,f.p.id,job.id)).state,'FAILED');assert.equal(f.calls.upload,0);assert.equal(f.calls.submit,0);
 await assert.rejects(f.generations.start(other.id,[job.id]),/不属于/);
});

test('Lux3D uses verified parameters and blocks unsafe output downloads before transport',async()=>{
 let requests=0;
 const runtime=new Lux3DRuntime({callApi:async(endpoint,body)=>{assert.equal(endpoint,'/lux3d/v1/generate/img-to-3d/task/create');assert.equal(body.img,'https://example.com/item.jpg');assert.equal(body.version,'G1');assert.equal(body.faceCount,100000);return {ok:true,body:{c:'0',d:12345}};},request:async()=>{requests++;throw Error('unexpected transport');}});
 assert.equal(await runtime.submit('https://example.com/item.jpg'),'12345');
 for(const u of ['http://qhsmodel.kujiale.com/model.glb','https://127.0.0.1/model.glb','https://example.com/model.glb','https://qhsmodel.kujiale.com:8443/model.glb','https://qhsmodel.kujiale.com/image.png'])await assert.rejects(runtime.download(u),/地址/);
 assert.equal(requests,0);
 assert.equal(permittedRemote('https://tx-qhsmodel-1258830046.cos.ap-shanghai.myqcloud.com/lux3dPbrEmbedResult/e8bc29221b02484291df9d06c5d07f54/textured.glb?sign=PRIVATE'),true);
 assert.equal(permittedRemote('https://tx-qhsmodel-1258830046.cos.ap-shanghai.myqcloud.com/other/private.glb'),false);
 assert.equal(permittedRemote('https://unrelated.cos.ap-shanghai.myqcloud.com/lux3dPbrEmbedResult/e8bc29221b02484291df9d06c5d07f54/textured.glb'),false);
 assert.equal(permittedRemote('https://api.aholo3d.cn/lux3d/v1/generate/img-to-3d/task/create','POST'),true);assert.equal(permittedRemote('https://api.aholo3d.cn/lux3d/v1/generate/task/get?taskid=123'),true);
 assert.equal(permittedRemote('https://api.aholo3d.cn/lux3d/v1/generate/text-to-3d/task/create','POST'),false);
});

test('photo-plus-room HTTP flow stages objects while room is DRAFT and preserves origin guards',async t=>{
 const f=await fixture(t),server=createEditorServer(f.root,{}, {projects:f.projects,objectRuntime:f.runtime});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port,endpoint=base+'/api/projects/'+f.p.id+'/object-generations';
 const body=JSON.stringify({items:[{sourceAssetId:f.source.id,category:'furniture'}]});
 const foreign=await fetch(endpoint,{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body});assert.equal(foreign.status,403);
 const staged=await fetch(endpoint,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body});assert.equal(staged.status,200);assert.equal(f.calls.submit,0);const {jobs}=await staged.json();
 const start=await fetch(endpoint+'/start',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(start.status,202);
 // Both server and fixture managers share the same root and durable state.
 assert.equal((await settle(f.generations,f.p.id,jobs[0].id)).state,'READY');assert.equal(f.calls.submit,1);
 const second=await f.projects.create({});assert.equal((await fetch(base+'/api/projects/'+second.id+'/object-generations/'+jobs[0].id)).status,404);
});
