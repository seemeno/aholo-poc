// Small maintenance parser for this repository's plain CSS; not browser runtime code.
function split(text,separator){
 const parts=[];let start=0,quote='',depth=0;
 for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c===separator&&!depth){parts.push(text.slice(start,i).trim());start=i+1;}}
 parts.push(text.slice(start).trim());return parts.filter(Boolean);
}
export function parseCss(source){
 const text=source.replace(/\/\*[\s\S]*?\*\//g,''),nodes=[];let start=0;
 while(start<text.length){while(/\s/.test(text[start]??'')&&start<text.length)start++;if(start===text.length)break;
  let open=start,quote='',depth=0;for(;open<text.length;open++){const c=text[open];if(quote){if(c==='\\')open++;else if(c===quote)quote='';continue;}if(c==='"'||c==="'")quote=c;else if(c==='(')depth++;else if(c===')')depth--;else if(c==='{'&&!depth)break;}
  if(open===text.length)throw Error('CSS rule is missing a block');let end=open+1,braces=1;quote='';
  for(;end<text.length&&braces;end++){const c=text[end];if(quote){if(c==='\\')end++;else if(c===quote)quote='';continue;}if(c==='"'||c==="'")quote=c;else if(c==='{')braces++;else if(c==='}')braces--;}
  if(braces)throw Error('Unclosed CSS block');const header=text.slice(start,open).trim(),body=text.slice(open+1,end-1);
  if(header.startsWith('@'))nodes.push({header,children:parseCss(body)});
  else for(const selector of split(header,','))nodes.push({selector,declarations:split(body,';').map(part=>{const index=part.indexOf(':');if(index<1)throw Error('Invalid CSS declaration');const value=part.slice(index+1).trim(),important=/!important\s*$/i.test(value);return {property:part.slice(0,index).trim(),value:value.replace(/\s*!important\s*$/i,''),important};})});
  start=end;
 }return nodes;
}
export function cssLeaves(nodes,path=[]){return nodes.flatMap(node=>node.children?cssLeaves(node.children,[...path,node.header]):[{...node,path}]);}
export function cssWinners(nodes){
 const result=new Map();for(const rule of cssLeaves(nodes))for(const declaration of rule.declarations){const key=JSON.stringify([rule.path,rule.selector,declaration.property]),previous=result.get(key);if(!previous?.important||declaration.important)result.set(key,declaration);}
 return [...result].sort(([a],[b])=>a.localeCompare(b));
}
export function consolidateCss(nodes){
 const result=structuredClone(nodes),seen=new Map();let removed=0;
 for(const rule of cssLeaves(result).reverse())for(let i=rule.declarations.length-1;i>=0;i--){const d=rule.declarations[i],key=JSON.stringify([rule.path,rule.selector,d.property]),later=seen.get(key);if(later&&(later.important||!d.important)&&!d.value.includes('-webkit-')&&!later.value.includes('-webkit-')){rule.declarations.splice(i,1);removed++;}else seen.set(key,d);}
 function compact(items){const output=[];for(const node of items){if(node.children){node.children=compact(node.children);if(!node.children.length)continue;}else if(!node.declarations.length)continue;const previous=output.at(-1);if(node.selector&&node.selector===previous?.selector)previous.declarations.push(...node.declarations);else output.push(node);}return output;}
 return {nodes:compact(result),removed};
}
export function formatCss(nodes,indent=''){
 return nodes.map(node=>node.children?indent+node.header+' {\n'+formatCss(node.children,indent+'  ')+indent+'}\n':indent+node.selector+' {\n'+node.declarations.map(d=>indent+'  '+d.property+': '+d.value+(d.important?' !important':'')+';\n').join('')+indent+'}\n').join('\n');
}
