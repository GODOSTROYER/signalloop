import { randomUUID } from 'node:crypto';
export const id = () => randomUUID();
export const platforms = ['instagram', 'youtube', 'linkedin'];
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export function assert(ok, message, status = 400) { if (!ok) throw Object.assign(new Error(message), {status}); }
export const words = s => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
export const sentence = s => (s.match(/[^.!?]+[.!?]?/u) || [s])[0].trim();
export const clipText = (p, c) => p.segments.filter(s => s.start < c.end && s.end > c.start).map(s => s.text).join(' ');
export function validateSegments(input, duration) {
  assert(Array.isArray(input) && input.length > 0 && input.length <= 20000, 'Provide 1–20,000 timestamped transcript segments.');
  let last = -1;
  return input.map(s => {
    const start = Number(s.start), end = Number(s.end), text = String(s.text || '').trim();
    assert(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start, 'Each segment needs valid start/end seconds.');
    assert(start >= last, 'Transcript segments must be sorted and non-overlapping.');
    assert(text.length > 0 && text.length <= 10000, 'A transcript segment is empty or too long.');
    assert(!duration || end <= duration + 0.15, 'Transcript extends beyond the uploaded media duration.');
    last = end;
    return {start, end, text};
  });
}
export function parseTranscript(text) {
  assert(typeof text === 'string' && text.length <= 2_000_000, 'Transcript is too large.');
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let value; try { value = JSON.parse(trimmed); } catch { assert(false, 'Invalid transcript JSON.'); }
    return {segments: validateSegments(Array.isArray(value) ? value : value.segments), timing: 'provided'};
  }
  const clock = t => t.replace(',', '.').split(':').reduce((a, n) => a * 60 + Number(n), 0);
  const segments = [];
  const re = /((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  for (const m of trimmed.matchAll(re)) segments.push({start: clock(m[1]), end: clock(m[2]), text: m[3].replace(/<[^>]*>/g, '').replace(/\n/g, ' ').trim()});
  if (segments.length) return {segments: validateSegments(segments), timing: 'provided'};
  assert(trimmed.length >= 30, 'Paste an SRT, VTT, JSON transcript, or at least 30 characters of text.');
  let cursor = 0;
  for (const text of trimmed.split(/\n\s*\n/).filter(Boolean)) {
    const duration = Math.max(8, words(text).length / 2.5);
    segments.push({start: cursor, end: cursor + duration, text: text.trim()}); cursor += duration;
  }
  return {segments: validateSegments(segments), timing: 'estimated'};
}
export function classify(text) {
  if (/\b(but|instead|wrong|myth|stop|not|trap)\b/i.test(text)) return 'contrarian';
  if (/\b(step|first|second|how to|try|start with|checklist)\b/i.test(text)) return 'how-to';
  if (/\b(I|we)\b.{0,35}\b(learned|built|spent|tried|lost|used)\b/i.test(text)) return 'story';
  if (text.includes('?')) return 'question';
  return 'insight';
}
export function candidates(project) {
  const segments = project.segments;
  const result = [];
  for (let i = 0; i < segments.length && result.length < 50; i++) {
    const group = [segments[i]];
    while (group.at(-1).end - group[0].start < 14 && i + group.length < segments.length && segments[i + group.length].end - group[0].start <= 65) group.push(segments[i + group.length]);
    const start = group[0].start, end = group.at(-1).end;
    if (end - start < 6 || end - start > 95) continue;
    const text = group.map(s => s.text).join(' '), hook = sentence(text);
    const kind = classify(hook + ' ' + text.slice(0, 140));
    const hookScore = clamp(55 + (/\?|\b(stop|not|instead|why|how|wrong|trap)\b/i.test(hook) ? 22 : 0) + (/\d/.test(hook) ? 9 : 0), 0, 95);
    const payoff = clamp(52 + (/\b(because|so|means|try|start|instead|first|save|measure)\b/i.test(text) ? 19 : 0) + (/\d/.test(text) ? 10 : 0), 0, 95);
    const coherence = clamp(82 - (/^(it|they|that|this|and|but)\b/i.test(hook) ? 16 : 0) - (/[.!?]$/.test(text) ? 0 : 12), 0, 95);
    const duration = Math.round(clamp(90 - Math.abs(38 - (end - start)), 30, 95));
    result.push({id: id(), projectId: project.id, start, end, title: hook.slice(0, 110), quote: hook, kind, text,
      features: {hook: hookScore, payoff, coherence, duration}, copy: {}, createdAt: new Date().toISOString(),
      reasons: [`${kind} opening: “${hook.slice(0, 140)}”`, `${Math.round(end-start)} seconds; ${group.length} complete transcript segment${group.length===1?'':'s'}.`,
        coherence < 75 ? 'Context warning: opening or ending may depend on surrounding speech.' : 'Starts and ends at transcript boundaries; review context before posting.'],
      warnings: project.timing === 'estimated' ? ['Estimated timestamps: attach timed captions before rendering.'] : [], engine: 'transparent-heuristic-v1'});
    i += group.length - 1;
  }
  assert(result.length, 'No 6–95 second candidates found. Use shorter transcript segments.');
  return result;
}
export function baseScore(c) { const f = c.features; return Math.round(f.hook*.35 + f.payoff*.3 + f.coherence*.25 + f.duration*.1); }
export function rankClips(clips, feedback, platform, sample) {
  // Synthetic and real observations never share a cohort. One row is one post, not a cumulative snapshot.
  const rows = feedback.filter(r => r.platform === platform && r.sample === sample && r.views >= 100);
  const prior = .38, priorPosts = 3;
  const quality = r => .65*(r.completions/r.views) + .2*clamp((r.saves/r.views)/.04,0,1) + .15*clamp((r.shares/r.views)/.025,0,1);
  const baseline = (priorPosts*prior + rows.reduce((s,r)=>s+quality(r),0))/(priorPosts+rows.length);
  return clips.map(c => {
    const matching = rows.filter(r => r.kind === c.kind);
    const posterior = (priorPosts*prior + matching.reduce((s,r)=>s+quality(r),0))/(priorPosts+matching.length);
    const delta = matching.length ? Math.round(clamp((posterior-baseline)*42,-12,12)*10)/10 : 0;
    const base = baseScore(c);
    return {...c, base, score: Math.round(clamp(base+delta,0,100)*10)/10, delta, evidence: matching.length,
      confidence: matching.length >= 8 ? 'developing' : 'low',
      feedbackReason: matching.length ? `${matching.length} ${sample?'synthetic':'imported'} ${platform} post(s) with ${c.kind} openings; ${delta>=0?'+':''}${delta} points after shrinkage. Association, not causation.` : `No eligible ${platform} observations for this opening. Ranking uses content evidence only.`};
  }).sort((a,b)=>b.score-a.score || a.start-b.start);
}
export function validateFeedback(rows, knownClips, sample) {
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= 5000, 'Import 1–5,000 post observations.');
  const seen = new Set();
  return rows.map(r => {
    const c = knownClips.find(c=>c.id===r.clipId);
    assert(c, 'Each observation must reference a clip in this workspace.');
    assert(platforms.includes(r.platform), 'Unknown platform.');
    const postId = String(r.postId || '').trim();
    assert(postId.length > 0 && postId.length < 200, 'Every row needs a stable postId for deduplication.');
    const key = `${r.platform}:${postId}`; assert(!seen.has(key), 'Duplicate postId in this import.'); seen.add(key);
    const counts = {};
    for (const k of ['views','completions','saves','shares']) { counts[k]=Number(r[k]); assert(Number.isSafeInteger(counts[k]) && counts[k]>=0, `${k} must be a non-negative integer.`); }
    assert(counts.views>0, 'views must be positive.');
    for(const k of ['completions','saves','shares']) assert(counts[k]<=counts.views, `${k} cannot exceed views.`);
    assert(typeof r.observedAt==='string' && Number.isFinite(Date.parse(r.observedAt)), 'observedAt must be an ISO date.');
    return {id: `${sample?'sample':'real'}:${key}`, projectId:c.projectId, clipId:c.id, kind:c.kind, platform:r.platform, postId, ...counts, sample, observedAt:r.observedAt};
  });
}
export function inferRules(before, after, platform, editId) {
  const rules = [], add = (kind,value,description) => rules.push({id:id(), kind,value,description,platform,editId,active:false,confidence:.55,createdAt:new Date().toISOString()});
  if (before.includes('—') && !after.includes('—')) add('no-emdash',true,'Use simple punctuation, not em dashes.');
  if (/#\w+/.test(before) && !/#\w+/.test(after)) add('no-hashtags',true,'Leave hashtags out of this platform’s copy.');
  if (/\p{Extended_Pictographic}/u.test(before) && !/\p{Extended_Pictographic}/u.test(after)) add('no-emoji',true,'Keep the writing free of emoji.');
  const oldWords = words(before).length, newWords=words(after).length;
  if (oldWords>20 && newWords<oldWords*.72 && newWords>=8) add('max-words',Math.max(newWords,12),`Keep copy close to ${Math.max(newWords,12)} words.`);
  // Only propose small, literal phrase changes. Never silently promote edits into global facts.
  let pre=0; while(pre<before.length && pre<after.length && before[pre]===after[pre]) pre++;
  let suffix=0; while(suffix<before.length-pre && suffix<after.length-pre && before.at(-1-suffix)===after.at(-1-suffix)) suffix++;
  const removed=before.slice(pre,before.length-suffix).trim(), added=after.slice(pre,after.length-suffix).trim();
  if(removed.length>=4 && removed.length<=60 && added.length>=2 && added.length<=60 && !removed.includes('\n') && !added.includes('\n')) add('replace',{from:removed,to:added},`Prefer “${added}” over “${removed}”.`);
  return rules;
}
export function applyRules(copy, rules, platform) {
  let text=copy;
  for(const r of rules.filter(r=>r.active && (r.platform===platform||r.platform==='all'))) {
    if(r.kind==='no-emdash') text=text.replace(/\s*—\s*/g,'. ');
    if(r.kind==='no-hashtags') text=text.replace(/#[\p{L}\p{N}_]+/gu,'');
    if(r.kind==='no-emoji') text=text.replace(/\p{Extended_Pictographic}\uFE0F?/gu,'');
    if(r.kind==='replace') text=text.split(r.value.from).join(r.value.to);
    if(r.kind==='max-words') { const ws=text.split(/\s+/); if(ws.length>r.value) text=ws.slice(0,r.value).join(' ').replace(/[,:;]$/,'')+'…'; }
  }
  return text.replace(/ +\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function draftCopy(clip, platform, rules) {
  assert(platforms.includes(platform),'Unknown platform.');
  const first=sentence(clip.text), rest=clip.text.slice(first.length).trim();
  let text;
  if(platform==='linkedin') text=`${first}\n\n${rest.slice(0,650)}\n\nWhat has worked in your experience?`;
  else if(platform==='youtube') text=`${first.slice(0,100)}\n\n${rest.slice(0,260)}\n\nFull conversation in the source episode. #Shorts`;
  else text=`${first}\n\n${rest.slice(0,240)}\n\nSave this for your next content session. #CreatorWorkflow`;
  return {text:applyRules(text,rules,platform),engine:'extractive-template',rulesUsed:rules.filter(r=>r.active&&(r.platform===platform||r.platform==='all')).map(r=>r.id)};
}
export function captions(project, clip, format='srt') {
  const time=(seconds,separator)=>{const n=Math.round(Math.max(0,seconds)*1000);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')}${separator}${String(n%1000).padStart(3,'0')}`;};
  return (format==='vtt'?'WEBVTT\n\n':'')+project.segments.filter(s=>s.start<clip.end&&s.end>clip.start).map((s,i)=>`${format==='srt'?i+1+'\n':''}${time(Math.max(s.start,clip.start)-clip.start,format==='srt'?',':'.')} --> ${time(Math.min(s.end,clip.end)-clip.start,format==='srt'?',':'.')}\n${s.text.replace(/[<>]/g,'')}\n`).join('\n');
}
export function calendarICS(items, clips) {
  const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const stamp=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SignalLoop//Content Calendar//EN',...items.flatMap(i=>['BEGIN:VEVENT',`UID:${i.id}@signalloop.local`,`DTSTAMP:${stamp(i.createdAt)}`,`DTSTART:${stamp(i.when)}`,`SUMMARY:${esc(`${i.platform}: ${clips.find(c=>c.id===i.clipId)?.title||'Content'}`)}`,`DESCRIPTION:${esc('Editorial reminder only. SignalLoop does not publish to social platforms.')}`,'END:VEVENT']),'END:VCALENDAR'].join('\r\n')+'\r\n';
}
