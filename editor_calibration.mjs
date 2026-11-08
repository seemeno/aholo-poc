import {validateStructure} from './geometry.mjs';

// Build and validate a complete candidate before replacing any live editor data.
export function scaleCalibration({structure,objects,points,sceneScale,height},factor){
 if(!Number.isFinite(factor)||factor<=0)throw Error('比例必须是大于 0 的数值。');
 const next=structuredClone(structure),scalePoint=p=>p.map(v=>v*factor),scaledHeight=(next.roomHeight??height)*factor;
 if(!Number.isFinite(scaledHeight)||scaledHeight<.5||scaledHeight>20)throw Error('缩放后的层高须在 0.5 到 20 米之间。');
 next.roomHeight=scaledHeight;
 next.sourceToAligned=next.sourceToAligned.map((row,i)=>i<3?row.map(v=>v*factor):row);
 next.floor.z*=factor;next.floor.bounds=next.floor.bounds.map(scalePoint);if(next.floor.polygon)next.floor.polygon=next.floor.polygon.map(scalePoint);
 next.scaleBasis='USER_CALIBRATED_UNMEASURED_FACTOR';
 for(const w of next.walls){w.a=scalePoint(w.a);w.b=scalePoint(w.b);w.height*=factor;}
 for(const o of next.openings??[]){o.center=scalePoint(o.center);o.width*=factor;o.height*=factor;}
 for(const box of next.boxes??[]){box.center=scalePoint(box.center);box.size=scalePoint(box.size);}
 const nextObjects=objects.map(o=>({...o,pose:{...o.pose,x:o.pose.x*factor,y:o.pose.y*factor,z:o.pose.z*factor}})),nextPoints=points.map(scalePoint),nextScale=sceneScale*factor;
 if(!Number.isFinite(nextScale)||nextScale<=0||nextPoints.some(p=>p.some(v=>!Number.isFinite(v)))||nextObjects.some(o=>!['x','y','z'].every(k=>Number.isFinite(o.pose[k]))))throw Error('缩放后的空间坐标无效。');
 validateStructure(next);
 return {structure:next,objects:nextObjects,points:nextPoints,sceneScale:nextScale};
}

// Selection and fixed-frame output pixel counts are not unsaved placement edits.
export function needsRecovery(record,saved){
 if(!record?.scene)return false;
 if(record.fields||!saved)return true;
 const canonical=value=>{
  const {projectId,worldId,structure,sceneScale,objects,camera}=value,frame=value.renderFrame??'viewport';
  const room={...structure,cameraBoundaryMode:'walls'};
  const content={projectId,worldId,structure:room,sceneScale,objects,
   camera:camera?{rows:camera.rows,verticalFov:camera.verticalFov,aspect:frame==='viewport'&&camera.resolution?camera.resolution[0]/camera.resolution[1]:undefined}:null,frame};
  if(!objects?.length){content.pose=value.pose;content.size=value.size;content.mode=value.mode;}
  const stable=v=>typeof v==='number'?Math.round(v*1e6)/1e6:v&&typeof v==='object'?Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>[k,stable(v[k])])):v;
  return JSON.stringify(stable(content));
 };
 return canonical(record.scene)!==canonical(saved);
}
