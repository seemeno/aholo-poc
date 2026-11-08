import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {LocalProjects} from '../local_projects.mjs';
import {createEditorServer} from '../structure_server.mjs';

async function setup(t,lan=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-delete-test-')),projects=new LocalProjects(root);
 const p=await projects.create({name:'我的空间 <test>',mode:'ply'}),other=await projects.create({name:'保留的空间'});
 const server=createEditorServer(root,lan?{lan:true,hosts:['192.168.50.20'],pairCode:'123456'}:{},{projects});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,base=`http://127.0.0.1:${port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-delete-test-'));await fs.rm(root,{recursive:true,force:true});});
 const request=(url,method='GET',body,headers={})=>fetch(base+url,{method,headers:{Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {root,projects,p,other,server,base,port,request,endpoint:'/api/projects/'+p.id};
}

test('delete hides a space and its data routes; restore survives restart and retains all project bytes',async t=>{
 const f=await setup(t),dir=f.projects.dir(f.p.id),files={'inputs/room.jpg':'source photo','objects/model.glb':'model bytes','placement.json':'{"saved":"placement"}','cover.jpg':'cover','room.ply':'room data'};
 for(const [name,bytes]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),bytes);}
 const effectId='a'.repeat(64),cloudId='b'.repeat(64);
 for(const [store,id]of [['effect-renders',effectId],['rendercloud',cloudId]]){const target=path.join(f.root,'local-data',store,id);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'job.json'),JSON.stringify({id,projectId:f.p.id,state:'READY',references:[],scene:{camera:{resolution:[640,480]}}}));await fs.writeFile(path.join(target,'preview.png'),'preview');}
 assert.equal((await f.request(f.endpoint,'DELETE')).status,200);
 assert.deepEqual((await f.request('/api/projects').then(r=>r.json())).map(p=>p.id),[f.other.id]);
 const removed=await f.request('/api/deleted-projects').then(r=>r.json());assert.equal(removed[0].id,f.p.id);assert.ok(removed[0].deletedAt);
 for(const url of [f.endpoint,f.endpoint+'/reference',f.endpoint+'/assets/room.ply',f.endpoint+'/scene',f.endpoint+'/objects',f.endpoint+'/object-generations',`/api/effect-renders/${effectId}/preview`,`/api/cloud-renders/${cloudId}`,`/api/effect-renders?project=${f.p.id}`])assert.equal((await f.request(url)).status,404,url);
 assert.equal((await f.request(f.endpoint+'/object-generations','POST',{items:[]})).status,404);
 const fresh=new LocalProjects(f.root);assert.equal((await fresh.deleted()).length,1);await assert.rejects(fresh.scene(f.p.id),{code:'ENOENT'});
 assert.equal((await f.request('/api/deleted-projects/'+f.p.id+'/restore','POST',{})).status,200);
 assert.equal((await fresh.deleted()).length,0);assert.equal((await fresh.load(f.p.id)).name,f.p.name);
 assert.equal((await f.request(f.endpoint+'/reference')).status,200);
 assert.equal((await f.request(`/api/effect-renders/${effectId}/preview`)).status,200);
 for(const [name,bytes]of Object.entries(files))assert.equal(await fs.readFile(path.join(dir,name),'utf8'),bytes);
 assert.equal((await f.projects.load(f.other.id)).name,'保留的空间');
 assert.throws(()=>fresh.deletedFile('../outside'),/ID/);
});

test('active room, object and render jobs prevent deletion without launching or cancelling work',async t=>{
 const f=await setup(t),jobId='c'.repeat(64),now=new Date().toISOString();
 f.p.status='WAITING';await f.projects.save(f.p);assert.equal((await f.request(f.endpoint,'DELETE')).status,409);f.p.status='READY';await f.projects.save(f.p);
 const objectDir=path.join(f.projects.dir(f.p.id),'object-generations',jobId);await fs.mkdir(objectDir,{recursive:true});
 const job={id:jobId,projectId:f.p.id,state:'RUNNING',createdAt:now};await fs.writeFile(path.join(objectDir,'job.ndjson'),JSON.stringify(job)+'\n');assert.equal((await f.request(f.endpoint,'DELETE')).status,409);
 // Completed copies may still identify their source project. They must be
 // removable without resuming or modifying the original job.
 await fs.appendFile(path.join(objectDir,'job.ndjson'),JSON.stringify({...job,state:'READY',projectId:f.other.id})+'\n');
 for(const store of ['effect-renders','rendercloud']){
  const target=path.join(f.root,'local-data',store,jobId);await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'job.json'),JSON.stringify({...job,state:store==='effect-renders'?'PREPARING':'WAITING_IMPORT'}));assert.equal((await f.request(f.endpoint,'DELETE')).status,409);
  await fs.writeFile(path.join(target,'job.json'),JSON.stringify({...job,state:'FAILED'}));
 }
 assert.equal((await f.request(f.endpoint,'DELETE')).status,200);
});

test('a pending upload excludes deletion, and an admitted delete excludes concurrent saves',async t=>{
 const f=await setup(t);let entered,release;let started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.projects.upload=async()=>{entered();await gate;return {ok:true};};
 const upload=fetch(f.base+f.endpoint+'/uploads?name=test.jpg',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/octet-stream'},body:'test'});await started;
 assert.equal((await f.request(f.endpoint,'DELETE')).status,409);release();assert.equal((await upload).status,200);
 const remove=f.projects.remove.bind(f.projects);started=new Promise(r=>entered=r);gate=new Promise(r=>release=r);f.projects.remove=async id=>{entered();await gate;return remove(id);};
 const deleting=f.request(f.endpoint,'DELETE');await started;assert.equal((await f.request(f.endpoint+'/scene','POST',{})).status,409);release();assert.equal((await deleting).status,200);
});

test('phone deletion and restoration require pairing and a valid same-origin request',async t=>{
 const f=await setup(t,true),host=`192.168.50.20:${f.port}`,origin='http://'+host;
 const request=(url,method='GET',body,headers={})=>new Promise((resolve,reject)=>{const req=http.request(f.base+url,{method,headers:{Host:host,Origin:origin,...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});
 assert.equal((await request(f.endpoint,'DELETE')).status,401);assert.equal((await request('/api/deleted-projects')).status,401);
 const pair=await request('/pair','POST','code=123456',{'Content-Type':'application/x-www-form-urlencoded'}),cookie=pair.headers['set-cookie'][0].split(';')[0];
 assert.equal((await request(f.endpoint,'DELETE',undefined,{Cookie:cookie,Origin:'null'})).status,403);
 assert.equal((await request(f.endpoint,'DELETE',undefined,{Cookie:cookie,Origin:'https://other.example'})).status,403);
 assert.equal((await request(f.endpoint,'DELETE',undefined,{Cookie:cookie})).status,200);
 assert.equal((await request('/api/deleted-projects/'+f.p.id+'/restore','POST','{}',{'Content-Type':'application/json'})).status,401);
 assert.equal((await request('/api/deleted-projects/'+f.p.id+'/restore','POST','{}',{Cookie:cookie,'Content-Type':'application/json'})).status,200);
 assert.equal((await f.projects.load(f.p.id)).name,f.p.name);
});
