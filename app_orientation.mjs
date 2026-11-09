export function orientationLayout(width,height,mode='portrait',force=true){
 if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw Error('视口尺寸无效');
 const turn=!force?0:mode==='landscape'&&height>width?90:mode==='portrait'&&width>height?-90:0;
 return {width:turn?height:width,height:turn?width:height,viewportWidth:width,viewportHeight:height,turn};
}
export function logicalPoint(x,y,state){return state.turn===90?[y,state.viewportWidth-x]:state.turn===-90?[state.viewportHeight-y,x]:[x,y];}
export function clientPoint(x,y,state){return state.turn===90?[state.viewportWidth-y,x]:state.turn===-90?[y,state.viewportHeight-x]:[x,y];}
export function canvasPointer(event,rect,turn=0){
 const u=(event.clientX-rect.left)/rect.width,v=(event.clientY-rect.top)/rect.height;
 const [a,b]=turn===90?[v,1-u]:turn===-90?[1-v,u]:[u,v];return {u:a,v:b,x:a*2-1,y:1-b*2,button:event.button};
}
export function createAppOrientation(doc,parts){
 const win=doc.defaultView,viewport=doc.createElement('div'),surface=doc.createElement('div');viewport.id='appViewport';surface.id='appSurface';viewport.append(surface);doc.body.prepend(viewport);for(const part of parts)if(part)surface.append(part);
 const mobile=win.matchMedia('(pointer: coarse)').matches;let mode='portrait',state,frame;
 function update(){
  frame=null;const width=win.innerWidth,height=win.innerHeight;
  state=orientationLayout(width,height,mode,mobile);
  doc.body.dataset.appTurn=String(state.turn);doc.body.dataset.appOrientation=state.width>state.height?'landscape':'portrait';doc.body.dataset.appMobile=String(mobile);
  doc.body.style.setProperty('--app-width',state.width+'px');doc.body.style.setProperty('--app-height',state.height+'px');doc.body.style.setProperty('--app-turn',state.turn+'deg');
  surface.style.width=state.width+'px';surface.style.height=state.height+'px';surface.style.transform=state.turn===90?`translateX(${width}px) rotate(90deg)`:state.turn===-90?`translateY(${height}px) rotate(-90deg)`:'none';
  win.dispatchEvent(new win.CustomEvent('apporientationchange'));
 }
 const resize=()=>{if(frame==null)frame=win.requestAnimationFrame(update);};win.addEventListener('resize',resize);update();
 return {get state(){return state;},setMode(value){if(!['portrait','landscape'].includes(value))throw Error('方向无效');mode=value;update();},point:event=>logicalPoint(event.clientX,event.clientY,state),client:point=>clientPoint(...point,state),pointer:(event,element)=>canvasPointer(event,element.getBoundingClientRect(),state.turn)};
}
