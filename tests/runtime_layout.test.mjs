import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalProjects} from '../local_projects.mjs';
import {EffectRuntime} from '../effect_runtime.mjs';

async function checkout(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'aholo-source-only-'));
 t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('aholo-source-only-'));await fs.rm(root,{recursive:true,force:true});});
 return root;
}
test('source-only installs explain missing optional demo media without creating an empty space',async t=>{
 const projects=new LocalProjects(await checkout(t));
 await assert.rejects(projects.example(),/未安装可选示例素材/);
 assert.deepEqual(await projects.list(),[]);
});
test('source-only installs report a missing GPU environment before launching a worker',async t=>{
 const root=await checkout(t);await fs.mkdir(path.join(root,'scripts'));
 await fs.copyFile(new URL('../scripts/start-local-ai.ps1',import.meta.url),path.join(root,'scripts/start-local-ai.ps1'));
 const runtime=new EffectRuntime(root,{request:async()=>{throw Error('Local service is offline');}});
 await assert.rejects(runtime.ensure(),/配置 runtime\/flux/);
});
