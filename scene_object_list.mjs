const icons={add:'<path d="M4 5h12v14H4zM4 14l4-4 4 4 2-2 2 2M18 4h4m-2-2v4"/><circle cx="8" cy="8" r="1"/>',eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',hidden:'<path d="m3 3 18 18M9.5 5.3 12 5c6.5 0 10 7 10 7a21 21 0 0 1-3.3 4M6.3 6.3A23 23 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.7-1.7"/>',focus:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M12 7v10m-5-5h10"/>',collapse:'<path d="m7 10 5 5 5-5"/>',expand:'<path d="m7 14 5-5 5 5"/>'};
const svg=kind=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`;
function button(label,kind){const element=document.createElement('button');element.type='button';element.title=label;element.setAttribute('aria-label',label);element.innerHTML=svg(kind);return element;}
export function createSceneObjectList(stage,{storageKey,onSelect,onVisibility,onFocus,onRemove,onAdd}){
 const root=document.createElement('section');root.id='sceneObjectList';root.setAttribute('aria-label','场景物品列表');
 const header=document.createElement('header'),heading=document.createElement('h2');heading.textContent='场景物品';const count=document.createElement('span');heading.append(count);
 const add=button('添加场景物品','add'),collapse=button('缩小物品列表','collapse');add.id='sceneListAdd';collapse.id='sceneListCollapse';
 const body=document.createElement('div');body.id='sceneListBody';const rows=document.createElement('ul');rows.id='sceneObjectRows';
 body.append(rows);header.append(heading,add,collapse);root.append(header,body);stage.append(root);
 let minimized=false,last='';try{minimized=localStorage.getItem(storageKey)==='collapsed';}catch{}
 const collapseState=()=>{body.hidden=minimized;root.dataset.collapsed=String(minimized);collapse.setAttribute('aria-expanded',String(!minimized));collapse.setAttribute('aria-controls',body.id);const label=minimized?'展开物品列表':'缩小物品列表';collapse.title=label;collapse.setAttribute('aria-label',label);collapse.innerHTML=svg(minimized?'expand':'collapse');};
 collapse.onclick=()=>{minimized=!minimized;collapseState();try{localStorage.setItem(storageKey,minimized?'collapsed':'expanded');}catch{}};collapseState();add.onclick=onAdd;
 return {root,update(items,selectedId,assets,projectBase){
  count.textContent=' '+items.length;const value=JSON.stringify({items:items.map(o=>[o.id,o.name,o.visible,o.assetId,o.assetKind]),selectedId,assets:assets.map(a=>[a.id,a.sourceAssetId])});if(last===value)return;last=value;
  const focused=root.contains(document.activeElement)?{id:document.activeElement.closest('[data-object-id]')?.dataset.objectId,action:document.activeElement.dataset.action}:null;
  rows.replaceChildren();if(!items.length){const empty=document.createElement('li');empty.className='scene-list-empty';empty.textContent='暂无新增物品，点击图片图标添加。原照片内容属于场景。';rows.append(empty);}
  for(const item of items){
   const row=document.createElement('li');row.dataset.objectId=item.id;row.dataset.selected=String(item.id===selectedId);row.dataset.visible=String(item.visible);
   const select=document.createElement('button');select.type='button';select.className='scene-object-select';select.dataset.action='select';select.setAttribute('aria-label','选中 '+item.name);select.setAttribute('aria-pressed',String(item.id===selectedId));
   const meta=assets.find(a=>a.id===item.assetId),source=item.assetKind==='image'?item.assetId:meta?.sourceAssetId;
   const thumb=document.createElement(source&&projectBase?'img':'span');thumb.className='scene-object-thumb';if(thumb.tagName==='IMG'){thumb.src=projectBase+'/objects/'+source;thumb.alt='';thumb.loading='lazy';}else{thumb.textContent='◇';thumb.setAttribute('aria-hidden','true');}
   select.title=item.name;select.append(thumb);select.onclick=()=>onSelect(item.id);
   const visibility=button((item.visible?'隐藏 ':'显示 ')+item.name,item.visible?'eye':'hidden');visibility.dataset.action='visibility';visibility.setAttribute('aria-pressed',String(item.visible));visibility.onclick=()=>onVisibility(item.id);
   const focus=button('聚焦 '+item.name,'focus');focus.dataset.action='focus';focus.disabled=!item.visible;focus.onclick=()=>onFocus(item.id);
   const remove=button('删除 '+item.name,'hidden');remove.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>';remove.dataset.action='remove';remove.onclick=()=>onRemove(item.id);
   row.append(select,visibility,focus,remove);rows.append(row);
  }
  if(focused?.id&&focused.action){const row=[...rows.children].find(r=>r.dataset.objectId===focused.id);row?.querySelector(`[data-action="${focused.action}"]`)?.focus({preventScroll:true});}
 }};
}
