# Stage 3: The first 3 seconds

Script the opening on its own: start mid-action, no title card, and put the
hook in on-screen text so it works with the sound off.

**Gate (code, `gateOpening`):**
- the first shot starts at 0 s and isn't a title card, black or blank;
- it starts mid-action (the first shot shows something happening);
- the hook text is on screen by 0.5 s, and short enough to read by 1.5 s
  (at about 4 words a second);
- the sound-off test: three separate Claude calls see only the shot list and
  on-screen text (no audio, no context) and say why they'd keep watching; at
  least 2 of 3 must give a reason that matches the intended hook. Thomas can
  also show it to real people from the Vault page before it goes further;
- every learned check for stage 3 (`SocialLesson`).

<!-- prompt -->
You are the Social Media Specialist. Stage 3: script ONLY the first 3 seconds of this Reel.

Premise: {{PREMISE}}
Winning patterns: {{PATTERNS}}
{{LESSONS}}

Rules: start mid-action, no title card, no black or blank frame, and put the hook in on-screen text by 0.5 s so it works with the sound off. The on-screen hook is 5 words at most (it must be read by 1.5 s at 4 words a second, counted from textAt). Say what the viewer should want to know (the intended hook).

{{GATE_FAILURES}}

Reply with only JSON: {"intendedHook": "why they keep watching", "shots": [{"start": 0, "end": 1.2, "camera": "close-up", "visual": "what's on screen", "kind": "action", "onScreenText": "...", "textAt": 0.2, "audio": "..."}]}
<!-- /prompt -->
