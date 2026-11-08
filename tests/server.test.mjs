import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEditorServer} from '../structure_server.mjs';
import {makeScene} from '../scene_state.mjs';
test('loopback save/load, previous revision backup, validation and origin guards',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-server-test-'));
 await fs.copyFile(new URL('../object_root_ensurer.mjs',import.meta.url),path.join(root,'object_root_ensurer.mjs'));
 await fs.copyFile(new URL('../restore_gate.mjs',import.meta.url),path.join(root,'restore_gate.mjs'));
 const server=createEditorServer(root);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/api/scene';
 try{
  const scene=makeScene(JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url),'utf8')));
  const ensurer=await fetch(origin+'/object_root_ensurer.mjs');assert.equal(ensurer.status,200);assert.match(ensurer.headers.get('content-type'),/javascript/);assert.match(await ensurer.text(),/createObjectRootEnsurer/);
  const restoreGate=await fetch(origin+'/restore_gate.mjs');assert.equal(restoreGate.status,200);assert.match(restoreGate.headers.get('content-type'),/javascript/);assert.match(await restoreGate.text(),/restoreWhenReady/);
  const missing=await fetch(url);assert.equal(missing.status,404);assert.equal(missing.headers.get('content-security-policy'),"connect-src 'self' blob:");
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(scene)})).status,403);
  const save=async v=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(v)});
  assert.equal((await save({...scene,size:{}})).status,400);
  scene.pose={x:.3,y:3,z:.12,yaw:1.23};assert.equal((await save(scene)).status,200);
  const restored=await fetch(url).then(r=>r.json());assert.deepEqual(restored.pose,scene.pose);assert.equal(restored.assets.worldId,'3FO4K4RIGVTB');assert.equal(restored.structure.openings.length,4);
  scene.pose.y=3.4;assert.equal((await save(scene)).status,200);assert.equal(JSON.parse(await fs.readFile(path.join(root,'scene/user_placement.json.bak'),'utf8')).pose.y,3);
  const glb=await fs.readFile(path.join(root,'scene/user_structure.glb'));assert.equal(glb.toString('ascii',0,4),'glTF');const doc=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());assert.equal(doc.meshes.length,1);assert.equal(doc.extras.placementPolicy,'floor-only');
  scene.mode='wall';scene.selectedWall='obsolete-wall';assert.equal((await save(scene)).status,200);const migrated=await fetch(url).then(r=>r.json());assert.equal(migrated.mode,'floor');assert.equal(migrated.selectedWall,'');assert.deepEqual(migrated.pose,scene.pose);
  assert.equal((await fetch(origin+'/output/task-ledger.json')).status,404);
 }finally{
  await new Promise(r=>server.close(r));
  for(const f of ['user_placement.json','user_placement.json.bak','user_structure.glb','user_placement.json.tmp'])try{await fs.unlink(path.join(root,'scene',f));}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await fs.rmdir(path.join(root,'scene'));}catch(e){if(e.code!=='ENOENT')throw e;}await fs.unlink(path.join(root,'object_root_ensurer.mjs'));await fs.unlink(path.join(root,'restore_gate.mjs'));await fs.rmdir(root);
 }
});
