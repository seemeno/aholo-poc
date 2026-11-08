export async function handleObjectGenerationRoutes(req,res,url,generations,readJson){
 const match=url.pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/object-generations(?:\/(start|[a-f0-9]{64})(?:\/(retry|recover|resume))?)?$/);
 if(!match)return false;
 const [,projectId,id,action]=match;
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method==='GET'&&!id){send(200,{jobs:await generations.list(projectId)});return true;}
 if(req.method==='POST'&&!id){const body=await readJson();send(200,{jobs:await generations.create(projectId,body.items)});return true;}
 if(req.method==='POST'&&id==='start'&&!action){const body=await readJson();send(202,{jobs:await generations.start(projectId,body.ids)});return true;}
 if(req.method==='POST'&&action){send(202,await generations.action(projectId,id,action,await readJson()));return true;}
 if(req.method==='GET'&&id&&id!=='start'&&!action){send(200,generations.public(await generations.load(projectId,id)));return true;}
 send(405,{error:'此物品任务操作不支持该请求方式'});return true;
}
