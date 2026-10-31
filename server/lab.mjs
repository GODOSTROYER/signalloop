import { id, assert, platforms, rankClips, validateFeedback } from './domain.mjs';
import { inspectMeaning, compareMemory, heldOutEvaluation, buildCampaign, parseFeedbackCSV, memoryFingerprint, goals } from './editorial.mjs';
import { reviewMoments } from './ai.mjs';
const now=()=>new Date().toISOString();

export function createLabRoutes({store,json,body}) {
 let running=0;
 const get=(kind,key)=>{const value=store.get(kind,key);assert(value,`${kind} item not found.`,404);return value;};
 const context=projectId=>{
  const project=get('projects',projectId);
  return {project,clips:store.all('clips').filter(c=>c.projectId===project.id),rules:store.all('rules').filter(r=>r.brandId===project.brandId),edits:store.all('edits').filter(e=>e.brandId===project.brandId),feedback:store.all('feedback').filter(r=>store.get('projects',r.projectId)?.brandId===project.brandId)};
 };
 return async(req,res,url)=>{
  const path=url.pathname,method=req.method;
  if(path==='/api/lab'&&method==='GET') {
   const {project,clips,rules,edits,feedback}=context(url.searchParams.get('project')||'demo');
   const platform=url.searchParams.get('platform')||'instagram';assert(platforms.includes(platform),'Unknown platform.');
   const clip=clips.find(c=>c.id===url.searchParams.get('clip'))||clips[0];
   const ranked=rankClips(clips,feedback,platform,project.sample),baseline=rankClips(clips,[],platform,project.sample);
   json(res,{comparison:clip?compareMemory(clip,rules,platform):null,integrity:clip?inspectMeaning(project,clip,clip.copy[platform]?.text||''):null,evaluation:heldOutEvaluation(clips,rules,edits),campaigns:store.all('campaigns').filter(c=>c.projectId===project.id).slice(-5).reverse(),goals,ranking:ranked.map((c,i)=>({clipId:c.id,title:c.title,before:baseline.findIndex(x=>x.id===c.id)+1,after:i+1,delta:c.delta,evidence:c.evidence})),readiness:{media:!!project.media,timedTranscript:!!project.segments.length&&project.timing!=='estimated',moments:clips.length,approvedMemory:rules.filter(r=>r.active).length,edits:edits.length,performanceRows:feedback.filter(f=>f.sample===project.sample).length,exports:store.all('jobs').filter(j=>j.projectId===project.id&&j.type==='render'&&j.status==='completed').length,aiConfigured:!!(process.env.GEMINI_API_KEY&&process.env.GEMINI_MODEL)},notice:'Memory ablation is a controlled software comparison, not a live audience A/B test.'});return true;
  }
  if(path==='/api/lab/inspect'&&method==='POST') {
   const b=await body(req),c=get('clips',b.clipId),p=get('projects',c.projectId);
   assert(typeof b.text==='string'&&b.text.length<=6000,'Provide up to 6,000 characters of draft copy.');
   json(res,inspectMeaning(p,c,b.text));return true;
  }
  if(path==='/api/feedback/csv'&&method==='POST') {
   const b=await body(req),ctx=context(b.projectId);
   assert(!ctx.project.sample,'Real metrics belong in your own source, not the synthetic demo.');
   assert(b.confirmedActual===true,'Confirm that the CSV contains actual post measurements.');
   const rows=validateFeedback(parseFeedbackCSV(b.csv),ctx.clips,false);
   store.transaction(()=>{for(const row of rows){const existing=store.get('feedback',row.id);assert(!existing||existing.clipId===row.clipId,'A post ID is already associated with another clip.');store.put('feedback',row);}store.log('feedback.csv-imported',{projectId:ctx.project.id,count:rows.length});});
   json(res,{count:rows.length});return true;
  }
  if(path==='/api/campaigns'&&method==='POST') {
   const b=await body(req),ctx=context(b.projectId);assert(goals[b.goal],'Choose a campaign goal.');
   assert(Number.isInteger(b.count)&&b.count>=2&&b.count<=5,'Choose 2–5 moments.');assert(ctx.clips.length>=2,'Import a transcript containing at least two moments.');
   assert(b.mode==='local'||b.mode==='ai','Choose local or AI planning.');assert(running<2,'Two planning requests are already running.',429);
   if(b.mode==='ai')assert(b.consent===true,'Explicit consent is required before sending transcript excerpts to Google.');
   running++;
   try{
    const fingerprint=memoryFingerprint(ctx.rules),review=b.mode==='ai'?await reviewMoments(ctx.project,ctx.clips,b.goal):null;
    // Reject a plan if memory or the source changed during a provider call.
    const latest=context(b.projectId);assert(memoryFingerprint(latest.rules)===fingerprint && JSON.stringify(latest.clips.map(c=>c.id))===JSON.stringify(ctx.clips.map(c=>c.id)),'Source or memory changed during planning. Run it again.',409);
    const plan=buildCampaign(ctx.project,ctx.clips,ctx.rules,ctx.feedback,{goal:b.goal,count:b.count,review});
    store.transaction(()=>{store.put('campaigns',plan);store.log('campaign.planned',{projectId:plan.projectId,campaignId:plan.id,engine:plan.engine,items:plan.items.length});});
    json(res,plan,201);
   }finally{running--;}
   return true;
  }
  const match=/^\/api\/campaigns\/([\w-]+)\/(approve|schedule|export)$/.exec(path);
  if(match) {
   const plan=get('campaigns',match[1]),ctx=context(plan.projectId),action=match[2];
   if(action==='export'&&method==='GET') {
    res.setHeader('Content-Disposition',`attachment; filename="signalloop-campaign-${plan.id}.json"`);
    json(res,{schemaVersion:1,exportedAt:now(),project:{id:ctx.project.id,name:ctx.project.name,sample:ctx.project.sample},campaign:plan,memoryEvaluation:heldOutEvaluation(ctx.clips,ctx.rules,ctx.edits),disclosure:'Contains editorial evidence and draft copy, not measured audience uplift. Synthetic data is explicitly labeled.'});return true;
   }
   if(method==='POST') {
    const b=await body(req);
    assert(memoryFingerprint(ctx.rules)===plan.memoryFingerprint,'Approved memory changed. Create a fresh campaign before approving or scheduling.',409);
    assert(plan.items.every(i=>ctx.clips.some(c=>c.id===i.clipId)),'The source changed. Create a fresh campaign.',409);
    if(action==='approve') {
     assert(b.acknowledged===true,'Review source context and copy before approving.');
     assert(Array.isArray(b.itemIds)&&b.itemIds.length>0&&new Set(b.itemIds).size===b.itemIds.length,'Choose unique items to approve.');
     for(const key of b.itemIds){const item=plan.items.find(i=>i.id===key);assert(item,'Campaign item not found.');assert(item.integrity.status!=='blocked','A blocked draft cannot be approved. Repair its source or copy first.');}
     for(const item of plan.items)if(b.itemIds.includes(item.id)&&item.status==='needs-review'){item.status='approved';item.approvedAt=now();}
     plan.status=plan.items.every(i=>i.status!=='needs-review')?'approved':'partially-approved';
     store.transaction(()=>{store.put('campaigns',plan);store.log('campaign.reviewed',{projectId:plan.projectId,campaignId:plan.id,itemIds:b.itemIds});});json(res,plan);return true;
    }
    if(action==='schedule') {
     const start=Date.parse(b.startAt);assert(Number.isFinite(start)&&start>Date.now(),'Select a future start time.');
     const items=plan.items.filter(i=>i.status==='approved'&&!i.calendarId);
     assert(items.length || plan.items.some(i=>i.calendarId),'Approve at least one draft before adding it to the calendar.',409);
     const created=[];
     store.transaction(()=>{
      for(let i=0;i<items.length;i++){
       const item=items[i],calendar={id:id(),campaignId:plan.id,projectId:plan.projectId,clipId:item.clipId,platform:item.platform,when:new Date(start+i*86400000).toISOString(),status:'planned',copySnapshot:item.copy,createdAt:now()};
       store.put('calendar',calendar);item.calendarId=calendar.id;item.status='scheduled';created.push(calendar);
      }
      plan.status=plan.items.every(i=>i.status==='scheduled')?'scheduled':'partially-scheduled';
      store.put('campaigns',plan);if(created.length)store.log('campaign.scheduled',{projectId:plan.projectId,campaignId:plan.id,count:created.length});
     });json(res,{created,alreadyScheduled:created.length===0,published:false});return true;
    }
   }
  }
  return false;
 };
}
