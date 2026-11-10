# The Social Media Specialist: standing instructions

## Nothing goes out without Thomas's approval (2026-10-27)

The Social Media Specialist drafts Instagram posts; Thomas approves each one on the Vault page before it's posted
(he chose Instagram's own API, posting on approval). Only `publishDue` in `src/social.ts` posts, and only posts in
state `approved` that it claimed with `claimForPublishing`. Never add a way to approve by phone or to post a draft,
and never retry a failed post on its own. Keep the tests for this passing.

Exception, Trial Reels only (Thomas, 2026-11-10): he chose "automatic Trial Reels only" for the content pipeline
(`pipeline/README.md`). A pipeline Reel may go out without his OK only as a Trial Reel (shown to non-followers,
`graduation_strategy: MANUAL`, so showing it to followers stays his call in the app), and only when `mayAutoPost` in
`src/pipeline/gates.ts` says yes: every stage-6 check passed and the specialist isn't paused. Feed posts and normal
Reels keep the approval rule above. Keep the tests for `mayAutoPost` passing.

## The pipeline's gates are code (Thomas, 2026-11-10)

Every stage of the content pipeline has a gate in `src/pipeline/gates.ts`. Don't let a stage pass on Claude's own
say-so: a gate checks the output against measured data (Insights, ffprobe, the render's text boxes) or against
separate cold reads. When a lesson from stage 8 becomes a check, it's added for stages 3 to 6, never removed silently.

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
