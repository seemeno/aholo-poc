export function createHoldHint({show,hide,schedule=setTimeout,unschedule=clearTimeout,delay=500}){
 let timer=null,press=null,suppressed=null;
 const clear=()=>{if(timer!==null)unschedule(timer);timer=null;};
 return {
  begin(button,event){clear();hide();suppressed=null;press={button,id:event.pointerId,x:event.clientX,y:event.clientY,fired:false};timer=schedule(()=>{timer=null;if(press){press.fired=true;suppressed=button;show(button);}},delay);},
  move(event){if(press&&(event.pointerId!==press.id||Math.hypot(event.clientX-press.x,event.clientY-press.y)>10))this.cancel();},
  end(event){if(!press||press.id!==event.pointerId)return false;const fired=press.fired;clear();press=null;return fired;},
  cancel(){clear();press=null;hide();},
  consumeClick(button,detail=1){if(detail!==0&&button===suppressed){suppressed=null;return true;}return false;}
 };
}

export function installButtonHints(doc=document,orientation=null){
 const win=doc.defaultView,tip=doc.createElement('div');tip.id='buttonHint';tip.className='app-button-hint';tip.setAttribute('role','tooltip');tip.hidden=true;doc.body.append(tip);
 let owner=null,hoverTimer=null,hideTimer=null,keyboard=false,lastType='',pointers=new Set();
 const buttonFor=target=>target?.closest?.('button[aria-label],button[title],button[data-tooltip],a[aria-label]');
 const clearTimers=()=>{clearTimeout(hoverTimer);clearTimeout(hideTimer);hoverTimer=null;hideTimer=null;};
 const hide=()=>{clearTimers();tip.hidden=true;if(owner){const rest=(owner.getAttribute('aria-describedby')??'').split(/\s+/).filter(x=>x&&x!==tip.id);if(rest.length)owner.setAttribute('aria-describedby',rest.join(' '));else owner.removeAttribute('aria-describedby');}owner=null;};
 const prepare=button=>{const title=button.getAttribute('title');if(title){if(!button.getAttribute('aria-label'))button.setAttribute('aria-label',title);button.removeAttribute('title');}return button;};
 const show=button=>{
  if(!button?.isConnected)return;hide();prepare(button);const label=button.dataset.tooltip||button.getAttribute('aria-label');if(!label)return;
  owner=button;tip.textContent=label;const modal=button.closest('dialog[open]');(modal??doc.body).append(tip);tip.hidden=false;tip.style.cssText='';
  button.setAttribute('aria-describedby',[(button.getAttribute('aria-describedby')??''),tip.id].filter(Boolean).join(' '));
  if(modal){Object.assign(tip.style,{position:'absolute',left:'8px',right:'8px',bottom:'8px',top:'auto',width:'auto'});return;}
  const r=button.getBoundingClientRect(),t=tip.getBoundingClientRect(),state=orientation?.state,turn=state?.turn??0,w=state?.width??win.innerWidth,h=state?.height??win.innerHeight;
  const center=orientation?orientation.point({clientX:r.left+r.width/2,clientY:r.top+r.height/2}):[r.left+r.width/2,r.top+r.height/2],buttonHeight=turn?r.width:r.height;
  const x=Math.max(t.width/2+8,Math.min(w-t.width/2-8,center[0])),above=center[1]-buttonHeight/2-t.height/2-10,y=Math.max(t.height/2+8,Math.min(h-t.height/2-8,above>=t.height/2+8?above:center[1]+buttonHeight/2+t.height/2+10)),point=orientation?orientation.client([x,y]):[x,y];
  tip.style.left=point[0]-t.width/2+'px';tip.style.top=point[1]-t.height/2+'px';tip.style.transform='rotate('+turn+'deg)';
 };
 const hold=createHoldHint({show,hide}),listeners=[];
 const on=(target,event,callback)=>{target.addEventListener(event,callback,true);listeners.push(()=>target.removeEventListener(event,callback,true));};
 on(doc,'pointerdown',e=>{keyboard=false;lastType=e.pointerType;pointers.add(e.pointerId);if(pointers.size>1){hold.cancel();return;}const button=buttonFor(e.target);if(button&&e.button===0)hold.begin(prepare(button),e);else hold.cancel();});
 on(doc,'pointermove',e=>hold.move(e));
 on(doc,'pointerup',e=>{pointers.delete(e.pointerId);if(hold.end(e))hideTimer=setTimeout(hide,1800);});
 on(doc,'pointercancel',e=>{pointers.delete(e.pointerId);hold.cancel();});
 on(doc,'click',e=>{const button=buttonFor(e.target);if(button&&hold.consumeClick(button,e.detail)){e.preventDefault();e.stopImmediatePropagation();return;}hold.cancel();});
 on(doc,'contextmenu',e=>{if(lastType==='touch'&&buttonFor(e.target))e.preventDefault();});
 on(doc,'pointerover',e=>{if(e.pointerType!=='mouse'||e.buttons)return;const button=buttonFor(e.target);if(!button||buttonFor(e.relatedTarget)===button)return;hide();prepare(button);hoverTimer=setTimeout(()=>show(button),350);});
 on(doc,'pointerout',e=>{if(e.pointerType==='mouse'&&buttonFor(e.target)!==buttonFor(e.relatedTarget))hide();});
 on(doc,'keydown',e=>{keyboard=true;if(e.key==='Escape')hold.cancel();});
 on(doc,'focusin',e=>{const button=buttonFor(e.target);if(keyboard&&button)show(button);});
 on(doc,'focusout',hide);on(doc,'scroll',()=>hold.cancel());on(doc,'close',()=>hold.cancel());on(win,'resize',()=>hold.cancel());on(win,'blur',()=>{pointers.clear();hold.cancel();});
 return {dispose(){hold.cancel();for(const remove of listeners)remove();tip.remove();}};
}
