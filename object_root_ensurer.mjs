// Shares one complete drain operation across callers. Item/asset identifiers are
// snapshotted before awaits so a replacement cannot relabel a stale template.
export function createObjectRootEnsurer({getItems,getMountedAssetId,loadTemplate,mountRoot}){
 let pending=null;
 return function ensureObjectRoots(){
  if(pending)return pending;
  pending=(async()=>{
   while(true){
    const batch=getItems().map(item=>({id:item.id,assetId:item.assetId}));
    for(const {id,assetId} of batch){
     if(getMountedAssetId(id)===assetId)continue;
     const template=await loadTemplate(assetId);
     const current=getItems().find(item=>item.id===id);
     if(!current||current.assetId!==assetId)continue;
     if(getMountedAssetId(id)===assetId)continue;
     await mountRoot(current,template,{id,assetId});
    }
    if(getItems().every(item=>getMountedAssetId(item.id)===item.assetId))return;
   }
  })().finally(()=>{pending=null;});
  return pending;
 }
}
