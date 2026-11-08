import fs from 'node:fs/promises';
import {api,unwrap,parseLossless} from './api_client.mjs';
export async function uploadAsset(file,{md5,name,size}){
 const r=await api('/asset/v1/token');if(!r.ok)throw Error(`素材上传凭证获取失败 HTTP ${r.http}`);const token=unwrap(r.body),host=new URL(token.globalDomain);
 if(host.protocol!=='https:'||host.username||host.password||!/(^|\.)kujiale\.com$/.test(host.hostname))throw Error('素材上传域名与已核对的 OUS 域名不符');
 const blockSize=Math.min(Number(token.blockSize),8*1024*1024);if(!Number.isInteger(blockSize)||blockSize<=0)throw Error('Invalid upload block size');
 const ous=async(endpoint,body)=>{const response=await fetch(new URL(endpoint,host),{method:body?'POST':'GET',headers:{'ous-token-v2':token.ousToken},body,redirect:'error',signal:AbortSignal.timeout(60000)});const result=parseLossless(await response.text());if(!response.ok)throw Error(`素材传输 HTTP ${response.status}`);return unwrap(result);};
 if(size<=blockSize){const form=new FormData();form.set('md5',md5);form.set('file',new Blob([await fs.readFile(file)]),name);await ous('/ous/api/v2/single/upload',form);}
 else{
  const blocks=Math.ceil(size/blockSize),init=await ous('/ous/api/v2/block/upload/init?'+new URLSearchParams({md5,blocks:String(blocks),size:String(size),name}),new Uint8Array());
  const missing=init.deduplicated?[]:(init.lackBlocks?.flatMap(v=>{const [a,b]=String(v).split('-').map(Number);if(!Number.isInteger(a)||a<1||(b??a)>blocks)throw Error('Invalid upload block range');return Array.from({length:(b??a)-a+1},(_,i)=>a+i);})??Array.from({length:blocks},(_,i)=>i+1));
  const handle=await fs.open(file,'r');try{for(const block of missing){const bytes=Buffer.alloc(Math.min(blockSize,size-(block-1)*blockSize));await handle.read(bytes,0,bytes.length,(block-1)*blockSize);const form=new FormData();form.set('block',String(block));form.set('file',new Blob([bytes]),name);await ous('/ous/api/v2/block/upload/part',form);}}finally{await handle.close();}
 }
 for(let i=0;i<30;i++){const status=await ous('/ous/api/v2/upload/status');if(status.status===5&&status.url)return status.url;if([6,8].includes(status.status))throw Error(`素材上传失败 ${status.errorCode??''}`);await new Promise(r=>setTimeout(r,1000));}
 throw Error('素材上传仍未完成，尚未提交生成任务');
}
