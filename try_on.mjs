import {floorPolygon,floorTriangles} from './geometry.mjs';
import {floorContains} from './placement.mjs';
import {objectsOverlap} from './object_state.mjs';

export const measurementAxes=['width','depth','height'];
export function resolveMeasurements(base,provided={}){
 const keys=measurementAxes.filter(k=>provided?.[k]!==undefined);
 if(!measurementAxes.every(k=>Number.isFinite(base[k])&&base[k]>0)||keys.some(k=>!Number.isFinite(provided[k])||provided[k]<.01||provided[k]>20))throw Error('请输入 1–2000 厘米的有效尺寸');
 const factor=keys.length?provided[keys[0]]/base[keys[0]]:1;
 const size=Object.fromEntries(measurementAxes.map(k=>[k,provided[k]??base[k]*factor]));
 if(measurementAxes.some(k=>!Number.isFinite(size[k])||size[k]<=0||size[k]>1000))throw Error('推算尺寸超出可预览范围，请核对');
 return {size,measuredAxes:keys,sizeBasis:keys.length===3?'USER_ENTERED_STAGING_SIZE':keys.length?'USER_PARTIAL_STAGING_SIZE':'UNMEASURED_DEFAULT_PROPORTIONS'};
}
export function dimensionDescription(value={}){
 const axes=value.measuredAxes??[];
 if(axes.length===3)return '尺寸由你填写 · 房间尺度仍需核对';
 if(axes.length)return `${axes.map(k=>({width:'宽',depth:'深',height:'高'}[k])).join('、')}由你填写 · 其余按比例推算`;
 return '尺寸未核对 · 当前仅为预览比例';
}
// Validate before touching the editor, its history, or the original object.
export function resizedPlacement(object,resolved,floor,others=[]){
 if(!object)throw Error('这件物品已不在当前方案中，请重新选择');
 const next={...object,...resolved,size:{...resolved.size},pose:{...object.pose}};
 if(!measurementAxes.every(k=>Number.isFinite(next.size[k])&&next.size[k]>0&&next.size[k]<=1000))throw Error('物品尺寸无效');
 if(object.mode==='floor'&&!floorContains(next.pose,next.size,floor))throw Error('修改后超出地面范围，请减小尺寸或先移动物品。原尺寸和位置已保留。');
 if(others.some(o=>o.id!==object.id&&objectsOverlap(next,o)))throw Error('修改后与新增物品重叠，请先调整位置。原尺寸和位置已保留。');
 return next;
}
export function quickPreviewReady(project,jobs=[]){
 return project?.experience==='quick-try-on'&&project.status==='READY'&&!!project.quickTryOnJobId&&jobs.some(j=>j.id===project.quickTryOnJobId&&j.state==='READY'&&j.resultAssetId);
}
export function findInitialPlacement(floor,size,objects=[],yaw=0){
 const poly=floorPolygon(floor),xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
 const lo=[Math.min(...xs),Math.min(...ys)],hi=[Math.max(...xs),Math.max(...ys)],center=lo.map((v,i)=>(v+hi[i])/2),candidates=[center];
 const triangles=floorTriangles(floor);
 for(let i=0;i<triangles.length;i+=9)candidates.push([(triangles[i]+triangles[i+3]+triangles[i+6])/3,(triangles[i+1]+triangles[i+4]+triangles[i+7])/3]);
 for(let x=0;x<=20;x++)for(let y=0;y<=20;y++)candidates.push([lo[0]+(hi[0]-lo[0])*x/20,lo[1]+(hi[1]-lo[1])*y/20]);
 candidates.sort((a,b)=>Math.hypot(a[0]-center[0],a[1]-center[1])-Math.hypot(b[0]-center[0],b[1]-center[1]));
 for(const [x,y] of candidates){const pose={x,y,z:floor.z,yaw},object={id:'candidate',visible:true,pose,size};if(floorContains(pose,size,floor)&&!objects.some(o=>objectsOverlap(object,o)))return pose;}
 return null;
}
export function validateTryOn(value){
 if(value===undefined)return;
 if(!value||!/^[a-f0-9]{64}$/.test(value.jobId)||!['pending','placed'].includes(value.state))throw Error('首次试摆记录无效');
 if(value.state==='placed'&&!/^[A-Za-z0-9_-]{1,90}$/.test(value.objectId??''))throw Error('首次试摆物品无效');
 if(value.size&&!measurementAxes.every(k=>Number.isFinite(value.size[k])&&value.size[k]>0&&value.size[k]<=1000))throw Error('待放置尺寸无效');
}

// Both tabs may see no scene. CAS chooses one winner; the loser restores it.
// Never call this for a standard project or overwrite any existing saved scene.
export async function initializeQuickTryOn({project,read,build,save,restore}){
 if(project?.experience!=='quick-try-on')return false;
 let saved;try{saved=await read();}catch(e){if(e.status!==404)throw e;}
 if(saved){restore(saved);return false;}
 if(!project.quickTryOnJobId)return false;
 const scene=await build();if(!scene)return false;
 try{const result=await save({...scene,expectedSavedAt:null});restore({...scene,savedAt:result.savedAt});return true;}
 catch(e){
  if(e.status!==409)throw e;
  for(let attempt=0;;attempt++){
   try{restore(await read());return false;}catch(error){if(error.status!==404||attempt>=24)throw error;}
   await new Promise(resolve=>setTimeout(resolve,20));
   // READY can become visible just before a room worker releases its lock.
   // Retrying the same null-version CAS is safe even if another tab wins.
   try{const result=await save({...scene,expectedSavedAt:null});restore({...scene,savedAt:result.savedAt});return true;}catch(error){if(error.status!==409)throw error;}
  }
 }
}
