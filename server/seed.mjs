import { candidates } from './domain.mjs';
export const demoParagraphs = [
 'The content treadmill is a trap. Publishing more is not the same as saying something worth hearing. Instead of asking how many posts you can squeeze out of a podcast, ask which idea would make someone pause. One useful conversation can carry a week of content, but only when every cut earns its place.',
 'Start with the question your audience is already asking. First, find a moment that answers it without needing the previous five minutes. Second, keep the example that makes the answer concrete. Third, stop the clip after the payoff. A complete thought beats a clever sentence with the context missing.',
 'We spent a month making every caption sound like a marketing department. Then we read them aloud. None of us spoke that way. We replaced impressive words with normal ones and kept the small details from the conversation. The lesson was simple: your editing history is a better brand guide than a list of adjectives.',
 'Why does the same clip feel right on one platform and wrong on another? The idea can stay the same while the invitation changes. A professional audience might want the reasoning. A short video audience needs the point quickly. Adapt the framing, not the facts. Do not invent a result just to make the hook stronger.',
 'Most creators do not need a virality score. They need a reason to trust a recommendation. Show the exact moment, explain why the idea stands on its own, and tell them what context might be lost. A transparent recommendation can be corrected. A mysterious number just asks to be believed.',
 'Try a simple weekly review. Choose one goal before you publish. Measure completions, saves, or thoughtful replies rather than everything at once. Compare similar posts on the same platform. Keep a few experiments in the mix. Otherwise you train yourself to repeat yesterday forever.',
 'A single successful post is not a strategy. It might have reached a different audience, gone out at a better time, or benefited from luck. Use early results as a small nudge, not a rule. The more evidence you collect, the more confidently you can change the next recommendation.',
 'We learned to protect the sentence that comes before the exciting quote. Sometimes that sentence is the qualification. Without it, the speaker sounds like they promised something they never promised. Good repurposing makes the idea easier to find without changing what the person actually said.'
];
export function seed(store){
  if(store.get('projects','demo'))return;
  let start=0;
  const segments=demoParagraphs.map(text=>{const duration=text.split(/\s+/).length/2.35;const s={start,end:start+duration,text};start+=duration;return s;});
  const project={id:'demo',name:'Beyond the content treadmill',source:'Original illustrative podcast transcript',sample:true,brandId:'demo-brand',timing:'estimated',segments,duration:start,status:'ready',createdAt:new Date().toISOString(),media:null};
  store.transaction(()=>{store.put('projects',project);for(const clip of candidates(project))store.put('clips',clip);store.log('workspace.created',{projectId:'demo',sample:true});});
}
