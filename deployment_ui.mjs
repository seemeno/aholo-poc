let settings={deployment:'local',effectsEnabled:true,sharedDemo:false,exampleAvailable:true};
export const getDeployment=()=>settings;
export const serviceText=text=>settings.deployment==='modelscope'?String(text).replaceAll('电脑本地','创空间').replaceAll('电脑上的','服务端的').replaceAll('电脑','服务端'):text;
export async function configureDeployment(){
 try{const response=await fetch('/api/capabilities',{signal:AbortSignal.timeout(8000)});if(response.ok)settings={...settings,...await response.json()};}catch{}
 if(settings.deployment==='modelscope'){
  document.body.dataset.deployment='modelscope';for(const link of document.querySelectorAll('a[href="/ui_wireframe.html"]'))link.hidden=true;
  for(const link of document.querySelectorAll('a[href="/phone"]')){link.hidden=false;link.textContent='手机访问';link.target='_blank';link.rel='noopener';}
  const intro=document.querySelector('.home-intro');
  if(intro&&!document.getElementById('studioPhoneAccess')){
   const card=document.createElement('section');card.id='studioPhoneAccess';card.className='studio-phone-access';card.setAttribute('aria-label','手机访问');
   card.innerHTML='<img class="studio-phone-qr" src="/phone-qr.svg" width="112" height="112" alt="手机扫码打开空间工坊"><div><h2>手机也能直接使用</h2><p class="desktop-phone-note">用手机相机扫码，在浏览器打开。无需同一 Wi-Fi，无需配对码。</p><p class="mobile-phone-note">手机浏览器中可直接拍照试摆，无需连接电脑。</p><a class="button secondary" href="/phone" target="_blank" rel="noopener">手机访问 · 复制网址</a></div>';
   intro.after(card);
  }
  const hint=document.createElement('p');hint.className='studio-demo-note';hint.textContent='比赛共享 Demo · 无需注册 · 项目与方案由体验者共用';document.querySelector('.home-intro')?.after(hint);
  const consent=document.getElementById('generationConsent');if(consent)consent.textContent='确认后向 Aholo 提交照片并使用演示额度，生成任务不会因关闭页面而取消。';
  for(const node of document.querySelectorAll('.app-footer,#library,.save-dialog,#saveDialog,.editor-heading small'))rewriteServiceCopy(node);
 }
 return settings;
}
export function rewriteServiceCopy(root){
 if(settings.deployment!=='modelscope'||!root)return;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())node.textContent=serviceText(node.textContent);
}
