import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

// Resolve PATH commands as well as absolute interpreter paths on a fresh checkout.
export async function findPython(){
 const candidates=process.env.AHOLO_PYTHON?[process.env.AHOLO_PYTHON]:[
  ...(process.platform==='win32'?['C:/Program Files/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe']:[]),
  'python3','python',
 ];
 for(const command of candidates){
  try{
   const result=await run(command,['-c','import sys,json;print(json.dumps([sys.executable,*sys.version_info[:2]]))'],{windowsHide:true,timeout:10000});
   const [executable,major,minor]=JSON.parse(result.stdout.trim());
   if(major===3&&minor>=11&&typeof executable==='string')return executable;
  }catch{}
 }
 throw Error('未找到 Python 3.11+。请设置 AHOLO_PYTHON 为 python.exe 的完整路径，并安装 requirements.txt。');
}
