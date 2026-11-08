import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeScene,validateScene} from '../scene_state.mjs';
import {objectsOverlap,placementCamera,randomUuidV4} from '../object_state.mjs';
import {inspectObject,LocalObjectAssets} from '../local_object_assets.mjs';
import {snapWall} from '../placement.mjs';
import {LocalProjects} from '../local_projects.mjs';
import {createEditorServer} from '../structure_server.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
const structure=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url),'utf8'));
const version3=()=>{const v=makeScene(structuredClone(structure));v.schemaVersion=3;return v;};

test('old saves migrate from their final top-level pose; new multi-object saves round trip independently',()=>{
  const old=makeScene(structuredClone(structure));old.pose.x=2;assert.equal(validateScene(old).objects[0].pose.x,2);
  const v=version3(),other=structuredClone(v.objects[0]);other.id='second';other.pose.x=3;other.visible=false;v.objects.push(other);v.activeObjectId='second';
  const restored=validateScene(JSON.parse(JSON.stringify(v)));assert.equal(restored.objects.length,2);assert.equal(restored.objects[1].visible,false);assert.equal(restored.objects[0].pose.x,0);
  assert.throws(()=>validateScene({...v,objects:[v.objects[0],v.objects[0]]}),/无效/);
  assert.throws(()=>validateScene({...v,activeObjectId:'missing'}),/不存在/);
  assert.throws(()=>validateScene({...v,rememberedCamera:{rows:[],verticalFov:65}}),/相机/);
});
test('new-object collision checks rotated footprints, height separation and hidden objects',()=>{
  const a=version3().objects[0],b=structuredClone(a);b.id='b';b.pose.yaw=.7;assert.equal(objectsOverlap(a,b),true);b.pose.x=8;assert.equal(objectsOverlap(a,b),false);b.pose.x=0;b.pose.z=3;assert.equal(objectsOverlap(a,b),false);b.pose.z=0;b.visible=false;assert.equal(objectsOverlap(a,b),false);
});
test('wall art keeps its requested bottom height and rejects doors at that height',()=>{
  const f={z:0,bounds:[[-5,-5],[5,5]]},w={id:'wall',a:[-4,-3,0],b:[4,-3,0],normal:[0,1,0],height:3},p={x:0,y:0,z:1.2,yaw:0},s={width:1,depth:.03,height:.8};
  const snapped=snapWall(p,s,f,w,{back:'+Y',bottomZ:1.2});assert.equal(snapped.ok,true);assert.equal(snapped.pose.z,1.2);
  assert.equal(snapWall(p,s,f,w,{back:'+Y',bottomZ:2.5}).ok,false);
  assert.equal(snapWall(p,s,f,w,{back:'+Y',bottomZ:1.2,openings:[{wallId:'wall',center:[0,-3,1.2],width:1,height:2.4}]}).ok,false);
});
test('camera framing uses object dimensions and ignores untrusted candidate walls',()=>{
  const o=version3().objects[0];o.pose={x:0,y:0,z:0,yaw:0};const room={floor:{z:0,bounds:[[-10,-10],[10,10]]},walls:[]};
  const a=placementCamera(o,room,[],1,65,1.5),b=placementCamera({...o,size:{width:8,depth:.4,height:3}},room,[],1,65,1.5);
  assert.ok(Math.hypot(...b.position.slice(0,2))>Math.hypot(...a.position.slice(0,2)));assert.equal(a.penalty,0);assert.ok(a.position.every(Number.isFinite));
  const noisy={...room,walls:[{id:'false-wall',a:[-10,-.3,0],b:[10,-.3,0],normal:[0,1,0],height:10}]};assert.deepEqual(placementCamera(o,noisy,[],1,65,1.5),a);
});
test('multi-object wall saves retain all poses while switching to floor-only placement',()=>{
  const v=version3();v.mode='wall';v.selectedWall='removed-wall';v.pose={x:1,y:2,z:1.4,yaw:.7};
  Object.assign(v.objects[0],{mode:'wall',selectedWall:'another-removed-wall',pose:{x:-1,y:1,z:1.2,yaw:-.3},align:true});
  const free=structuredClone(v.objects[0]);free.id='free-object';free.mode='free';free.pose.z=2;v.objects.push(free);
  const poses=v.objects.map(o=>structuredClone(o.pose)),restored=validateScene(JSON.parse(JSON.stringify(v)));
  assert.deepEqual(restored.objects.map(o=>o.pose),poses);assert.equal(restored.pose.z,1.4);assert.equal(restored.mode,'floor');assert.equal(restored.objects[0].mode,'floor');assert.equal(restored.objects[1].mode,'free');assert.ok(restored.objects.every(o=>o.selectedWall===''&&o.align===false));
  assert.deepEqual(validateScene(JSON.parse(JSON.stringify(restored))),restored);
});
test('object IDs remain UUID v4 when insecure LAN contexts lack randomUUID',()=>{
  let randomCalls=0;
  const cryptoWithoutRandomUUID={getRandomValues(bytes){randomCalls++;bytes.fill(0);return bytes;}};
  const id=randomUuidV4(cryptoWithoutRandomUUID);
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(randomCalls,1);
});
test('real self-contained GLB is accepted; remote image references and malformed files rejected',async()=>{
  const real=await fs.readFile(new URL('./fixtures/cabinet.glb',import.meta.url));assert.equal(inspectObject(real,'cabinet.glb').kind,'glb');
  const gltf={asset:{version:'2.0'},meshes:[{}],images:[{uri:'https://other.example/texture.png'}]},json=Buffer.from(JSON.stringify(gltf).padEnd(Math.ceil(JSON.stringify(gltf).length/4)*4,' ')),bytes=Buffer.alloc(20+json.length);bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
  assert.throws(()=>inspectObject(bytes,'remote.glb'),/外部/);assert.throws(()=>inspectObject(Buffer.alloc(30),'broken.glb'),/GLB/);assert.throws(()=>inspectObject(real,'test.svg'),/支持/);
});
test('local object upload, deduplication, persistence, project isolation and origin checks via HTTP',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-objects-')),m=new LocalProjects(dir),server=createEditorServer(dir);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  try{
    const p=await m.create({mode:'ply'});Object.assign(p,{status:'READY',worldId:structure.worldId});await m.save(p);
    const bytes=await fs.readFile(new URL('./fixtures/cabinet.glb',import.meta.url)),endpoint=origin+'/api/projects/'+p.id+'/objects';
    const upload=async(originHeader=origin)=>fetch(endpoint+'?name=custom.glb',{method:'POST',headers:{Origin:originHeader,'Content-Type':'application/octet-stream'},body:bytes});
    assert.equal((await upload('https://other.example')).status,403);const response=await upload();assert.equal(response.status,200);const a=await response.json();assert.equal(a.kind,'glb');assert.equal((await(await upload()).json()).id,a.id);
    assert.equal((await fetch(endpoint).then(r=>r.json())).length,1);const downloaded=Buffer.from(await(await fetch(endpoint+'/'+a.id)).arrayBuffer());assert.deepEqual(downloaded,bytes);
    const v=version3();v.projectId=p.id;v.objects[0].assetId=a.id;await m.scene(p.id,v);assert.equal((await m.scene(p.id)).objects[0].assetId,a.id);
    const second=await m.create({mode:'ply'});Object.assign(second,{status:'READY',worldId:structure.worldId});await m.save(second);await assert.rejects(new LocalObjectAssets(m).validateReferences(second.id,v),/不属于/);
    assert.equal((await fetch(origin+'/api/projects/'+second.id+'/objects/'+a.id)).status,400);
  }finally{await new Promise(r=>server.close(r));if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('aholo-objects-'))throw Error('Unsafe test cleanup');await fs.rm(dir,{recursive:true,force:true});}
});
