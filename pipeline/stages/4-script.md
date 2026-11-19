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
- a stranger can follow it (Thomas, 2026-11-18: the first test Reel was
  "the most incoherent thing I've ever seen"): 8 to 14 shots, one or two
  places, every shot names its camera (no two in a row the same, 3+ kinds),
  and (narrated formats: not the satisfying video) the voice starts in the
  first shot and speaks in at least 3 of 4 shots, and 3 separate cold reads that see only what a viewer sees and hears
  retell the story; a 4th call checks each retelling against the script's own
  two-sentence `story`, and 2 of 3 must get it right, with nothing that
  matters confusing them;
- a separate Claude review (Thomas's Low Tide checks) finds no problems:
  grammar, physics and timing plausible, nothing contradicts itself;
- the format's own checks (`gateFormat`, see the README's content mix): an
  ad sells one product plus our custom AI agents and software, entertainment
  doesn't sell, satisfying videos say they're made with AI, explainers cite 2+
  sources from the last 14 days;
- every learned check for stage 4.

<!-- prompt -->
You are the Social Media Specialist. Stage 4: write the full script, 30 to 60 seconds.

Premise: {{PREMISE}}
Opening (keep exactly): {{OPENING}}
Winning patterns: {{PATTERNS}}
{{LESSONS}}

Rules: it stands alone (never refer to other episodes), has its own payoff, and leaves a reason to watch the next one. Something new every 2 to 3 seconds. Every spoken claim is shown on screen. Clean grammar; plausible physics and timing; nothing contradicts itself.

The format's own rules (follow them exactly; they decide the narration, the shots, the cameras and the caption):
{{FORMAT}}

A stranger scrolling past must understand it on one watch. Cold viewers will retell it from only what they see and hear, and it fails if they get it wrong or are confused. Every shot names its place ("place": "the shop") and its camera; one or two places in the whole video; never the same camera twice in a row, at least 3 kinds.

Keep it simple so it holds together (a strict reviewer checks every one of these):
- 30 to 45 seconds. Shots are 2.5 to 4 seconds (the opening's shots keep their timing); a new shot, new on-screen text or a new line in every 3 seconds.
- One timeline told in order, starting with the opening. No flashbacks and no flash-forwards. Any clock or day shown on screen only moves forward and matches what's happening.
- At most two characters (none in a satisfying video) and one or two places. A character is in one place at a time and needs the time to get anywhere.
- Anything used later (a flashlight, a key, a phone) is shown before it's used.
- The payoff and the caption agree with how the story actually ends.
- nextHook is why someone would follow for the next video (a new mystery, "follow for what the dog does next"), never "part 2", "episode", "to be continued" or anything that makes this one incomplete.

{{GATE_FAILURES}}

Reply with only JSON: {"shots": [{"start": 0, "end": 2.5, "place": "the shop", "camera": "wide", "visual": "...", "onScreenText": "...", "line": "spoken words or empty", "onScreen": "how the spoken claim is shown, or empty when no line", "sound": "sfx or music cue"}], "story": "what happens, in two plain sentences, exactly as a viewer should understand it", "payoff": "...", "nextHook": "...", "caption": "...", "sources": [{"url": "https://...", "published": "YYYY-MM-DD", "title": "..."}]} (sources only for an explainer)
<!-- /prompt -->
