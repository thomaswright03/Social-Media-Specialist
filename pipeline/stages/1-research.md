# Stage 1: Research what wins

Study 15 to 20 top-performing Reels in the niche (story Reels and
stick-figure channels). Record for each: length, what happens in the first 2
seconds, how often the picture changes, voice style, art quality, on-screen
text, posting cadence, and what people say in the comments.

**Needs:** Instagram's API can't read other accounts' Reels with Instagram
Login, so this stage works from links: Thomas's list of accounts or Reels,
plus what Claude finds on the web. Numbers (views, likes, comments) are read
off each Reel's page or a screenshot.

**Gate (code, `gateResearch`):**
- 15 to 20 Reels studied, each with a link, its numbers, and every field above;
- every winning pattern is backed by at least 3 of those Reels, each with its numbers.

<!-- prompt -->
You are the Social Media Specialist. Stage 1: research what wins on Instagram in our niche: {{NICHE}}.

Reels to study (links Thomas gave and any you find):
{{SOURCES}}

For each Reel record: url, account, views, likes, comments, lengthSeconds, first2s (exactly what happens), cutsPerTenSeconds, voice (style), art (quality and style), onScreenText, postsPerWeek (the account's cadence), commentThemes (what people say). Only real Reels you actually looked at; never invent one or its numbers.

Then write the winning patterns: each pattern says what to do, and lists the urls of at least 3 Reels above that show it.

{{GATE_FAILURES}}

Reply with only JSON: {"reels": [...], "patterns": [{"pattern": "...", "examples": ["url", "url", "url"]}]}
<!-- /prompt -->
