import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccess} from '../lan_access.mjs';

test('pairing returns to an allowed draft route and rejects external or arbitrary redirect paths',async()=>{
 const id='0acae1be-95b8-4419-8e8f-4fe60b9b96a4';
 for(const next of ['/#photo','/#photo/'+id,'/#space/'+id,'//evil.example','/\\evil.example','/arbitrary']){
  const access=createAccess({lan:true,hosts:['192.168.1.20'],pairCode:'123456'});let result;
  const req={method:'POST',headers:{host:'192.168.1.20:8787',origin:'http://192.168.1.20:8787'},socket:{localPort:8787,remoteAddress:'192.168.1.30'},async *[Symbol.asyncIterator](){yield Buffer.from(new URLSearchParams({code:'123456',next}).toString());}};
  await access.handle(req,{writeHead(status,headers){result={status,headers};},end(){}},new URL('http://192.168.1.20:8787/pair'));
  assert.equal(result.status,303);assert.equal(result.headers.Location,next.startsWith('/#')?next:'/');
 }
});
