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
| 1 | Research what wins: 15 to 20 top Reels in the niche | every winning pattern has 3+ real examples, each with a link and its numbers | gate only |
| 2 | Ideas: pitch 20, score, keep 3 | 20 scored pitches, the top 3 kept, each finalist passes the cold one-sentence test | gate only |
| 3 | The first 3 seconds | no title card, starts mid-action, on-screen hook by 0.5 s and readable by 1.5 s, cold sound-off viewers know why to keep watching | gate only |
| 4 | Script, 30 to 60 s, standalone | no 3-second slice without something new; every spoken claim on screen; clean grammar, plausible physics and timing, no contradictions; own payoff; a reason to watch the next | gate only |
| 5 | Production: art, voice, music, captions | our frames judged side by side with the benchmark's, not worse on any axis | gate only |
| 6 | Pre-publish checks | duration, loudness, size, text outside Instagram's button zones, cover, caption first line, keywords, call to action, every learned check | gate only |
| 7 | Test small: 2 to 3 hooks as Trial Reels | after 48 h, the winner by 3-second hold, average watch % and shares per reach | gate only, posting code ready |
| 8 | Learn | every lesson becomes a check for stages 3 to 6, the patterns list is updated, and a double down or drop decision | gate only |

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
