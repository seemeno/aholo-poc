import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findPython} from '../python_runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=spawnSync(await findPython(),['-m','unittest','discover','-s','tests','-p','test_*.py','-v'],{
 cwd:root,stdio:'inherit',windowsHide:true,
 env:{...process.env,PYTHONPATH:[path.join(root,'.local-python'),process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),PYTHONUTF8:'1'},
});
if(result.error)throw result.error;
process.exitCode=result.status??1;
