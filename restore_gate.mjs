// Avoid applying data after an asynchronous load crosses into a protected UI state.
export async function restoreWhenReady(loadValue,{isBusy,apply,onBusy}){
 if(isBusy()){onBusy();return false;}
 const value=await loadValue();
 if(isBusy()){onBusy();return false;}
 apply(value);
 return true;
}
