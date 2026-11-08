// The verified local FLUX.2 Klein 4B recipe, parameterized for the current view.
export const EFFECT_RECIPE='klein4b-fp8-preserve-layout-v3';
export function effectWorkflow({image,references=[],width,height,seed,prefix}){
 const n=(class_type,inputs)=>({class_type,inputs});
 const refText=references.map((r,i)=>`Image ${i+2} is a product/detail reference for ${r.label}. Use it only to preserve that existing item's design and materials, never to change the room layout or add another item.`).join(' ');
 const prompt=`Refine image 1 into a convincing real interior photograph of this exact same room from the exact same camera. Preserve the composition, perspective, room layout, architecture, floor, walls, existing decor, and every placed object's position, scale and orientation. Preserve each furniture design, number of doors, shelves, handles and legs, and original material colors. ${refText} Unify the whole image with soft natural light, consistent exposure and white balance, realistic material texture and subtle contact shadows. Make the placed furniture look as photographic as the surrounding room. Refine existing details without redesigning the room. No new furniture, no television unless already present, no people, no text, no watermark. Restrained interior photography, not glossy CGI or an illustration.`;
 const graph={
  '1':n('UNETLoader',{unet_name:'flux-2-klein-4b-fp8.safetensors',weight_dtype:'default'}),
  '2':n('CLIPLoader',{clip_name:'qwen_3_4b.safetensors',type:'flux2',device:'default'}),
  '3':n('VAELoader',{vae_name:'flux2-vae.safetensors'}),
  '4':n('LoadImage',{image}),
  '5':n('CLIPTextEncode',{clip:['2',0],text:prompt}),
  '6':n('ConditioningZeroOut',{conditioning:['5',0]}),
  '7':n('VAEEncode',{pixels:['4',0],vae:['3',0]}),
  '8':n('ReferenceLatent',{conditioning:['5',0],latent:['7',0]}),
  '9':n('ReferenceLatent',{conditioning:['6',0],latent:['7',0]}),
  '14':n('CFGGuider',{model:['1',0],positive:['8',0],negative:['9',0],cfg:1}),
  '15':n('RandomNoise',{noise_seed:seed}),
  '16':n('KSamplerSelect',{sampler_name:'euler'}),
  '17':n('Flux2Scheduler',{steps:4,width,height}),
  '22':n('SplitSigmas',{sigmas:['17',0],step:2}),
  '19':n('SamplerCustomAdvanced',{noise:['15',0],guider:['14',0],sampler:['16',0],sigmas:['22',1],latent_image:['7',0]}),
  '20':n('VAEDecode',{samples:['19',0],vae:['3',0]}),
  '21':n('SaveImage',{images:['20',0],filename_prefix:prefix}),
 };
 graph['5'].inputs.text+=' Preserve the exact number of chairs, plants, doors, windows, pictures and cabinets already visible in image 1. Never add any new door or window. Keep the artwork entirely inside its existing frame. Do not put botanical artwork into the room as a real plant.';
 references.forEach((r,i)=>{
  const id=30+i*5;
  graph[id]=n('LoadImage',{image:r.image});
  graph[id+1]=n('ImageScaleToTotalPixels',{image:[String(id),0],upscale_method:'lanczos',megapixels:.589824,resolution_steps:16});
  graph[id+2]=n('VAEEncode',{pixels:[String(id+1),0],vae:['3',0]});
  graph[id+3]=n('ReferenceLatent',{conditioning:graph['14'].inputs.positive,latent:[String(id+2),0]});
  graph[id+4]=n('ReferenceLatent',{conditioning:graph['14'].inputs.negative,latent:[String(id+2),0]});
  graph['14'].inputs.positive=[String(id+3),0];graph['14'].inputs.negative=[String(id+4),0];
 });
 return graph;
}
