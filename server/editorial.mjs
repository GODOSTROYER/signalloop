import { createHash } from 'node:crypto';
import { assert, id, words, draftCopy, rankClips, platforms } from './domain.mjs';

const normalize = text => String(text).toLowerCase().replace(/\s+/g,' ').trim();
const qualifier = /\b(only|unless|except|hypothetical|illustrative|not a|not guaranteed|small sample|may|might|could|not representative)\b/i;
const quantities = text => (String(text).match(/(?:[$€£₹]\s*)?\d+(?:[.,]\d+)*(?:\s*%|\s*(?:million|billion|thousand))?/gi)||[]).map(normalize);
export function memoryFingerprint(rules, platform) {
  const applicable=rules.filter(r=>r.active && (!platform || r.platform===platform || r.platform==='all'));
  return createHash('sha256').update(JSON.stringify(applicable.map(r=>({id:r.id,kind:r.kind,value:r.value,platform:r.platform})).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex').slice(0,16);
}

// A source-linked risk screen, not a semantic fact checker. A clear result is
// intentionally named "no-rule-flags" rather than "verified" or "true".
export function inspectMeaning(project, clip, copy='') {
  const segments=project.segments.map((s,i)=>({...s,index:i}));
  const selected=segments.filter(s=>s.start<clip.end && s.end>clip.start);
  const before=segments.filter(s=>s.end<=clip.start).at(-1);
  const after=segments.find(s=>s.start>=clip.end);
  const flags=[];
  const add=(code,severity,message,evidence)=>flags.push({code,severity,message,evidence});
  if(project.timing==='estimated') add('estimated-timing','review','Estimated timing cannot support frame-accurate export.',null);
  if(before && clip.start-before.end<=3 && qualifier.test(before.text)) add('preceding-qualification','review','A nearby qualification sits outside this cut. Include it or review the context.',before);
  if(after && after.start-clip.end<=3 && /^(?:but|however|except|unless|only|that said|in this case)\b/i.test(after.text)) add('following-qualification','review','The next segment may qualify this claim. Review the full statement.',after);
  if(/^(?:it|they|that|this|and|but|he|she)\b/i.test(clip.text)) add('dependent-opening','review','The opening refers to something outside the selected moment.',selected[0]);
  if(copy) {
    const source=normalize(clip.text), normalizedCopy=normalize(copy);
    for(const quantity of [...new Set(quantities(copy))]) if(!quantities(clip.text).includes(quantity)) add('unsupported-number','block',`The draft introduces “${quantity}”, which is absent from this clip.`,null);
    for(const claim of ['guaranteed','guarantee','proven','always','never','cure','risk-free']) if(new RegExp(`\\b${claim}\\b`,'i').test(normalizedCopy) && !new RegExp(`\\b${claim}\\b`,'i').test(source)) add('unsupported-certainty','block',`The draft introduces “${claim}”, strengthening the source claim.`,null);
    if(qualifier.test(clip.text) && !qualifier.test(copy)) add('qualification-omitted','review','Source qualifications may be missing from the draft. Check before publishing.',selected.find(s=>qualifier.test(s.text)));
    if(/\b(?:not|never|cannot|can't|won't)\b/i.test(clip.text) && !/\b(?:not|never|cannot|can't|won't)\b/i.test(copy)) add('negation-omitted','review','The source contains a negation that is absent from this draft. Meaning may have changed.',selected.find(s=>/\b(?:not|never|cannot|can't|won't)\b/i.test(s.text)));
  }
  return {status:flags.some(f=>f.severity==='block')?'blocked':flags.length?'review':'no-rule-flags',flags,segments:selected,before:before||null,after:after||null,limitation:'Rule-based risk screen. It cannot establish factual correctness, detect every paraphrase error, or replace human review.'};
}

export function ruleViolated(text,rule) {
  if(rule.kind==='no-hashtags')return /#[\p{L}\p{N}_]+/u.test(text);
  if(rule.kind==='no-emdash')return text.includes('—');
  if(rule.kind==='no-emoji')return /\p{Extended_Pictographic}/u.test(text);
  if(rule.kind==='max-words')return words(text).length>rule.value;
  if(rule.kind==='replace')return normalize(text).includes(normalize(rule.value.from));
  return false;
}
export function compareMemory(clip,rules,platform) {
  const active=rules.filter(r=>r.active&&(r.platform===platform||r.platform==='all'));
  const baseline=draftCopy(clip,platform,[]),learned=draftCopy(clip,platform,rules);
  const checks=active.map(r=>({ruleId:r.id,description:r.description,editId:r.editId,before:ruleViolated(baseline.text,r),after:ruleViolated(learned.text,r)}));
  return {clipId:clip.id,title:clip.title,platform,baseline:baseline.text,learned:learned.text,changed:baseline.text!==learned.text,checks,violationsBefore:checks.filter(c=>c.before).length,violationsAfter:checks.filter(c=>c.after).length,memoryFingerprint:memoryFingerprint(rules,platform)};
}
export function heldOutEvaluation(clips,rules,edits) {
  const training=new Set(edits.map(e=>e.clipId)),heldOut=clips.filter(c=>!training.has(c.id)).slice(0,16);
  const cases=heldOut.flatMap(c=>platforms.map(p=>compareMemory(c,rules,p)));
  return {type:'deterministic-memory-ablation',heldOutClips:heldOut.length,trainingClips:training.size,cases:cases.length,changedDrafts:cases.filter(c=>c.changed).length,violationsBefore:cases.reduce((n,c)=>n+c.violationsBefore,0),violationsAfter:cases.reduce((n,c)=>n+c.violationsAfter,0),note:'Same source and template, with versus without approved memory. Edit-source clips are excluded. Measures rule adherence only, not writing quality, audience lift or model generalization.'};
}

export function parseFeedbackCSV(text) {
  assert(typeof text==='string' && text.length<=2_000_000,'CSV must be under 2 MB.');
  let rows=[],row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else {assert(quoted||!cell,'Invalid CSV quoting.');quoted=!quoted;}}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  assert(!quoted,'Unclosed CSV quote.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  assert(rows.length>=2 && rows.length<=5001,'CSV needs a header and 1–5,000 rows.');
  const header=rows.shift().map(x=>x.replace(/^\uFEFF/,'').trim());
  const required=['clipId','postId','platform','views','completions','saves','shares','observedAt'];
  assert(header.length===required.length && new Set(header).size===header.length && required.every(h=>header.includes(h)),`CSV columns: ${required.join(', ')}`);
  return rows.map(row=>{assert(row.length===header.length,'CSV row has the wrong number of columns.');return Object.fromEntries(header.map((h,i)=>[h,row[i].trim()]));});
}

export const goals={educate:'Teach something useful',trust:'Build trust',discovery:'Start a conversation'};
const preferences={educate:['how-to','insight','question'],trust:['story','insight','how-to'],discovery:['question','contrarian','story']};
function overlap(a,b){return Math.max(0,Math.min(a.end,b.end)-Math.max(a.start,b.start))/Math.min(a.end-a.start,b.end-b.start);}
export function buildCampaign(project,clips,rules,feedback,{goal='educate',count=3,review=null}={}) {
  assert(goals[goal],'Unknown campaign goal.');assert(Number.isInteger(count)&&count>=2&&count<=5,'Choose 2–5 moments.');
  assert(clips.length>=2,'At least two moments are needed for a campaign.');
  const recommended=review?new Map(review.selections.map((s,i)=>[s.clipId,{...s,order:i}])):null;
  const ranked=rankClips(clips,feedback,'instagram',project.sample);
  const pool=ranked.map(c=>({...c,goalBonus:Math.max(0,8-preferences[goal].indexOf(c.kind)*3)*(preferences[goal].includes(c.kind)?1:0),meaning:inspectMeaning(project,c)}));
  const chosen=[],decisions=[];
  while(chosen.length<count) {
    const available=pool.filter(c=>!chosen.some(p=>p.id===c.id || overlap(p,c)>.25));
    if(!available.length)break;
    available.sort((a,b)=>{
      const score=c=>c.score+c.goalBonus-(chosen.some(p=>p.kind===c.kind)?10:0)-(c.meaning.flags.length*2)+(recommended?.has(c.id)?10-recommended.get(c.id).order:0);
      return score(b)-score(a)||a.start-b.start;
    });
    chosen.push(available[0]);
  }
  for(const c of pool)if(!chosen.some(x=>x.id===c.id))decisions.push({clipId:c.id,title:c.title,reason:chosen.some(x=>overlap(x,c)>.25)?'Overlaps a selected moment.':'Lower goal fit or less variety within this campaign budget.'});
  const items=chosen.map((c,i)=>{
    const platform=['instagram','linkedin','youtube','instagram','linkedin'][i];
    const ranking=rankClips([c],feedback,platform,project.sample)[0];
    const draft=draftCopy(c,platform,rules);
    return {id:id(),clipId:c.id,platform,role:['Open the conversation','Make it useful','Give a reason to return','Add another perspective','Invite a response'][i],title:c.title,start:c.start,end:c.end,kind:c.kind,status:'needs-review',copy:draft.text,engine:draft.engine,ruleIds:draft.rulesUsed,sourceQuote:c.quote,sourceSegments:c.meaning.segments,integrity:inspectMeaning(project,c,draft.text),score:ranking.score,feedbackDelta:ranking.delta,reason:`${c.kind} opening; goal-fit bonus ${c.goalBonus}; ${ranking.feedbackReason}`,aiReason:recommended?.get(c.id)?.reason||null,aiEvidence:recommended?.get(c.id)?.quote||null,calendarId:null};
  });
  return {id:id(),projectId:project.id,brandId:project.brandId,goal,goalLabel:goals[goal],sample:project.sample,createdAt:new Date().toISOString(),memoryFingerprint:memoryFingerprint(rules),engine:review?.engine||'transparent-editorial-planner-v2',aiReviewedCandidates:review?.reviewed||0,status:'awaiting-review',items,rejected:decisions,trace:[{step:'Read the source',result:`${project.segments.length} timed segments; ${Math.round(project.duration)} seconds.`},{step:'Select and diversify',result:`${clips.length} candidates considered; ${items.length} non-overlapping moments selected. Platform-specific feedback is used; Instagram is the campaign-discovery baseline.`},{step:'Apply approved memory',result:`${rules.filter(r=>r.active).length} active preferences. ${items.reduce((n,i)=>n+i.ruleIds.length,0)} applicable rule references across drafts.`},{step:'Check meaning',result:`${items.reduce((n,i)=>n+i.integrity.flags.length,0)} review flags. Source quotations and surrounding context preserved for review.`},{step:'Human approval',result:'Nothing is published or scheduled until you approve it.'}],limitations:['Local drafts are extractive templates, not LLM generation.', 'AI review, when enabled, reviews the candidate shortlist, not raw audio/video.', 'Scores are editorial heuristics, not probabilities or causal uplift.']};
}
