# Social Media Specialist

Thomas's AI employee that runs his business Instagram. Every morning it
drafts posts about his products (a caption, hashtags, and an image with a
headline and a real screenshot of the product's own site). **Nothing goes
out until Thomas approves it** on the Vault's AI Employees → Social Media
Specialist page; then it's posted through Instagram's own API at his posting
time. What it does and doesn't do is in [docs/ROLE.md](docs/ROLE.md).

It runs on GitHub Actions (`.github/workflows/social.yml`), so it works with
Thomas's computer off.

## How it works

1. **Hitta first** (`src/hitta-requests.ts`, `src/requests.ts`): open requests
   are answered before anything long, every hour.
2. **Morning run** (`social run`, `src/social.ts`), 8:09 in Arizona:
   - keeps the Instagram token fresh (`src/instagram.ts`: refreshed weekly,
     stored sealed in the Vault's `SocialToken`) and reads the account;
   - reads likes, comments, reach, saves, shares and views on what went out in
     the last 30 days;
   - drafts posts until a week's worth (posts a week, default 3) is waiting or
     scheduled, at most three a morning: Thomas's ideas first, then the product
     posted about longest ago (`src/draft.ts`). Claude reads the product's
     site, fetched by the code, plus the posts Thomas turned down and why, and
     his best posts by reach. A screen drops links, made-up claims (guarantees,
     #1), mentions of Hitta and too few hashtags; it asks once more, then skips;
   - makes the image (`src/render.ts`): 1080x1350 JPEG rendered by headless
     Chromium, with a screenshot of the page Claude picked on the product's own
     site, or a words-only card;
   - tells Hitta once when new drafts are waiting (normal urgency).
3. **Hourly** (`social publish`): posts every approved post whose time has
   come. The image is served by the Vault at `/api/social/media/<token>.jpg`,
   because Instagram fetches it from a URL. Each post is claimed before
   posting, so it can never go out twice; one Instagram refuses is marked
   failed, Hitta is told, and Thomas taps Try again.

Approving on the page puts the post on the next posting day (Monday,
Wednesday and Friday by default) at the posting time (11:30 Arizona by
default) that has no post yet, or Post now.

Tables (it creates them; the Vault has them in its Prisma schema too):
`SocialPost`, `SocialIdea`, `SocialSettings`, `SocialStatus`, `SocialAlert`,
`SocialToken`.

## The content pipeline (Reels)

`pipeline/` holds the performance-first Reels pipeline: nine stages, each a
prompt plus a gate of checks in code that must pass before the next stage.
Stage 0 (diagnose) runs today; the others have their prompts and tested
gates and get their runners next. See `pipeline/README.md`, including what
Instagram's API can and can't do.

## History

Everything the specialist does is recorded in the Vault (`SocialAction`) and
shown on its page: every post and failed post, drafts, token refreshes,
pipeline stages passed or stopped at a gate, and anything done for Thomas
through Hitta.

## Setup

### Instagram (once, about 15 minutes)

1. Make the Instagram account a **professional** account (Business or
   Creator): in the Instagram app, Settings → Account type and tools →
   Switch to professional account. Personal accounts can't post through the
   API.
2. On [developers.facebook.com](https://developers.facebook.com/apps), Create
   app → pick the use case for managing messaging and content on Instagram
   (the Instagram API) → type Business. Meta renames these screens now and
   then; look for "Instagram API with Instagram login".
3. In the app, Instagram → API setup with Instagram business login →
   Generate access tokens → Add account, log in to the Instagram account, and
   generate a token. Allow content publishing, insights, comments and
   messages (the content pipeline reads Reel Insights; comments and messages
   are there for when it starts managing them). The app can stay
   in Development mode: your own account doesn't need App Review.
4. Paste the token as the `INSTAGRAM_ACCESS_TOKEN` secret below. It lasts 60
   days, and the specialist renews it every week on its own. If it ever
   stops working, generate a new one the same way and paste it over the old
   secret; the new one wins at once.

Using Facebook login instead (an Instagram account linked to a Facebook
Page, with a system-user token that doesn't expire) also works: set the
secret `INSTAGRAM_USER_ID` to the Instagram account id, and add a repository
variable (Settings → Secrets and variables → Actions → Variables)
`INSTAGRAM_GRAPH_HOST` = `graph.facebook.com`.

### Secrets

Add these as Actions secrets in this repo (Settings → Secrets and variables →
Actions → New repository secret).

| Secret | What to put in |
|---|---|
| `VAULT_DATABASE_URL` | The Vault's Turso URL (the same value as in the other employees' repos) |
| `VAULT_DATABASE_AUTH_TOKEN` | The Vault's Turso token (the same value as in the other employees' repos) |
| `VAULT_PUBLIC_URL` | The Vault's own web address, like `https://your-vault.vercel.app`. Instagram fetches each image from it. |
| `CLAUDE_CODE_OAUTH_TOKEN` | From `claude setup-token` on your computer |
| `HITTA_API_KEY` | A new key for a "Social Media Specialist" employee in Hitta |
| `INSTAGRAM_ACCESS_TOKEN` | The token from step 3 above |
| `INSTAGRAM_USER_ID` | Optional with Instagram login (it asks Instagram); needed with Facebook login |

Then, from the Actions tab → Social Media Specialist → Run workflow:

1. `hitta-test`: Hitta should get a low-urgency test (201).
2. `instagram-test`: prints the account's name and followers. Posts nothing.
3. `preview`: drafts one post and keeps its image as a run artifact; saves
   nothing and posts nothing.
4. `run`: the first real morning run. Drafts show up on the Vault page.
5. `diagnose`: stage 0 of the content pipeline (`pipeline/README.md`). Reads
   Insights for everything posted and names the top 3 reasons it
   underperformed, each with a number; the result is on the Vault page.

For the Vault page's **Draft now** button, the Vault needs a GitHub token
with Actions read and write on this repo, as `SOCIAL_DISPATCH_TOKEN` on
Vercel (or make `CDO_DISPATCH_TOKEN` cover this repo too).

## Commands

```
npx social requests        answer Hitta's open requests
npx social run             the morning run: token, stats, drafts, Hitta
npx social publish         post every approved post that's due
npx social preview         draft one post into preview.jpg; saves nothing, posts nothing
npx social diagnose        content pipeline stage 0: Insights diagnosis (pipeline/README.md)
npx social instagram-test  read the Instagram account; posts nothing
npx social hitta-test      send Hitta a test report
npm test                   the tests
```
