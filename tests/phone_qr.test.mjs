import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorServer} from '../structure_server.mjs';
import QRCode from 'qrcode';
test('phone page QR only encodes the LAN address and retains explicit code pairing',async t=>{
 const server=createEditorServer(undefined,{lan:true,hosts:['192.168.50.10'],pairCode:'654321'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port,response=await fetch(`http://127.0.0.1:${port}/phone`),html=await response.text();assert.equal(response.status,200);
 const expected=await QRCode.toDataURL(`http://192.168.50.10:${port}/`,{width:220,margin:4,errorCorrectionLevel:'M'});
 assert.ok(html.includes(`src="${expected}"`));assert.match(html,/输入下方配对码/);assert.match(html,/654321/);
});
