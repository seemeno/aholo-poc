import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function git(args){return execFileSync('git',args,{cwd:root,windowsHide:true,maxBuffer:16*1024*1024}).toString().split('\0').filter(Boolean);}
// Include already tracked files: adding an ignore rule does not untrack a file.
const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']))].sort();
const trackedIgnored=git(['ls-files','--cached','--ignored','--exclude-standard','-z']);
const issues=trackedIgnored.map(file=>({file,reason:'已跟踪但应被忽略；需从 Git 索引移除'}));
const details=[];
const forbidden=/^(?:runtime|local-data|output|tmp|node_modules|\.local-python|\.alignment[^/]*|\.transfer_helpers|scene|assets\/demo)\//;
const sensitive=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgithub_pat_[A-Za-z0-9_]{40,}\b/,/\bgh[pousr]_[A-Za-z0-9]{36,}\b/,/\bAKIA[0-9A-Z]{16}\b/,/\bsk-[A-Za-z0-9_-]{32,}\b/];
for(const file of files){
 const absolute=path.resolve(root,file);
 if(!absolute.startsWith(root+path.sep)){issues.push({file,reason:'路径位于仓库外'});continue;}
 let stat;try{stat=await fs.lstat(absolute);}catch(e){if(e.code==='ENOENT')continue;throw e;}
 if(stat.isSymbolicLink()){issues.push({file,reason:'提交范围包含链接，请核对目标'});continue;}
 if(!stat.isFile())continue;
 details.push({file,bytes:stat.size});
 if(forbidden.test(file)||/\.(?:safetensors|onnx|pt|pth|ckpt|whl|mp4|mov|zip|part|download|pem|key)$/i.test(file))issues.push({file,reason:'本地数据、模型、环境或归档不应提交'});
 if(stat.size>10*1024**2){issues.push({file,reason:'超过本项目 10 MiB 的源码仓库单文件预算'});continue;}
 if(/\.(?:mjs|js|py|md|html|css|json|txt|ps1|cmd|ya?ml)$/.test(file)||file==='.env.example'){
  const contents=await fs.readFile(absolute,'utf8');
  if(sensitive.some(pattern=>pattern.test(contents))||(process.env.AHOLO_API_KEY&&contents.includes(process.env.AHOLO_API_KEY)))issues.push({file,reason:'检测到疑似密钥；检查此文件，工具不会输出密钥内容'});
 }
}
const report={files:details.length,bytes:details.reduce((sum,f)=>sum+f.bytes,0),largest:details.toSorted((a,b)=>b.bytes-a.bytes).slice(0,8),issues};
if(process.argv.includes('--json'))console.log(JSON.stringify(report,null,2));
else{
 console.log(`GitHub candidate files: ${report.files}; total ${(report.bytes/1024**2).toFixed(2)} MiB`);
 for(const entry of report.largest)console.log(`  ${(entry.bytes/1024).toFixed(1)} KiB  ${entry.file}`);
 if(issues.length)for(const issue of issues)console.error(`${issue.file}: ${issue.reason}`);
 else console.log('PASS: no excluded runtime data, oversized files or recognized secret patterns in candidates.');
 console.log('This checks common patterns, not every possible secret or asset license.');
}
if(issues.length)process.exitCode=1;
