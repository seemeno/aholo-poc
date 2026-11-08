const DAY=86400000;
function indexedAdapter(){
 let database;
 const open=()=>database??=new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(Error('此浏览器不支持本机暂存，请离开前保存。'));return;}
  const request=indexedDB.open('space-workshop-drafts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('本机暂存被占用，请关闭其他旧页面后重试。'));
 });
 const run=async(mode,action)=>{const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),request=action(tx.objectStore('drafts'));tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('暂存未完成'));});};
 return {get:key=>run('readonly',s=>s.get(key)),put:value=>run('readwrite',s=>s.put(value)),remove:key=>run('readwrite',s=>s.delete(key))};
}
// Blob data stays in this browser. No draft API or remote transmission is involved.
export function createDraftStore({adapter=indexedAdapter(),now=Date.now,ttlMs=7*DAY}={}){
 let tail=Promise.resolve();const enqueue=action=>{const next=tail.catch(()=>{}).then(action);tail=next;return next;};
 return {
  get:key=>enqueue(async()=>{const record=await adapter.get(key);if(!record)return null;if(record.version!==1||now()-record.updatedAt>ttlMs){await adapter.remove(key);return null;}return record.value;}),
  set:(key,value)=>enqueue(()=>adapter.put({key,version:1,updatedAt:now(),value})),
  remove:key=>enqueue(()=>adapter.remove(key)),
 };
}
export const localDrafts=createDraftStore();
export const packFile=file=>file?{blob:file,name:file.name,type:file.type,lastModified:file.lastModified}:null;
export const unpackFile=value=>value?new File([value.blob],value.name,{type:value.type,lastModified:value.lastModified}):null;
export function packItems(items){return items.map(({url,file,...item})=>({...item,size:item.size?{...item.size}:undefined,file:packFile(file)}));}
export function unpackItems(items=[]){return items.map(item=>({...item,file:unpackFile(item.file)}));}
export function createDraftWriter(store,key,{onStatus=()=>{},delayMs=250}={}){
 let timer,value,revision=0,saved=0;
 const flush=async()=>{clearTimeout(timer);if(saved===revision)return;const current=revision;try{await store.set(key,value);saved=Math.max(saved,current);if(current===revision)onStatus('saved');}catch(e){onStatus('error',e);throw e;}};
 return {
  schedule(next){value=next;revision++;onStatus('pending');clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),delayMs);},
  flush,
  async clear(){clearTimeout(timer);revision++;saved=revision;value=undefined;await store.remove(key);onStatus('empty');},
  pending:()=>saved!==revision,
  current:()=>value,
 };
}
