import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEditorServer} from '../structure_server.mjs';
import {LocalProjects} from '../local_projects.mjs';
import {auditedFetch,permittedRemote} from '../network_audit.mjs';

test('retired cloud API and UI cannot submit work, while local effect history remains available',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-flux-only-')),projects=new LocalProjects(root);
 const p=await projects.create({name:'local Flux only'});let keyCalls=0;projects.key=async()=>{keyCalls++;throw Error('Cloud key must not be requested');};
 const server=createEditorServer(root,{}, {projects});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-flux-only-'));await fs.rm(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 for(const method of ['GET','POST','HEAD'])assert.equal((await fetch(base+'/api/cloud-renders',{method,headers:{Origin:base,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify({projectId:p.id})}:{})})).status,404);
 for(const url of ['/api/cloud-renders/'+ 'a'.repeat(64),'/rendercloud_ui.mjs','/output/04_ai_cloud_assets/cloud_context.json'])assert.equal((await fetch(base+url)).status,404);
 assert.equal(keyCalls,0);const history=await fetch(base+'/api/effect-renders?project='+p.id+'&resume=0');assert.equal(history.status,200);assert.deepEqual(await history.json(),{latest:null});
});

test('cloud render and import egress is blocked before transport; local Flux endpoints stay allowed',async()=>{
 let calls=0;const request=auditedFetch(async()=>{calls++;return {status:200};},async()=>{});
 for(const [route,method]of [['jobs','POST'],['jobs','GET'],['mesh-upload-process/task/create','POST'],['mesh-upload-process/task/get','GET'],['streams','POST']]){
  const url='https://api.aholo3d.cn/rendercloud/v1/'+route;assert.equal(permittedRemote(url,method),false);await assert.rejects(request(url,{method}),/禁止/);
 }
 assert.equal(calls,0);assert.equal(permittedRemote('http://127.0.0.1:8190/prompt','POST'),true);assert.equal(permittedRemote('http://127.0.0.1:8190/history','GET'),true);
});
