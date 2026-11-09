import {requestJson} from './ui_network.mjs';
import {getDeployment} from './deployment_ui.mjs';
export function createPersonalEffectSettings(dialog,{onChange=()=>{},onSessionChange=()=>{}}={}){
 const enabled=!!getDeployment().personalEffectsEnabled;let configured=false,sessionId='';
 const key='aholo-personal-inference-session';try{sessionId=sessionStorage.getItem(key)??'';}catch{}
 const headers=()=>sessionId?{'X-Aholo-Personal-Session':sessionId}:{};
 if(!enabled)return {enabled,headers,configured:()=>false,consented:()=>false,refresh:async()=>{},reset(){}};
 const section=document.createElement('section');section.className='personal-effect-settings';
 section.innerHTML='<details open><summary>可选 · 使用个人 ModelScope 额度</summary><p>三维试摆和保存方案无需出图 Token。这里的实时 AI 出图仅消耗你自己的魔粒，不使用演示者额度。</p><label for="personalEffectToken">个人 Token<input id="personalEffectToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ms-…"></label><div class="personal-token-actions"><button data-connect type="button">配置个人 Token</button><button data-clear type="button" hidden>清除 Token</button><a href="https://modelscope.cn/my/myaccesstoken" target="_blank" rel="noopener noreferrer">获取个人 Token ↗</a></div><p data-session role="status">尚未配置。Token 仅保存在服务器内存，最长 1 小时；服务重启需重新填写。</p><p>配置不发起生成，真实权限与魔粒余额在提交时验证。结果保存到共享项目，其他体验者也可看到。</p></details><label class="personal-effect-consent"><input data-consent type="checkbox">确认将当前截图和家具参考图发送到 ModelScope，并消耗本人魔粒。额度不足不使用演示者额度。</label>';
 dialog.querySelector('.effect-intro').after(section);
 const input=section.querySelector('input[type=password]'),status=section.querySelector('[data-session]'),connect=section.querySelector('[data-connect]'),clear=section.querySelector('[data-clear]'),consent=section.querySelector('[data-consent]');
 function update(value){configured=!!value.configured;clear.hidden=!configured;status.textContent=configured?'已配置个人 Token · '+new Date(value.expiresAt).toLocaleTimeString('zh-CN')+' 前有效，生成时验证额度。':'尚未配置或会话已失效。可继续免费试摆，也可重新填写个人 Token。';onChange();}
 function remember(value){sessionId=value;try{if(value)sessionStorage.setItem(key,value);else sessionStorage.removeItem(key);}catch{}}
 connect.onclick=async()=>{connect.disabled=true;status.textContent='正在配置个人会话…';try{const value=await requestJson('/api/personal-inference/session',{body:{token:input.value},headers:headers()});input.value='';remember(value.sessionId);consent.checked=false;update(value);await onSessionChange();}catch(e){status.textContent=e.message;}finally{connect.disabled=false;}};
 clear.onclick=async()=>{clear.disabled=true;try{await requestJson('/api/personal-inference/session/clear',{body:{},headers:headers()});remember('');input.value='';consent.checked=false;update({configured:false});status.textContent='Token 已清除。已提交的云端任务不会取消；配置原 Token 后可继续查询。';}catch(e){status.textContent=e.message;}finally{clear.disabled=false;}};
 consent.onchange=()=>onChange();
 return {enabled,headers,configured:()=>configured,consented:()=>consent.checked,reset(){consent.checked=false;onChange();},async refresh(){try{update(await requestJson('/api/personal-inference/session',{headers:headers()}));}catch{configured=false;status.textContent='个人会话暂时无法读取，请重试配置。';onChange();}}};
}
