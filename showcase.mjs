import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync,brotliDecompressSync} from 'node:zlib';
import {LocalObjectAssets} from './local_object_assets.mjs';
import {makeScene} from './scene_state.mjs';
import {structureGlb} from './structure_mesh.mjs';
import {findInitialPlacement} from './try_on.mjs';
import {placementCamera} from './object_state.mjs';
import {PerspectiveCamera} from 'three';
const openings=new Map();
export async function showcaseAvailable(root){try{await fs.access(path.join(root,'assets/showcase/manifest.json'));return true;}catch{return false;}}
export async function openShowcase(projects){
 if(openings.has(projects.base))return openings.get(projects.base);
 const promise=(async()=>{
  const base=path.join(projects.root,'assets/showcase'),manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
  const existing=(await projects.list()).find(p=>p.showcaseVersion===manifest.version&&p.status==='READY');if(existing)return existing;
  const read=async name=>{const meta=manifest.files[name];if(!meta||meta.file!==name+(meta.encoding==='brotli'?'.br':'.gz')||meta.bytes>40*1024**2)throw Error('体验素材清单无效');const unpack=meta.encoding==='brotli'?brotliDecompressSync:gunzipSync;const bytes=unpack(await fs.readFile(path.join(base,meta.file)),{maxOutputLength:40*1024**2});if(bytes.length!==meta.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('体验素材不完整，请重新部署示例包');return bytes;};
  const structure=JSON.parse(await read('structure.json'));const p=await projects.create({name:manifest.name,mode:'ply'});
  try{
   p.worldId=manifest.worldId;p.showcaseVersion=manifest.version;p.upAxis='Z';p.provenance=manifest.source;p.status='EXTRACTING';p.message='正在准备预生成体验素材，不会发起生成';
   for(const name of ['room.ply','point_preview.json','structure.json'])await fs.writeFile(path.join(projects.dir(p.id),name),await read(name));
   await fs.writeFile(path.join(projects.dir(p.id),'structure.glb'),structureGlb(structure));await projects.save(p);
   const assets=new LocalObjectAssets(projects),photo=await assets.store(p.id,await read('furniture_reference.png'),'示例柜子.png');
   const furniture=await assets.store(p.id,await read('furniture.glb'),'示例柜子.glb',{sourceAssetId:photo.id,category:'furniture'});
   const pose=findInitialPlacement(structure.floor,manifest.size);if(!pose)throw Error('示例物品没有合法位置');
   const scene=makeScene(structure);scene.schemaVersion=3;scene.projectId=p.id;scene.objects=[{id:'showcase_cabinet',name:'示例柜子',assetId:furniture.id,assetKind:'glb',visible:true,pose,size:manifest.size,mode:'floor',gap:.02,back:'+Y',align:false,measuredAxes:[],sizeBasis:'UNMEASURED_DEFAULT_PROPORTIONS'}];scene.activeObjectId='showcase_cabinet';
   const framing=placementCamera(scene.objects[0],structure,[],1,65,16/9),camera=new PerspectiveCamera(65,16/9);camera.up.set(0,0,1);camera.position.fromArray(framing.position);camera.lookAt(...framing.target);camera.updateMatrixWorld();const matrix=camera.matrixWorld.toArray();for(const i of [12,13,14])matrix[i]*=1000;scene.camera={rows:Array.from({length:4},(_,i)=>matrix.slice(i*4,i*4+4)),verticalFov:65,resolution:[1024,576]};
   await projects.scene(p.id,{...scene,expectedSavedAt:null});const ready=await projects.load(p.id);ready.status='READY';ready.message='预生成体验空间 · 无需上传或等待生成';await projects.save(ready);return projects.public(ready);
  }catch(e){p.status='FAILED';p.error='体验素材准备未完成，请重试';await projects.save(p);throw e;}
 })().finally(()=>openings.delete(projects.base));openings.set(projects.base,promise);return promise;
}
