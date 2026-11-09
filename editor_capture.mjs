import {withCaptureVisibility} from './comparison_view.mjs';
import {currentViewCapture} from './ui_actions.mjs';

export function createEditorCapture(api){
 let exportInProgress=false;
 async function captureFrame(includeAdded=true){
  const s=api.viewport();return withCaptureVisibility(s,includeAdded,async()=>{
   for(let i=0;i<3;i++)await new Promise((resolve,reject)=>{
    let frame;const cleanup=()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',interrupted);s.renderer.domElement.removeEventListener('webglcontextlost',interrupted);};
    const interrupted=()=>{if(document.hidden||s.contextLost){cleanup();reject(Error('画面已暂停，请返回页面或恢复三维后再保存图片'));}};
    document.addEventListener('visibilitychange',interrupted);s.renderer.domElement.addEventListener('webglcontextlost',interrupted);if(document.hidden||s.contextLost){interrupted();return;}
    frame=requestAnimationFrame(()=>{cleanup();resolve();});
   });
   if(s!==api.viewport())throw Error('三维画面已更新，请重试');s.renderer.render(s.scene,s.camera);const result=document.createElement('canvas');result.width=s.renderer.domElement.width;result.height=s.renderer.domElement.height;result.getContext('2d').drawImage(s.renderer.domElement,0,0);return result;
  });
}
async function captureEffect(){

 if(exportInProgress)throw Error('正在准备其他图片，请稍后重试');
 if(!api.projectId)throw Error('请先从“我的空间”打开项目');
 api.requireEdits();
 api.commitObject();if(!api.objects().some(o=>o.visible))throw Error('请先添加或显示物品');
 exportInProgress=true;const main=document.querySelector('main'),oldInert=main.inert,controlsEnabled=api.viewport()?.controls.enabled??true;main.inert=true;let restoreRenderer;
 try{
  await api.openView('gaussian');await api.ensureObjects();if(!api.viewport()?.splat||api.view()!=='gaussian')throw Error('请等待房间三维场景加载完成');
  const s=api.viewport(),oldRatio=s.renderer.getPixelRatio(),oldSize=s.renderer.getSize(new s.THREE.Vector2()),oldAspect=s.camera.aspect;
  restoreRenderer=()=>{s.renderer.setPixelRatio(oldRatio);s.renderer.setSize(oldSize.x,oldSize.y,false);s.camera.aspect=oldAspect;s.camera.updateProjectionMatrix();s.exporting=false;s.controls.enabled=controlsEnabled;};
  const {width,height,imageWidth,imageHeight,left,top}=currentViewCapture(oldAspect);
  s.controls.enabled=false;s.exporting=true;s.renderer.setPixelRatio(1);s.renderer.setSize(imageWidth,imageHeight,false);s.camera.aspect=oldAspect;s.camera.updateProjectionMatrix();
  const frame=await captureFrame(),image=document.createElement('canvas');image.width=width;image.height=height;const context=image.getContext('2d');context.fillStyle='#eaf0eb';context.fillRect(0,0,width,height);context.drawImage(frame,left,top,imageWidth,imageHeight);
  const scene=api.snapshot();scene.camera.resolution=[width,height];
  await api.persist(scene);
  return {scene,preview:image.toDataURL('image/png')};
 }finally{restoreRenderer?.();main.inert=oldInert;exportInProgress=false;api.sync();}
}

 return {get busy(){return exportInProgress;},captureEffect};
}
