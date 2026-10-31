/** Generate an original spoken fixture locally, never download someone else's content. */
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../server/db.mjs';
import { demoParagraphs, seed } from '../server/seed.mjs';
import { run, probe } from '../server/media.mjs';
import { candidates } from '../server/domain.mjs';
const store=new Store(resolve(process.env.DATA_DIR||'.signalloop'));seed(store);
const tmp=await mkdtemp(join(tmpdir(),'signalloop-demo-'));
try {
 console.log('Generating original synthetic speech with eSpeak. This resets only the demo brand.');
 const parts=[],segments=[];let cursor=0;
 for(let i=0;i<demoParagraphs.length;i++){
  const file=join(tmp,`${i}.wav`);await run('espeak',['-s','150','-v','en-us','-w',file,demoParagraphs[i]]);
  const meta=await probe(file);parts.push(`file '${file.replace(/'/g,"'\\''")}'`);segments.push({start:cursor,end:cursor+meta.duration,text:demoParagraphs[i]});cursor+=meta.duration;
 }
 await writeFile(join(tmp,'list.txt'),parts.join('\n'));await mkdir(join(store.dir,'uploads'),{recursive:true});
 const file='uploads/demo-original.wav';await run('ffmpeg',['-nostdin','-v','error','-y','-f','concat','-safe','0','-i',join(tmp,'list.txt'),'-c:a','pcm_s16le',join(store.dir,file)]);
 const meta=await probe(join(store.dir,file));
 const p={...store.get('projects','demo'),brandId:'demo-brand',source:'Original synthetic speech generated with eSpeak',segments,duration:meta.duration,timing:'provided',media:{file,...meta},status:'ready'};
 store.transaction(()=>{
  for(const kind of ['clips','feedback','calendar','edits','rules','jobs','campaigns'])for(const item of store.all(kind).filter(x=>x.projectId==='demo'))store.delete(kind,item.id);
  store.put('projects',p);for(const c of candidates(p))store.put('clips',c);store.log('demo.media-generated',{projectId:'demo',sample:true});
 });
 console.log(`Generated ${Math.round(meta.duration)} seconds of synthetic podcast audio. Reload the studio.`);
} finally {await rm(tmp,{recursive:true,force:true});store.close();}
