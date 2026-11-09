import {Mesh,CylinderGeometry,BoxGeometry,MeshBasicMaterial} from 'three';

// A single upright lever drives Three.js's XYZ uniform operation. Its direction
// is a gesture guide, not permission to stretch just the height dimension.
export function configureUniformScale(control){
 let found=false;
 control.getHelper().traverse(node=>{
  if(!node.gizmo?.scale||!node.picker?.scale)return;
  found=true;
  for(const group of [node.gizmo.scale,node.picker.scale,node.helper?.scale]){
   if(!group)continue;
   for(const child of [...group.children]){group.remove(child);child.traverse(part=>part.geometry?.dispose());}
  }
  // Gaussian splats render in the transparent pass. Keep the entire lever in
  // that same pass and draw last, otherwise splats can erase sections of it.
  const material=new MeshBasicMaterial({color:0xe2aa35,transparent:true,opacity:1,depthTest:false,depthWrite:false,toneMapped:false});
  const parts=[
   ['shaft',new CylinderGeometry(.012,.012,.82,10).rotateX(Math.PI/2).translate(0,0,.41)],
   ['handle',new BoxGeometry(.15,.15,.15).translate(0,0,.8)]
  ];
  for(const [part,geometry]of parts){const mesh=new Mesh(geometry,material);mesh.name='XYZ';mesh.userData.uniformScalePart=part;mesh.renderOrder=Infinity;node.gizmo.scale.add(mesh);}
  const picker=new Mesh(new CylinderGeometry(.14,.14,.76,12).rotateX(Math.PI/2).translate(0,0,.6),new MeshBasicMaterial({visible:false}));picker.name='XYZ';picker.userData.uniformScalePart='hit';node.picker.scale.add(picker);
 });
 if(!found)throw Error('当前查看器不支持等比缩放手柄');
}
export function assertUniformSize(base,next){
 const axes=['width','depth','height'],ratios=axes.map(k=>next[k]/base[k]);
 if(!axes.every(k=>Number.isFinite(base[k])&&base[k]>0&&Number.isFinite(next[k])&&next[k]>0)||!ratios.every(Number.isFinite)||ratios.some(r=>Math.abs(r-ratios[0])>1e-6*Math.max(1,...ratios)))throw Error('仅支持等比缩放，请一次修改一项尺寸');
 return next;
}
