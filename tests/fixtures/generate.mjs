// Deterministic, synthetic media for tests. No user photos or downloaded models.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
const dir=new URL('./',import.meta.url);
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,bytes){const name=Buffer.from(type),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);name.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([name,bytes])),out.length-4);return out;}
const size=128,header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
const pixels=Buffer.alloc(size*(size*3+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=y*(size*3+1)+1+x*3;pixels[i]=x*2;pixels[i+1]=y*2;pixels[i+2]=((x>>4)^(y>>4))&1?220:60;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
await fs.writeFile(new URL('image.png',dir),png);
const positions=[-1,0,-.3,1,0,-.3,1,.8,-.3,-1,.8,-.3,-1,0,.3,1,0,.3,1,.8,.3,-1,.8,.3];
const indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5];
const geometry=Buffer.alloc(positions.length*4+indices.length*2);positions.forEach((v,i)=>geometry.writeFloatLE(v,i*4));indices.forEach((v,i)=>geometry.writeUInt16LE(v,positions.length*4+i*2));
const doc={asset:{version:'2.0',generator:'Space Workshop synthetic test fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.65,.5,.35,1],metallicFactor:0,roughnessFactor:.8}}],buffers:[{byteLength:geometry.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length*4,target:34962},{buffer:0,byteOffset:positions.length*4,byteLength:indices.length*2,target:34963}],accessors:[{bufferView:0,componentType:5126,count:8,type:'VEC3',min:[-1,0,-.3],max:[1,.8,.3]},{bufferView:1,componentType:5123,count:indices.length,type:'SCALAR',min:[0],max:[7]}]};
const text=JSON.stringify(doc),json=Buffer.from(text.padEnd(Math.ceil(Buffer.byteLength(text)/4)*4,' '));
const glb=Buffer.alloc(28+json.length+geometry.length);glb.writeUInt32LE(0x46546c67);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(json.length,12);glb.writeUInt32LE(0x4e4f534a,16);json.copy(glb,20);glb.writeUInt32LE(geometry.length,20+json.length);glb.writeUInt32LE(0x004e4942,24+json.length);geometry.copy(glb,28+json.length);
await fs.writeFile(new URL('cabinet.glb',dir),glb);
console.log('Generated synthetic image.png and cabinet.glb');
