import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore,createDraftWriter,packItems,unpackItems} from '../local_drafts.mjs';

function memory(){const records=new Map();return {records,async get(key){return structuredClone(records.get(key));},async put(record){records.set(record.key,structuredClone(record));},async remove(key){records.delete(key);}};}
test('local drafts preserve photo bytes, names, partial measurements and project isolation across sessions',async()=>{
 const adapter=memory(),store=createDraftStore({adapter}),file=new File(['real-byte-content'],'家具.jpg',{type:'image/jpeg',lastModified:123});
 await store.set('room:new',{items:packItems([{file,name:'椅子',size:{width:.8},sourceAssetId:'already-uploaded'}]),pendingIds:['draft-job']});
 await store.set('room:another',{name:'另一个空间'});
 const second=createDraftStore({adapter}),loaded=await second.get('room:new'),[item]=unpackItems(loaded.items);
 assert.equal(item.file.name,'家具.jpg');assert.equal(item.file.lastModified,123);assert.equal(await item.file.text(),'real-byte-content');assert.deepEqual(item.size,{width:.8});assert.equal(item.sourceAssetId,'already-uploaded');assert.deepEqual(loaded.pendingIds,['draft-job']);
 await second.remove('room:new');assert.equal(await store.get('room:new'),null);assert.equal((await second.get('room:another')).name,'另一个空间');
});
test('a successful submission clears pending local writes without resurrecting an earlier draft',async()=>{
 const adapter=memory();let release,entered;const enteredGate=new Promise(r=>entered=r),gate=new Promise(r=>release=r),put=adapter.put;
 adapter.put=async value=>{entered();await gate;await put(value);};
 const store=createDraftStore({adapter}),writer=createDraftWriter(store,'room:new',{delayMs:100000});
 writer.schedule({name:'old'});const writing=writer.flush();await enteredGate;const clearing=writer.clear();release();await Promise.all([writing,clearing]);
 assert.equal(writer.pending(),false);assert.equal(await store.get('room:new'),null);
});
test('expired drafts stop offering restoration and storage failures retain an unsaved state',async()=>{
 const adapter=memory();let now=0;const store=createDraftStore({adapter,now:()=>now,ttlMs:10});await store.set('a',{name:'old'});now=11;assert.equal(await store.get('a'),null);assert.equal(adapter.records.size,0);
 adapter.put=async()=>{throw Error('quota');};const writer=createDraftWriter(store,'b',{delayMs:100000});writer.schedule({name:'retain'});await assert.rejects(writer.flush(),/quota/);assert.equal(writer.pending(),true);assert.equal(writer.current().name,'retain');await writer.clear();
});
