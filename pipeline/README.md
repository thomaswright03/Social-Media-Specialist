# The content pipeline

How the Social Media Specialist makes Reels that perform. It's a chain of nine
stages (0 to 8). Each stage is a prompt (in `stages/`) plus a **gate**: checks
that must all pass before the next stage starts. The gates are code
(`src/pipeline/gates.ts`, tested in `test/pipeline.test.ts`), not a promise in
the prompt: when a gate fails, the stage is run again with the failed checks
in front of Claude (up to 3 tries), and if it still fails the pipeline stops
there and the Vault page shows why.

It starts from what actually performs on Instagram, not from our first
series. Those videos are the examples of what to avoid (`avoid.md`).

| # | Stage | Gate (all must pass) | Built |
|---|-------|----------------------|-------|
| 0 | Diagnose: pull Insights for everything posted | 3 reasons it underperformed, each backed by a number that matches the Insights data | yes (`social diagnose`) |
| 1 | Research what wins: 15 to 20 top Reels in the niche | every winning pattern has 3+ real examples, each with a link and its numbers | yes (`social research`) |
| 2 | Ideas: pitch 20 in the format code picked (80/20 mix), score, keep 3 | 20 scored pitches, the top 3 kept, each finalist fits the format and passes the cold one-sentence test (3 separate cold reads, 2 must say yes) | yes (`social ideas`) |
| 3 | The first 3 seconds | no title card, starts mid-action, on-screen hook by 0.5 s and readable by 1.5 s, cold sound-off viewers know why to keep watching | yes (`social script`) |
| 4 | Script, 30 to 60 s, standalone | no 3-second slice without something new; every spoken claim on screen; clean grammar, plausible physics and timing, no contradictions; own payoff; a reason to watch the next; the format's checks | yes (`social script`) |
| 5 | Production: art, voice, music, captions | our frames judged side by side with the benchmark's, not worse on any axis | yes (`social produce`: ElevenLabs voice, drawn SVG shots, captions, our own sound; the mp4 is a run artifact) |
| 6 | Pre-publish checks | duration, loudness, size, text outside Instagram's button zones, cover, caption first line, keywords, call to action, music and art licensed, every learned check | gate only |
| 7 | Test small: 2 to 3 hooks as Trial Reels | after 48 h, the winner by 3-second hold, average watch % and shares per reach; too small after 7 days | gate only, posting code ready |
| 8 | Learn | every lesson becomes a check for stages 3 to 6, the patterns list is updated, and double down or drop as the numbers say | gate only |

## What it makes: 80% entertainment, 20% ads (Thomas, 2026-11-18)

Each Reel is one of four formats, picked by code (`nextFormat` in
`src/pipeline/formats.ts`) from what was already made:

| Format | Kind | What it is |
|--------|------|------------|
| `story` | entertainment | a standalone stick-figure story (stage 1's patterns) |
| `satisfying` | entertainment | a satisfying AI-made video |
| `explainer` | entertainment | a current event explained with bold graphics and transitions |
| `ad` | ad | one product from wright-ai-solutions.com, plus Wright AI Solutions itself: we build custom AI agents and software for businesses |

Each format has its own prompts in `pipeline/formats/<format>.md`: `ideas`
(what to pitch, stage 2), `script` (how it's told: narration, shots, cameras,
caption; stages 3 and 4) and `style` (how it's drawn, stage 5). Edit those
files to change a format. Stories and ads have characters drawn once and
re-posed; the satisfying video has no narrator, so stage 4 doesn't ask for one.

An ad is made only when it keeps ads at 2 of the last 10 Reels and at least 3
entertainment Reels came since the last one; ads take turns between the
site's products. The entertainment formats take turns too. Each script also
passes `gateFormat` with stage 4's gate:

- an ad names its one product and no other, says we build custom AI agents
  and software for businesses, and ends on a call to action;
- entertainment doesn't sell (no "link in bio", sign-up, discount, product
  or business names);
- a satisfying video's caption says it was made with AI (Instagram expects AI
  content to be labelled);
- an explainer lists at least 2 linked sources dated within the last 14 days.

## What I added to Thomas's outline (2026-11-10)

He said to fill gaps where I saw them. These are in the gates too:

- **Music and art rights** (stage 6). Reels posted through the API can't use
  Instagram's music library, so every sound and picture must be ours or
  royalty-free with a license that allows commercial use, and the Reel
  lists each one with its source and license.
- **The account's goal** (stage 0). The series is meant to bring profile
  visits that lead to the website, so the diagnosis also reads follows and
  taps on the profile's link over the last 30 days, not only views.
- **A stop rule** (stage 7). A test that hasn't reached 100 accounts per
  version after 7 days is called too small instead of waiting forever.
- **Double down or drop by the numbers** (stage 8). Double down only when the
  winner beats where we started (stage 0's medians) on at least 2 of 3-second
  hold, watch % and shares per reach; otherwise drop. Stage 8's decision has
  to agree.
- **Gates are code, every try is saved.** A stage can't pass on its own word;
  failures are fed back and retried up to 3 times, then it stops and says why.

"Gate only" means the gate checks exist and are tested, and the stage's
prompt is written; the runner for that stage comes next, once the open
decisions for it are made (see the bottom of this file).

## What gets recorded

Every stage result and gate result is saved in the Vault (`SocialStage`),
every lesson in `SocialLesson`, and every action the specialist takes (a
post, a draft, a token refresh, a stage passed or failed, anything done
through Hitta) in its History (`SocialAction`), shown on the Vault page.

## Posting: Trial Reels only, on their own

Thomas chose automatic Trial Reels only: a finished video goes out as a Trial
Reel (shown to non-followers only) without waiting for him, but only after
every stage-6 check passes. Graduation (showing it to followers) stays his
call in the Instagram app (`graduation_strategy: MANUAL`). Feed posts still
need his approval on the Vault page.

## What Instagram's API can and can't do (checked 2026-11-10, API v27)

- No Facebook Page is needed: the specialist uses the Instagram API with
  Instagram Login, which works on a professional account by itself.
- Can: publish photos, Reels and **Trial Reels** (`trial_params`), read
  Insights (views, reach, likes, comments, saves, shares, average watch time,
  total watch time, and `reels_skip_rate`, the share who skipped in the first
  3 seconds), turn comments on or off on a post, reply to, hide or delete
  comments, and answer DMs (with the messages permission).
- Can't, with Instagram Login: delete a post (Facebook Login only, which
  needs a Page), graduate a Trial Reel, or tell whether one has graduated.
- Can't at all: change the bio, name, profile photo, link in bio, or
  highlights, pin a post, or read the retention graph or per-Reel follows.
  The retention graph is only in the app (an Insights screenshot works).
- Others' Reels can't be read with Instagram Login (Business Discovery and
  hashtag search need Facebook Login), so stage 1 needs links to the Reels
  to study, or a Facebook Page.
- Videos are fetched by Instagram from a public URL; with Instagram Login
  there's no direct upload.
