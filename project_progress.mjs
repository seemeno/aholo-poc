const roomActive=new Set(['QUEUED','UPLOADING','WAITING','DOWNLOADING','EXTRACTING']);
const objectActive=new Set(['QUEUED','UPLOADING','RUNNING','DOWNLOADING']);
const effectActive=new Set(['QUEUED','PREPARING','GENERATING','WAITING']);
const attention=new Set(['FAILED','PAUSED','SUBMIT_UNKNOWN']);
export function roomProgress(project){
 const descriptions={DRAFT:['pending','待生成','照片保存后，确认开始生成。'],QUEUED:['running','准备中','正在准备场景任务。'],UPLOADING:['running','准备中','正在传输场景素材。'],WAITING:['running','生成中','正在生成三维场景，可以离开页面稍后查看。'],DOWNLOADING:['running','下载中','场景已生成，正在保存到电脑。'],EXTRACTING:['running','整理中','正在准备地面与可摆放区域。'],READY:['done','已就绪','可以进入空间，开始试摆。'],FAILED:['attention','未完成','场景处理失败，请查看下方提示。'],PAUSED:['attention','待继续','处理已暂停，可以接着完成已有任务。'],SUBMIT_UNKNOWN:['attention','待核对','提交结果尚未确认，请先核对已有任务。']};
 const [state,label,note]=descriptions[project.status]??['unknown','待核对','正在读取场景状态。'];
 // A server restart may leave a saved active status without a local worker.
 const needsResume=!!project.worldId&&(project.status==='PAUSED'||roomActive.has(project.status)&&project.processing===false);
 return {state:needsResume?'attention':state,label:needsResume?'待继续':label,note,needsResume};
}
export function projectProgress(project,{jobs=null,effect=null,effectKnown=false,jobsError='',effectError=''}={}){
 const room=roomProgress(project),known=Array.isArray(jobs)&&!jobsError,items=Array.isArray(jobs)?jobs:[];
 const ready=items.filter(j=>j.state==='READY').length,total=items.length;
 const running=roomActive.has(project.status)&&!room.needsResume||items.some(j=>objectActive.has(j.state))||effectActive.has(effect?.state);
 const needsAttention=room.needsResume||attention.has(project.status)||items.some(j=>attention.has(j.state))||attention.has(effect?.state)||!!jobsError||!!effectError;
 let label='待生成',title='确认照片，准备开始';
 if(needsAttention){label='需要关注';title=running?'部分任务需要处理，其余继续进行':'有任务需要你处理';}
 else if(running){label='处理中';title=roomActive.has(project.status)?'正在准备你的空间':effectActive.has(effect?.state)?'正在生成空间效果图':'空间已就绪，物品正在生成';}
 else if(project.status==='READY'&&known&&ready===total){label='可以试摆';title=effect?.state==='READY'?'效果图已生成':project.hasScene?'摆放方案已保存':'空间与物品已准备好';}
 else if(project.status==='READY'&&known){label='待生成物品';title='空间已就绪，还有物品待生成';}
 else if(project.status==='READY'){label='读取进度';title='空间已就绪，正在读取其他进度';}
 return {room,items,known,ready,total,label,title,needsAttention,jobsError,effectError,effect,effectKnown};
}
export function projectStepProgress(project,data={}){
 const m=projectProgress(project,data),effect=m.effect;
 const itemState=m.jobsError?'attention':!m.known?'unknown':m.items.some(j=>attention.has(j.state))?'attention':m.items.some(j=>objectActive.has(j.state))?'running':m.total&&m.ready===m.total?'done':'pending';
 const itemText=m.jobsError?(m.total?`物品 ${m.ready}/${m.total} · 暂未更新`:'物品暂未更新'):!m.known?'物品读取中':m.total?`物品 ${m.ready}/${m.total} 就绪`:'未添加物品';
 const itemLines=[{text:itemText,state:itemState==='attention'&&!m.jobsError?'pending':itemState==='running'?'pending':itemState}];
 if(m.known&&['attention','running','pending'].includes(itemState)&&m.ready<m.total){const filter=itemState==='attention'?j=>attention.has(j.state):itemState==='running'?j=>objectActive.has(j.state):j=>j.state==='DRAFT',count=m.items.filter(filter).length;itemLines.push({text:count+' 件'+(itemState==='attention'?'需处理':itemState==='running'?'生成中':'待生成'),state:itemState});}
 const effectState=m.effectError?'attention':!m.effectKnown?'unknown':effect?.state==='READY'?'done':effectActive.has(effect?.state)?'running':attention.has(effect?.state)?'attention':'pending';
 const effectLabel=m.effectError?'进度暂未更新':!m.effectKnown?'读取中':effect?.state==='READY'?'效果图已生成':effectActive.has(effect?.state)?'效果图生成中':effect?.state==='SUBMIT_UNKNOWN'?'任务待核对':effect?.state==='FAILED'?'效果图未完成':effect?.state==='PAUSED'?'任务待继续':'未生成 · 可选';
 const prepareState=[m.room.state,itemState].includes('attention')?'attention':[m.room.state,itemState].includes('running')?'running':m.room.state==='done'&&m.known&&m.ready===m.total?'done':'pending';
 const showDetails=m.room.state!=='done'||!m.known||m.ready<m.total||m.needsAttention||effectState==='running';
 const attentionKey=showDetails?JSON.stringify([project.status,m.room.needsResume,m.items.map(j=>[j.id,j.state]),m.jobsError,effect?.state,m.effectError]):'';
 return {...m,itemState,effectState,showDetails,attentionKey,steps:{
  prepare:{state:prepareState,lines:[{text:'场景'+m.room.label,state:m.room.state},...itemLines]},
  place:{state:project.hasScene?'done':'pending',lines:[{text:project.hasScene?'方案已保存':project.status==='READY'?'可开始试摆':'待场景就绪',state:project.hasScene?'done':'pending'}]},
  effects:{state:effectState,lines:[{text:effectLabel,state:effectState}]}
 }};
}
