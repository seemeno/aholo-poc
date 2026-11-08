import {spawn} from 'node:child_process';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const logs=path.join(root,'local-data/service-logs');
await mkdir(logs,{recursive:true});

async function available(url,marker){
 try{const response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.status!==200){await response.body?.cancel();return false;}if(marker)return (await response.text()).includes(marker);await response.body?.cancel();return true;}
 catch{return false;}
}
async function start(name,executable,args,url,marker){
 if(await available(url,marker)){console.log(`${name} already available: ${url}`);return;}
 const lock=path.join(logs,name+'.start.lock');let ownsLock=false;
 try{
 for(let attempt=0;attempt<40;attempt++){
  try{const file=await open(lock,'wx');ownsLock=true;try{await file.writeFile(String(process.pid));}finally{await file.close();}break;}
  catch(error){if(error.code!=='EEXIST')throw error;const pid=Number(await readFile(lock,'utf8').catch(()=>''));if(pid>0){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){await unlink(lock).catch(()=>{});continue;}}}}
  if(await available(url,marker)){console.log(`${name} already available: ${url}`);return;}
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(!ownsLock)throw Error(`${name} is still starting. Please retry shortly.`);
 // An existing foreground process may still be reaching its listen callback.
 for(let attempt=0;attempt<4;attempt++){if(await available(url,marker)){console.log(`${name} already available: ${url}`);return;}await new Promise(resolve=>setTimeout(resolve,250));}
 const stdout=openSync(path.join(logs,name+'.stdout.log'),'a');
 const stderr=openSync(path.join(logs,name+'.stderr.log'),'a');
 let child,launchError;
 try{
  child=spawn(executable,args,{cwd:root,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});
  child.once('error',error=>{launchError=error;});
  child.unref();
 }finally{closeSync(stdout);closeSync(stderr);}
 for(let attempt=0;attempt<30;attempt++){
  if(await available(url,marker)){console.log(`${name} started (PID ${child.pid}): ${url}`);return;}
  if(launchError)throw launchError;
  if(child.exitCode!==null)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error(`${name} did not start. Check ${path.join(logs,name+'.stderr.log')}`);
 }finally{if(ownsLock)await unlink(lock).catch(()=>{});}
}

try{
 await start('editor',process.execPath,[path.join(root,'structure_server.mjs'),'--lan'],'http://127.0.0.1:8787/','data-ui-version="integrated-v1"');
}catch(error){console.error(error.message);process.exitCode=1;}
