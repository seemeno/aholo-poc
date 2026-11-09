import {footprint} from './placement.mjs';
import {pointInside, floorPolygon} from './geometry.mjs';

export const BUILTIN_OBJECT='builtin_tv';
export function roomItemLibrary(assets=[],jobs=[]){
 const sources=new Set([...assets.filter(a=>a.kind==='glb').map(a=>a.sourceAssetId),...jobs.filter(j=>j.category!=='picture').map(j=>j.sourceAssetId)].filter(Boolean));
 const ready=new Map(jobs.filter(j=>j.state==='READY'&&j.resultAssetId).map(j=>[j.resultAssetId,j]));
 const items=new Map();
 for(const asset of assets){if(asset.kind!=='glb'&&(asset.kind!=='image'||sources.has(asset.id)))continue;const job=ready.get(asset.id);items.set(asset.id,{id:asset.id,name:job?.name??asset.name.replace(/\.[^.]+$/,''),kind:asset.kind,category:job?.category??asset.category??(asset.kind==='image'?'picture':'furniture'),sourceAssetId:asset.kind==='image'?asset.id:asset.sourceAssetId??job?.sourceAssetId});}
 for(const [id,job]of ready)if(!items.has(id))items.set(id,{id,name:job.name,kind:job.category==='picture'?'image':'glb',category:job.category,sourceAssetId:job.sourceAssetId});
 return [...items.values()];
}
export function randomUuidV4(cryptoApi=globalThis.crypto){
  if(typeof cryptoApi?.randomUUID==='function')return cryptoApi.randomUUID();
  if(typeof cryptoApi?.getRandomValues!=='function')throw Error('此浏览器无法安全生成对象 ID');
  const bytes=cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const idPattern=/^[A-Za-z0-9_-]{1,90}$/;
export function legacyObject(scene){
  return {id:'object_1',name:'电视柜',assetId:BUILTIN_OBJECT,assetKind:'glb',visible:true,
    pose:structuredClone(scene.pose),size:structuredClone(scene.size),mode:scene.mode,
    selectedWall:scene.selectedWall,gap:scene.gap,back:scene.back??'+Y',align:scene.align??true};
}
export function validateObjects(scene){
  if(scene.schemaVersion!==3){scene.objects=[legacyObject(scene)];scene.activeObjectId='object_1';}
  scene.objects??=[legacyObject(scene)];
  if(!Array.isArray(scene.objects)||scene.objects.length>40)throw Error('最多摆放 40 件物品');
  const ids=new Set();
  for(const o of scene.objects){
    if(!o||typeof o.id!=='string'||!idPattern.test(o.id)||ids.has(o.id)||typeof o.name!=='string'||!o.name.trim()||o.name.length>80||
      typeof o.assetId!=='string'||!(o.assetId===BUILTIN_OBJECT||/^[a-f0-9-]{36}$/.test(o.assetId))||!['glb','image'].includes(o.assetKind)||
      typeof o.visible!=='boolean'||!['x','y','z','yaw'].every(k=>Number.isFinite(o.pose?.[k]))||
      !['width','depth','height'].every(k=>Number.isFinite(o.size?.[k])&&o.size[k]>0&&o.size[k]<=1000)||
      !['free','floor','wall'].includes(o.mode)||!Number.isFinite(o.gap)||o.gap<0||!['-Y','+Y','-X','+X'].includes(o.back)||typeof o.align!=='boolean')throw Error('物品数据无效');
    if(o.measuredAxes!==undefined&&(!Array.isArray(o.measuredAxes)||new Set(o.measuredAxes).size!==o.measuredAxes.length||o.measuredAxes.some(k=>!['width','depth','height'].includes(k))))throw Error('物品尺寸来源无效');
    if(o.mode==='wall')o.mode='floor';
    o.selectedWall='';o.align=false;
    if(o.assetId===BUILTIN_OBJECT&&o.assetKind!=='glb')throw Error('内置物品类型无效');
    ids.add(o.id);
  }
  scene.activeObjectId??=scene.objects[0]?.id??null;
  if(scene.objects.length&&!ids.has(scene.activeObjectId))throw Error('当前物品不存在');
  if(!scene.objects.length)scene.activeObjectId=null;
  return scene;
}
// Oriented footprint SAT plus vertical intervals: newly added objects only.
export function objectsOverlap(a,b){
  if(!a.visible||!b.visible||a.pose.z+a.size.height<=b.pose.z+.001||b.pose.z+b.size.height<=a.pose.z+.001)return false;
  const ap=footprint(a.pose,a.size),bp=footprint(b.pose,b.size);
  for(const poly of [ap,bp])for(let i=0;i<4;i++){
    const p=poly[i],q=poly[(i+1)%4],n=[q[1]-p[1],p[0]-q[0]],aa=ap.map(v=>v[0]*n[0]+v[1]*n[1]),bb=bp.map(v=>v[0]*n[0]+v[1]*n[1]);
    if(Math.max(...aa)<=Math.min(...bb)+1e-8||Math.max(...bb)<=Math.min(...aa)+1e-8)return false;
  }
  return true;
}
export function placementCamera(object,structure,others=[],side=1,fov=65,aspect=1){
  const {pose:p,size:s}=object,target=[p.x,p.y,p.z+s.height*.55];
  const distance=Math.max(1.5,s.height/(2*Math.tan(fov*Math.PI/360)),s.width/(2*Math.tan(fov*Math.PI/360)*Math.max(.3,aspect)))*1.65+s.depth/2;
  const front=Math.atan2(-Math.cos(p.yaw),Math.sin(p.yaw));
  const candidates=[side*.35,0,side*.7,-side*.35,side*1.2,Math.PI].map(a=>{
    const angle=front+a,position=[p.x+Math.cos(angle)*distance,p.y+Math.sin(angle)*distance,Math.max(structure.floor.z+1.25,p.z+s.height*.7)];
    let penalty=pointInside(position,floorPolygon(structure.floor))?0:100;
    for(const o of others.filter(o=>o.id!==object.id&&o.visible))if(position[2]>=o.pose.z&&position[2]<=o.pose.z+o.size.height&&pointInside(position,footprint(o.pose,o.size)))penalty+=30;
    return {position,target,penalty};
  });
  return candidates.sort((a,b)=>a.penalty-b.penalty)[0];
}
