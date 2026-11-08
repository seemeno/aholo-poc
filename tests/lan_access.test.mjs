import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createEditorServer} from '../structure_server.mjs';
import {createAccess} from '../lan_access.mjs';
test('Wi-Fi pairing gates all project/assets/paid APIs, validates origin/host, expires and revokes sessions',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-lan-'));let time=0;
 const server=createEditorServer(root,{lan:true,hosts:['192.168.1.20'],pairCode:'123456',now:()=>time});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,base=`http://127.0.0.1:${port}`,host=`192.168.1.20:${port}`,origin='http://'+host;
 const request=(p,opts={})=>new Promise((resolve,reject)=>{const req=http.request(base+p,{method:opts.method??'GET',headers:{Host:host,...opts.headers}},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>{const body=Buffer.concat(parts).toString();resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>body,json:async()=>JSON.parse(body)});});});req.on('error',reject);req.end(opts.body);});
 try{
  assert.equal((await request('/')).status,303);
  for(const p of ['/api/projects','/api/doctor','/api/projects/6f492b6f-23bd-4c21-bf21-44e9efd09772/assets/room.ply'])assert.equal((await request(p)).status,401);
  assert.equal((await request('/api/projects/6f492b6f-23bd-4c21-bf21-44e9efd09772/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await request('/phone')).status,303);
  assert.equal((await fetch(base+'/phone')).status,200);
  const formPage=await request('/pair');assert.equal(formPage.status,200);assert.equal(formPage.headers.get('referrer-policy'),'same-origin');
  // A native same-origin form must retain its Origin. Do not "fix" a null
  // Origin by accepting it: opaque/cross-origin submissions remain forbidden.
  assert.equal((await request('/pair',{method:'POST',headers:{Origin:'null'},body:'code=123456'})).status,403);
  assert.equal((await request('/pair',{method:'POST',headers:{Origin:'http://attacker.example'},body:'code=123456'})).status,403);
  const pair=async code=>request('/pair',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'code='+code+'&next=%2F'});
  const wrong=await pair('000000');assert.equal(wrong.status,303);assert.equal(wrong.headers.get('set-cookie'),null);
  const retryURL=new URL(wrong.headers.get('location'),origin);assert.equal(retryURL.searchParams.get('error'),'code');assert.equal(retryURL.searchParams.get('next'),'/');assert.doesNotMatch(retryURL.href,/000000/);
  const errorPage=await request(retryURL.pathname+retryURL.search);assert.equal(errorPage.status,200);assert.match(await errorPage.text(),/role="alert">配对码不正确/);
  assert.equal(new URL((await pair('中文中文中文')).headers.get('location'),origin).searchParams.get('error'),'code');
  const paired=await pair('123456');assert.equal(paired.status,303);const cookie=paired.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  assert.equal((await request('/api/projects',{headers:{Cookie:cookie}})).status,200);
  const phone=await request('/phone',{headers:{Cookie:cookie}});assert.equal(phone.status,200);assert.equal(phone.headers.get('referrer-policy'),'same-origin');assert.doesNotMatch(await phone.text(),/123456/);
  assert.equal((await request('/api/projects',{method:'POST',headers:{Cookie:cookie,Origin:'http://attacker.example','Content-Type':'application/json'},body:'{}'})).status,403);
  const created=await request('/api/projects',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'LAN local draft',mode:'generation'})});assert.equal(created.status,200);
  // Pairing a phone must not replace the desktop session. Both clients see
  // the same saved projects while continuing to use their own access path.
  const project=await created.json();
  const [desktopList,phoneList]=await Promise.all([fetch(base+'/api/projects'),request('/api/projects',{headers:{Cookie:cookie}})]);
  assert.equal(desktopList.status,200);assert.equal(phoneList.status,200);
  assert.deepEqual(await desktopList.json(),await phoneList.json());
  assert.equal((await fetch(base+'/api/projects/'+project.id)).status,200);
  assert.equal((await request('/api/projects/'+project.id,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await request('/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin}})).status,303);assert.equal((await request('/api/projects',{headers:{Cookie:cookie}})).status,401);
  const secondCookie=(await pair('123456')).headers.get('set-cookie');time=9*60*60*1000;assert.equal((await request('/api/projects',{headers:{Cookie:secondCookie}})).status,401);
  assert.equal((await request('/api/projects',{headers:{Host:`evil.example:${port}`}})).status,403);
  for(let i=0;i<6;i++)await pair('000000');const limited=await pair('123456');assert.equal(limited.status,303);assert.equal(new URL(limited.headers.get('location'),origin).searchParams.get('error'),'rate');assert.equal(limited.headers.get('set-cookie'),null);
  const limitedPage=await request(limited.headers.get('location'));assert.equal(limitedPage.status,200);assert.match(await limitedPage.text(),/等待 5 分钟/);
  assert.doesNotMatch(await (await request('/pair?error=toString')).text(),/role="alert"/);
 }finally{await new Promise(r=>server.close(r));if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('aholo-lan-'))throw Error('Unexpected test directory');await fs.rm(root,{recursive:true,force:true});}
});
test('pairing counts concurrent attempts before waiting for request bodies',async()=>{
 const access=createAccess({lan:true,hosts:['192.168.1.20'],pairCode:'123456'});let release;const gate=new Promise(r=>release=r),responses=[];
 const attempt=code=>{let result;const req={method:'POST',headers:{host:'192.168.1.20:8787',origin:'http://192.168.1.20:8787'},socket:{localPort:8787,remoteAddress:'192.168.1.30'},async *[Symbol.asyncIterator](){await gate;yield Buffer.from('code='+code);}},res={writeHead(status,headers){result={status,headers};},end(){responses.push(result);}};return access.handle(req,res,new URL('http://192.168.1.20:8787/pair'));};
 const running=Array.from({length:12},()=>attempt('000000'));release();await Promise.all(running);assert.equal(responses.filter(r=>r.headers.Location.endsWith('error=rate')).length,6);assert.equal(responses.filter(r=>r.headers.Location.endsWith('error=code')).length,6);assert.ok(responses.every(r=>r.status===303&&!r.headers['Set-Cookie']));await attempt('123456');assert.match(responses.at(-1).headers.Location,/error=rate$/);
});
test('paired browsers can revisit or resubmit pair and follow the landing page instead of a 404',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-lan-'));
 for(const name of ['local_demo.html','local_demo.mjs','structure_editor.html','structure_editor.mjs'])await fs.copyFile(new URL('../'+name,import.meta.url),path.join(root,name));
 const server=createEditorServer(root,{lan:true,hosts:['192.168.1.20'],pairCode:'123456'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,host=`192.168.1.20:${port}`,origin='http://'+host;
 const request=(pathname,{cookie,local=false,body}={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:pathname,method:body===undefined?'GET':'POST',headers:{Host:local?`127.0.0.1:${port}`:host,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:local?`http://127.0.0.1:${port}`:origin,'Content-Type':'application/x-www-form-urlencoded'}:{})}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(body);});
 try{
  const pair=await request('/pair',{body:'code=123456&next=%2F'}),cookie=pair.headers['set-cookie']?.[0];assert.equal(pair.status,303);assert.ok(cookie);
  const home=await request(pair.headers.location,{cookie});assert.equal(home.status,200);assert.match(home.text,/空间工坊/);
  assert.equal((await request('/local_demo.mjs',{cookie})).status,200);
  const revisit=await request('/pair',{cookie});assert.equal(revisit.status,303);assert.equal(revisit.headers.location,'/');assert.equal((await request(revisit.headers.location,{cookie})).status,200);
  const again=await request('/pair',{cookie,body:'code=123456&next=%2F'});assert.equal(again.status,303);assert.equal(again.headers.location,'/');assert.equal((await request(again.headers.location,{cookie})).status,200);
  const editor='/structure_editor.html?project=6f492b6f-23bd-4c21-bf21-44e9efd09772';
  const next=await request('/pair?next='+encodeURIComponent(editor),{cookie});assert.equal(next.status,303);assert.equal(next.headers.location,editor);assert.equal((await request(next.headers.location,{cookie})).status,200);
  const unsafe=await request('/pair?next=https%3A%2F%2Fevil.example',{cookie});assert.equal(unsafe.headers.location,'/');
  for(const body of [undefined,'code=123456']){const local=await request('/pair',{local:true,body});assert.equal(local.status,303);assert.equal(local.headers.location,'/');}
 }finally{await new Promise(r=>server.close(r));if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('aholo-lan-'))throw Error('Unexpected test directory');await fs.rm(root,{recursive:true,force:true});}
});
