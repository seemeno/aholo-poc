// Display visibility never changes per-object visibility or the saved scene.
export async function withCaptureVisibility(state,includeAdded,run){
 const nodes=[state.modelRoot,state.proxies,state.transform?.getHelper(),state.selectionBox].filter(Boolean),previous=nodes.map(n=>n.visible);
 state.modelRoot.visible=includeAdded;for(const n of nodes.slice(1))n.visible=false;
 try{return await run();}finally{nodes.forEach((n,i)=>n.visible=previous[i]);}
}
export async function captureComparison(capture,compose){
 const before=await capture(false),after=await capture(true);
 return compose(before,after);
}
export function comparisonLayout(width,height,vertical=false,label=48){
 if(![width,height,label].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('对照图片尺寸无效');
 return vertical?{width,height:height*2+label*2,frames:[{x:0,y:label,labelY:32},{x:0,y:height+label*2,labelY:height+label+32}]}:
  {width:width*2,height:height+label,frames:[{x:0,y:label,labelY:32},{x:width,y:label,labelY:32}]};
}
