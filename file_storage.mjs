import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Windows readers and antivirus can briefly hold the destination open. Keep the
// old file available and retry the atomic replace, never unlink the saved data.
export async function writeJsonAtomic(target,value){
 const temporary=target+'.'+crypto.randomUUID()+'.tmp';
 await fs.writeFile(temporary,JSON.stringify(value,null,2),{flag:'wx'});
 try{
  for(let attempt=0;;attempt++){
   try{await fs.rename(temporary,target);return;}
   catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=7)throw e;await new Promise(r=>setTimeout(r,Math.min(240,15*2**attempt)));}
  }
 }finally{try{await fs.unlink(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
