import http from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, mkdir, unlink, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.mjs';
import { seed } from './seed.mjs';
import { Workers, probe, run } from './media.mjs';
import { createLabRoutes } from './lab.mjs';
import { inspectMeaning } from './editorial.mjs';
import { rewriteCopy } from './ai.mjs';
import { assert, id, platforms, parseTranscript, validateSegments, candidates, rankClips, draftCopy, inferRules, validateFeedback, captions, calendarICS } from './domain.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mkv':'video/x-matroska','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac'};
const now=()=>new Date().toISOString();
function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){assert((req.headers['content-type']||'').startsWith('application/json'),'Expected application/json.',415);let chunks=[],size=0;for await(const b of req){size+=b.length;assert(size<=3_000_000,'Request is too large.',413);chunks.push(b);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString());}catch{assert(false,'Invalid JSON.');}assert(value&&typeof value==='object'&&!Array.isArray(value),'Expected a JSON object.');return value;}
async function sendFile(req,res,path,type,download){
 const info=await stat(path).catch(()=>null);assert(info?.isFile(),'File not found.',404);
 let start=0,end=info.size-1,status=200;
 if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);assert(m&&(m[1]||m[2]),'Unsupported byte range.',416);if(!m[1])start=Math.max(0,info.size-Number(m[2]));else start=Number(m[1]);if(m[1]&&m[2])end=Number(m[2]);end=Math.min(end,info.size-1);assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<=end&&start<info.size,'Invalid byte range.',416);status=206;}
 const headers={'Content-Type':type||mime[extname(path)]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store'};
 if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
 if(download)headers['Content-Disposition']=`attachment; filename="${download}"`;
 res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}await pipeline(createReadStream(path,{start,end}),res);
}
export function createApp({dataDir=process.env.DATA_DIR||join(root,'.signalloop'),accessToken=process.env.ACCESS_TOKEN||'',localOnly=true}={}){
 const store=new Store(dataDir);seed(store);const workers=new Workers(store),sessions=new Map(),loginAttempts=new Map();let uploads=0;
 const get=(kind,key)=>{const x=store.get(kind,key);assert(x,`${kind} item not found.`,404);return x;};
 const rulesFor=p=>store.all('rules').filter(r=>r.brandId===p.brandId); // a creator brand spans sources; demo is isolated
 const clipsFor=p=>store.all('clips').filter(c=>c.projectId===p.id);
 const labRoutes=createLabRoutes({store,json,body});
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try{
   const host=req.headers.host||'localhost',url=new URL(req.url,`http://${host}`),path=decodeURIComponent(url.pathname),method=req.method;
   if(localOnly)assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Invalid Host header.',403);
   if(req.headers.origin)assert(new URL(req.headers.origin).host===host,'Cross-origin requests are not allowed.',403);
   if(path==='/api/health')return json(res,{ok:true,authRequired:!!accessToken});
   if(path==='/api/session'&&method==='POST'){
    const ip=req.socket.remoteAddress,attempt=loginAttempts.get(ip)||{count:0,at:Date.now()};if(Date.now()-attempt.at>60000){attempt.count=0;attempt.at=Date.now();}assert(attempt.count<10,'Too many login attempts. Try again in a minute.',429);attempt.count++;loginAttempts.set(ip,attempt);
    const value=await body(req);const given=Buffer.from(String(value.token||'')),expected=Buffer.from(accessToken);
    assert(given.length===expected.length&&timingSafeEqual(given,expected),'Incorrect access token.',401);
    const sid=randomBytes(32).toString('hex');sessions.set(sid,Date.now()+12*3600000);res.setHeader('Set-Cookie',`sl_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(res,{ok:true});
   }
   if(path.startsWith('/api/')&&accessToken){const sid=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sl_session='))?.slice(11);assert(sessions.get(sid)>Date.now(),'Unlock this workspace with its access token.',401);}
   if(await labRoutes(req,res,url))return;
   if(path==='/api/state'&&method==='GET'){
    const projects=store.all('projects').map(p=>({...p,media:p.media?{...p.media,file:undefined,url:`/api/media/${p.id}`} : null}));
    const projectId=url.searchParams.get('project')||projects[0]?.id,project=get('projects',projectId),platform=url.searchParams.get('platform')||'instagram';assert(platforms.includes(platform),'Unknown platform.');
    return json(res,{projects,projectId,platform,clips:rankClips(clipsFor(project),store.all('feedback').filter(r=>store.get('projects',r.projectId)?.brandId===project.brandId),platform,project.sample),rules:rulesFor(project),edits:store.all('edits').filter(e=>e.brandId===project.brandId),feedback:store.all('feedback').filter(r=>store.get('projects',r.projectId)?.brandId===project.brandId),calendar:store.all('calendar').filter(c=>c.projectId===projectId),jobs:store.all('jobs').filter(j=>j.projectId===projectId).slice(-15),audit:store.audit().filter(a=>a.data.projectId===projectId||a.data.clipId&&clipsFor(project).some(c=>c.id===a.data.clipId)).slice(0,20),capabilities:{ai:!!(process.env.GEMINI_API_KEY&&process.env.GEMINI_MODEL),whisper:process.env.ENABLE_WHISPER==='1',auth:!!accessToken},notice:'Prototype. Scores are editorial heuristics, not probabilities of success. Calendar does not auto-publish.'});
   }
   if(path==='/api/projects'&&method==='POST'){
    const b=await body(req);assert(typeof b.name==='string'&&b.name.trim().length>0&&b.name.length<=150,'Provide a project name (1–150 characters).');
    const p={id:id(),name:b.name.trim(),source:'Your source',sample:false,brandId:'creator-brand',segments:[],duration:0,status:'awaiting_media',media:null,timing:null,createdAt:now()};store.put('projects',p);return json(res,p,201);
   }
   const projectMatch=/^\/api\/projects\/([\w-]+)(?:\/(upload|transcript|transcribe))?$/.exec(path);
   if(projectMatch&&method==='POST'){
    const p=get('projects',projectMatch[1]),action=projectMatch[2];
    assert(!store.all('jobs').some(j=>j.projectId===p.id&&['queued','running'].includes(j.status)),'A media job is running for this source. Wait before changing it.',409);
    if(action==='upload'){
     assert(uploads<2,'Two uploads are already in progress.',429);assert(!p.sample,'Create a new source for your own media. The demo remains isolated.');assert(!p.media,'Create a new source instead of replacing existing media.');
     const extension=extname(url.searchParams.get('name')||'').toLowerCase();assert(['.mp4','.webm','.mov','.mkv','.wav','.mp3','.m4a','.ogg','.flac'].includes(extension),'Unsupported media extension.');
     const file=`uploads/${id()}${extension}`,full=join(store.dir,file);await mkdir(join(store.dir,'uploads'),{recursive:true});const limit=Number(process.env.MAX_UPLOAD_MB||512)*1024*1024;let bytes=0;uploads++;
     try{await pipeline(req,new Transform({transform(chunk,_enc,cb){bytes+=chunk.length;cb(bytes>limit?Object.assign(new Error('Upload exceeds size limit.'),{status:413}):null,chunk);}}),createWriteStream(full,{flags:'wx'}));const meta=await probe(full);const updated={...p,duration:meta.duration,media:{file,...meta},status:p.segments.length?'ready':'awaiting_transcript'};if(p.segments.length)validateSegments(p.segments,meta.duration);store.put('projects',updated);store.log('media.uploaded',{projectId:p.id,bytes});return json(res,{id:p.id,duration:meta.duration},201);}catch(e){await unlink(full).catch(()=>{});throw e;}finally{uploads--;}
    }
    if(action==='transcript'){
     assert(!clipsFor(p).some(c=>Object.keys(c.copy).length)||!store.all('edits').some(e=>e.projectId===p.id),'Create a new source to replace a transcript after saving editorial work.',409);
     const b=await body(req),parsed=parseTranscript(b.text);assert(!(p.media&&parsed.timing==='estimated'),'Media needs timestamped SRT, VTT or JSON. Plain text timings are estimated and unsafe for cutting.');
     const updated={...p,...parsed,duration:p.media?p.duration:parsed.segments.at(-1).end,status:'ready'};validateSegments(updated.segments,p.media?p.duration:undefined);const cs=candidates(updated);
     store.transaction(()=>{for(const c of clipsFor(p))store.delete('clips',c.id);for(const k of ['feedback','calendar'])for(const x of store.all(k).filter(x=>x.projectId===p.id))store.delete(k,x.id);store.put('projects',updated);for(const c of cs)store.put('clips',c);store.log('transcript.imported',{projectId:p.id,timing:parsed.timing,clips:cs.length});});return json(res,{id:p.id,clips:cs.length});
    }
    if(action==='transcribe'){assert(!p.segments.length,'This source already has a transcript. Create a new source to run transcription again.');return json(res,workers.transcribe(p),202);}
   }
   const clipMatch=/^\/api\/clips\/([\w-]+)\/(draft|edit|captions|render)$/.exec(path);
   if(clipMatch){const c=get('clips',clipMatch[1]),p=get('projects',c.projectId),action=clipMatch[2];
    if(action==='captions'&&method==='GET'){const format=url.searchParams.get('format')==='vtt'?'vtt':'srt';assert(p.timing!=='estimated','Attach a timed transcript before exporting captions.');res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="clip-${c.id}.${format}"`});return res.end(captions(p,c,format));}
    if(action==='draft'&&method==='POST'){const b=await body(req);assert(platforms.includes(b.platform),'Unknown platform.');const rules=rulesFor(p);const draft=b.ai===true?await rewriteCopy(c,b.platform,rules,store.all('edits').filter(e=>e.brandId===p.brandId)):draftCopy(c,b.platform,rules);draft.integrity=inspectMeaning(p,c,draft.text);const latest=get('clips',c.id);const previous=latest.copy[b.platform];latest.copy[b.platform]={...draft,revision:(previous?.revision||0)+1,memoryVersion:rules.filter(r=>r.active).length,updatedAt:now()};store.put('clips',latest);store.log('copy.generated',{projectId:p.id,clipId:c.id,platform:b.platform,engine:draft.engine});return json(res,latest.copy[b.platform]);}
    if(action==='edit'&&method==='POST'){
     const b=await body(req);assert(platforms.includes(b.platform),'Unknown platform.');assert(typeof b.text==='string'&&b.text.trim().length>0&&b.text.length<=6000,'Copy must be 1–6,000 characters.');const previous=c.copy[b.platform];assert(previous,'Generate a draft before editing.');assert(b.revision===previous.revision,'This copy changed in another tab. Reload before saving.',409);assert(previous.text!==b.text,'No changes to learn from.');
     const edit={id:id(),projectId:p.id,clipId:c.id,brandId:p.brandId,platform:b.platform,before:previous.text,after:b.text,createdAt:now()};const rules=inferRules(edit.before,edit.after,b.platform,edit.id).map(r=>({...r,projectId:p.id,brandId:p.brandId}));
     store.transaction(()=>{store.put('edits',edit);const existing=rulesFor(p);for(const r of rules)if(!existing.some(e=>e.kind===r.kind&&e.platform===r.platform&&JSON.stringify(e.value)===JSON.stringify(r.value)))store.put('rules',r);c.copy[b.platform]={...previous,text:b.text,revision:previous.revision+1,engine:'creator-edited',integrity:inspectMeaning(p,c,b.text),updatedAt:now()};store.put('clips',c);store.log('memory.edit-recorded',{projectId:p.id,clipId:c.id,editId:edit.id,proposals:rules.length});});return json(res,{edit,rules});
    }
    if(action==='render'&&method==='POST')return json(res,workers.render(p,c,await body(req)),202);
   }
   const ruleMatch=/^\/api\/rules\/([\w-]+)$/.exec(path);
   if(ruleMatch&&method==='PATCH'){const rule=get('rules',ruleMatch[1]),b=await body(req);assert(typeof b.active==='boolean','active must be boolean.');store.put('rules',{...rule,active:b.active});store.log('memory.rule-reviewed',{projectId:rule.projectId,ruleId:rule.id,active:b.active});return json(res,{ok:true});}
   if(path==='/api/feedback'&&method==='POST'){
    const b=await body(req),p=get('projects',b.projectId);assert(!p.sample,'Use the labeled demo fixture in the demo workspace. Import real metrics into your own source.');const rows=validateFeedback(b.rows,clipsFor(p),false);
    store.transaction(()=>{for(const r of rows){const existing=store.get('feedback',r.id);assert(!existing||existing.clipId===r.clipId,'postId is already associated with another clip.');store.put('feedback',r);}store.log('feedback.imported',{projectId:p.id,count:rows.length});});return json(res,{count:rows.length});
   }
   if(path==='/api/feedback/demo'&&method==='POST'){
    const b=await body(req),p=get('projects',b.projectId);assert(p.sample,'Synthetic feedback is only allowed in the demo workspace.');const clips=clipsFor(p),rows=[];
    for(const platform of platforms)for(const c of clips)for(let n=0;n<3;n++){const good=c.kind==='how-to';rows.push({clipId:c.id,postId:`demo-${c.id}-${n}`,platform,views:1000+n*100,completions:good?810+n*80:240+n*20,saves:good?42:5,shares:good?28:3,observedAt:new Date(Date.now()-n*86400000).toISOString()});}
    const validated=validateFeedback(rows,clips,true);store.transaction(()=>{for(const row of validated)store.put('feedback',row);store.log('feedback.demo-loaded',{projectId:p.id,count:validated.length,sample:true});});return json(res,{count:validated.length,sample:true});
   }
   if(path==='/api/feedback/demo'&&method==='DELETE'){const b=await body(req),p=get('projects',b.projectId);assert(p.sample,'Not a demo workspace.');for(const r of store.all('feedback').filter(r=>r.projectId===p.id&&r.sample))store.delete('feedback',r.id);return json(res,{ok:true});}
   if(path==='/api/calendar'&&method==='POST'){
    const b=await body(req),c=get('clips',b.clipId);assert(platforms.includes(b.platform),'Unknown platform.');assert(c.copy[b.platform],'Draft platform copy before scheduling.');assert(inspectMeaning(get('projects',c.projectId),c,c.copy[b.platform].text).status!=='blocked','Source guard blocked this draft. Remove unsupported numbers or certainty before scheduling.',409);assert(Number.isFinite(Date.parse(b.when))&&Date.parse(b.when)>Date.now(),'Choose a future publication time.');assert(!store.all('calendar').some(x=>x.clipId===c.id&&x.platform===b.platform&&x.when===new Date(b.when).toISOString()),'This reminder already exists.',409);
    const item={id:id(),projectId:c.projectId,clipId:c.id,platform:b.platform,when:new Date(b.when).toISOString(),status:'planned',copySnapshot:c.copy[b.platform].text,createdAt:now()};store.put('calendar',item);store.log('calendar.planned',{projectId:c.projectId,clipId:c.id});return json(res,item,201);
   }
   const calMatch=/^\/api\/calendar\/([\w-]+)$/.exec(path);if(calMatch&&method==='DELETE'){get('calendar',calMatch[1]);store.delete('calendar',calMatch[1]);return json(res,{ok:true});}
   if(path==='/api/calendar.ics'&&method==='GET'){const p=get('projects',url.searchParams.get('project'));res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="signalloop-calendar.ics"'});return res.end(calendarICS(store.all('calendar').filter(i=>i.projectId===p.id),clipsFor(p)));}
   const sourceCaptions=/^\/api\/source-captions\/([\w-]+)$/.exec(path);if(sourceCaptions&&method==='GET'){const p=get('projects',sourceCaptions[1]);assert(p.timing!=='estimated','Accurate captions are not available.');res.writeHead(200,{'Content-Type':'text/vtt; charset=utf-8'});return res.end(captions(p,{start:0,end:p.duration},'vtt'));}
   const mediaMatch=/^\/api\/media\/([\w-]+)$/.exec(path);if(mediaMatch&&['GET','HEAD'].includes(method)){const p=get('projects',mediaMatch[1]);assert(p.media,'No media for this source.',404);return await sendFile(req,res,join(store.dir,p.media.file));}
   const exportMatch=/^\/api\/exports\/([\w-]+)$/.exec(path);if(exportMatch&&['GET','HEAD'].includes(method)){const job=get('jobs',exportMatch[1]);assert(job.type==='render'&&job.status==='completed','Export is not ready.',409);return await sendFile(req,res,join(store.dir,job.result.file),'video/mp4',`signalloop-${job.id}.mp4`);}
   if(path.startsWith('/api/'))assert(false,'API endpoint not found.',404);
   assert(['GET','HEAD'].includes(method),'Method not allowed.',405);
   const assets={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/views.js':'views.js','/ui.js':'ui.js','/styles.css':'styles.css','/mark.svg':'mark.svg','/lab.js':'lab.js','/lab.css':'lab.css'};
   assert(assets[path],'Page not found.',404);return await sendFile(req,res,join(root,'public',assets[path]));
  }catch(e){if(res.headersSent){res.destroy();return;}json(res,{error:e.status?e.message:'The operation failed. Check server configuration and media tools.'},e.status||500);if(!e.status)console.error(e.message);}
 });
 server.requestTimeout=30*60000;server.headersTimeout=60000;
 return {server,store,workers};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const host=process.env.HOST||'127.0.0.1',token=process.env.ACCESS_TOKEN||'',local=['127.0.0.1','localhost','::1'].includes(host);
 if(!local&&token.length<24)throw new Error('Set ACCESS_TOKEN to at least 24 characters before binding publicly. Use HTTPS at your reverse proxy.');
 const app=createApp({localOnly:local});app.server.listen(Number(process.env.PORT||3000),host,()=>console.log(`SignalLoop is running at http://${host}:${process.env.PORT||3000}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.server.close(()=>{app.store.close();process.exit(0);});});
}
