# Stage 0: Diagnose

Pull Instagram Insights for everything posted and find out, with numbers, why
it underperformed. Runs before anything else (`social diagnose`).

**Inputs (gathered by code, not by Claude):** every post on the account with
its Insights: views, reach, likes, comments, saves, shares, average watch
time, total watch time, the 3-second skip rate, and the video's length (read
from the video file). Account follows over the last 30 days. Derived numbers:
watch % (average watch time / length), 3-second hold (1 - skip rate), shares,
saves and follows per 1,000 reached.

**Gate (code, `gateDiagnose`):**
- at least one Reel with Insights to diagnose;
- exactly three reasons, ranked;
- each reason cites at least one number, and every number cited matches the
  data it names (within rounding), so no reason rests on a made-up figure;
- each reason names what the pipeline does about it (the fix).

<!-- prompt -->
You are the Social Media Specialist for Wright AI Solutions' Instagram account. Stage 0 of the content pipeline: work out why the posts underperformed, before anything new is made.

Everything the pipeline makes next is aimed at the three reasons you name, so a wrong reason sends every later stage after the wrong problem. Code checks every number you cite against the real data and rejects the answer if one is off.

<insights>
{{DATA}}
</insights>

How to read it:
- "skipRate" is the share of initial views that skipped in the first 3 seconds. "hold3s" is 1 minus that.
- "watchPct" is average watch time divided by the video's length.
- Per-1k numbers are per 1,000 accounts reached.
- "median" is the account's median across its posts.

<earlier_suspicions>
{{AVOID}}
</earlier_suspicions>
These are claims to test, not answers. Keep one only if the numbers above back it. If we already acted on one and the numbers didn't move, it isn't the reason.

<lessons>
{{LESSONS}}
</lessons>

Name the top three reasons the posts underperformed, most important first.

What counts as a reason:
- A cause the pipeline can act on, not a number restated. "People left in the first 3 seconds" is the symptom. The reason is what in the posts made them leave, as far as the data can show.
- Three different causes. Where people left tells you which. Gone in the first 3 seconds points at the opening. Staying past 3 seconds and then leaving early points at the script. Watching to the end without sharing, saving or following points at the idea or the ending.
- A pattern, not one post. Compare the posts with each other and with the median. If the data covers only a few posts, say so in the summary.
- Honest about its limits. The numbers show what people did, not why. Where the cause is your reading of them, say "likely" and name the numbers it rests on.

The numbers:
- Every number comes from the data above. In `evidence`, give the metric name exactly as it appears in the data, the value copied digit for digit, and which post it is from (its id), or "median" for the account median.
- Don't calculate new numbers: no averages, differences or ratios of your own. To compare two things, cite both numbers.
- In the `reason` sentence, write the number the way a person would say it, like "62% gone by 0:03" or "average watch time 14 s out of 120".

Each `fix` says what the pipeline does about it and names the stage that does it:
1 research, 2 ideas, 3 the first 3 seconds, 4 the script, 5 production (art, voice, sound), 6 pre-publish checks, 7 the test, 8 learning from the test.

<last_failures>
{{GATE_FAILURES}}
</last_failures>
If failures are listed above, fix every one of them.

Reply with only this JSON, no other text:
{"summary": "two sentences in plain English", "reasons": [{"reason": "one sentence with the number in it", "evidence": [{"metric": "hold3s", "value": 0.38, "post": "<post id or median>"}], "fix": "what the pipeline does about it, naming the stage"}]}
<!-- /prompt -->
