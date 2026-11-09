import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createEditorServer} from '../structure_server.mjs';
import {LocalProjects} from '../local_projects.mjs';

test('production UI and real reference photos work after LAN pairing and retain access guards',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-ui-integration-'));
 const server=createEditorServer(root,{lan:true,hosts:['192.168.50.10'],pairCode:'123456'});
 let listening=false;
 try{
  const consumerFiles=['consumer.css','consumer_editor.mjs','try_on.mjs','comparison_view.mjs','simple_gesture.mjs','viewer_activity.mjs','deployment_ui.mjs','personal_effect_ui.mjs','uniform_scale.mjs','button_hints.mjs','app_orientation.mjs','effect_history.mjs','editor_persistence.mjs','editor_viewport.mjs','editor_ui.mjs','editor_capture.mjs'];
  for(const file of ['local_demo.html','app.css','editor.css','structure_editor.html',...consumerFiles])await fs.copyFile(new URL('../'+file,import.meta.url),path.join(root,file));
  const manager=new LocalProjects(root),p=await manager.create({name:'真实项目 <test>',mode:'generation'});
  const file='11111111-1111-4111-8111-111111111111.png',photo=Buffer.from('test-reference-image');
  p.uploads=[{id:file.slice(0,-4),file,name:'房间.png',kind:'image',size:photo.length,check:{warnings:[]}}];await manager.save(p);await fs.writeFile(path.join(manager.dir(p.id),'inputs',file),photo);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));listening=true;
  const port=server.address().port,base=`http://127.0.0.1:${port}`,host=`192.168.50.10:${port}`,origin='http://'+host;
  const request=(url,options={})=>new Promise((resolve,reject)=>{const req=http.request(base+url,{method:options.method??'GET',headers:{Host:host,...options.headers}},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{const bytes=Buffer.concat(parts);resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>bytes.toString(),arrayBuffer:async()=>bytes});});});req.on('error',reject);req.end(options.body);});
  const ref=`/api/projects/${p.id}/reference`;
  assert.equal((await request(ref)).status,401);
  assert.equal((await request('/app.css')).status,303);
  const pair=await request('/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'code=123456&next=%2F'});
  assert.equal(pair.status,303);const cookie=pair.headers.get('set-cookie').split(';')[0];
  const get=(url,extra={})=>request(url,{...extra,headers:{Cookie:cookie,...extra.headers}});
  const home=await get('/');assert.equal(home.status,200);assert.match(await home.text(),/data-ui-version="integrated-v1"/);
  for(const resource of ['/app.css','/editor.css']){const r=await get(resource);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/text\/css/);assert.equal(r.headers.get('cache-control'),'no-store');}
  const editor=await get('/structure_editor.html?project='+p.id);assert.equal(editor.status,200);assert.match(await editor.text(),/id="editorBack"/);
  for(const file of consumerFiles){const r=await get('/'+file);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),file.endsWith('.css')?/text\/css/:/javascript/);}
  const image=await get(ref);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),photo);
  const head=await get(ref,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await get(ref+'/other')).status,404);
  assert.equal((await get('/local-data/projects/'+p.id+'/project.json')).status,404);
  assert.equal((await get('/api/projects',{method:'POST',headers:{Origin:'null','Content-Type':'application/json'},body:'{}'})).status,403);
  // A generated project without an uploaded image can still show its existing cover.
  p.uploads=[];await manager.save(p);await fs.writeFile(path.join(manager.dir(p.id),'cover.jpg'),photo);assert.equal((await get(ref)).headers.get('content-type'),'image/jpeg');
 }finally{
  if(listening)await new Promise(r=>server.close(r));
  const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('aholo-ui-integration-'));await fs.rm(target,{recursive:true,force:true});
 }
});
