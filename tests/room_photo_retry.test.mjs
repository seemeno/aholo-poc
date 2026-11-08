import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Readable} from 'node:stream';
import {LocalProjects} from '../local_projects.mjs';
import {createEditorServer} from '../structure_server.mjs';

const photo=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(40)]);
const input=bytes=>Object.assign(Readable.from([bytes]),{headers:{'content-length':String(bytes.length)}});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-room-retry-')),projects=new LocalProjects(root);
 projects.py=async()=>({kind:'image',width:1200,height:800,warnings:[]});projects.key=async()=>true;
 const p=await projects.create({name:'保留这个客厅',prompt:'保留布局',mode:'generation'});
 await projects.upload(p.id,input(photo),'old.png');const old=await projects.load(p.id);
 Object.assign(old,{status:'FAILED',worldId:'OLD-WORLD',remoteStatus:'FAILED',submission:{sha256:'old-submission'},error:'Remote generation failed'});await projects.save(old);
 const dir=projects.dir(p.id);await fs.mkdir(path.join(dir,'objects'));await fs.writeFile(path.join(dir,'objects','keep.glb'),'existing furniture');
 await fs.writeFile(path.join(dir,'world_latest.json'),'{"status":"FAILED"}');
 t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-room-retry-'));await fs.rm(root,{recursive:true,force:true});});
 return {root,projects,old,dir};
}
const replace=(f,bytes=photo,version=f.old.updatedAt)=>f.projects.upload(f.old.id,input(bytes),'new.png',{replaceRoom:true,version});

test('replacement retains project and furniture, archives the failed attempt, and submits only after explicit start',async t=>{
 const f=await fixture(t);let submits=0,transfers=0;
 f.projects.transfer=async()=>{transfers++;return 'https://holo-cos.aholo3d.cn/new.png';};
 f.projects.callApi=async(endpoint,body)=>{if(body){submits++;assert.equal(endpoint,'/world/v1/generations');assert.equal(body.resources.length,1);return {http:200,ok:true,body:{worldId:'NEW-WORLD'}};}return {http:200,ok:true,body:{status:'FAILED'}};};
 const result=await replace(f);assert.equal(result.project.id,f.old.id);assert.equal(result.project.name,f.old.name);assert.equal((await f.projects.list()).length,1);
 const p=await f.projects.load(f.old.id);assert.equal(p.status,'DRAFT');assert.equal(p.worldId,undefined);assert.equal(p.submission,undefined);assert.equal(p.remoteStatus,undefined);assert.equal(p.uploads.length,1);assert.notEqual(p.uploads[0].id,f.old.uploads[0].id);assert.equal(p.prompt,f.old.prompt);
 assert.equal(transfers,0);assert.equal(submits,0);assert.equal(p.sceneAttempts.length,1);assert.equal(p.sceneAttempts[0].worldId,'OLD-WORLD');
 const archive=path.join(f.dir,'scene-attempts',p.sceneAttempts[0].id);
 assert.equal(JSON.parse(await fs.readFile(path.join(archive,'project.json'),'utf8')).submission.sha256,'old-submission');assert.equal(await fs.readFile(path.join(archive,'world_latest.json'),'utf8'),'{"status":"FAILED"}');
 assert.deepEqual(await fs.readFile(path.join(f.dir,'inputs',f.old.uploads[0].file)),photo);assert.equal(await fs.readFile(path.join(f.dir,'objects','keep.glb'),'utf8'),'existing furniture');
 const fresh=new LocalProjects(f.root);assert.equal((await fresh.load(p.id)).sceneAttempts[0].worldId,'OLD-WORLD');
 await f.projects.start(p.id);for(let i=0;i<100&&f.projects.busy.has(p.id);i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.projects.busy.has(p.id),false);assert.equal(submits,1);assert.equal(transfers,1);assert.equal((await f.projects.load(p.id)).worldId,'NEW-WORLD');
 await f.projects.start(p.id);for(let i=0;i<100&&f.projects.busy.has(p.id);i++)await new Promise(r=>setTimeout(r,5));assert.equal(submits,1);
});

test('invalid or undecodable replacements and failed metadata commits preserve the previous room',async t=>{
 const f=await fixture(t),target=path.join(f.dir,'project.json'),before=await fs.readFile(target),oldFiles=await fs.readdir(path.join(f.dir,'inputs'));
 await assert.rejects(replace(f,Buffer.from('not an actual PNG file')),/扩展名/);
 f.projects.py=async()=>{throw Error('decode failed');};await assert.rejects(replace(f),/decode failed/);
 f.projects.py=async()=>({kind:'image',width:1200,height:800,warnings:[]});const save=f.projects.save.bind(f.projects);f.projects.save=async p=>{if(p.status==='DRAFT')throw Error('disk commit failed');return save(p);};
 await assert.rejects(replace(f),/disk commit failed/);assert.deepEqual(await fs.readFile(target),before);assert.deepEqual(await fs.readdir(path.join(f.dir,'inputs')),oldFiles);assert.equal(await fs.readFile(path.join(f.dir,'world_latest.json'),'utf8'),'{"status":"FAILED"}');assert.equal(f.projects.uploading.size,0);
});

test('replacement refuses active, ambiguous, successful, foreign-mode and stale requests',async t=>{
 const f=await fixture(t);
 for(const status of ['WAITING','SUBMIT_UNKNOWN','PAUSED','READY']){const p=await f.projects.load(f.old.id);p.status=status;await f.projects.save(p);await assert.rejects(replace(f),{statusCode:409});}
 const p=await f.projects.load(f.old.id);p.status='FAILED';p.mode='reconstruction';await f.projects.save(p);await assert.rejects(replace(f),{statusCode:409});
 p.mode='generation';await f.projects.save(p);await assert.rejects(replace(f,photo,'stale-version'),{statusCode:409});f.old.updatedAt=p.updatedAt;
 f.projects.busy.add(p.id);await assert.rejects(replace(f),{statusCode:409});f.projects.busy.delete(p.id);
 await replace(f);await assert.rejects(replace(f),{statusCode:409});
});

test('phone replacement keeps pairing and origin guards and excludes concurrent project changes',async t=>{
 const f=await fixture(t),server=createEditorServer(f.root,{lan:true,hosts:['192.168.50.20'],pairCode:'123456'},{projects:f.projects});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,origin=`http://192.168.50.20:${port}`,endpoint='/api/projects/'+f.old.id+'/room-photo?name=new.png&version='+encodeURIComponent(f.old.updatedAt);
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const request=(url,{body,headers={}}={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:url,method:body===undefined?'GET':'POST',headers:{Host:`192.168.50.20:${port}`,Origin:origin,...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});
 assert.equal((await request(endpoint,{body:photo,headers:{'Content-Type':'application/octet-stream'}})).status,401);
 const pair=await request('/pair',{body:'code=123456',headers:{'Content-Type':'application/x-www-form-urlencoded'}}),cookie=pair.headers['set-cookie'][0].split(';')[0],headers={Cookie:cookie,'Content-Type':'application/octet-stream'};
 assert.equal((await request(endpoint,{body:photo,headers:{...headers,Origin:'null'}})).status,403);
 let entered,release;const gate=new Promise(r=>release=r),checking=new Promise(r=>entered=r);f.projects.py=async()=>{entered();await gate;return {kind:'image',width:1200,height:800,warnings:[]};};
 const replacing=request(endpoint,{body:photo,headers});await checking;
 assert.equal((await request('/api/projects/'+f.old.id+'/start',{body:'{}',headers:{Cookie:cookie,'Content-Type':'application/json'}})).status,409);
 release();const result=await replacing;assert.equal(result.status,200);assert.equal(JSON.parse(result.text).project.id,f.old.id);
 assert.equal((await request(endpoint,{body:photo,headers})).status,409);
});
