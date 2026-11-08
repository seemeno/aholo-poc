// Local files only. No AHOLO calls or external model services.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function inspectObject(bytes,name){
  const ext=path.extname(name).toLowerCase();
  if(ext==='.glb'){
    if(bytes.length<24||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('需要完整的 glTF 2.0 GLB 文件');
    const len=bytes.readUInt32LE(12);if(len>bytes.length-20)throw Error('GLB 内容损坏');
    const g=JSON.parse(bytes.toString('utf8',20,20+len).trim());
    if(g.asset?.version!=='2.0'||!g.meshes?.length)throw Error('GLB 中没有可摆放的网格');
    if((g.extensionsRequired??[]).some(e=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(e)))throw Error('请导出未使用 Draco、Meshopt 或 KTX2 压缩的 GLB，当前本地查看器不加载额外解码器');
    for(const r of [...g.buffers??[],...g.images??[]])if(r.uri&&!/^data:/.test(r.uri))throw Error('请导出包含内嵌贴图与网格的 GLB，不支持外部文件引用');
    return {kind:'glb',ext,mime:'model/gltf-binary'};
  }
  if(['.png','.jpg','.jpeg','.webp'].includes(ext)){
    const valid=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes[0]===255&&bytes[1]===216;
    if(!valid)throw Error('图片内容与扩展名不匹配');
    return {kind:'image',ext,mime:ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg'};
  }
  throw Error('支持 GLB 模型，或 JPG/PNG/WebP 挂画图片');
}
export class LocalObjectAssets{
  constructor(projects){this.projects=projects;}
  async list(id){await this.projects.load(id);const dir=path.join(this.projects.dir(id),'objects');let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    return Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(async n=>JSON.parse(await fs.readFile(path.join(dir,n),'utf8'))));}
  async upload(id,req,name){
    await this.projects.load(id);
    const max=100*1024**2;if(Number(req.headers['content-length'])>max)throw Error('物品文件最大 100 MB');
    const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>max)throw Error('物品文件最大 100 MB');chunks.push(c);}
    return this.store(id,Buffer.concat(chunks),name);
  }
  async store(id,bytes,name,metadata={}){
    await this.projects.load(id);
    if(bytes.length>100*1024**2)throw Error('物品文件最大 100 MB');
    const info=inspectObject(bytes,name),hash=crypto.createHash('sha256').update(bytes).digest('hex'),existing=await this.list(id),duplicate=existing.find(a=>a.sha256===hash);
    if(duplicate)return duplicate;
    if(existing.length>=80)throw Error('项目素材库最多 80 个文件');
    const assetId=crypto.randomUUID(),dir=path.join(this.projects.dir(id),'objects');await fs.mkdir(dir,{recursive:true});
    const a={...metadata,id:assetId,name:path.win32.basename(path.posix.basename(name)).slice(0,80),kind:info.kind,mime:info.mime,file:assetId+info.ext,sha256:hash,size:bytes.length,createdAt:new Date().toISOString()};
    await fs.writeFile(path.join(dir,a.file),bytes,{flag:'wx'});await fs.writeFile(path.join(dir,assetId+'.json'),JSON.stringify(a,null,2),{flag:'wx'});return a;
  }
  async get(id,assetId){if(!/^[a-f0-9-]{36}$/.test(assetId))throw Error('物品素材 ID 无效');const a=(await this.list(id)).find(a=>a.id===assetId);if(!a)throw Error('物品素材不存在');return {meta:a,bytes:await fs.readFile(path.join(this.projects.dir(id),'objects',a.file))};}
  async validateReferences(id,scene){const assets=await this.list(id);for(const o of scene.objects??[])if(o.assetId!=='builtin_tv'&&!assets.some(a=>a.id===o.assetId&&a.kind===o.assetKind))throw Error('摆放引用了不属于当前项目的物品素材');}
}
