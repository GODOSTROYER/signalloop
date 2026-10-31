# Three-minute judge demo

## Preparation

Install Node 22.16+, FFmpeg and eSpeak. Run `npm run demo:media` before starting the server; this resets demo records only. Start with `npm start`. Use a permitted real podcast for your final submission when possible. Keep a backup MP4 export ready, but show the real application first. Never call synthetic feedback actual audience performance.

## 0:00–0:25: the problem

“Most repurposing tools forget what happened after you pressed generate. SignalLoop remembers how you edited the content and uses measured results to change the next recommendation.”

Open the source. Play the original synthetic podcast, explaining that it is a reproducible demo fixture. Show clip timestamps and the original quotation.

## 0:25–0:55: editorial judgment, with evidence

Select a candidate. Explain the visible hook, payoff, coherence and duration rubric. Show the context warning. State that this is an editorial score, not a probability of going viral.

Switch between Instagram and LinkedIn: the idea stays grounded in the source; the framing changes. The offline prototype uses templates. Use AI rewrite only when the configured provider has been verified.

## 0:55–1:40: the learning moment

Generate Instagram copy. Delete its hashtag and save. Open Brand memory. Show the actual before/after edit and proposed rule. Approve “Leave hashtags out of this platform’s copy.”

Switch to another moment. Regenerate Instagram copy. Show that the hashtag is gone. Switch to YouTube and show that its unrelated platform rule was not changed. Turn the rule off to demonstrate reversibility.

“The point is not remembering a paragraph. It is remembering a specific editorial decision, with evidence, scope and an off switch.”

## 1:40–2:15: outcome evidence changes the shortlist

Open Performance. State explicitly: “These are synthetic test observations, isolated from real creator data.” Load the illustrative results. Show the before-content score, the feedback adjustment, and the changed shortlist order. Open the studio to show the same ranking changed there.

“Real creators can import observed post metrics. We compare within a platform, shrink small samples toward a prior, and cap the adjustment. This is association, not proof of causality.”

## 2:15–2:45: real output

Plan the selected post. Show the editorial calendar and ICS export. Queue a 9:16 MP4 with captions. Show an actual completed render and downloaded file. Mention that this prototype preserves the source frame with fit-and-pad; it does not claim face tracking.

## 2:45–3:00: close

“Clips are easy to generate. Editorial taste is harder to retain. SignalLoop turns every correction and every measured outcome into a better starting point for the next piece of content.”

## Honest answers

- Is it fine-tuning? No. Explicit rule learning, stored edit examples, and optional retrieval into the AI copy prompt.
- Is it a multi-agent system? No. Modular deterministic services and one optional model call are sufficient for this prototype. Do not imply unbuilt agent infrastructure.
- Does it publish? No. Planning and export are real; social publishing is a future OAuth integration.
- Does it fetch live analytics? No. Import and reranking are real; platform ingestion is not connected.
- Is ranking proven to improve performance? No. The algorithm demonstrably changes suggestions, but actual content lift needs controlled evaluation.
- What is novel here? Inspectable, reversible memory plus a separate, conservative evidence loop. Do not claim competitors have none of these features without current comparative research.
