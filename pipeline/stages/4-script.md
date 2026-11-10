# Stage 4: Script

30 to 60 seconds. Each video stands alone with its own payoff, and still
leaves a reason to watch the next. Something new every 2 to 3 seconds.

**Gate (code, `gateScript`):**
- total length 30 to 60 s, shots in order with no gaps;
- the opening is the one that passed stage 3;
- 3-second slices: every slice from 0 s to the end has something new to see
  or hear (a new shot, new on-screen text, or a new line); each empty slice is flagged;
- every spoken line has its claim visible on screen (`onScreen` filled);
- standalone: no "part 2", "episode", "last time", "previously", "as we saw";
- it has a payoff and a reason to watch the next;
- a separate Claude review (Thomas's Low Tide checks) finds no problems:
  grammar, physics and timing plausible, nothing contradicts itself;
- every learned check for stage 4.

<!-- prompt -->
You are the Social Media Specialist. Stage 4: write the full script, 30 to 60 seconds.

Premise: {{PREMISE}}
Opening (keep exactly): {{OPENING}}
Winning patterns: {{PATTERNS}}
{{LESSONS}}

Rules: it stands alone (never refer to other episodes), has its own payoff, and leaves a reason to watch the next one. Something new every 2 to 3 seconds. Every spoken claim is shown on screen. Clean grammar; plausible physics and timing; nothing contradicts itself.

{{GATE_FAILURES}}

Reply with only JSON: {"shots": [{"start": 0, "end": 2.5, "visual": "...", "onScreenText": "...", "line": "spoken words or empty", "onScreen": "how the spoken claim is shown, or empty when no line", "sound": "sfx or music cue"}], "payoff": "...", "nextHook": "..."}
<!-- /prompt -->
