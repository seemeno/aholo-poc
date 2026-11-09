import crypto from 'node:crypto';
const missing=()=>Object.assign(Error('请先配置本人的 ModelScope Token；不会使用演示者额度'),{credentialRequired:true,statusCode:428});
export class PersonalCredentials{
 constructor({now=Date.now,ttl=60*60*1000,maxSessions=200}={}){this.now=now;this.ttl=ttl;this.maxSessions=maxSessions;this.sessions=new Map();}
 prune(){for(const [id,value]of this.sessions)if(value.expiresAt<=this.now())this.sessions.delete(id);}
 id(req){const header=req.headers['x-aholo-personal-session'];return typeof header==='string'&&/^[a-f0-9]{64}$/.test(header)?header:/(?:^|;\s*)aholo_personal=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1]??null;}
 set(req,res,token,{secure=true}={}){
  if(typeof token!=='string'||!/^ms-[A-Za-z0-9_-]{16,256}$/.test(token.trim()))throw Object.assign(Error('请输入有效的 ModelScope 个人访问令牌（ms- 开头）'),{statusCode:400});
  this.prune();const previous=this.id(req);if(previous)this.sessions.delete(previous);if(this.sessions.size>=this.maxSessions)throw Object.assign(Error('个人出图会话较多，请稍后再试'),{statusCode:429});
  const id=crypto.randomBytes(32).toString('hex'),value={token:token.trim(),owner:crypto.createHash('sha256').update(token.trim()).digest('hex'),expiresAt:this.now()+this.ttl};this.sessions.set(id,value);
  res.setHeader('Set-Cookie',`aholo_personal=${id}; HttpOnly; Path=/; Max-Age=${Math.floor(this.ttl/1000)}${secure?'; SameSite=None; Secure; Partitioned':'; SameSite=Strict'}`);return {...this.status(id),sessionId:id};
 }
 status(id){this.prune();const value=this.sessions.get(id);return {configured:!!value,expiresAt:value?new Date(value.expiresAt).toISOString():null,model:'Qwen/Qwen-Image-Edit-2511',storage:'SERVER_MEMORY_ONLY'};}
 read(id){this.prune();const value=this.sessions.get(id);if(!value)throw missing();return value;}
 clear(req,res,{secure=true}={}){this.sessions.delete(this.id(req));res.setHeader('Set-Cookie',`aholo_personal=; HttpOnly; Path=/; Max-Age=0${secure?'; SameSite=None; Secure; Partitioned':'; SameSite=Strict'}`);return {configured:false};}
}
