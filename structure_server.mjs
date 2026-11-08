// Loopback-only editor server. Narrow allowlist; credentials never reach browser.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateScene} from './scene_state.mjs';
import {structureGlb} from './structure_mesh.mjs';
import {LocalProjects} from './local_projects.mjs';
import {LocalObjectAssets} from './local_object_assets.mjs';
import {installNetworkAudit} from './network_audit.mjs';
import {createAccess,privateIPv4s} from './lan_access.mjs';
import {LocalEffectRenderer} from './effect_render.mjs';
import {EffectRuntime} from './effect_runtime.mjs';
import {handleEffectRoutes} from './effect_routes.mjs';
import {ObjectGenerations} from './object_generation.mjs';
import {handleObjectGenerationRoutes} from './object_generation_routes.mjs';
import {projectActivity,assertProjectIdle} from './project_lifecycle.mjs';
const defaultRoot=path.dirname(fileURLToPath(import.meta.url));
export function createEditorServer(root=defaultRoot,accessOptions={},dependencies={}){
const access=createAccess(accessOptions);
const projects=dependencies.projects??new LocalProjects(root);
const objects=new LocalObjectAssets(projects);
const effects=new LocalEffectRenderer(root,{projects,runtime:dependencies.effectRuntime});
const generations=new ObjectGenerations(root,{projects,assets:objects,runtime:dependencies.objectRuntime});
const activity=projectActivity();
const allowed=new Set(['local_demo.html','local_demo.mjs','structure_editor.html','structure_editor.mjs','object_root_ensurer.mjs','restore_gate.mjs','object_state.mjs','placement.mjs','geometry.mjs','scene_state.mjs','structure_mesh.mjs','assets/demo/structure.json','assets/demo/structure.glb','assets/demo/point_preview.json','assets/demo/room.ply','assets/demo/furniture.glb']);
allowed.add('app.css');allowed.add('editor.css');allowed.add('assets/ui/room.png');
allowed.add('editor_room.mjs');
allowed.add('wall_edit.mjs');
allowed.add('editor_calibration.mjs');allowed.add('effect_history.mjs');
allowed.add('scene_object_list.mjs');
allowed.add('effect_ui.mjs');allowed.add('effect_ui.css');
allowed.add('ui_actions.mjs');for(const file of ['ui_network.mjs','photo_draft_ui.mjs','local_drafts.mjs','object_submission.mjs','project_progress.mjs','photo_checks.mjs'])allowed.add(file);
for(const file of ['object_photos.mjs','object_generation_ui.mjs','object_generation_ui.css'])allowed.add(file);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.ply':'application/octet-stream','.glb':'model/gltf-binary'};
const sceneFile=path.join(root,'scene/user_placement.json');
return http.createServer(async(req,res)=>{
 res.setHeader('Content-Security-Policy',"connect-src 'self' blob:");
 const port=req.socket.localPort;
 const leases=new Map();let releaseTransition;
 const lease=id=>{if(!/^[a-f0-9-]{36}$/.test(id??''))throw Error('项目 ID 无效');if(!leases.has(id))leases.set(id,activity.enter(id));};
 try{
  const url=new URL(req.url,'http://localhost'),rel=url.pathname==='/'?'local_demo.html':decodeURIComponent(url.pathname).slice(1);
  if(await access.handle(req,res,url))return;
  const projectMatch=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})(?:\/|$)/),restoreMatch=url.pathname.match(/^\/api\/deleted-projects\/([a-f0-9-]{36})\/restore$/);
  if(projectMatch){if(req.method==='DELETE'&&url.pathname==='/api/projects/'+projectMatch[1]||req.method==='POST'&&url.pathname==='/api/projects/'+projectMatch[1]+'/room-photo')releaseTransition=activity.transition(projectMatch[1]);else{lease(projectMatch[1]);await projects.load(projectMatch[1]);}}
  if(restoreMatch&&req.method==='POST')releaseTransition=activity.transition(restoreMatch[1]);
  if(url.pathname==='/api/effect-renders'&&req.method==='GET'){const id=url.searchParams.get('project');lease(id);await projects.load(id);}
  const renderMatch=url.pathname.match(/^\/api\/effect-renders\/([a-f0-9]{64})(?:\/|$)/);
  if(renderMatch){const j=await effects.load(renderMatch[1]);lease(j.projectId);await projects.load(j.projectId);}
  const json=async(maxBytes=2_000_000)=>{if(req.headers['content-type']!=='application/json')throw Error('需要 JSON 请求');let value='',bytes=0;for await(const part of req){bytes+=part.length;if(bytes>maxBytes)throw Error('请求过大');value+=part;}const body=JSON.parse(value);if(body?.projectId){lease(body.projectId);await projects.load(body.projectId);}return body;};
  const send=value=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname==='/api/deleted-projects'&&req.method==='GET'){send(await projects.deleted());return;}
  if(restoreMatch&&req.method==='POST'){await json();send(await projects.restore(restoreMatch[1]));return;}
  if(await handleEffectRoutes(req,res,url,effects,()=>json(8_000_000)))return;
  if(await handleObjectGenerationRoutes(req,res,url,generations,json))return;
  if(rel==='api/doctor'&&req.method==='GET'){send(await projects.doctor());return;}
  if(rel==='api/projects'){
   if(req.method==='GET'){send(await projects.list());return;}
   if(req.method==='POST'){send(projects.public(await projects.create(await json())));return;}
  }
  if(rel==='api/example'&&req.method==='POST'){await json();send(await projects.example());return;}
  const route=rel.match(/^api\/projects\/([a-f0-9-]{36})(?:\/(uploads|room-photo|details|visit|start|extract|recover|scene|assets|objects|reference)(?:\/([a-zA-Z0-9_.-]+))?)?$/);
  if(route){const [,id,action,asset]=route;
   if(action==='visit'&&!asset&&req.method==='POST'){await json();send(await projects.visit(id));return;}
   if(action==='details'&&!asset&&req.method==='POST'){send(await projects.updateDraft(id,await json()));return;}
   if(!action&&req.method==='DELETE'){await assertProjectIdle(id,{projects,generations,effects});send(await projects.remove(id));return;}
   if(!action&&req.method==='GET'){send(projects.public(await projects.load(id)));return;}
   if(action==='reference'&&!asset&&['GET','HEAD'].includes(req.method)){
    const p=await projects.load(id),image=p.uploads.find(u=>u.kind==='image');
    let file='cover.jpg',mime='image/jpeg';
    if(image&&/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$/i.test(image.file)){file=path.join('inputs',image.file);mime={'.png':'image/png','.webp':'image/webp'}[path.extname(image.file).toLowerCase()]??'image/jpeg';}
    const bytes=await fs.readFile(path.join(projects.dir(id),file));res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   if(action==='objects'){
    if(req.method==='POST'&&!asset){if(req.headers['content-type']!=='application/octet-stream')throw Error('需要二进制文件');send(await objects.upload(id,req,url.searchParams.get('name')??''));return;}
    if(req.method==='GET'&&!asset){send(await objects.list(id));return;}
    if(['GET','HEAD'].includes(req.method)&&asset){const {meta,bytes}=await objects.get(id,asset);res.writeHead(200,{'Content-Type':meta.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return;}
   }
   if(action==='uploads'&&req.method==='POST'){if(req.headers['content-type']!=='application/octet-stream')throw Error('需要二进制文件');send(await projects.upload(id,req,url.searchParams.get('name')??''));return;}
   if(action==='room-photo'&&!asset&&req.method==='POST'){if(req.headers['content-type']!=='application/octet-stream')throw Error('需要二进制文件');await projects.load(id);await assertProjectIdle(id,{projects,generations,effects});send(await projects.upload(id,req,url.searchParams.get('name')??'',{replaceRoom:true,version:url.searchParams.get('version')}));return;}
   if(action==='start'&&req.method==='POST'){send(await projects.start(id,await json()));return;}
   if(action==='extract'&&req.method==='POST'){send(await projects.reextract(id,(await json()).upAxis));return;}
   if(action==='recover'&&req.method==='POST'){send(await projects.recover(id,String((await json()).worldId??'')));return;}
   if(action==='scene'&&['GET','POST'].includes(req.method)){send(await projects.scene(id,req.method==='POST'?await json():undefined));return;}
   if(action==='assets'&&['GET','HEAD'].includes(req.method)&&['room.ply','structure.json','structure.glb','point_preview.json','cover.jpg','user_structure.glb'].includes(asset)){
    const bytes=await fs.readFile(path.join(projects.dir(id),asset));res.writeHead(200,{'Content-Type':asset.endsWith('.jpg')?'image/jpeg':types[path.extname(asset)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
  }
  if(rel==='api/scene'){
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   if(req.method==='GET'){try{res.end(await fs.readFile(sceneFile));}catch(e){if(e.code!=='ENOENT')throw e;res.writeHead(404);res.end(JSON.stringify({error:'No user placement saved'}));}return;}
   if(req.method==='POST'){
    if(req.headers['content-type']!=='application/json'){res.writeHead(403);res.end();return;}
    let bytes=0,body='';for await(const part of req){bytes+=part.length;if(bytes>2000000)throw Error('Scene exceeds 2 MB');body+=part;}
    const scene=validateScene(JSON.parse(body));if(scene.objects.some(o=>o.assetId!=='builtin_tv'))throw Error('自有物品请在本地项目中保存');scene.kind='user_saved';scene.savedAt=new Date().toISOString();
    if(scene.worldId!=='3FO4K4RIGVTB')throw Error('旧版示例接口不接受其他项目');
    await fs.mkdir(path.dirname(sceneFile),{recursive:true});
    try{await fs.copyFile(sceneFile,sceneFile+'.bak');}catch(e){if(e.code!=='ENOENT')throw e;}
    await fs.writeFile(sceneFile+'.tmp',JSON.stringify(scene,null,2));await fs.rename(sceneFile+'.tmp',sceneFile);
    await fs.writeFile(path.join(root,'scene/user_structure.glb'),structureGlb(scene.structure,{floorOnly:true}));res.end(JSON.stringify({ok:true,savedAt:scene.savedAt}));return;
   }
  }
  const dependency=/^node_modules\/(three\/(build\/three\.(module|core)\.js|examples\/jsm\/[a-zA-Z0-9_./-]+\.js)|@sparkjsdev\/spark\/dist\/[a-zA-Z0-9_./-]+\.(js|wasm))$/.test(rel)&&!rel.split('/').includes('..');
  if(!['GET','HEAD'].includes(req.method)||(!allowed.has(rel)&&!dependency)){res.writeHead(404);res.end();return;}
  const bytes=await fs.readFile(path.join(root,rel));res.writeHead(200,{'Content-Type':types[path.extname(rel)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){res.writeHead(e.statusCode??(e.code==='ENOENT'?404:400),{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e.code==='ENOENT'?'空间或文件不可用，请刷新列表或检查最近删除。':e.message}));}
 finally{releaseTransition?.();for(const release of leases.values())release();}
});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await installNetworkAudit(defaultRoot);const port=Number(process.env.PORT??8787),lan=process.argv.includes('--lan'),runtime=new EffectRuntime(defaultRoot);
 const server=createEditorServer(defaultRoot,{lan},{effectRuntime:runtime});let checking=false,fluxReady=false,fluxMessage='';
 const keepFluxReady=async()=>{if(checking)return;checking=true;try{if(fluxReady&&await runtime.health())return;await runtime.ensure();fluxReady=true;if(fluxMessage!=='ready')console.log('Local Flux service ready');fluxMessage='ready';}catch(e){fluxReady=false;if(fluxMessage!==e.message)console.error('Local Flux startup: '+e.message);fluxMessage=e.message;}finally{checking=false;}};
 server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{console.log(`Placement editor: http://127.0.0.1:${port}`);if(lan){console.log(`Phone pairing (open on this computer): http://127.0.0.1:${port}/phone`);for(const ip of privateIPv4s())console.log(`Same Wi-Fi: http://${ip}:${port}/`);}keepFluxReady();});
 const fluxWatch=setInterval(()=>keepFluxReady(),60000);fluxWatch.unref();server.on('close',()=>clearInterval(fluxWatch));
}
