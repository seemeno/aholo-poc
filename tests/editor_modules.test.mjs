import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {createSceneSaveState} from '../editor_persistence.mjs';
import {createEditorViewport} from '../editor_viewport.mjs';
import {createEditorCapture} from '../editor_capture.mjs';
import {createEditorUI} from '../editor_ui.mjs';
import {roomEnvelope} from '../editor_room.mjs';
import fs from 'node:fs/promises';

test('queued editor saves use the last acknowledged CAS version and do not mark newer edits saved',async()=>{
 const requests=[];let release;const blocked=new Promise(resolve=>release=resolve);
 const store=createSceneSaveState({projectId:'room',endpoint:'/scene',request:async(url,{body})=>{requests.push(body);if(requests.length===1)await blocked;return {savedAt:'v'+requests.length};}});
 store.changed();const first=store.persist({objects:['first']});await Promise.resolve();store.changed();const next=store.persist({objects:['next']});store.changed();assert.equal(store.state.pending,2);release();await Promise.all([first,next]);
 assert.deepEqual(requests.map(r=>r.expectedSavedAt),[null,'v1']);assert.equal(store.state.savedRevision,2);assert.equal(store.state.revision,3);assert.equal(store.state.dirty,true);assert.equal(store.state.pending,0);
});

test('a save conflict stops queued writes until an explicitly restored version rebases them',async()=>{
 let calls=0;const store=createSceneSaveState({projectId:'room',endpoint:'/scene',request:async()=>{if(++calls===1)throw Object.assign(Error('conflict'),{status:409});return {savedAt:'v3'};}});
 store.changed();const result=await Promise.allSettled([store.persist({x:1}),store.persist({x:2})]);assert.ok(result.every(r=>r.status==='rejected'));assert.equal(calls,1);assert.equal(store.state.conflict,true);assert.equal(store.state.dirty,true);
 store.adopt({savedAt:'v2'},{clean:false});await store.persist({x:3});assert.equal(store.state.version,'v3');assert.equal(store.state.conflict,false);assert.equal(store.state.dirty,false);
});

test('failed save retries retain the original version; automatic initialization resets only edit revisions',async()=>{
 let fail=true;const seen=[],store=createSceneSaveState({projectId:'room',endpoint:'/scene',request:async(_,body)=>{seen.push(body.body.expectedSavedAt);if(fail)throw Error('offline');return {savedAt:'v2'};}});
 store.adopt({savedAt:'v1'});store.changed();await assert.rejects(store.persist({x:1}),/offline/);assert.equal(store.state.version,'v1');fail=false;await store.persist({x:2});assert.deepEqual(seen,['v1','v1']);store.resetBaseline();assert.equal(store.state.version,'v2');assert.equal(store.state.revision,0);
});

class Canvas extends EventTarget{constructor(){super();this.style={};this.width=844;this.height=390;}remove(){this.removed=true;}}
class Renderer{constructor(){this.domElement=new Canvas();this.ratio=1.5;this.size=new THREE.Vector2(844,390);this.disposed=0;}setPixelRatio(v){this.ratio=v;}getPixelRatio(){return this.ratio;}setClearColor(){}setAnimationLoop(fn){this.loop=fn;}setSize(w,h){this.size.set(w,h);this.domElement.width=w;this.domElement.height=h;}getSize(out){return out.copy(this.size);}render(){}dispose(){this.disposed++;}}
class Controls extends THREE.EventDispatcher{constructor(){super();this.target=new THREE.Vector3();this.enabled=true;}update(){}dispose(){this.disposed=true;}}
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/room-structure.json',import.meta.url)));
function viewportFixture(){
 let camera=null,creates=0;const room=roomEnvelope(fixture,[]),doc={hidden:false},elements={three:{append(){}},stage:{clientWidth:844,clientHeight:390},previewQuality:{value:'clear'},assetError:{},assetErrorText:{}};
 let viewport;const api={$:id=>elements[id],document:doc,pixelRatio:1.5,structure:()=>fixture,room:()=>room,objects:()=>[],view:()=> 'gaussian',busy:()=>false,ready:()=>true,mobile:()=>true,pendingCamera:()=>camera,rememberCamera:v=>camera=v,pointer:()=>({x:0,y:0}),suspend(){},bindInput(){},openView:()=>viewport.setupThree(),loading(){},status(){},onCameraCommit(){},onSelection(){},refresh(){},ensureObjects:async()=>{},loadTemplate(){},onTransformDrag(){},onTransformChange(){},asset:name=>name,loadGraphics:async()=>{creates++;return {THREE:{...THREE,WebGLRenderer:Renderer},OrbitControls:Controls,TransformControls,GLTFLoader:class{}};}};
 viewport=createEditorViewport(api);return {viewport,elements,doc,get creates(){return creates;},get savedCamera(){return camera;}};
}

test('viewport shares initialization, follows logical viewport dimensions and restores camera through recovery',async()=>{
 const f=viewportFixture();await Promise.all([f.viewport.setupThree(),f.viewport.setupThree()]);assert.equal(f.creates,1);const old=f.viewport.state;f.viewport.layoutThree();assert.equal(old.camera.aspect,844/390);
 const saved=f.viewport.cameraRows();await f.viewport.recoverViewer();assert.equal(f.creates,2);assert.equal(old.renderer.disposed,1);assert.equal(old.renderer.domElement.removed,true);assert.deepEqual(f.viewport.cameraRows(),saved);assert.deepEqual(f.savedCamera.rows,saved);
 f.elements.stage.clientWidth=390;f.elements.stage.clientHeight=844;f.viewport.layoutThree();assert.equal(f.viewport.state.camera.aspect,390/844);await f.viewport.centerSceneCamera();assert.equal(f.viewport.state.camera.fov,65);
});

test('context loss pauses the renderer and export sizing is not overwritten by layout',async()=>{
 const f=viewportFixture();await f.viewport.setupThree();const state=f.viewport.state;state.exporting=true;state.renderer.setSize(512,256);f.viewport.layoutThree();assert.deepEqual(state.renderer.size.toArray(),[512,256]);state.exporting=false;
 state.renderer.domElement.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));assert.equal(state.contextLost,true);assert.equal(state.renderer.loop,null);assert.equal(state.controls.enabled,false);
});

test('capture keeps complete current view and restores renderer, visibility and input after save failure',async t=>{
 const previous={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};t.after(()=>Object.assign(globalThis,previous));
 const main={inert:false},doc=new EventTarget();doc.hidden=false;doc.querySelector=()=>main;doc.createElement=()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=> 'data:image/png;base64,test'});globalThis.document=doc;globalThis.requestAnimationFrame=fn=>{queueMicrotask(fn);return 1;};globalThis.cancelAnimationFrame=()=>{};
 const renderer=new Renderer(),camera=new THREE.PerspectiveCamera(65,844/390,.03,100),state={THREE,renderer,camera,controls:{enabled:true},splat:{},scene:{},modelRoot:new THREE.Object3D(),proxies:new THREE.Object3D(),selectionBox:new THREE.Object3D(),transform:{getHelper:()=>helper}};const helper=new THREE.Object3D();
 const capture=createEditorCapture({projectId:'room',viewport:()=>state,view:()=> 'gaussian',requireEdits(){},commitObject(){},objects:()=>[{visible:true}],openView:async()=>{},ensureObjects:async()=>{},snapshot:()=>({camera:{viewAspect:camera.aspect}}),persist:async()=>{throw Error('save failed');},sync(){}});
 await assert.rejects(capture.captureEffect(),/save failed/);assert.equal(capture.busy,false);assert.equal(main.inert,false);assert.equal(state.controls.enabled,true);assert.equal(state.exporting,false);assert.equal(camera.aspect,844/390);assert.equal(renderer.getPixelRatio(),1.5);assert.deepEqual(renderer.size.toArray(),[844,390]);assert.ok([state.modelRoot,state.proxies,state.selectionBox,helper].every(n=>n.visible));
});

test('UI owner keeps view switching, panel state and orientation labels together without rebinding',async t=>{
 const previous={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};t.after(()=>Object.assign(globalThis,previous));
 const elements=new Map(),classes=()=>{const set=new Set();return {add:key=>set.add(key),remove:key=>set.delete(key),contains:key=>set.has(key)};};
 const element=id=>({id,textContent:'',dataset:{},hidden:false,classList:classes(),attributes:new Map(),setAttribute(key,value){this.attributes.set(key,value);},getAttribute(key){return this.attributes.get(key);},hasAttribute(key){return this.attributes.has(key);},querySelector(){return null;},matches:()=>false,scrollIntoView(){},focus(){}});
 const $=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},doc={body:{classList:classes()},querySelectorAll:()=>[],activeElement:null,fullscreenElement:null};globalThis.document=doc;globalThis.requestAnimationFrame=fn=>{fn();return 1;};
 let view='gaussian',opens=0;const ui=createEditorUI({$,main:$('main'),orientation:{},mobile:()=>true,view:()=>view,editing:()=>false,busy:()=>false,draw(){},precise(){},requireEdits(){},openView:async value=>{opens++;view=value;}});
 ui.bind();const bound=$('planBtn').onclick;ui.bind();assert.equal($('planBtn').onclick,bound);await bound();assert.equal(opens,1);assert.equal(view,'plan');ui.syncViewTools();assert.equal($('main').dataset.view,'plan');assert.equal($('expandScene').getAttribute('aria-pressed'),'false');
 doc.body.classList.add('view-expanded');ui.syncExpandButton();assert.equal($('expandScene').getAttribute('aria-label'),'切回竖屏');assert.equal($('main').classList.contains('compact'),true);await $('view3d').onclick();ui.openPanel('more','moreTools');assert.equal(ui.group,'more');assert.equal($('main').classList.contains('compact'),false);ui.closePanel();assert.equal($('main').classList.contains('compact'),true);
});
