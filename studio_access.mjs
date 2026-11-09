// Shared public demo. This is deliberately separate from local Wi-Fi pairing.
import QRCode from 'qrcode';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phonePage=address=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>手机访问 · 空间工坊</title><style>*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:#f7f7f1;color:#234436;font:16px system-ui,sans-serif}main{max-width:520px;margin:4vh auto;padding:24px;background:white;border-radius:20px}h1{font-size:26px}p{line-height:1.7}.qr{display:block;width:208px;max-width:100%;height:auto;margin:24px auto}input,button,a{font:inherit}input{width:100%;padding:12px;border:1px solid #bacfbf;border-radius:10px;font-size:16px}button,a.button{display:block;width:100%;min-height:44px;margin:12px 0;padding:12px;border:0;border-radius:10px;background:#345a3a;color:white;text-align:center;text-decoration:none}.note{font-size:13px;color:#61705f}</style></head><body><main><h1>用手机打开空间工坊</h1><p>用手机相机扫描二维码，在浏览器中打开；也可以把下方网址发到手机。</p><img class="qr" width="208" height="208" src="/phone-qr.svg" alt="扫描二维码，在手机浏览器打开空间工坊"><label for="phoneAddress">手机访问网址</label><input id="phoneAddress" value="${escape(address)}" readonly><button id="copyAddress" type="button">复制网址</button><p id="copyStatus" role="status"></p><p>无需连接同一 Wi-Fi，无需配对码。手机打开网址后，可直接拍摄或选择照片。</p><p class="note">项目与已保存方案在手机、电脑共用。同一空间请在一台设备编辑，另一台刷新查看；尚未提交的照片草稿不会自动转移。</p><a class="button" href="/">进入空间工坊</a></main><script>document.getElementById('copyAddress').onclick=async()=>{const input=document.getElementById('phoneAddress'),status=document.getElementById('copyStatus');try{await navigator.clipboard.writeText(input.value);status.textContent='网址已复制，可以发送到手机后在浏览器打开。';}catch{input.focus();input.select();input.setSelectionRange(0,input.value.length);status.textContent='请复制已选中的网址，或在手机上长按网址复制。';}};</script></body></html>`;
export function createStudioAccess({origins,proxyPeers=[],startsPerMinute=12,now=Date.now}){
 const allowedOrigins=new Set(origins),publicHosts=new Set(origins.map(o=>new URL(o).host));let starts=[],hostWarning=false;
 const reject=(res,status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}));return true;};
 return {async handle(req,res,url){
  const internalHosts=new Set(['localhost:'+req.socket.localPort,'127.0.0.1:'+req.socket.localPort]);
  // ModelScope FC rewrites Host to this connection's container IP and port,
  // and does not supply X-Forwarded-Host. Trust only our actual local socket.
  const localAddress=(req.socket.localAddress??'').replace(/^::ffff:/,'');
  if(localAddress)internalHosts.add((localAddress.includes(':')?'['+localAddress+']':localAddress)+':'+req.socket.localPort);
  const forwarded=req.headers['x-forwarded-host'],address=(req.socket.remoteAddress??'').replace(/^::ffff:/,''),proxy=proxyPeers.includes(address)||/^(?:127\.|::1$|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address);
  if(!publicHosts.has(req.headers.host)&&!internalHosts.has(req.headers.host)&&!(proxy&&publicHosts.has(forwarded))){
   // Only routing metadata; never log cookies, credentials, photos or request bodies.
   if(!hostWarning){hostWarning=true;console.warn('Studio proxy host rejected: '+JSON.stringify({host:req.headers.host,forwardedHost:forwarded,address,localAddress,localPort:req.socket.localPort}));}
   return reject(res,403,'访问来源未配置');
  }
  if(!['GET','HEAD'].includes(req.method)&&!allowedOrigins.has(req.headers.origin))return reject(res,403,'请从创空间应用页面提交操作');
  if(['/phone','/phone-qr.svg'].includes(url.pathname)&&['GET','HEAD'].includes(req.method)){
   const address=origins[0]+'/',qr=url.pathname==='/phone-qr.svg';
   const body=qr?await QRCode.toString(address,{type:'svg',width:208,margin:4,errorCorrectionLevel:'M'}):phonePage(address);
   res.writeHead(200,{'Content-Type':qr?'image/svg+xml':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:body);return true;
  }
  if(['/pair','/logout'].includes(url.pathname)){res.writeHead(303,{Location:'/','Cache-Control':'no-store'});res.end();return true;}
  if(req.method==='POST'&&(url.pathname==='/api/effect-renders'||/^\/api\/projects\/[a-f0-9-]{36}\/(?:start|object-generations\/start)$/.test(url.pathname))){
   const time=now();starts=starts.filter(t=>time-t<60000);if(starts.length>=startsPerMinute){res.setHeader('Retry-After','60');return reject(res,429,'生成请求较多，请稍后再开始；已提交任务仍可继续查询');}starts.push(time);
  }
  return false;
 }};
}
