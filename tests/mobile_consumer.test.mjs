import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveMeasurements,resizedPlacement} from '../try_on.mjs';
import {comparisonLayout} from '../comparison_view.mjs';
import {createViewerActivity} from '../viewer_activity.mjs';
import {decodePhotoFile} from '../photo_checks.mjs';

const floor={z:0,bounds:[[-3,-3],[3,3]]};
const chair={id:'chair',mode:'floor',visible:true,pose:{x:0,y:0,z:0,yaw:Math.PI/4},size:{width:1,depth:.5,height:.8}};
test('placed size edits preserve position and rotation, infer proportions and record only entered axes',()=>{
 const original=structuredClone(chair),next=resizedPlacement(chair,resolveMeasurements(chair.size,{height:1.6}),floor);
 assert.deepEqual(next.size,{width:2,depth:1,height:1.6});assert.deepEqual(next.measuredAxes,['height']);assert.deepEqual(next.pose,chair.pose);assert.deepEqual(chair,original);
});
test('illegal placed resize leaves original object and provenance untouched',()=>{
 const source={...structuredClone(chair),measuredAxes:['width'],sizeBasis:'USER_PARTIAL_STAGING_SIZE'},original=structuredClone(source);
 assert.throws(()=>resizedPlacement(source,resolveMeasurements(source.size,{width:10}),floor),/地面范围/);assert.deepEqual(source,original);
 const other={...structuredClone(chair),id:'other',pose:{x:2,y:0,z:0,yaw:0},size:{width:1,depth:1,height:1}};
 assert.throws(()=>resizedPlacement(source,resolveMeasurements(source.size,{width:4}),floor,[source,other]),/重叠/);assert.deepEqual(source,original);
});
test('resizing a floating object never drops it to the floor, and hidden objects do not obstruct',()=>{
 const floating={...structuredClone(chair),mode:'free',pose:{x:0,y:0,z:1.2,yaw:.2}},other={...structuredClone(chair),id:'hidden',visible:false};
 const next=resizedPlacement(floating,resolveMeasurements(floating.size,{width:1.5}),floor,[other]);assert.equal(next.pose.z,1.2);assert.equal(next.mode,'free');
});
test('both comparison orientations preserve equal full frames and separate labels',()=>{
 for(const [w,h]of [[1280,720],[720,1280]]){
  const horizontal=comparisonLayout(w,h),vertical=comparisonLayout(w,h,true);
  assert.deepEqual([horizontal.width,horizontal.height],[w*2,h+48]);assert.deepEqual([vertical.width,vertical.height],[w,h*2+96]);
  for(const layout of [horizontal,vertical])for(const f of layout.frames){assert.ok(f.x+w<=layout.width);assert.ok(f.y+h<=layout.height);assert.ok(f.labelY<f.y);}
  assert.equal(vertical.frames[1].y,vertical.frames[0].y+h+48);
 }
 assert.throws(()=>comparisonLayout(0,720));
});
test('viewer pauses once in background or context loss and resumes only when visible and available',()=>{
 let starts=0,stops=0;const activity=createViewerActivity({start:()=>starts++,stop:()=>stops++});
 activity.sync();activity.sync();assert.equal(starts,1);activity.sync({hidden:true});activity.sync({hidden:true,lost:true});assert.equal(stops,1);
 activity.sync({lost:true});activity.sync({visible:false});assert.equal(starts,1);activity.sync();assert.equal(starts,2);activity.dispose();assert.equal(stops,2);
});
test('photo decoder falls back to Image when bitmap API rejects, and releases object URLs',async t=>{
 const previous={bitmap:globalThis.createImageBitmap,image:globalThis.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL};let revoked=0,attempts=0;
 t.after(()=>{if(previous.bitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=previous.bitmap;if(previous.image===undefined)delete globalThis.Image;else globalThis.Image=previous.image;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;});
 globalThis.createImageBitmap=async()=>{attempts++;throw Error('unsupported');};URL.createObjectURL=()=> 'blob:fixture';URL.revokeObjectURL=()=>revoked++;
 globalThis.Image=class{width=800;height=600;set src(value){assert.equal(value,'blob:fixture');queueMicrotask(()=>this.onload());}};
 const image=await decodePhotoFile(new File(['fixture'],'phone.heic'));assert.equal(image.width,800);assert.equal(attempts,2);assert.equal(revoked,1);
 globalThis.Image=class{set src(value){queueMicrotask(()=>this.onerror());}};await assert.rejects(decodePhotoFile(new File(['bad'],'phone.heic')),/JPEG/);assert.equal(revoked,2);
});
