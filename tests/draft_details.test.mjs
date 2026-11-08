import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalProjects} from '../local_projects.mjs';
test('same-page draft edits retain the project identity and reject stale or already-started updates',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-draft-details-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-draft-details-'));await fs.rm(root,{recursive:true,force:true});});
 const m=new LocalProjects(root),p=await m.create({name:'original'});
 const updated=await m.updateDraft(p.id,{version:p.updatedAt,name:'客厅',prompt:'保留木地板',status:'READY',id:'foreign'});
 assert.equal(updated.id,p.id);assert.equal(updated.name,'客厅');assert.equal(updated.status,'DRAFT');
 await assert.rejects(m.updateDraft(p.id,{version:'stale',name:'wrong'}),e=>e.statusCode===409);
 const current=await m.load(p.id);current.status='WAITING';await m.save(current);
 await assert.rejects(m.updateDraft(p.id,{version:current.updatedAt,name:'wrong'}),e=>e.statusCode===409);
 assert.equal((await m.load(p.id)).name,'客厅');
});
