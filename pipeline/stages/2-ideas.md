# Stage 2: Ideas

Pitch 20 premises and score each from 1 to 5 on: hook strength, would people
share it, does it work on its own, and how different it is from what we've
made. Keep the top 3.

**Gate (code, `gateIdeas`):**
- exactly 20 pitches, each scored 1 to 5 on all four;
- the 3 kept are the 3 highest totals;
- each finalist is one sentence, with no reference to other episodes;
- the one-sentence test: each finalist is read cold by separate Claude calls
  that see only that sentence; at least 2 of 3 must want the next sentence.

<!-- prompt -->
You are the Social Media Specialist. Stage 2: pitch 20 premises for standalone Reels (30 to 60 s) in our niche: {{NICHE}}.

This Reel's format (every pitch must fit it):
{{FORMAT}}

Winning patterns (stage 1):
{{PATTERNS}}

What we've already made (be different from it):
{{HISTORY}}

{{LESSONS}}

For each pitch write it as ONE sentence that makes a cold reader want the next sentence, then score it 1 to 5 on hook, shareable, standalone, different. Then list the ids of the top 3 by total.

{{GATE_FAILURES}}

Reply with only JSON: {"pitches": [{"id": 1, "sentence": "...", "hook": 4, "shareable": 3, "standalone": 5, "different": 4}], "finalists": [1, 2, 3]}
<!-- /prompt -->
