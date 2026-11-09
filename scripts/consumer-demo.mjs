// Disposable local UI fixture. All generation is synthetic; no API keys or cloud calls.
// Run: node scripts/consumer-demo.mjs. Stop with Ctrl+C; files stay under ignored tmp/.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalProjects} from '../local_projects.mjs';
import {LocalObjectAssets} from '../local_object_assets.mjs';
import {ObjectGenerations} from '../object_generation.mjs';
import {createEditorServer} from '../structure_server.mjs';
import {structureGlb} from '../structure_mesh.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(repo,'tmp'),{recursive:true});
const root=await fs.mkdtemp(path.join(repo,'tmp','consumer-demo-'));
for(const f of await fs.readdir(repo))if(/\.(mjs|css|html)$/.test(f))await fs.copyFile(path.join(repo,f),path.join(root,f));
await fs.symlink(path.join(repo,'node_modules'),path.join(root,'node_modules'),'junction');
await fs.mkdir(path.join(root,'assets/ui'),{recursive:true});await fs.copyFile(path.join(repo,'tests/fixtures/image.png'),path.join(root,'assets/ui/room.png'));
const template=JSON.parse(await fs.readFile(path.join(repo,'tests/fixtures/room-structure.json'))),glb=await fs.readFile(path.join(repo,'tests/fixtures/cabinet.glb')),image=await fs.readFile(path.join(repo,'tests/fixtures/image.png'));
template.sourceToAligned=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];template.floor={...template.floor,z:0,bounds:[[-3,-3],[3,3]],polygon:[[-3,-3],[3,-3],[3,3],[-3,3]]};template.walls=[];template.boxes=[];template.openings=[];
const points=[];for(let x=-3;x<=3;x+=.12)for(let y=-3;y<=3;y+=.12)points.push([x,y,0]);for(let x=-3;x<=3;x+=.12)for(let z=.12;z<2.8;z+=.12)points.push([x,3,z],[-3,x,z]);
const props=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
const header=Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex '+points.length+'\n'+props.map(p=>'property float '+p).join('\n')+'\nend_header\n');
const data=Buffer.alloc(points.length*props.length*4);points.forEach((p,i)=>[...p,.5,.6,.3,3,-2.7,-2.7,-3.8,1,0,0,0].forEach((v,j)=>data.writeFloatLE(v,(i*props.length+j)*4)));const ply=Buffer.concat([header,data]);
class DemoProjects extends LocalProjects{
 async key(){return true;}
 async doctor(){return {apiKeyConfigured:true,pythonAvailable:true,geometryAvailable:true,mediaChecksAvailable:true,storage:'ISOLATED_SYNTHETIC_DEMO'};}
 async py(){return {width:1200,height:900,warnings:[]};}
 async start(id){const p=await this.load(id);if(p.status==='READY')return this.public(p);p.status='WAITING';p.message='模拟：正在准备合成房间';await this.save(p);setTimeout(()=>this.finish(id).catch(console.error),1800);return this.public(p);}
 async finish(id){const p=await this.load(id),s={...template,worldId:'synthetic-'+id};await fs.writeFile(path.join(this.dir(id),'structure.json'),JSON.stringify(s));await fs.writeFile(path.join(this.dir(id),'point_preview.json'),JSON.stringify({xyz:points,sourceXyz:points,rgb:points.map(()=>[190,199,176])}));await fs.writeFile(path.join(this.dir(id),'structure.glb'),structureGlb(s));await fs.writeFile(path.join(this.dir(id),'room.ply'),ply);p.worldId=s.worldId;p.status='READY';p.message='模拟：合成房间已就绪';await this.save(p);}
}
const projects=new DemoProjects(root),assets=new LocalObjectAssets(projects),runtime={inspectSource:async()=>({width:1200,height:900}),upload:async()=> 'https://holo-cos.aholo3d.cn/synthetic',submit:async()=> '123456',wait:async()=>{await new Promise(r=>setTimeout(r,1200));return 'https://qhsmodel.kujiale.com/synthetic.glb';},download:async()=>glb};
const jobs=new ObjectGenerations(root,{projects,assets,runtime});
async function ready(name,size){let p=await projects.create({name,experience:'quick-try-on'});const source=await assets.store(p.id,image,'synthetic.png'),[job]=await jobs.create(p.id,[{sourceAssetId:source.id,name:'合成柜子',category:'furniture',size}]);await projects.updateDraft(p.id,{version:p.updatedAt,quickTryOnJobId:job.id});await projects.finish(p.id);await jobs.start(p.id,[job.id]);return p.id;}
const fit=await ready('隔离验证 · 正常试摆',{width:1.2,depth:.5,height:.7}),large=await ready('隔离验证 · 待调整',{width:8,depth:8,height:1});
const server=createEditorServer(root,{}, {projects,objectRuntime:runtime,effectRuntime:{generate:async()=>{throw Error('UI fixture does not run Flux');}}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const info={origin,root,fit:origin+'/structure_editor.html?project='+fit,large:origin+'/structure_editor.html?project='+large};await fs.writeFile(path.join(repo,'tmp/consumer-demo.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info));
