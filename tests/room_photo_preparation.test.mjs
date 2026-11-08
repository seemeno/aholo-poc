import test from 'node:test';
import assert from 'node:assert/strict';
import {roomPhotoDimensions,restoreRoomPhoto} from '../photo_checks.mjs';

test('room inputs fit the verified 2048 edge without cropping or enlarging smaller photos',()=>{
 assert.deepEqual(roomPhotoDimensions(4096,3072),{width:2048,height:1536});
 assert.deepEqual(roomPhotoDimensions(3072,4096),{width:1536,height:2048});
 assert.deepEqual(roomPhotoDimensions(1672,941),{width:1672,height:941});
 assert.deepEqual(roomPhotoDimensions(1,10000),{width:1,height:2048});
 for(const width of [0,-1,NaN,Infinity,1.5])assert.throws(()=>roomPhotoDimensions(width,1080));
});
test('restoring an old prepared JPEG invalidates its upload marker after compatible conversion',async()=>{
 const old=new File(['old-jpeg'],'room.jpg',{type:'image/jpeg'}),png=new File(['new-png'],'room.png',{type:'image/png'});
 const result=await restoreRoomPhoto(old,true,async source=>{assert.equal(source,old);return {file:png,check:{width:2048,height:1536}};});
 assert.equal(result.file,png);assert.equal(result.prepared,false);assert.equal(result.check.width,2048);
});
test('only byte-identical restored PNGs keep a prepared upload; same-size changed bytes require reupload',async()=>{
 const old=new File(['abcd'],'room.png',{type:'image/png'});
 const normalize=bytes=>async()=>({file:new File([bytes],'room.png',{type:'image/png'}),check:{}});
 assert.equal((await restoreRoomPhoto(old,true,normalize('abcd'))).prepared,true);
 assert.equal((await restoreRoomPhoto(old,true,normalize('abce'))).prepared,false);
 assert.equal((await restoreRoomPhoto(old,false,normalize('abcd'))).prepared,false);
 let called=false;assert.equal((await restoreRoomPhoto(null,true,async()=>{called=true;})).file,null);assert.equal(called,false);
});
