import {validateStructure,floorPolygon,pointInside} from './geometry.mjs';
const near=(a,b,t=.06)=>Math.hypot(a[0]-b[0],a[1]-b[1])<=t;
function followOpenings(openings,old,wall){
 const dx=old.b[0]-old.a[0],dy=old.b[1]-old.a[1],length=Math.hypot(dx,dy),nx=wall.b[0]-wall.a[0],ny=wall.b[1]-wall.a[1];
 for(const opening of openings??[])if(opening.wallId===old.id){const x=opening.center[0]-old.a[0],y=opening.center[1]-old.a[1],t=(x*dx+y*dy)/(length*length),offset=x*old.normal[0]+y*old.normal[1];opening.center=[wall.a[0]+t*nx+offset*wall.normal[0],wall.a[1]+t*ny+offset*wall.normal[1],wall.a[2]+opening.center[2]-old.a[2]];}
}
export function editedWall(structure,id,a,b,previous){
 if(![a,b].every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)))throw Error('墙线坐标无效');
 const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<.05)throw Error('墙线长度不能小于 5 厘米');
 let normal=[-dy/length,dx/length,0];
 const poly=floorPolygon(structure.floor),center=poly.reduce((c,p)=>c.map((v,i)=>v+p[i]/poly.length),[0,0]);
 const direction=previous?normal[0]*previous.normal[0]+normal[1]*previous.normal[1]:normal[0]*(center[0]-(a[0]+b[0])/2)+normal[1]*(center[1]-(a[1]+b[1])/2);
 if(direction<0)normal=normal.map(v=>-v);
 return {...previous,id,a:[...a.slice(0,2),structure.floor.z],b:[...b.slice(0,2),structure.floor.z],normal,height:structure.roomHeight??previous?.height??2.6,source:'MANUAL',enabled:true};
}
export function changeWall(structure,id,a,b,{connect=true}={}){
 const next=structuredClone(structure),old=next.walls.find(w=>w.id===id),wall=editedWall(next,id,a,b,old);
 if(old){
  // Door/window positions follow their wall in local coordinates.
  followOpenings(next.openings,old,wall);
  if(connect)for(const w of next.walls.filter(w=>w.id!==id&&w.enabled!==false)){
   let moved=false;const ends={a:[...w.a],b:[...w.b]};for(const end of ['a','b'])for(const key of ['a','b'])if(near(w[end],old[key])){ends[end]=[...wall[key]];moved=true;break;}
   if(moved){const changed=editedWall(next,w.id,ends.a,ends.b,w);followOpenings(next.openings,w,changed);Object.assign(w,changed);}
  }
  Object.assign(old,wall);
 }else next.walls.push(wall);
 validateStructure(next);return next;
}
export function removeWall(structure,id){const next=structuredClone(structure);next.walls=next.walls.filter(w=>w.id!==id);next.openings=(next.openings??[]).filter(o=>o.wallId!==id);validateStructure(next);return next;}
// A complete manually traced perimeter can be concave; it must stay inside the floor.
export function manualWallBoundary(structure){
 let walls=structure.walls.filter(w=>w.enabled!==false&&w.source==='MANUAL');
 // Dangling internal segments do not invalidate an otherwise closed perimeter.
 for(;;){const kept=walls.filter(w=>[w.a,w.b].every(p=>walls.some(other=>other!==w&&(near(other.a,p)||near(other.b,p)))));if(kept.length===walls.length)break;walls=kept;}
 const polygons=[],floor=floorPolygon(structure.floor);
 while(walls.length){const component=[walls.shift()];for(let i=0;i<component.length;i++){const w=component[i];for(let j=walls.length-1;j>=0;j--)if([walls[j].a,walls[j].b].some(p=>near(p,w.a)||near(p,w.b)))component.push(...walls.splice(j,1));}
  if(component.length<3)continue;const used=new Set([component[0].id]),polygon=[component[0].a.slice(0,2)];let end=component[0].b,valid=true;
  while(used.size<component.length){polygon.push(end.slice(0,2));const matches=component.filter(w=>!used.has(w.id)&&(near(w.a,end)||near(w.b,end)));if(matches.length!==1){valid=false;break;}const w=matches[0];used.add(w.id);end=near(w.a,end)?w.b:w.a;}
  if(!valid||!near(end,polygon[0])||!polygon.every((p,i)=>segmentWithinFloor(p,polygon[(i+1)%polygon.length],floor)))continue;
  try{validateStructure({...structure,floor:{...structure.floor,polygon}});polygons.push(polygon);}catch{}
 }
 const area=poly=>Math.abs(poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a[0]*b[1]-a[1]*b[0];},0));
 return polygons.sort((a,b)=>area(b)-area(a))[0]??null;
}
function segmentWithinFloor(a,b,floor){
 if(!pointInside(a,floor)||!pointInside(b,floor))return false;
 const times=[0,1],dx=b[0]-a[0],dy=b[1]-a[1],at=t=>[a[0]+t*dx,a[1]+t*dy];
 for(let i=0;i<floor.length;i++){const c=floor[i],d=floor[(i+1)%floor.length],ex=d[0]-c[0],ey=d[1]-c[1],cross=dx*ey-dy*ex;
  if(Math.abs(cross)>1e-12){const cx=c[0]-a[0],cy=c[1]-a[1],t=(cx*ey-cy*ex)/cross,u=(cx*dy-cy*dx)/cross;if(t>0&&t<1&&u>=0&&u<=1)times.push(t);}
 }
 times.sort((a,b)=>a-b);return times.every((t,i)=>i===0||pointInside(at((t+times[i-1])/2),floor));
}
