// Foreground selection and background refresh share one read, without side effects.
export function createHistoryReader(read){
 let pending=null;
 return ()=>{
  if(pending)return pending;
  const request=Promise.resolve().then(read).then(result=>{
   const jobs=result.jobs??(result.latest?[result.latest]:[]);
   if(!Array.isArray(jobs))throw Error('效果图记录格式无效，请重新读取。');
   return jobs;
  });
  pending=request.finally(()=>{pending=null;});return pending;
 };
}

export function roomEffectRecords(projectId,jobs){
 if(!Array.isArray(jobs))throw Error('效果图记录格式无效，请重新读取。');
 const records=jobs.filter(j=>j.projectId===projectId&&/^[a-f0-9]{64}$/.test(j.id)).slice().sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
 return {jobs:records,images:records.filter(j=>j.state==='READY'),tasks:records.filter(j=>j.state!=='READY'),running:records.filter(j=>['QUEUED','PREPARING','GENERATING','WAITING'].includes(j.state))};
}

// Room changes never display another room's records. Failed reads retain last good data.
export function createRoomEffectHistory({read,onChange=()=>{}}){
 const rooms=new Map(),readers=new Map();let selected=null;
 const state=id=>rooms.get(id)??{projectId:id,jobs:[],known:false,loading:false,error:null};
 const publish=value=>{rooms.set(value.projectId,value);if(selected===value.projectId)onChange(value);};
 return {
  select(id){selected=id;onChange(state(id));},
  get current(){return selected;},
  get state(){return state(selected);},
  async refresh(id=selected){
   if(!id)return [];
   if(!readers.has(id))readers.set(id,createHistoryReader(()=>read(id)));
   publish({...state(id),loading:true});
   try{const records=roomEffectRecords(id,await readers.get(id)());publish({projectId:id,jobs:records.jobs,known:true,loading:false,error:null});return records.jobs;}
   catch(error){publish({...state(id),loading:false,error});throw error;}
  }
 };
}

export function createRoomEffectGallery(container,{read,onRefresh,onAuth}={}){
 const doc=container.ownerDocument,escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={QUEUED:'排队中',PREPARING:'准备中',GENERATING:'生成中',WAITING:'等待完成',WAITING_CREDENTIALS:'等待个人凭证',READY:'已完成',FAILED:'生成失败',SUBMIT_UNKNOWN:'提交待核对',PAUSED:'已暂停'};
 const time=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('zh-CN'):'时间未知';};
 container.className='room-effects';container.innerHTML='<header><h2>效果图</h2><button type="button" data-refresh>更新进度</button></header><p data-status role="status"></p><a data-auth hidden>重新配对</a><p data-empty hidden>还没有效果图。进入试摆，调整视角后点击相机图标生成。</p><div class="room-effect-images" data-images></div><details class="room-effect-records" open><summary data-summary>生成记录</summary><ol data-records></ol></details>';
 const $=selector=>container.querySelector(selector),images=$('[data-images]'),tasks=$('[data-records]'),refresh=$('[data-refresh]'),status=$('[data-status]'),auth=$('[data-auth]');
 const viewer=doc.createElement('dialog');viewer.className='space-dialog room-effect-lightbox';viewer.setAttribute('aria-labelledby','roomEffectImageTitle');viewer.innerHTML='<header><h2 id="roomEffectImageTitle">效果图</h2><button type="button" data-close aria-label="关闭大图">×</button></header><p data-caption></p><img alt="完整效果图"><p data-image-error role="status" hidden>图片暂未加载，请重新加载。</p><button type="button" data-reload hidden>重新加载图片</button><nav aria-label="切换效果图"><button type="button" data-previous>上一张</button><span data-counter></span><button type="button" data-next>下一张</button></nav>';
 doc.body.append(viewer);const v=selector=>viewer.querySelector(selector);let galleryKey='',taskKey='',ready=[],imageId=null;
 v('[data-close]').onclick=()=>viewer.close();
 function showImage(id){
  const index=ready.findIndex(j=>j.id===id);if(index<0)return;imageId=id;const job=ready[index],url='/api/effect-renders/'+id+'/image',image=v('img');
  if(image.getAttribute('src')!==url){image.src=url;v('[data-image-error]').hidden=true;v('[data-reload]').hidden=true;}
  image.alt='效果图 · '+time(job.completedAt??job.createdAt);v('[data-caption]').textContent=time(job.completedAt??job.createdAt)+' · '+job.width+' × '+job.height;
  v('[data-counter]').textContent=(index+1)+' / '+ready.length;v('[data-previous]').disabled=index===0;v('[data-next]').disabled=index===ready.length-1;
 }
 v('[data-previous]').onclick=()=>showImage(ready[ready.findIndex(j=>j.id===imageId)-1]?.id);
 v('[data-next]').onclick=()=>showImage(ready[ready.findIndex(j=>j.id===imageId)+1]?.id);
 v('img').onerror=()=>{v('[data-image-error]').hidden=false;v('[data-reload]').hidden=false;};
 v('[data-reload]').onclick=()=>{v('[data-image-error]').hidden=true;v('[data-reload]').hidden=true;v('img').src='/api/effect-renders/'+imageId+'/image?retry='+Date.now();};
 images.addEventListener('click',event=>{const button=event.target.closest('[data-effect-image]');if(!button)return;showImage(button.dataset.effectImage);if(!viewer.open)viewer.showModal();});
 function render(value){
  container.hidden=!value.projectId;if(!value.projectId)return;
  const records=roomEffectRecords(value.projectId,value.jobs);ready=records.images;refresh.disabled=value.loading;container.setAttribute('aria-busy',String(value.loading));
  status.textContent=value.error?'效果图记录暂未更新，已读取的图片和进度仍保留。':!value.known?'正在读取效果图记录…':ready.length+' 张效果图 · '+records.running.length+' 个任务进行中';
  auth.hidden=true;if(value.error)onAuth?.(value.error,auth);
  $('[data-empty]').hidden=!value.known||!!value.jobs.length;$('[data-summary]').textContent='生成记录 · '+records.tasks.length+' 项';
  container.querySelector('.room-effect-records').hidden=!records.tasks.length;
  const nextGallery=JSON.stringify([value.projectId,ready.map(j=>[j.id,j.completedAt,j.width,j.height])]);
  if(nextGallery!==galleryKey){galleryKey=nextGallery;images.innerHTML=ready.map(j=>'<button type="button" class="room-effect-thumbnail" data-effect-image="'+j.id+'" aria-label="放大效果图 '+escape(time(j.completedAt??j.createdAt))+'"><img loading="lazy" src="/api/effect-renders/'+j.id+'/image" alt="已生成的效果图"><span>'+escape(time(j.completedAt??j.createdAt))+'</span><small>'+escape(j.width)+' × '+escape(j.height)+'</small></button>').join('');for(const image of images.querySelectorAll('img'))image.onerror=()=>{image.hidden=true;image.parentElement.classList.add('image-unavailable');};}
  const nextTasks=JSON.stringify([value.projectId,records.tasks]);
  if(nextTasks!==taskKey){taskKey=nextTasks;tasks.innerHTML=records.tasks.map(j=>'<li data-state="'+escape(j.state)+'"><div><strong>'+escape(labels[j.state]??'待核对')+'</strong><time>'+escape(time(j.createdAt))+'</time></div><p>'+escape(j.message??'')+'</p>'+(['QUEUED','PREPARING','GENERATING','WAITING'].includes(j.state)?'<progress aria-label="'+escape(labels[j.state])+'"></progress>':'')+'</li>').join('');}
  if(viewer.open)showImage(imageId);
 }
 const history=createRoomEffectHistory({read,onChange:render});
 refresh.onclick=()=>onRefresh?onRefresh():history.refresh().catch(()=>{});
 return {
  select(id){if(id!==history.current&&viewer.open)viewer.close();history.select(id);if(id)history.refresh().catch(()=>{});},
  refresh:id=>history.refresh(id),
  get state(){return history.state;}
 };
}
