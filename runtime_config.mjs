import path from 'node:path';
import {isIP} from 'node:net';
export function dataDirectory(root,env=process.env){return env.AHOLO_DATA_DIR?path.resolve(env.AHOLO_DATA_DIR):path.join(root,'local-data');}
export function deploymentSettings(env=process.env){
 const studio=env.AHOLO_DEPLOYMENT==='modelscope';
 const origins=(env.AHOLO_PUBLIC_ORIGIN??'').split(',').map(s=>s.trim()).filter(Boolean).map(s=>{const u=new URL(s);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('AHOLO_PUBLIC_ORIGIN 必须是完整站点来源');return u.origin;});
 if(studio&&!origins.length)throw Error('创空间需配置 AHOLO_PUBLIC_ORIGIN');
 const proxyPeers=(env.AHOLO_TRUSTED_PROXY_ADDRESSES??'').split(',').map(s=>s.trim().replace(/^::ffff:/,'')).filter(Boolean);
 if(proxyPeers.some(ip=>!isIP(ip)))throw Error('AHOLO_TRUSTED_PROXY_ADDRESSES 只接受精确 IP 地址');
 return {studio,origins,proxyPeers,personalEffectsEnabled:studio&&env.AHOLO_PERSONAL_EFFECTS_ENABLED!=='0',effectsEnabled:env.AHOLO_EFFECTS_ENABLED==='1'||(!studio&&env.AHOLO_EFFECTS_ENABLED!=='0')};
}
