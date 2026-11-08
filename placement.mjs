// Z-up, metres. Furniture origin is its bottom centre; local +Y is front.
import {floorPolygon,pointInside,wallFrame,openingRect} from './geometry.mjs';
export function footprint(pose, size) {
  const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>[
    pose.x+c*a*size.width/2-s*b*size.depth/2,
    pose.y+s*a*size.width/2+c*b*size.depth/2]);
}
export function floorContains(pose,size,floor) {
  const poly=floorPolygon(floor),corners=footprint(pose,size);
  if(!corners.every(p=>pointInside(p,poly)))return false;
  // Concave boundaries can cross the footprint even when all corners are inside.
  const cr=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<4;i++)for(let j=0;j<poly.length;j++){const a=corners[i],b=corners[(i+1)%4],c=poly[j],d=poly[(j+1)%poly.length];if(cr(a,b,c)*cr(a,b,d)<-1e-12&&cr(c,d,a)*cr(c,d,b)<-1e-12)return false;}
  return true;
}
export function snapFloor(pose,size,floor) {
  if(!floorContains(pose,size,floor)) return {ok:false,reason:'家具超出地面边界，请调整位置或地面范围。'};
  return {ok:true,pose:{...pose,z:floor.z}};
}
export function snapWall(pose,size,floor,wall,{gap=.02,openings=[],align=true,back='-Y',bottomZ=floor.z}={}) {
  if(!wall||![gap,size.width,size.depth,size.height].every(Number.isFinite)||gap<0) return {ok:false,reason:'墙面或尺寸参数无效。'};
  const dx=wall.b[0]-wall.a[0],dy=wall.b[1]-wall.a[1],length=Math.hypot(dx,dy);
  if(!Number.isFinite(bottomZ)||bottomZ+size.height>wall.a[2]+wall.height+1e-8||bottomZ<wall.a[2]-1e-8) return {ok:false,reason:'家具高度超出墙面范围。'};
  const tx=dx/length,ty=dy/length;
  let nx=wall.normal[0],ny=wall.normal[1],nl=Math.hypot(nx,ny); nx/=nl;ny/=nl;
  if(!Number.isFinite(nx)||Math.abs(nx*tx+ny*ty)>.001) return {ok:false,reason:'墙面法线无效。'};
  const bv={'-Y':[0,-1],'+Y':[0,1],'-X':[-1,0],'+X':[1,0]}[back];if(!bv)return {ok:false,reason:'请选择有效背面。'};
  const requestedYaw=align?Math.atan2(-ny,-nx)-Math.atan2(bv[1],bv[0]):pose.yaw,yaw=Math.atan2(Math.sin(requestedYaw),Math.cos(requestedYaw));
  const bx=Math.cos(yaw)*bv[0]-Math.sin(yaw)*bv[1],by=Math.sin(yaw)*bv[0]+Math.cos(yaw)*bv[1];
  if(bx*(-nx)+by*(-ny)<.999)return {ok:false,reason:'所选背面尚未平行墙面；请手动旋转或勾选对齐朝向。'};
  const corners=footprint({x:0,y:0,yaw},size),halfWidth=Math.max(...corners.map(p=>Math.abs(p[0]*tx+p[1]*ty))),halfDepth=Math.max(...corners.map(p=>Math.abs(p[0]*nx+p[1]*ny)));
  if(length<halfWidth*2+2*gap)return {ok:false,reason:'墙段不足以容纳家具。'};
  const t=Math.max(halfWidth+gap,Math.min(length-halfWidth-gap,(pose.x-wall.a[0])*tx+(pose.y-wall.a[1])*ty));
  for(const o of openings.filter(o=>o.wallId===wall.id)) {
    const ot=(o.center[0]-wall.a[0])*tx+(o.center[1]-wall.a[1])*ty;
    if(Math.abs(t-ot)<halfWidth+o.width/2+gap&&bottomZ<o.center[2]+o.height/2&&bottomZ+size.height>o.center[2]-o.height/2) return {ok:false,reason:'当前位置与门窗开口重叠。'};
  }
  const result={...pose,x:wall.a[0]+tx*t+nx*(halfDepth+gap),y:wall.a[1]+ty*t+ny*(halfDepth+gap),z:bottomZ,yaw};
  if(!floorContains(result,size,floor)) return {ok:false,reason:'贴墙后超出地面候选范围，请核对地面或墙线。'};
  return {ok:true,pose:result,wallId:wall.id,gap};
}
export function placementWarnings(pose,size,structure,{includeStructure=false}={}){
  const warnings=[],f=structure.floor,corners=footprint(pose,size);
  if(!floorContains(pose,size,f))warnings.push('越出所选地面边界');
  const dz=pose.z-f.z;if(dz>.01)warnings.push(`悬空 ${dz.toFixed(3)} m`);if(dz<-.01)warnings.push(`穿地 ${(-dz).toFixed(3)} m`);
  // Candidate walls and semantic boxes are diagnostics only, never placement constraints.
  if(!includeStructure)return warnings;
  for(const w of structure.walls.filter(w=>w.enabled!==false)){
    if(pose.z>=w.a[2]+w.height||pose.z+size.height<=w.a[2])continue;
    const {t,n,length}=wallFrame(w),ds=corners.map(p=>(p[0]-w.a[0])*n[0]+(p[1]-w.a[1])*n[1]),us=corners.map(p=>(p[0]-w.a[0])*t[0]+(p[1]-w.a[1])*t[1]),lo=Math.max(0,Math.min(...us)),hi=Math.min(length,Math.max(...us));
    if(lo>=hi)continue;
    const holes=(structure.openings??[]).filter(o=>o.wallId===w.id).map(o=>({o,r:openingRect(o,w)}));
    if(Math.min(...ds)<.03&&Math.max(...ds)>-.03&&holes.some(({r})=>lo<r[1]&&hi>r[0]&&pose.z<r[3]+w.a[2]&&pose.z+size.height>r[2]+w.a[2]))warnings.push(`可能堵住门窗 ${w.id}`);
    const through=Math.min(...ds)<-.01&&Math.max(...ds)>.01;
    const insideOpening=holes.some(({r})=>lo>=r[0]&&hi<=r[1]&&pose.z>=r[2]+w.a[2]&&pose.z+size.height<=r[3]+w.a[2]);
    if(through&&!insideOpening)warnings.push(`可能穿墙 ${w.id}`);
  }
  const overlaps=(a,b)=>{for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],n=[q[1]-p[1],p[0]-q[0]],pa=a.map(p=>p[0]*n[0]+p[1]*n[1]),pb=b.map(p=>p[0]*n[0]+p[1]*n[1]);if(Math.max(...pa)<=Math.min(...pb)+1e-8||Math.max(...pb)<=Math.min(...pa)+1e-8)return false;}return true;};
  for(const box of structure.boxes??[]){if(/carpet|painting|curtain|chandelier|illumination/.test(box.class))continue;const [width,depth,height]=box.size;if(pose.z+size.height<=box.center[2]-height/2+.01||pose.z>=box.center[2]+height/2-.01)continue;const occupied=footprint({x:box.center[0],y:box.center[1],yaw:box.yaw},{width,depth});if(overlaps(corners,occupied))warnings.push(`可能与已有 ${box.class} 重叠（语义包围盒）`);}
  return warnings;
}
export function columnMatrix(pose) {
  const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
  return [[c,-s,0,pose.x],[s,c,0,pose.y],[0,0,1,pose.z],[0,0,0,1]];
}
