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
