import {createViewerActivity} from './viewer_activity.mjs';
import {configureUniformScale} from './uniform_scale.mjs';
import {floorPolygon,pointInside} from './geometry.mjs';
import {constrainRoomView,roomHomeCamera} from './editor_room.mjs';
import {createObjectRootEnsurer} from './object_root_ensurer.mjs';

const loadGraphics=async()=>{
 const [THREE,{OrbitControls},{GLTFLoader},{TransformControls}]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js'),import('three/addons/loaders/GLTFLoader.js'),import('three/addons/controls/TransformControls.js')]);
 return {THREE,OrbitControls,GLTFLoader,TransformControls};
};
export function createEditorViewport(api){
 const $=api.$,doc=api.document??globalThis.document;let threeState=null,threeSetupPromise=null;
 function constrainCamera(){
 const s=threeState;if(!s||s.constraining||s.exporting)return;s.constraining=true;
 try{const view=constrainRoomView(s.camera.position.toArray(),s.controls.target.toArray(),api.room(),s.lastCamera);s.camera.position.fromArray(view.position);s.controls.target.fromArray(view.target);s.lastCamera=view.position;s.controls.update();}finally{s.constraining=false;}
}
function restoreCamera(saved){if(!saved||!threeState)return;threeState.lastCamera=null;const m=new threeState.THREE.Matrix4().fromArray(saved.rows.flat());m.elements[12]/=1000;m.elements[13]/=1000;m.elements[14]/=1000;m.decompose(threeState.camera.position,threeState.camera.quaternion,new threeState.THREE.Vector3());threeState.camera.fov=saved.verticalFov;const forward=new threeState.THREE.Vector3(0,0,-1).applyQuaternion(threeState.camera.quaternion);threeState.controls.target.copy(threeState.camera.position).addScaledVector(forward,3);threeState.controls.update();constrainCamera();}
function cameraRows(){const c=threeState.camera;c.updateMatrixWorld();const e=c.matrixWorld.elements;return [[e[0],e[1],e[2],0],[e[4],e[5],e[6],0],[e[8],e[9],e[10],0],[e[12]*1000,e[13]*1000,e[14]*1000,1]];}
function setupThree(){if(threeSetupPromise)return threeSetupPromise;if(threeState)return Promise.resolve();threeSetupPromise=setupThreeBody().catch(e=>{const failed=threeState;threeState=null;disposeViewer(failed);threeSetupPromise=null;throw e;});return threeSetupPromise;}
let viewerRecovery=null;
function syncViewerActivity(){threeState?.activity?.sync({hidden:doc.hidden,lost:!!threeState.contextLost,visible:api.view()!=='plan'});}
function disposeViewer(s){
 if(!s)return;s.activity?.dispose();s.renderer.setAnimationLoop(null);s.controls.dispose();s.transform.dispose();s.splat?.dispose();s.spark?.dispose();
 const disposed=new Set(),dispose=value=>{if(value?.dispose&&!disposed.has(value)){disposed.add(value);value.dispose();}};
 for(const {normalized}of s.templates.values())normalized.traverse(node=>{dispose(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])if(material){for(const value of Object.values(material))if(value?.isTexture)dispose(value);dispose(material);}});
 s.renderer.dispose();s.renderer.domElement.remove();
}
async function recoverViewer(){
 if(viewerRecovery)return viewerRecovery;
 if(api.busy()){api.loading('图片准备中，请结束后重试三维画面。',true);return;}
 viewerRecovery=(async()=>{api.suspend();const old=threeState;if(old)api.rememberCamera({rows:cameraRows(),verticalFov:old.camera.fov});threeState=null;threeSetupPromise=null;disposeViewer(old);await api.openView(api.view()==='plan'?'gaussian':api.view());api.bindInput();})();
 try{await viewerRecovery;}catch(e){api.loading('恢复暂未完成：'+e.message,true);}finally{viewerRecovery=null;}
}
async function setupThreeBody(){
  if(threeState)return;
  api.loading('正在加载三维查看器…');
  api.status('正在加载三维查看器…');
  const {THREE,OrbitControls,GLTFLoader,TransformControls}=await (api.loadGraphics??loadGraphics)();
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(api.pixelRatio??globalThis.devicePixelRatio??1,$('previewQuality')?.value==='smooth'?1:1.5));renderer.setClearColor('#e5eae6');$('three').append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(65,1,.03,100),controls=new OrbitControls(camera,renderer.domElement);camera.up.set(0,0,1);
  controls.addEventListener('end',()=>{if(api.ready()&&!api.busy())api.onCameraCommit();});
  const [lo,hi]=api.structure().floor.bounds,center=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2],origin=api.structure().sourceToAligned.slice(0,3).map(row=>row[3]);
  // Start inside the space, near the source capture position, rather than outside its shell.
  const eye=pointInside(origin,floorPolygon(api.structure().floor))&&Math.hypot(origin[0]-center[0],origin[1]-center[1])>.4?origin:[center[0],center[1]-Math.min(hi[1]-lo[1],hi[0]-lo[0])*.2,api.structure().floor.z+1.4];
  camera.position.set(eye[0],eye[1],Math.max(api.structure().floor.z+1.25,eye[2]));controls.target.set(center[0],center[1],api.structure().floor.z+.8);controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff,0x68725c,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(3,-3,7);scene.add(sun);
  const proxies=new THREE.Group(),modelRoot=new THREE.Group();scene.add(proxies,modelRoot);
  controls.minDistance=.12;controls.maxDistance=30;controls.enableRotate=false;controls.enabled=!api.busy();threeState={THREE,renderer,scene,camera,controls,proxies,modelRoot,roots:new Map(),templates:new Map(),loading:new Map(),gltfLoader:new GLTFLoader(),splat:null,spark:null};
  const transformProxy=new THREE.Object3D();scene.add(transformProxy);const transform=new TransformControls(camera,renderer.domElement);transform._getPointer=e=>api.pointer(e,renderer.domElement);configureUniformScale(transform);transform.setSize(api.mobile()?1.15:.9);transform.setRotationSnap(Math.PI/180);scene.add(transform.getHelper());
  const selectionBox=new THREE.BoxHelper(new THREE.Object3D(),0x55bd98);selectionBox.material.depthTest=false;selectionBox.material.transparent=true;selectionBox.material.opacity=.85;selectionBox.renderOrder=1000;selectionBox.visible=false;scene.add(selectionBox);Object.assign(threeState,{transform,transformProxy,selectionBox});
  transform.addEventListener('dragging-changed',event=>{controls.enabled=!event.value&&!api.busy();api.onTransformDrag(event.value);});
  transform.addEventListener('objectChange',()=>api.onTransformChange(threeState));
  controls.addEventListener('change',constrainCamera);constrainCamera();
  const s=threeState;s.ensureObjectRoots=createObjectRootEnsurer({
    getItems:()=>api.objects(),
    getMountedAssetId:id=>s.roots.get(id)?.userData.assetId,
    loadTemplate:assetId=>api.loadTemplate(assetId),
    mountRoot:(o,{normalized,extent},{id,assetId})=>{
      if(threeState!==s)return;
      const old=s.roots.get(id);if(old){s.modelRoot.remove(old);s.roots.delete(id);}
      const root=new THREE.Group(),wrapper=normalized.clone(true);root.add(wrapper);root.userData={objectId:id,assetId,extent};
      root.position.set(o.pose.x,o.pose.y,o.pose.z);root.rotation.z=o.pose.yaw;root.visible=o.visible;wrapper.scale.set(o.size.width/extent.x,o.size.depth/extent.y,o.size.height/extent.z);s.roots.set(id,root);s.modelRoot.add(root);api.onSelection();
    }
  });restoreCamera(api.pendingCamera());try{await api.ensureObjects();}catch(e){$('assetErrorText').textContent='有物品未能载入，可以在原处重试，空间仍可浏览。';$('assetError').hidden=false;api.status(e.message);}api.refresh();
  const render=()=>{if(threeState!==s||s.contextLost||doc.hidden)return;if(!s.exporting)layoutThree();controls.update();renderer.render(scene,camera);};
  s.activity=createViewerActivity({start:()=>renderer.setAnimationLoop(render),stop:()=>renderer.setAnimationLoop(null)});
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();s.contextLost=true;api.suspend();s.controls.enabled=false;syncViewerActivity();api.loading('三维画面中断，摆放仍保留。等待浏览器恢复，或点击重试。',true);});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{if(threeState===s)recoverViewer();});
  syncViewerActivity();api.bindInput();
}
function layoutThree(){
 if(!threeState||threeState.exporting)return;
 const s=threeState,width=Math.max(1,$('stage').clientWidth),height=Math.max(1,$('stage').clientHeight),key=width+'x'+height;
 if(s.frameKey===key)return;s.frameKey=key;s.renderer.setSize(width,height,false);Object.assign(s.renderer.domElement.style,{position:'absolute',width:width+'px',height:height+'px',left:'0px',top:'0px'});s.camera.aspect=width/height;s.camera.updateProjectionMatrix();
}
async function loadSplat(){
  const s=threeState;
  if(s.splat){if(s.splat.initialized)await s.splat.initialized;return;}
  const {SparkRenderer,SplatMesh}=await import('@sparkjsdev/spark');
  if(threeState!==s)return;
  s.spark??=new SparkRenderer({renderer:s.renderer});s.scene.add(s.spark);
  api.loading('正在下载与解码房间，完成后可直接试摆…');
  const splat=new SplatMesh({url:api.asset('room.ply'),onProgress:event=>{if(threeState!==s)return;const loaded=(event.loaded/1024**2).toFixed(1),total=event.lengthComputable?(event.total/1024**2).toFixed(1):null;api.loading(total?`房间已传输 ${loaded} / ${total} MB，随后准备三维画面…`:`房间已传输 ${loaded} MB，正在准备三维画面…`);}});
  s.splat=splat;s.scene.add(splat);api.refresh();
  try{if(splat.initialized)await splat.initialized;if(threeState===s)window.mixedPreviewReady={worldId:api.structure().worldId,gaussianCount:splat.numSplats??null,model:true};}
  catch(e){s.scene.remove(splat);splat.dispose();if(s.splat===splat)s.splat=null;throw e;}
}
async function centerSceneCamera(){
 if(api.busy())return;api.suspend();await api.openView('gaussian');if(!threeState)return;
 const c=roomHomeCamera(api.room());threeState.lastCamera=null;threeState.camera.fov=65;threeState.camera.updateProjectionMatrix();threeState.camera.position.set(...c.position);threeState.controls.target.set(...c.target);constrainCamera();
 api.status('已从房间中央开始，单指拖背景原地转头；双指平移、捏合调整远近。');
}


 function bindLifecycle(doc=api.document??globalThis.document,win=window){
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden){api.suspend();api.onHidden();}syncViewerActivity();if(!doc.hidden&&threeState&&!threeState.contextLost)layoutThree();});
  win.addEventListener('pagehide',()=>{api.suspend();threeState?.activity?.sync({hidden:true});});win.addEventListener('pageshow',syncViewerActivity);
 }
 return {get state(){return threeState;},setupThree,loadSplat,layoutThree,constrainCamera,cameraRows,restoreCamera,recoverViewer,syncViewerActivity,centerSceneCamera,bindLifecycle};
}
