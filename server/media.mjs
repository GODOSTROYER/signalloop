import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readableCaptions, wrapTitle } from './caption-layout.mjs';
import { assert, captions, id, validateSegments, candidates } from './domain.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function run(command,args,{timeout=120000,maxOutput=2_000_000,cwd}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],shell:false});let stdout='',stderr='',settled=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');done(new Error(`${command} timed out.`));},timeout);
  function done(error){if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(stdout);}
  child.on('error',()=>done(new Error(`${command} is not installed or could not start.`)));
  child.stdout.on('data',b=>{stdout+=b.toString();if(stdout.length>maxOutput){child.kill('SIGKILL');done(new Error('Worker output limit exceeded.'));}});
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000);});
  child.on('close',code=>done(code===0?null:new Error(`${command} failed (${code}). ${stderr.slice(-700)}`)));
 });
}
export async function probe(path){
 const data=JSON.parse(await run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',path]));
 const duration=Number(data.format?.duration);
 assert(Number.isFinite(duration)&&duration>0&&duration<=8*3600,'Media must have a duration between 0 and 8 hours.');
 assert(data.streams?.some(s=>s.codec_type==='video'||s.codec_type==='audio'),'No audio or video stream found.');
 return {duration,video:data.streams.some(s=>s.codec_type==='video'),audio:data.streams.some(s=>s.codec_type==='audio')};
}
export class Workers{
 constructor(store){this.store=store;this.queue=[];this.active=false;for(const j of store.all('jobs').filter(j=>['queued','running'].includes(j.status)))store.put('jobs',{...j,status:'failed',error:'Interrupted by server restart. Please retry.'});}
 enqueue(type,projectId,fn){
  assert(this.queue.length<10,'Worker queue is full. Try again after the current job completes.',429);
  const job={id:id(),type,projectId,status:'queued',createdAt:new Date().toISOString()};this.store.put('jobs',job);this.queue.push({job,fn});this.drain();return job;
 }
 async drain(){
  if(this.active)return;this.active=true;
  try{while(this.queue.length){const {job,fn}=this.queue.shift();this.store.put('jobs',{...job,status:'running'});
   try{const result=await fn(job);this.store.put('jobs',{...job,status:'completed',result,finishedAt:new Date().toISOString()});}
   catch(e){this.store.put('jobs',{...job,status:'failed',error:String(e.message).slice(0,1000),finishedAt:new Date().toISOString()});}
  }}finally{this.active=false;}
 }
 transcribe(project){
  assert(process.env.ENABLE_WHISPER==='1','Local transcription is disabled. Attach a timed transcript, or install faster-whisper and set ENABLE_WHISPER=1.',409);
  assert(project.media,'Upload media before transcription.');
  return this.enqueue('transcribe',project.id,async job=>{
   const output=join(this.store.dir,`${job.id}.json`);
   await run(process.env.PYTHON_BIN||'python3',[join(root,'scripts/transcribe.py'),join(this.store.dir,project.media.file),output],{timeout:2*3600000});
   const value=JSON.parse(await readFile(output,'utf8'));await unlink(output);
   const latest=this.store.get('projects',project.id);
   const updated={...latest,segments:validateSegments(value.segments,latest.duration),timing:'asr',status:'ready',language:value.language};
   const clips=candidates(updated);
   this.store.transaction(()=>{this.store.put('projects',updated);for(const c of this.store.all('clips').filter(c=>c.projectId===updated.id))this.store.delete('clips',c.id);for(const c of clips)this.store.put('clips',c);this.store.log('transcript.completed',{projectId:updated.id,engine:'faster-whisper'});});
   return {projectId:updated.id,clips:clips.length};
  });
 }
 render(project,clip,{aspect='9:16',burnCaptions=true}){
  assert(project.media,'Upload source media to render a clip.');
  assert(project.timing!=='estimated','Estimated timestamps cannot be rendered. Attach a timed transcript first.');
  assert(['9:16','1:1','16:9'].includes(aspect),'Unsupported aspect ratio.');
  return this.enqueue('render',project.id,async job=>{
   const dir=join(this.store.dir,'exports');await mkdir(dir,{recursive:true});
   const sub=`${job.id}.srt`,output=`${job.id}.mp4`;
   await writeFile(join(dir,sub),readableCaptions(project,clip));
   const [w,h]=aspect==='9:16'?[720,1280]:aspect==='1:1'?[720,720]:[1280,720];
   // Fit-and-pad protects context. No unimplemented face tracking or misleading smart-crop claim.
   const filter=`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x111a23,setsar=1`+(burnCaptions?`,subtitles=${sub}:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H00151B24,BorderStyle=1,Outline=1.2,Alignment=2,MarginV=32'`:'');
   const input=join(this.store.dir,project.media.file),duration=clip.end-clip.start;
   const args=['-nostdin','-y','-v','error','-threads','2'];
   if(project.media.video)args.push('-ss',String(clip.start),'-i',input,'-map','0:v:0','-map','0:a?','-vf',filter);
   else {
    const titleFile=`${job.id}.title.txt`;
    await writeFile(join(dir,titleFile),wrapTitle(clip.title,w===1280?45:29));
    const waveWidth=w-120,waveHeight=Math.round(h*.10),label=project.sample?'SYNTHETIC DEMO AUDIO':'PODCAST EXCERPT';
    const brand=`drawtext=font='DejaVu Sans':text='SignalLoop.':expansion=none:fontcolor=0xdbff8b:fontsize=25:x=60:y=55`;
    const labelFilter=`drawtext=font='DejaVu Sans':text='${label}':expansion=none:fontcolor=0xa6bbae:fontsize=13:x=60:y=${Math.round(h*.2)}`;
    const title=`drawtext=font='DejaVu Sans':textfile=${titleFile}:expansion=none:fontcolor=white:fontsize=${w===1280?38:34}:line_spacing=13:x=60:y=${Math.round(h*.27)}`;
    const subtitle=burnCaptions?`,subtitles=${sub}:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H00151B24,BorderStyle=1,Outline=1.2,Alignment=2,MarginV=32'`:'';
    const graph=`[1:a]asplit=2[audio][wave];[wave]showwaves=s=${waveWidth}x${waveHeight}:mode=line:rate=24:colors=0xdbff8b[waveform];[0:v]${brand},${labelFilter},${title}[base];[base][waveform]overlay=(W-w)/2:H*0.60:shortest=1${subtitle}[out]`;
    args.push('-f','lavfi','-i',`color=c=0x1c302d:s=${w}x${h}:r=24`,'-ss',String(clip.start),'-i',input,'-filter_complex_threads','1','-filter_complex',graph,'-map','[out]','-map','[audio]');
   }
   args.push('-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','24','-threads','2','-c:a','aac','-b:a','128k','-pix_fmt','yuv420p','-movflags','+faststart',output);
   await run('ffmpeg',args,{cwd:dir,timeout:600000});
   this.store.log('clip.rendered',{clipId:clip.id,aspect,jobId:job.id});
   return {file:`exports/${output}`,url:`/api/exports/${job.id}`,aspect,clipId:clip.id,captionTiming:'segment-interpolated',style:project.media.video?'fit-and-pad':'waveform-audiogram'};
  });
 }
}
