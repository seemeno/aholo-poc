// Optional same-Wi-Fi access. Pairing secrets/sessions remain in this process.
import crypto from 'node:crypto';
import os from 'node:os';
import QRCode from 'qrcode';
export function privateIPv4s(){return [...new Set(Object.values(os.networkInterfaces()).flat().filter(x=>x&&!x.internal&&x.family==='IPv4'&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address)).map(x=>x.address))];}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nextPath=value=>value==='/'||/^\/#(?:photo(?:\/[a-f0-9-]{36})?|space\/[a-f0-9-]{36})$/.test(value)||/^\/structure_editor\.html\?project=[a-f0-9-]{36}$/.test(value)?value:'/';
const pairingErrors={code:'配对码不正确，请查看电脑上的连接手机页面。',rate:'尝试次数过多，请等待 5 分钟后重试。',full:'连接数量已达上限，请重启电脑服务后重新配对。'};
const page=(title,content)=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title} · 空间工坊</title><style>*{box-sizing:border-box}body{font:16px system-ui,sans-serif;background:#f1f5ef;color:#234436;margin:0;padding:24px 16px}main{max-width:540px;margin:5vh auto;background:white;padding:24px;border-radius:18px}h1{font-size:24px}p{line-height:1.7}input,button,a.button{font:inherit;padding:14px;border:1px solid #bacfbf;border-radius:9px;width:100%;display:block;margin:12px 0}button,a.button{background:#28614b;color:white;text-align:center;text-decoration:none}code{font-size:18px;overflow-wrap:anywhere;display:block;margin:12px 0}.pin{font-size:38px;letter-spacing:8px;font-weight:700}.note{color:#687e70;font-size:14px}</style><main><h1>${title}</h1>${content}</main></html>`;
export function createAccess({lan=false,hosts=privateIPv4s(),pairCode=crypto.randomInt(100000,1000000).toString(),now=Date.now}={}){
  const sessions=new Map(),attempts=new Map(),ips=lan?hosts:[],ttl=8*60*60*1000;
  // no-referrer makes a native form POST send Origin:null, which our origin
  // guard must reject. Preserve same-origin form headers without leaking
  // referrers to other sites; never relax the guard to accept null origins.
  const html=(res,status,body)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});res.end(body);};
  // Redirect form errors to a normal page: embedded browsers can replace HTTP
  // 401/429 navigation responses with a generic connection-error screen.
  const retry=(res,next,reason)=>{res.writeHead(303,{'Location':'/pair?next='+encodeURIComponent(nextPath(next))+'&error='+reason,'Cache-Control':'no-store'});res.end();};
  const enter=(req,res,url)=>{if(req.method==='POST')req.resume();res.writeHead(303,{'Location':nextPath(url.searchParams.get('next')??'/'),'Cache-Control':'no-store'});res.end();};
  const pairing=(next,error='')=>page('连接电脑上的空间工坊',`<p>手机和电脑连接同一 Wi-Fi。在电脑打开“连接手机”，输入页面显示的 6 位配对码。</p>${error?`<p role="alert">${escape(error)}</p>`:''}<form method="post" action="/pair"><input type="hidden" name="next" value="${escape(next)}"><label>电脑上的配对码<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label><button>配对并进入</button></form><p class="note">配对后可访问这台电脑上的个人项目并使用其 AHOLO 额度。文件仍保存在电脑；仅用于你信任的同一 Wi-Fi。</p>`);
  function local(req){const port=req.socket.localPort;return [`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);}
  return {lan,hosts:ips,async handle(req,res,url){
    const port=req.socket.localPort,allowed=['127.0.0.1','localhost',...ips].map(ip=>`${ip}:${port}`);
    if(!allowed.includes(req.headers.host)){res.writeHead(403);res.end();return true;}
    if(!['GET','HEAD'].includes(req.method)&&!allowed.map(h=>'http://'+h).includes(req.headers.origin)){res.writeHead(403);res.end();return true;}
    if(url.pathname==='/phone'&&req.method==='GET'&&local(req)){
      const qrCards=lan?await Promise.all(ips.map(async ip=>{const address=`http://${ip}:${port}/`,image=await QRCode.toDataURL(address,{width:220,margin:4,errorCorrectionLevel:'M'});return `<div style="text-align:center;margin:18px 0"><img width="220" height="220" src="${image}" alt="扫描打开空间工坊地址"><p class="note">用手机相机扫码打开地址，再输入下方配对码。<br>备用地址：${escape(address)}</p></div>`;})):[];
      html(res,200,page('电脑与手机同时使用',lan?`<p>已开启局域网访问，电脑和手机可同时使用。电脑继续打开本机首页。</p><p>1. 手机与电脑连接同一局域网（电脑也可通过网线连接同一路由器）。</p><p>2. 手机相机扫码打开，或使用备用地址：</p>${qrCards.join('')}${ips.map(ip=>`<code>http://${escape(ip)}:${port}/</code>`).join('')||'<p>未检测到局域网地址，请连接路由器后重启服务。</p>'}<p>3. 输入本次运行的配对码：</p><div class="pin">${escape(pairCode)}</div><p class="note">配对有效期 8 小时；重启服务后旧配对失效。电脑需保持运行。照片通过手机系统相机/相册选择器获取。同一空间请在一台设备编辑，另一台刷新查看已保存结果，避免覆盖。</p><a class="button" href="/">回到空间工坊</a>`:'<p>当前服务仅允许本机访问。关闭当前服务后，运行“启动本地Demo.cmd”、“启动手机网页版.cmd”或 npm start，即可让电脑与手机同时使用；手机需连接同一局域网。</p><a class="button" href="/">回到空间工坊</a>'));return true;
    }
    if(local(req)){
      if(url.pathname==='/pair'&&['GET','POST'].includes(req.method)){enter(req,res,url);return true;}
      return false;
    }
    const token=/(?:^|;\s*)aholo_lan=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1],expires=token?sessions.get(token):0;
    if(token&&expires&&expires>now()){
      if(url.pathname==='/pair'&&['GET','POST'].includes(req.method)){enter(req,res,url);return true;}
      if(url.pathname==='/phone'&&req.method==='GET'){html(res,200,page('手机已连接',`<p>你正在使用这台电脑上的空间工坊，文件保存在电脑本地。</p><a class="button" href="/">继续使用</a><form action="/logout" method="post"><button>断开手机配对</button></form>`));return true;}
      if(url.pathname==='/logout'&&req.method==='POST'){sessions.delete(token);res.writeHead(303,{'Location':'/pair','Set-Cookie':'aholo_lan=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});res.end();return true;}
      return false;
    }
    if(token)sessions.delete(token);
    if(url.pathname==='/pair'&&req.method==='GET'){const reason=url.searchParams.get('error');html(res,200,pairing(nextPath(url.searchParams.get('next')??'/'),Object.hasOwn(pairingErrors,reason)?pairingErrors[reason]:''));return true;}
    if(url.pathname==='/pair'&&req.method==='POST'){
      const address=req.socket.remoteAddress,previous=attempts.get(address),entry=previous&&previous.until>now()?previous:{count:0,until:now()+5*60*1000};
      if(entry.count>=6){retry(res,'/','rate');return true;}
      entry.count++;attempts.set(address,entry);
      let body='';for await(const part of req){body+=part;if(Buffer.byteLength(body)>1024){res.writeHead(413);res.end();return true;}}
      const form=new URLSearchParams(body),code=form.get('code')??'',next=nextPath(form.get('next')??'/');
      if(!/^[0-9]{6}$/.test(code)||code.length!==pairCode.length||!crypto.timingSafeEqual(Buffer.from(code),Buffer.from(pairCode))){retry(res,next,'code');return true;}
      attempts.delete(address);for(const [key,expiry] of sessions)if(expiry<=now())sessions.delete(key);
      if(sessions.size>=100){retry(res,next,'full');return true;}
      const key=crypto.randomBytes(32).toString('hex');sessions.set(key,now()+ttl);res.writeHead(303,{'Location':next,'Set-Cookie':`aholo_lan=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttl/1000}`,'Cache-Control':'no-store'});res.end();return true;
    }
    if(!['GET','HEAD'].includes(req.method)||url.pathname.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'手机配对已失效，请回到首页重新配对。'}));return true;}
    res.writeHead(303,{'Location':'/pair?next='+encodeURIComponent(nextPath(url.pathname+url.search)),'Cache-Control':'no-store'});res.end();return true;
  }};
}
