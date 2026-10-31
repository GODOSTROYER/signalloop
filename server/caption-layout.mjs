import { captions } from './domain.mjs';
// Cue timing is interpolated within source segments. This is NOT forced word
// alignment. The source words and segment endpoints are never rewritten.
export function phraseSegments(segments,maxWords=7) {
 const output=[];
 for(const segment of segments) {
  const tokens=segment.text.trim().split(/\s+/);let cursor=0;
  while(cursor<tokens.length) {
   let end=Math.min(cursor+maxWords,tokens.length);
   for(let j=cursor+1;j<end-1;j++)if(/[.!?;]$/.test(tokens[j])){end=j+1;break;}
   const phrase=tokens.slice(cursor,end),lines=[];let line='';
   for(const token of phrase){if(line && (line+' '+token).length>32){lines.push(line);line=token;}else line+=(line?' ':'')+token;}
   if(line)lines.push(line);
   output.push({start:segment.start+(segment.end-segment.start)*cursor/tokens.length,end:segment.start+(segment.end-segment.start)*end/tokens.length,text:lines.join('\n')});
   cursor=end;
  }
 }
 return output;
}
export function readableCaptions(project,clip,format='srt') {
 return captions({...project,segments:phraseSegments(project.segments)},clip,format);
}
export function wrapTitle(title,width=30) {
 const words=String(title).replace(/[\x00-\x1f]/g,' ').split(/\s+/),lines=[];let line='';
 for(const word of words){if(line&&(line+' '+word).length>width){lines.push(line);line=word;}else line+=(line?' ':'')+word;}
 if(line)lines.push(line);
 return lines.slice(0,4).join('\n');
}
