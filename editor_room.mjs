import {floorPolygon,floorTriangles,pointInside} from './geometry.mjs';
import {manualWallBoundary} from './wall_edit.mjs';

// Camera enclosure uses the editable floor perimeter. Detected wall planes remain
// candidates and must not silently become internal collision barriers.
export function roomEnvelope(structure,points=[]){
 const floor=structure.floor,heights=points.map(p=>p[2]-floor.z).filter(z=>Number.isFinite(z)&&z>1.5&&z<8).sort((a,b)=>a-b);
 const estimated=heights.length?heights[Math.floor((heights.length-1)*.97)]:2.6;
 const height=structure.roomHeight??Math.max(2,Math.min(5,estimated));
 let polygon=floorPolygon(floor).map(p=>[...p]),wallCount=0;
 const manual=structure.cameraBoundaryMode!=='floor'?manualWallBoundary(structure):null;
 if(manual){polygon=manual;wallCount=manual.length;}
 const walls=structure.walls.filter(w=>w.enabled!==false&&w.supportRatio>=.04&&w.supportCount>=1000&&w.rmse<=.06&&w.height>=1.5&&Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1])>=1.5);
 const angles=walls.map(w=>Math.atan2(w.normal[1],w.normal[0])).sort((a,b)=>a-b),closed=angles.length>=3&&angles.every((a,i)=>(i+1<angles.length?angles[i+1]:angles[0]+2*Math.PI)-a<Math.PI-.1);
 if(!manual&&closed&&structure.cameraBoundaryMode!=='floor'){
  let candidate=polygon;
  for(const w of walls){const distance=p=>(p[0]-w.a[0])*w.normal[0]+(p[1]-w.a[1])*w.normal[1],out=[];
   candidate.forEach((b,i)=>{const a=candidate[(i+candidate.length-1)%candidate.length],da=distance(a),db=distance(b);if((da>=0)!==(db>=0)){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}if(db>=0)out.push(b);});candidate=out;
  }
  const area=Math.abs(candidate.reduce((sum,a,i)=>{const b=candidate[(i+1)%candidate.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
  if(candidate.length>=3&&area>=1){try{floorTriangles({...floor,polygon:candidate});polygon=candidate;wallCount=walls.length;}catch{}}
 }
 const triangles=floorTriangles({...floor,polygon}),centers=[];
 for(let i=0;i<triangles.length;i+=9)centers.push([(triangles[i]+triangles[i+3]+triangles[i+6])/3,(triangles[i+1]+triangles[i+4]+triangles[i+7])/3]);
 return {polygon,bottom:floor.z+.08,top:floor.z+height-.08,height,centers,wallCount,margin:wallCount?.12:.025};
}
const distanceToEdge=(p,a,b)=>{
 const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
};
export function insideRoom(point,room,margin=room.margin??.025){
 return point.every(Number.isFinite)&&point[2]>=room.bottom&&point[2]<=room.top&&pointInside(point,room.polygon)&&room.polygon.every((a,i)=>distanceToEdge(point,a,room.polygon[(i+1)%room.polygon.length])>=margin);
}
export function clampRoomPoint(point,room){
 const p=[...point];p[2]=Math.max(room.bottom,Math.min(room.top,p[2]));
 if(insideRoom(p,room))return p;
 const candidates=room.centers.filter(c=>insideRoom([...c,p[2]],room));
 if(!candidates.length){const c=room.centers[0]??room.polygon[0];return [...c,p[2]];}
 const center=candidates.sort((a,b)=>Math.hypot(a[0]-p[0],a[1]-p[1])-Math.hypot(b[0]-p[0],b[1]-p[1]))[0]??room.centers[0];
 if(!center)return [room.polygon[0][0],room.polygon[0][1],p[2]];
 const start=[...center,p[2]];return constrainRoomMotion(start,p,room);
}
export function constrainRoomMotion(from,to,room){
 if(!insideRoom(from,room))return clampRoomPoint(to,room);
 // Test every polygon-edge intersection, so a large gesture cannot jump across
 // the outside of a concave room and re-enter at another valid endpoint.
 const times=[0,1],dx=to[0]-from[0],dy=to[1]-from[1];
 room.polygon.forEach((a,i)=>{const b=room.polygon[(i+1)%room.polygon.length],ex=b[0]-a[0],ey=b[1]-a[1],cross=dx*ey-dy*ex;
  if(Math.abs(cross)<1e-12)return;const ax=a[0]-from[0],ay=a[1]-from[1],t=(ax*ey-ay*ex)/cross,u=(ax*dy-ay*dx)/cross;if(t>0&&t<1&&u>=0&&u<=1)times.push(t);
 });times.sort((a,b)=>a-b);
 const at=t=>from.map((v,i)=>v+(to[i]-v)*t);let low=0,high=1;
 for(let i=1;i<times.length;i++){const middle=(times[i-1]+times[i])/2;if(!insideRoom(at(middle),room)){high=middle;break;}low=middle;if(!insideRoom(at(times[i]),room)){high=times[i];break;}low=times[i];}
 if(low===1&&insideRoom(to,room))return [...to];
 for(let i=0;i<40;i++){const mid=(low+high)/2;if(insideRoom(at(mid),room))low=mid;else high=mid;}
 return at(low);
}

export function gizmoPlacement(position,rotation,scale){
 const values=[...position,rotation,...scale];if(!values.every(Number.isFinite)||scale.some(v=>v<.01||v>1000))throw Error('缩放后尺寸应在 1 厘米到 1000 米之间。');
 return {pose:{x:position[0],y:position[1],z:position[2],yaw:rotation},size:{width:scale[0],depth:scale[1],height:scale[2]}};
}
