// All routes run behind the normal Host/Origin/phone pairing guards.
export async function handleEffectRoutes(req,res,url,effects,readJson){
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(url.pathname==='/api/effect-renders'){
  if(req.method==='POST'){send(202,await effects.start(await readJson()));return true;}
  if(req.method==='GET'){const projectId=url.searchParams.get('project');send(200,url.searchParams.get('history')==='1'?{jobs:await effects.list(projectId)}:{latest:await effects.latest(projectId,url.searchParams.get('resume')!=='0')});return true;}
 }
 const match=url.pathname.match(/^\/api\/effect-renders\/([a-f0-9]{64})(?:\/(image|preview))?$/);
 if(!match||!['GET','HEAD'].includes(req.method))return false;
 if(match[2]){const bytes=await effects.image(match[1],match[2]==='preview');res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);}
 else send(200,await effects.get(match[1]));return true;
}
