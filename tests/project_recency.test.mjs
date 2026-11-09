import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LocalProjects} from '../local_projects.mjs';
import {makeScene} from '../scene_state.mjs';
import {createEditorServer} from '../structure_server.mjs';

test('opening or editing an old space moves it first; polling never changes order or draft versions',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-recency-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-recency-'));await fs.rm(root,{recursive:true,force:true});});
 const projects=new LocalProjects(root),old=await projects.create({name:'old'}),newer=await projects.create({name:'newer'});
 for(const [p,date] of [[old,'2020-01-01T00:00:00.000Z'],[newer,'2021-01-01T00:00:00.000Z']]){p.createdAt=date;p.updatedAt=date;await fs.writeFile(path.join(projects.dir(p.id),'project.json'),JSON.stringify(p));}
 assert.equal((await projects.list())[0].id,newer.id);
 const server=createEditorServer(root,{}, {projects});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url='http://127.0.0.1:'+server.address().port;
 const version=(await projects.load(old.id)).updatedAt;
 const response=await fetch(url+'/api/projects/'+old.id+'/visit',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:'{}'});assert.equal(response.status,200);
 assert.equal((await projects.list())[0].id,old.id);assert.equal((await projects.load(old.id)).updatedAt,version);
 assert.deepEqual(await projects.list(),await projects.list());
 const structure=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url)));
 const p=await projects.load(newer.id);p.status='READY';p.worldId=structure.worldId;await projects.save(p);const scene=makeScene(structure);scene.projectId=p.id;await projects.scene(p.id,scene);
 assert.equal((await projects.list())[0].id,newer.id);
 await projects.remove(old.id);assert.equal((await fetch(url+'/api/projects/'+old.id+'/visit',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:'{}'})).status,404);
});
