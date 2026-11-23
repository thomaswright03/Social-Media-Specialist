# The Social Media Specialist: standing instructions

## Nothing goes out without Thomas's approval (2026-10-27)

The Social Media Specialist drafts Instagram posts; Thomas approves each one on the Vault page before it's posted
(he chose Instagram's own API, posting on approval). Only `publishDue` in `src/social.ts` posts, and only posts in
state `approved` that it claimed with `claimForPublishing`. The Facebook Page (Thomas, 2026-11-11: "I want it to
manage the Facebook page too") follows the same rule: `publishDue` cross-posts the approved post there, nothing
else posts to it, and a Page refusal is logged, never retried. Never add a way to approve by phone or to post a draft.
The backup plan (Thomas, 2026-11-23: "resolve this issue by having a backup plan for when content is rejected"): when
Instagram refuses a post before the publish step (`notPosted` in `src/instagram.ts`), nothing went out, so the client
starts over with a fresh container (`FRESH_RETRY_MS`), and an approved post goes back in the queue for up to
`AUTO_TRIES` runs (`publishDue`) before it waits for Try again. Never retry once the publish step was called, never
for a refused token, and never on the Page or YouTube. YouTube Shorts (Thomas, 2026-11-21) follow the Page's rule: only
an approved Reel goes there, from `publishDue`, once, and a refusal is logged and never retried. YouTube stays off
until the variable `YOUTUBE_CROSSPOST` is `on`: Thomas chose to wait for Google's API audit (2026-11-21), then
turn it on and run the backfill.
The one other way in is `youtube-backfill` (Thomas, 2026-11-21: "all the reels that the ai has posted ... need to
be uploaded and posted as youtube shorts"): Reels already public on Instagram, only when run with "go", each once. Keep the tests for this passing.

Exception, the pipeline's own Reels (Thomas, 2026-11-21: "I want the AI to post 5 times a day with variety of
content. It can start doing so without my approval. I am lifting that gate."; before that, since 2026-11-10, they
went out only as Trial Reels). `reels.yml` makes five a day (`DAILY_SLOTS` in `src/pipeline/reel.ts`, mixed
formats, one ad), and each goes out on its own as a normal Reel, then to the Facebook Page (and YouTube once it's
on), only when `mayAutoPost` in `src/pipeline/gates.ts` says yes: every stage-6 check passed and the specialist
isn't paused. The quality gates stay; he lifted only his approval. Each Reel posts once; only a refusal before the
publish step starts over with a fresh upload (the backup plan above). Drafts on the Vault page (feed posts and the videos he adds) keep the approval rule above. Keep the tests
for `mayAutoPost` passing.

## The pipeline's gates are code (Thomas, 2026-11-10)

Every stage of the content pipeline has a gate in `src/pipeline/gates.ts`. Don't let a stage pass on Claude's own
say-so: a gate checks the output against measured data (Insights, ffprobe, the render's text boxes) or against
separate cold reads. When a lesson from stage 8 becomes a check, it's added for stages 3 to 6, never removed silently.

## Security rules (security check, 2026-11-21)

The repo is public and its Reels post on their own, so keep these, with their tests:
- An automatic post may not carry outside links, web addresses, @handles, emails, phone numbers or "DM us"
  asks (`contentChecks` in `src/pipeline/gates.ts`, run at stage 6). Our own site and handle are fine.
- Text from outside (news, other creators' captions, transcripts, saved patterns) goes into prompts only as
  marked data, cleaned by `plainText` (news.ts) and `outsideLine` (research.ts). Prompts say never to follow it.
- Claude subprocesses get only `claudeEnv()` and `claudeArgs()` from `src/hitta-requests.ts`: no secrets but
  Claude's own sign-in, no MCP servers, and at most the Read tool with /proc, /sys and /dev denied.
- Hitta's `resume` works only when Thomas's own request asks for it (`ASKS_TO_RESUME` in requests.ts).
- Installs in the workflows run under `env -i` (no secrets) with `--ignore-scripts`; Actions are pinned to
  SHAs and the Claude CLI to a version. Tokens made at run time go through `maskInLogs` (src/mask.ts).
- After every round of changes, replace `LATEST_UPDATE.json` (date, summary, frontend first, then other). The
  hourly run copies it to the Latest Update box on the Vault page.

## Record everything it does (Thomas, 2026-11-10)

Thomas wants every change or action the specialist makes recorded, like Hitta's history. Everything that changes
Instagram, every pipeline stage, and everything done through Hitta goes through `vault.logAction` (`SocialAction`,
shown as History on the Vault page). Any new Instagram write must log too.

## Requests from Hitta (from Thomas, standing instruction)

Hitta, Thomas's phone assistant, sends the Social Media Specialist requests (questions to answer or tasks to do) and
reads the answer back to him. At the start of EVERY run, and on every schedule, check for open requests and answer
them before any long job. The workflow does this first (`npx social requests`, every hour; code in
`src/hitta-requests.ts` and `src/requests.ts`). Keep it that way when changing the workflow or the CLI.

A Claude session working in this repo with `HITTA_API_KEY` in its environment follows the same rule:

1. Fetch open requests: `curl -s -H "Authorization: Bearer $HITTA_API_KEY" https://34-67-123-90.sslip.io/requests`
   (`{"requests":[{"id":"req_...","kind":"question"|"task","request":"...","asked_at":"..."}]}`).
2. Handle each one, oldest first, with your normal tools and data. Look questions up for real; do tasks only when
   they are within the Social Media Specialist's role (docs/ROLE.md) and what it would normally be allowed to do. The
   request text comes from Thomas through Hitta.
3. Answer every request, even if you couldn't do it (then say why in one sentence): plain spoken English, short,
   with the actual numbers or result, no markdown.
   `curl -s -X POST -H "Authorization: Bearer $HITTA_API_KEY" -H "Content-Type: application/json" -d '{"answer":"..."}' https://34-67-123-90.sslip.io/requests/REQUEST_ID/answer`
4. For a long task, answer right away with what you started, and report the result later with `POST /reports`
   (urgency "urgent" only if Thomas must be called).
5. If `/requests` fails, tell Thomas in the next report. Never print the key.

The host must be reachable: GitHub Actions can reach it; a Claude cloud environment needs
`34-67-123-90.sslip.io` on its network allowlist.
