import test from 'node:test';
import assert from 'node:assert/strict';
import {auditedFetch,permittedRemote} from '../network_audit.mjs';
test('local demo permits its AHOLO operations and blocks LLM endpoints',()=>{
 assert.equal(permittedRemote('https://api.aholo3d.cn/world/v1/generations','POST'),true);
 assert.equal(permittedRemote('https://ous-cos.kujiale.com/ous/api/v2/single/upload','POST'),true);
 for(const u of ['https://api.openai.com/v1/responses','https://api.anthropic.com/v1/messages','https://api.aholo3d.cn/spatial/v1/tasks','https://api.aholo3d.cn/chat/completions','http://api.aholo3d.cn/world/v1/generations'])assert.equal(permittedRemote(u,'POST'),false);
});
test('audit omits secrets and denies disallowed calls before the transport',async()=>{
 const records=[];let calls=0;const request=auditedFetch(async(input,init)=>{calls++;assert.equal(init.redirect,'error');return {status:200};},async r=>records.push(r));
 await request('https://ous-cos.kujiale.com/ous/api/v2/upload/status?token=TOPSECRET',{headers:{Authorization:'TOPSECRET'}});
 await assert.rejects(request('https://api.openai.com/v1/responses',{method:'POST'}),/禁止/);
 assert.equal(calls,1);assert.equal(records.at(-1).event,'BLOCKED_BY_POLICY');assert.equal(JSON.stringify(records).includes('TOPSECRET'),false);
});
