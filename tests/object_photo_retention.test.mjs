import test from 'node:test';
import assert from 'node:assert/strict';
import {saveObjectPhotos} from '../object_photos.mjs';
test('partial photo retries retain fields and a saved asset ID without reuploading successful bytes',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let uploads=0,creations=0;
 globalThis.fetch=async(url,options)=>{
  if(url.includes('/objects?')){uploads++;return Response.json({id:'asset-'+uploads});}
  creations++;const item=JSON.parse(options.body).items[0];
  if(creations===2)return Response.json({error:'temporary task-record failure'},{status:500});
  return Response.json({jobs:[{id:'job-'+creations,...item}]});
 };
 const items=['chair','lamp'].map((name,i)=>({localId:String(i),name,category:'furniture',file:new File(['test'],name+'.jpg'),size:{width:.8,depth:.7,height:.9}}));
 const first=await saveObjectPhotos('project',items);assert.equal(first.jobs.length,1);assert.equal(first.failedItems.length,1);assert.equal(uploads,2);
 assert.equal(first.failedItems[0].name,'lamp');assert.deepEqual(first.failedItems[0].size,items[1].size);assert.equal(first.failedItems[0].sourceAssetId,'asset-2');
 const second=await saveObjectPhotos('project',first.failedItems);assert.equal(second.errors.length,0);assert.equal(second.jobs.length,1);assert.equal(uploads,2);assert.equal(creations,3);
});
