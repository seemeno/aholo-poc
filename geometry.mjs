// Shared metre/Z-up interaction geometry; wall openings are actual mesh holes.
export function floorPolygon(f) {
  if(f.polygon?.length>=3)return f.polygon;
  const [a,b]=f.bounds;return [[a[0],a[1]],[b[0],a[1]],b,[a[0],b[1]]];
}
export function pointInside(p,poly) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[j],b=poly[i],cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);
    if(Math.abs(cross)<1e-8&&p[0]>=Math.min(a[0],b[0])-1e-8&&p[0]<=Math.max(a[0],b[0])+1e-8&&p[1]>=Math.min(a[1],b[1])-1e-8&&p[1]<=Math.max(a[1],b[1])+1e-8)return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}
export function wallFrame(w){const dx=w.b[0]-w.a[0],dy=w.b[1]-w.a[1],length=Math.hypot(dx,dy);return {length,t:[dx/length,dy/length],n:w.normal};}
export function openingRect(o,w){const {t,length}=wallFrame(w),u=(o.center[0]-w.a[0])*t[0]+(o.center[1]-w.a[1])*t[1];return [Math.max(0,u-o.width/2),Math.min(length,u+o.width/2),Math.max(0,o.center[2]-o.height/2-w.a[2]),Math.min(w.height,o.center[2]+o.height/2-w.a[2])];}
export function wallPatches(w,openings=[]){
  const {length}=wallFrame(w),holes=openings.filter(o=>o.wallId===w.id).map(o=>openingRect(o,w)).filter(r=>r[1]>r[0]&&r[3]>r[2]);
  const xs=[...new Set([0,length,...holes.flatMap(r=>r.slice(0,2))])].sort((a,b)=>a-b),zs=[...new Set([0,w.height,...holes.flatMap(r=>r.slice(2))])].sort((a,b)=>a-b),out=[];
  for(let i=1;i<xs.length;i++)for(let j=1;j<zs.length;j++){const u=(xs[i-1]+xs[i])/2,z=(zs[j-1]+zs[j])/2;if(!holes.some(r=>u>r[0]&&u<r[1]&&z>r[2]&&z<r[3]))out.push([xs[i-1],xs[i],zs[j-1],zs[j]]);}return out;
}
export function wallTriangles(w,openings=[]){const {t}=wallFrame(w),v=(u,z)=>[w.a[0]+t[0]*u,w.a[1]+t[1]*u,w.a[2]+z];return wallPatches(w,openings).flatMap(([a,b,c,d])=>[...v(a,c),...v(b,c),...v(b,d),...v(a,c),...v(b,d),...v(a,d)]);}
// Ear clipping for user polygons; rejects self intersections in validateStructure.
export function floorTriangles(f){
  const poly=floorPolygon(f),ids=poly.map((_,i)=>i),out=[];
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const area=poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a[0]*b[1]-b[0]*a[1];},0);if(area<0)ids.reverse();
  let guard=0;while(ids.length>2&&guard++<poly.length**2){let found=false;for(let k=0;k<ids.length;k++){const ia=ids[(k+ids.length-1)%ids.length],ib=ids[k],ic=ids[(k+1)%ids.length],a=poly[ia],b=poly[ib],c=poly[ic];if(cross(a,b,c)<=1e-10)continue;if(ids.some(id=>![ia,ib,ic].includes(id)&&cross(a,b,poly[id])>=-1e-10&&cross(b,c,poly[id])>=-1e-10&&cross(c,a,poly[id])>=-1e-10))continue;out.push(...[a,b,c].flatMap(p=>[...p,f.z]));ids.splice(k,1);found=true;break;}if(!found)throw Error('地面轮廓无法三角化');}return out;
}
export function validateStructure(s){
  const finite=p=>Array.isArray(p)&&p.every(Number.isFinite),poly=floorPolygon(s.floor);
  if(typeof s.worldId!=='string'||!/^[A-Za-z0-9_-]{5,100}$/.test(s.worldId)||s.units!=='m'||s.upAxis!=='Z'||!Number.isFinite(s.floor.z)||poly.length<3||poly.length>500||!poly.every(p=>p.length===2&&finite(p)))throw Error('结构坐标无效');
  for(let i=0;i<poly.length;i++)for(let j=i+1;j<poly.length;j++){if(j===i+1||(i===0&&j===poly.length-1))continue;const a=poly[i],b=poly[(i+1)%poly.length],c=poly[j],d=poly[(j+1)%poly.length],cr=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if(cr(a,b,c)*cr(a,b,d)<0&&cr(c,d,a)*cr(c,d,b)<0)throw Error('地面轮廓自交');}
  const m=s.sourceToAligned;if(!Array.isArray(m)||m.length!==4||!m.every(r=>finite(r)&&r.length===4)||m[3].some((v,i)=>Math.abs(v-(i===3?1:0))>1e-8)||m[0][0]<=0)throw Error('场景矩阵无效');
  const ids=new Set();for(const w of s.walls){if(ids.has(w.id)||!finite(w.a)||!finite(w.b)||w.a.length!==3||w.b.length!==3||Math.abs(w.a[2]-w.b[2])>1e-6||!finite(w.normal)||!Number.isFinite(w.height)||w.height<=0||wallFrame(w).length<.05)throw Error('墙线无效');const {t}=wallFrame(w);if(Math.abs(Math.hypot(...w.normal)-1)>.001||Math.abs(t[0]*w.normal[0]+t[1]*w.normal[1])>.001||Math.abs(w.normal[2])>.001)throw Error('墙法线无效');ids.add(w.id);}
  for(const o of s.openings??[])if(!ids.has(o.wallId)||!finite(o.center)||o.center.length!==3||![o.width,o.height].every(v=>Number.isFinite(v)&&v>0))throw Error('开口无效');
  floorTriangles(s.floor);return s;
}
