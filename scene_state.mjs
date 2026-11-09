import {validateTryOn} from './try_on.mjs';
import {validateStructure} from './geometry.mjs';
import {columnMatrix} from './placement.mjs';
import {validateObjects} from './object_state.mjs';
export const ASSETS={worldId:'3FO4K4RIGVTB',localGlb:'assets/demo/furniture.glb',dimensionsBasis:'user_authorized_estimate',localFront:'-Y',localBack:'+Y',bottomOrigin:'normalized_from_actual_mesh_bounds'};
export function validateScene(v){
  if(v.renderFrame!==undefined&&!['landscape','portrait','viewport'].includes(v.renderFrame))throw Error('成图画幅无效');
  if(typeof v.worldId!=='string'||!/^[A-Za-z0-9_-]{5,100}$/.test(v.worldId)||v.upAxis!=='Z'||v.units!=='m'||!['x','y','z','yaw'].every(k=>Number.isFinite(v.pose?.[k]))||!['width','depth','height'].every(k=>Number.isFinite(v.size?.[k])&&v.size[k]>0)||!Number.isFinite(v.sceneScale)||v.sceneScale<=0||!['free','floor','wall'].includes(v.mode)||!Number.isFinite(v.gap)||v.gap<0)throw Error('摆放文件格式不兼容');
  validateStructure(v.structure);
  if(v.structure.roomHeight!==undefined&&(!Number.isFinite(v.structure.roomHeight)||v.structure.roomHeight<.5||v.structure.roomHeight>20))throw Error('室内层高无效');
  if(v.structure.cameraBoundaryMode!==undefined&&!['walls','floor'].includes(v.structure.cameraBoundaryMode))throw Error('室内边界模式无效');
  if(v.structure.worldId!==v.worldId)throw Error('结构与场景不一致');
  // Legacy wall saves retain their pose; the next placement uses floor snapping.
  if(v.mode==='wall')v.mode='floor';
  v.selectedWall='';v.align=false;v.placementPolicy='floor-only';
  v.collisionValidation='FLOOR_AND_NEW_OBJECTS_ONLY';
  if(v.back&&!['-Y','+Y','-X','+X'].includes(v.back))throw Error('背面无效');
  for(const camera of [v.camera,v.rememberedCamera])if(camera){if(!Array.isArray(camera.rows)||camera.rows.length!==4||!camera.rows.every(r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite))||!Number.isFinite(camera.verticalFov)||camera.verticalFov<=1||camera.verticalFov>=179)throw Error('相机参数无效');if(camera.resolution&&(!Array.isArray(camera.resolution)||camera.resolution.length!==2||!camera.resolution.every(x=>Number.isInteger(x)&&x>0&&x<=4500)))throw Error('相机分辨率无效');}
  validateTryOn(v.tryOn);
  for(const camera of [v.camera,v.rememberedCamera])if(camera?.viewAspect!==undefined&&(!Number.isFinite(camera.viewAspect)||camera.viewAspect<=0))throw Error('相机视野比例无效');
  validateObjects(v);
  v.assets={...ASSETS,worldId:v.worldId};v.placementMatrix=columnMatrix(v.pose);return v;
}
export function makeScene(structure){return validateScene({schemaVersion:2,worldId:structure.worldId,upAxis:'Z',units:'m',sceneScale:1,structure,size:{width:1.8,depth:.4,height:.55},pose:{x:0,y:0,z:structure.floor.z,yaw:0},mode:'floor',selectedWall:'',gap:.02,back:'+Y',align:false,kind:'demo_test_pose',furnitureBottomOrigin:true});}
