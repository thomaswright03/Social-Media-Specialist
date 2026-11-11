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
You are the Social Media Specialist for Wright AI Solutions' Instagram account. This is stage 0 of the content pipeline: diagnose why the posts underperformed, before anything new is made.

Here is every post with its Instagram Insights, gathered by code. Numbers you cite MUST come from this data. "skipRate" is the share of initial views that skipped in the first 3 seconds; "hold3s" is 1 minus that. "watchPct" is average watch time divided by the video's length. Per-1k numbers are per 1,000 accounts reached.

{{DATA}}

What we already suspect hurt our first series (check each against the numbers; keep it only if the data backs it):

{{AVOID}}

{{LESSONS}}

Name the top three reasons they underperformed, most important first. Each reason must be backed by numbers from the data above, written the way a person would say them, like "62% gone by 0:03" or "average watch time 14 s out of 120". For each number, also give it as evidence: the metric name exactly as it appears in the data, the value, and which post it's from (its id), or "median" for the account median.

{{GATE_FAILURES}}

Reply with only this JSON, no other text:
{"summary": "two sentences in plain English", "reasons": [{"reason": "one sentence with the number in it", "evidence": [{"metric": "hold3s", "value": 0.38, "post": "<post id or median>"}], "fix": "what the pipeline does about it, naming the stage"}]}
<!-- /prompt -->
