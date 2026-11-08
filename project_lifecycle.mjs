import fs from 'node:fs/promises';
import path from 'node:path';

const conflict=()=>Object.assign(Error('空间正在使用或处理，请稍后重试。'),{statusCode:409});

// A transition cannot race an admitted upload, save, or job-start request.
export function projectActivity(){
 const readers=new Map(),transitions=new Set();
 return {
  enter(id){if(transitions.has(id))throw conflict();readers.set(id,(readers.get(id)??0)+1);return ()=>{const left=readers.get(id)-1;if(left)readers.set(id,left);else readers.delete(id);};},
  transition(id){if(transitions.has(id)||readers.has(id))throw conflict();transitions.add(id);return ()=>transitions.delete(id);},
 };
}

export async function assertProjectIdle(id,{projects,generations,effects}){
 if(projects.busy.has(id)||projects.uploading.has(id)||projects.sceneSaving.has(id)||[...generations.pool.running].some(key=>key.startsWith(id+':')))throw conflict();
 // Check durable states without resuming work. Historical copied spaces can
 // contain completed jobs carrying their source project's ID.
 let objectIds=[];const objectBase=path.join(projects.dir(id),'object-generations');
 try{objectIds=await fs.readdir(objectBase);}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const jobId of objectIds.filter(n=>/^[a-f0-9]{64}$/.test(n))){
  const lines=(await fs.readFile(path.join(objectBase,jobId,'job.ndjson'),'utf8')).split('\n');let j;
  for(const line of lines.reverse()){try{j=JSON.parse(line);break;}catch{}}
  if(!j||!['DRAFT','READY','FAILED','PAUSED','SUBMIT_UNKNOWN'].includes(j.state))throw conflict();
 }
 // Legacy cloud records are checked from disk only; the retired renderer is
 // never constructed or resumed by the application.
 const cloudBase=path.join(projects.root,'local-data/rendercloud');
 const legacyCloud={base:cloudBase,load:jobId=>fs.readFile(path.join(cloudBase,jobId,'job.json'),'utf8').then(JSON.parse)};
 for(const [manager,terminal,running]of [
  [effects,new Set(['READY','FAILED','SUBMIT_UNKNOWN']),effects.pool.running],
  [legacyCloud,new Set(['READY','FAILED','SUBMIT_UNKNOWN','IMPORT_UNKNOWN','INTERRUPTED']),new Set()],
 ]){
  let names;try{names=await fs.readdir(manager.base);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  for(const jobId of names.filter(n=>/^[a-f0-9]{64}$/.test(n))){const j=await manager.load(jobId);if(j.projectId===id&&(!terminal.has(j.state)||running.has(jobId)))throw conflict();}
 }
}
