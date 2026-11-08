import {requestJson,RequestError} from './ui_network.mjs';
// Recheck durable state before continuing, including when a start response was lost.
export async function continueObjectJobs(projectId,ids,json=requestJson){
 const {jobs}=await json(`/api/projects/${projectId}/object-generations`),wanted=new Set(ids);
 if(ids.some(id=>!jobs.some(j=>j.id===id)))throw new RequestError('已保存的物品任务暂时找不到，请返回空间核对。',{kind:'missing',status:404});
 const drafts=jobs.filter(j=>wanted.has(j.id)&&j.state==='DRAFT');
 if(drafts.length)await json(`/api/projects/${projectId}/object-generations/start`,{body:{ids:drafts.map(j=>j.id)}});
 return jobs.filter(j=>wanted.has(j.id));
}
