import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { KDocsCliProvider } from '../src/client/provider.js';
import { downloadPreview, previewName } from '../src/client/preview-cache.js';
import { fieldSchema } from '../src/remote-schemas.js';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
const ref={driveId:'public-drive',fileId:'public-image'};
const url='https://download.wps365.com/public-image';

it('图片直下载保留后缀，经严格Remote结果校验；缓存复用、刷新、清理与PDF隔离',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(PNG);
 const provider=new KDocsCliProvider({});const calls=[];
 provider.stat=async()=>({name:'测试图.PNG'});
 provider.runAction=async(service,action,params)=>{calls.push({service,action,params});return{data:{url}};};
 try{
  const image=await provider.preparePreview(ref);
  assert.equal(image.kind,'image-file');assert.equal(image.source,'download');assert.ok(image.absolutePath.endsWith('.png'));
  assert.deepEqual(await readFile(image.absolutePath),PNG);
  assert.equal(calls.length,1);assert.equal(calls[0].action,'download-file');assert.equal(calls[0].params.with_hash,true);
  assert.equal(fieldSchema({kind:'previewFile'},z).parse(image).kind,'image-file');
  assert.throws(()=>fieldSchema({kind:'previewFile'},z).parse({...image,url:'must-not-cross-wire'}));
  assert.equal((await provider.preparePreview(ref)).cached,true);assert.equal(calls.length,1);
  assert.equal((await provider.preparePreview(ref,{refresh:true})).absolutePath,image.absolutePath);assert.equal(calls.length,2);
  globalThis.fetch=async()=>new Response('%PDF-1.4\npublic\n%%EOF');provider.stat=async()=>({name:'测试.pdf'});
  const pdf=await provider.preparePreview(ref);assert.equal(pdf.kind,'pdf-file');assert.notEqual(pdf.absolutePath,image.absolutePath);
  await provider.previewCache.dispose();await assert.rejects(stat(image.absolutePath),{code:'ENOENT'});
 }finally{globalThis.fetch=original;await provider.previewCache.dispose();}
});

it('八种原生图片后缀校验头部；HTML伪装/错误格式和超限图片拒绝且清理',async()=>{
 const base=await mkdtemp(join(tmpdir(),'kdocs-public-image-test-'));
 const samples={png:PNG,jpg:Buffer.from([255,216,255,224]),jpeg:Buffer.from([255,216,255,224]),gif:Buffer.from('GIF89a'),webp:Buffer.from('RIFF1234WEBP'),bmp:Buffer.from('BMpublic'),ico:Buffer.from([0,0,1,0,1,0]),svg:Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')};
 try{
  for(const [extension,bytes] of Object.entries(samples)){
   const path=join(base,'public.'+extension);assert.equal(previewName('public.'+extension,extension),'public.'+extension);
   await downloadPreview(url,path,{extension,fetcher:async()=>new Response(bytes)});assert.deepEqual(await readFile(path),bytes);
   const bad=join(base,'bad.'+extension);await assert.rejects(downloadPreview(url,bad,{extension,fetcher:async()=>new Response('<html>login</html>')}),/不是受支持的图片/);await assert.rejects(stat(bad),{code:'ENOENT'});
  }
  await assert.rejects(downloadPreview(url,join(base,'wrong.png'),{extension:'png',fetcher:async()=>new Response('%PDF-1.4')}),/不是受支持的图片/);
  await assert.rejects(downloadPreview(url,join(base,'large.png'),{extension:'png',maxBytes:8,fetcher:async()=>new Response(PNG)}),/上限/);
  assert.throws(()=>previewName('public.heic','heic'),/不支持/);
 }finally{await rm(base,{recursive:true,force:true});}
});

it('HEIC/TIFF等不支持格式在请求下载前拒绝',async()=>{
 const provider=new KDocsCliProvider({});let requested=false;
 provider.runAction=async()=>{requested=true;throw Error('must not download');};
 try{for(const ext of ['heic','tif','tiff','html']){provider.stat=async()=>({name:'public.'+ext});await assert.rejects(provider.preparePreview(ref),/不支持/);}assert.equal(requested,false);}
 finally{await provider.previewCache.dispose();}
});
