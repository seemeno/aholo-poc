import {randomUuidV4} from './object_state.mjs';
import {photoMeasurements} from './ui_actions.mjs';
import {requestJson} from './ui_network.mjs';
import {inspectPhotoFile} from './photo_checks.mjs';
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const objectJson=(url,body)=>requestJson(url,{body});
let pickerSequence=0;
export async function normalizeObjectPhoto(file){
 if(!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)&&!file.type.startsWith('image/'))throw Error('请选择物品照片，支持 JPG、PNG 或 WebP');
 if(file.size>30*1024**2)throw Error('单张物品照片最大 30 MB');
 let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('无法读取这张照片，请转换成 JPG、PNG 或 WebP 后重试');}
 try{
  if(bitmap.width<32||bitmap.height<32)throw Error('照片尺寸太小，请选择清晰的物品照片');
  const factor=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*factor));canvas.height=Math.max(1,Math.round(bitmap.height*factor));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));if(!blob)throw Error('照片转换失败');
  return new File([blob],(file.name.replace(/\.[^.]+$/,'')||'object')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
 }finally{bitmap.close();}
}
export function createObjectPhotoPicker(container,{onChange=()=>{}}={}){
 const prefix='objectPhotos'+(++pickerSequence);let items=[],pending=Promise.resolve(),locked=false,processing=false;
 container.classList.add('object-photo-picker');
 container.innerHTML=`<div class="photo-picker-heading"><h3>家具与装饰照片 <span class="optional-label">可同时添加</span></h3><p>每张照片代表一件物品，可以一次选择多张。家具、灯具和摆件生成三维模型；挂画可直接使用原图。</p></div><div class="object-photo-actions"><button type="button" data-choose>从相册选择多张</button><button type="button" data-camera>拍一件物品</button><input id="${prefix}Files" type="file" accept="image/*" multiple hidden><input id="${prefix}Camera" type="file" accept="image/*" capture="environment" hidden></div><p class="photo-picker-message" role="status"></p><div class="object-photo-items"></div>`;
 const list=container.querySelector('.object-photo-items'),message=container.querySelector('.photo-picker-message'),album=container.querySelector('#'+prefix+'Files'),camera=container.querySelector('#'+prefix+'Camera');
 const choose=container.querySelector('[data-choose]'),shoot=container.querySelector('[data-camera]');
 const setButtons=()=>{choose.disabled=shoot.disabled=locked||processing;};
 function render(){
  list.innerHTML=items.map((item,i)=>`<article class="object-photo-item"><img src="${item.url}" alt="${escapeHtml(item.name)}的物品照片"><div class="object-photo-fields"><label for="${prefix}Name${i}">物品名称</label><input id="${prefix}Name${i}" data-name="${i}" value="${escapeHtml(item.name)}" maxlength="70"><label for="${prefix}Kind${i}">物品类型</label><select id="${prefix}Kind${i}" data-kind="${i}"><option value="furniture" ${item.category==='furniture'?'selected':''}>家具 · 生成三维</option><option value="decor" ${item.category==='decor'?'selected':''}>灯具 / 摆件 · 生成三维</option><option value="picture" ${item.category==='picture'?'selected':''}>挂画 · 直接使用图片</option></select><details><summary>尺寸（可稍后填写）</summary><div class="object-photo-size">${[['width','宽'],['depth','深'],['height','高']].map(([key,label])=>`<label>${label}（厘米）<input type="number" inputmode="decimal" min="1" max="2000" step="0.1" data-size="${i}:${key}" value="${item.size?.[key]===undefined?'':Number((item.size[key]*100).toFixed(4))}" placeholder="待确认"></label>`).join('')}</div></details>${item.check?`<p class="object-photo-check">照片可读取 · ${item.check.width} × ${item.check.height} 像素 · ${(item.file.size/1024**2).toFixed(1)} MB</p>${item.check.warnings?.length?`<p class="object-photo-quality">质量提醒：${item.check.warnings.map(escapeHtml).join("；")} 仅供参考，可换图或继续。</p>`:""}`:""}${item.error?`<p class="object-task-error">${escapeHtml(item.error)}</p>`:''}<button type="button" class="text-button" data-remove="${i}" aria-label="移除 ${escapeHtml(item.name)}">移除</button></div></article>`).join('');
  list.querySelectorAll('[data-name]').forEach(el=>el.oninput=()=>{items[Number(el.dataset.name)].name=el.value;onChange();});
  list.querySelectorAll('[data-kind]').forEach(el=>el.onchange=()=>{items[Number(el.dataset.kind)].category=el.value;onChange();});
  list.querySelectorAll('[data-size]').forEach(el=>el.oninput=()=>{const [i,key]=el.dataset.size.split(':');const item=items[Number(i)];item.size??={};if(el.value==='')delete item.size[key];else item.size[key]=Number(el.value)/100;el.setCustomValidity('');el.removeAttribute('aria-invalid');onChange();});
  list.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{if(locked)return;const [item]=items.splice(Number(el.dataset.remove),1);URL.revokeObjectURL(item.url);render();onChange();});
  for(const el of list.querySelectorAll('input,select,button'))el.disabled=locked;
  message.textContent=items.length?`已选择 ${items.length} 件物品 · 每次最多 20 张照片`:'也可以先生成空间，之后再添加物品。';
 }
 async function append(files){
  if(locked||processing)return;const selected=Array.from(files);if(items.length+selected.length>20){message.textContent='一次最多选择 20 张物品照片，请分批添加。';return;}
  processing=true;setButtons();const failures=[];
  try{for(let i=0;i<selected.length;i++){
   const source=selected[i];message.textContent=`正在本机处理照片 ${i+1}/${selected.length}…`;
   try{const file=await normalizeObjectPhoto(source),check=await inspectPhotoFile(file);items.push({localId:randomUuidV4(),file,check,name:source.name.replace(/\.[^.]+$/,'').slice(0,70)||'我的物品',category:'furniture',url:URL.createObjectURL(file)});}catch(e){failures.push(source.name+'：'+e.message);}
  }}finally{processing=false;setButtons();album.value='';camera.value='';render();if(failures.length)message.textContent=failures.join('；');onChange();}
 }
 choose.onclick=()=>album.click();shoot.onclick=()=>camera.click();album.onchange=()=>{pending=append(album.files);};camera.onchange=()=>{pending=append(camera.files);};
 return {
  async ready(options){await pending;return this.values(options);},
  values(options){return items.map((item,i)=>{try{const measurements=photoMeasurements(item.size,options);return {...item,name:item.name.trim()||'我的物品',size:undefined,draftSize:undefined,...measurements};}catch(e){const input=list.querySelector(`[data-size="${i}:${e.field}"]`);input.closest('details').open=true;input.setCustomValidity(e.message);input.setAttribute('aria-invalid','true');input.reportValidity();throw Error(item.name+'：'+e.message);}});},
  applySaveResult(result){const failed=new Map(result.failedItems.map(item=>[item.localId,item]));items=items.filter(item=>{const failure=failed.get(item.localId);if(failure){Object.assign(item,{error:failure.error,sourceAssetId:failure.sourceAssetId});return true;}URL.revokeObjectURL(item.url);return false;});render();onChange();},
  setItems(value){for(const item of items)URL.revokeObjectURL(item.url);items=value.map(item=>({...item,size:item.size??item.draftSize,url:URL.createObjectURL(item.file)}));render();onChange();},
  snapshot(){return items.map(({url,...item})=>({...item,size:item.size?{...item.size}:undefined}));},
  count(){return items.length;},
  lock(value){locked=value;setButtons();for(const el of list.querySelectorAll('input,select,button'))el.disabled=locked;},
  clear(){for(const item of items)URL.revokeObjectURL(item.url);items=[];render();onChange();}
 };
}
export async function saveObjectPhotos(projectId,items,onProgress=()=>{}){
 const jobs=[],errors=[],failedItems=[];
 for(let i=0;i<items.length;i++){
  const item=items[i];onProgress(i,items.length,item.name);
  try{
   if(!item.sourceAssetId){const asset=await requestJson(`/api/projects/${projectId}/objects?name=${encodeURIComponent(item.file.name)}`,{rawBody:item.file,timeoutMs:90000});item.sourceAssetId=asset.id;}
   const result=await objectJson(`/api/projects/${projectId}/object-generations`,{items:[{sourceAssetId:item.sourceAssetId,name:item.name,category:item.category,...(item.size?{size:item.size}:{}),...(item.draftSize?{draftSize:item.draftSize}:{})}]});jobs.push(...result.jobs);
  }catch(e){item.error=e.message;errors.push(item.name+'：'+e.message);failedItems.push(item);}
 }
 return {jobs,errors,failedItems};
}
