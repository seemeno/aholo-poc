import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalProjects} from '../local_projects.mjs';
import {LocalObjectAssets} from '../local_object_assets.mjs';
test('real pre-generated showcase opens without inference, initializes once and preserves saved or cleared plans',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-showcase-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(data)),path.resolve(os.tmpdir()));assert.ok(path.basename(data).startsWith('aholo-showcase-'));await fs.rm(data,{recursive:true,force:true});});
 const projects=new LocalProjects(path.resolve('.'),{dataDir:data,callApi:async()=>{throw Error('No cloud generation');}});projects.py=async()=>{throw Error('No extraction needed');};
 const [a,b]=await Promise.all([projects.example(),projects.example()]);assert.equal(a.id,b.id);assert.equal(a.status,'READY');assert.ok(a.showcaseVersion);const scene=await projects.scene(a.id);assert.equal(scene.objects.length,1);assert.notEqual(scene.objects[0].assetId,'builtin_tv');assert.equal((await new LocalObjectAssets(projects).list(a.id)).length,2);assert.ok((await fs.stat(path.join(projects.dir(a.id),'room.ply'))).size>1000000);
 scene.objects=[];scene.activeObjectId=null;await projects.scene(a.id,{...scene,expectedSavedAt:scene.savedAt});assert.equal((await projects.example()).id,a.id);assert.equal((await projects.scene(a.id)).objects.length,0);
 await projects.remove(a.id);const next=await projects.example();assert.notEqual(next.id,a.id);assert.equal((await projects.scene(next.id)).objects.length,1);
});
