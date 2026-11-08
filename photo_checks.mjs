// Browser-only preliminary checks. The computer still validates the saved bytes.
// Compatibility policy verified with the phone-photo World generation diagnostic.
export const ROOM_PHOTO_MAX_EDGE=2048;
export function roomPhotoDimensions(width,height){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw Error('照片没有可读取的像素尺寸。');
 const scale=Math.min(1,ROOM_PHOTO_MAX_EDGE/Math.max(width,height));
 return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
export async function restoreRoomPhoto(file,wasPrepared,normalize){
 if(!file)return {file:null,check:null,prepared:false};
 const result=await normalize(file),ready=result.file;
 // Reuse the saved upload only when its actual encoded bytes remain identical.
 let prepared=!!wasPrepared&&file.name===ready.name&&file.type===ready.type&&file.size===ready.size;
 if(prepared){const [before,after]=await Promise.all([file.arrayBuffer(),ready.arrayBuffer()]);const a=new Uint8Array(before),b=new Uint8Array(after);prepared=a.every((value,i)=>value===b[i]);}
 return {...result,prepared};
}
export function photoQuality({width,height,sharpness}){
 const warnings=[];
 if(Math.min(width,height)<512)warnings.push('图片分辨率较低，本 demo 建议短边至少 512 像素。');
 if(sharpness<35)warnings.push('图片模糊或低纹理。');
 return {width,height,sharpness,warnings};
}
export function checkPhotoCanvas(source){
 const canvas=document.createElement('canvas'),scale=Math.min(320/source.width,640/source.height);canvas.width=Math.max(3,Math.round(source.width*scale));canvas.height=Math.max(3,Math.round(source.height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);
 const {data}=ctx.getImageData(0,0,canvas.width,canvas.height),gray=new Float64Array(canvas.width*canvas.height);
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]);
 let sum=0,squares=0,count=0;const w=canvas.width;
 for(let y=1;y<canvas.height-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,v=gray[i-1]+gray[i+1]+gray[i-w]+gray[i+w]-4*gray[i];sum+=v;squares+=v*v;count++;}
 return photoQuality({width:source.width,height:source.height,sharpness:count?squares/count-(sum/count)**2:0});
}
export async function inspectPhotoFile(file){
 const image=await createImageBitmap(file,{imageOrientation:'from-image'});
 try{return checkPhotoCanvas(image);}finally{image.close();}
}
