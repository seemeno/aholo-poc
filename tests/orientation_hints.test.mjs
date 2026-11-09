import test from 'node:test';
import assert from 'node:assert/strict';
import {orientationLayout,logicalPoint,clientPoint,canvasPointer,createAppOrientation} from '../app_orientation.mjs';
import {createHoldHint} from '../button_hints.mjs';

test('landscape and portrait layouts work in a locked viewport without native fullscreen',()=>{
 assert.deepEqual(orientationLayout(390,844,'landscape'),{width:844,height:390,viewportWidth:390,viewportHeight:844,turn:90});
 assert.equal(orientationLayout(844,390,'landscape').turn,0);assert.equal(orientationLayout(844,390,'portrait').turn,-90);assert.equal(orientationLayout(1440,900,'portrait',false).turn,0);
 for(const [w,h]of [[320,740],[390,844],[844,390],[1440,900]])for(const mode of ['portrait','landscape']){const state=orientationLayout(w,h,mode);for(const p of [[0,0],[state.width/2,state.height/2],[state.width,state.height]])assert.deepEqual(logicalPoint(...clientPoint(...p,state),state),p);}
});
test('rotated canvas picking maps screen corners and a scale-handle hit to the same logical ray',()=>{
 const rect={left:17,top:23,width:390,height:844};
 for(const turn of [0,90,-90])for(const [u,v]of [[0,0],[.2,.8],[.5,.5],[.74,.13],[1,1]]){
  const [a,b]=turn===90?[1-v,u]:turn===-90?[v,1-u]:[u,v];const p=canvasPointer({clientX:rect.left+a*rect.width,clientY:rect.top+b*rect.height,button:-1},rect,turn);
  assert.ok(Math.abs(p.x-(u*2-1))<1e-12);assert.ok(Math.abs(p.y-(1-v*2))<1e-12);assert.equal(p.button,-1);
 }
});
test('the same toggle turns a locked portrait viewport sideways and restores portrait without a fullscreen request',()=>{
 const element=()=>({children:[],dataset:{},style:{setProperty(key,value){this[key]=value;}},append(...nodes){this.children.push(...nodes);},prepend(node){this.children.unshift(node);}});
 const body=element(),events=[],win={innerWidth:390,innerHeight:844,matchMedia:()=>({matches:true}),addEventListener(){},dispatchEvent:e=>events.push(e.type),CustomEvent:class{constructor(type){this.type=type;}},requestAnimationFrame(){throw Error('No resize expected');}};
 const doc={body,defaultView:win,createElement:element,documentElement:{requestFullscreen(){throw Error('Must not request fullscreen');}}},header=element(),main=element(),control=createAppOrientation(doc,[header,main]);
 assert.equal(body.dataset.appTurn,'0');control.setMode('landscape');assert.equal(body.dataset.appTurn,'90');assert.equal(control.state.width,844);assert.equal(body.children[0].children[0].style.transform,'translateX(390px) rotate(90deg)');
 control.setMode('portrait');assert.equal(body.dataset.appTurn,'0');assert.equal(control.state.width,390);assert.equal(body.children[0].children[0].style.transform,'none');assert.equal(events.length,3);
});
function harness(){let task=null,shown=0,hidden=0;const hold=createHoldHint({show:()=>shown++,hide:()=>hidden++,schedule:fn=>(task=fn,1),unschedule:()=>task=null});return {hold,fire:()=>task?.(),get shown(){return shown;},get hidden(){return hidden;}};}
test('long press shows a label and consumes its release click; the next intentional tap still works',()=>{
 const h=harness(),button={},down={pointerId:1,clientX:10,clientY:10};h.hold.begin(button,down);h.fire();assert.equal(h.shown,1);assert.equal(h.hold.end(down),true);assert.equal(h.hold.consumeClick(button,1),true);
 h.hold.begin(button,down);assert.equal(h.hold.end(down),false);assert.equal(h.hold.consumeClick(button,1),false);
});
test('dragging, a second finger and cancellation do not trigger a tooltip or swallow normal clicks',()=>{
 for(const move of [{pointerId:1,clientX:30,clientY:10},{pointerId:2,clientX:10,clientY:10}]){const h=harness(),button={};h.hold.begin(button,{pointerId:1,clientX:10,clientY:10});h.hold.move(move);h.fire();assert.equal(h.shown,0);assert.equal(h.hold.consumeClick(button,1),false);}
 const h=harness();h.hold.begin({}, {pointerId:1,clientX:0,clientY:0});h.hold.cancel();h.fire();assert.equal(h.shown,0);
});
