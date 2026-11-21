# Social Media Specialist

Thomas's AI employee that runs his business Instagram. Every morning it
drafts posts about his products (a caption, hashtags, and an image with a
headline and a real screenshot of the product's own site). **Those drafts
don't go out until Thomas approves them** on the Vault's AI Employees → Social
Media Specialist page; then they're posted through Instagram's own API at his
posting time. Its own Reels, five a day, post on their own when they pass
every check (Thomas lifted his approval for them on 2026-11-21). What it does and doesn't do is in [docs/ROLE.md](docs/ROLE.md).

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
   A finished Reel kept in `posts/reels` (listed in `posts/reels/drafts.json`,
   added as a draft by `social reel-drafts`) is approved the same way; its video
   is uploaded from the repo as a normal Reel, and the same video goes up as a
   Reel on the Facebook Page (a Page refusal is logged, never retried).
4. **Five Reels a day, on their own** (`.github/workflows/reels.yml`,
   `social reel slot`; Thomas lifted his approval for these on 2026-11-21):
   7am explainer, 10am satisfying, 1pm ad, 4pm explainer, 7pm satisfying
   (Arizona). Each goes through the pipeline's gates (`pipeline/README.md`)
   and posts as a normal Reel, then to the Facebook Page, only if every check
   passes. Pause on the Vault page stops them.

Approving on the page puts the post on the next posting day (Monday,
Wednesday and Friday by default) at the posting time (11:30 Arizona by
default) that has no post yet, or Post now.

Tables (it creates them; the Vault has them in its Prisma schema too):
`SocialPost`, `SocialIdea`, `SocialSettings`, `SocialStatus`, `SocialAlert`,
`SocialToken`.

## The content pipeline (Reels)

`pipeline/` holds the performance-first Reels pipeline: nine stages, each a
prompt plus a gate of checks in code that must pass before the next stage.
Stages 0 (diagnose) and 1 (research) run today; the others have their
prompts and tested gates and get their runners next. See `pipeline/README.md`, including what
Instagram's API can and can't do.

## History

Everything the specialist does is recorded in the Vault (`SocialAction`) and
shown on its page: every post and failed post, drafts, token refreshes,
pipeline stages passed or stopped at a gate, and anything done for Thomas
through Hitta.

## Setup

### Instagram and the Facebook Page (once, about 20 minutes)

The specialist uses **Facebook login**: one token reaches both the Instagram
account and the Facebook Page it's linked to (it can also delete Instagram
posts and look up other accounts, which Instagram login can't). Instagram
login still works for Instagram alone; see the end of this section.

1. Make the Instagram account a **professional** account (Business or
   Creator), and link it to the Facebook Page: in Instagram, Edit profile →
   Public business information → Page → connect the Page.
2. On [developers.facebook.com](https://developers.facebook.com/apps), Create
   app → use cases **Manage messaging & content on Instagram** and **Manage
   everything on your Page**. No business portfolio is needed for this route.
3. In the app, Use cases → Instagram → Customize → **API setup with Facebook
   login**, then **Permissions and features**: add instagram_manage_insights,
   instagram_manage_comments, pages_manage_posts, pages_manage_engagement,
   pages_read_user_content and read_insights (the setup adds the rest).
4. Tools → **Graph API Explorer**: pick the app, "Get User Access Token",
   add instagram_basic, instagram_content_publish, instagram_manage_insights,
   instagram_manage_comments, instagram_manage_messages, pages_show_list,
   pages_read_engagement, pages_manage_posts, pages_manage_engagement,
   pages_read_user_content, read_insights and business_management, then
   **Generate Access Token** and allow the Page and the Instagram account.
5. Make it long-lived: click the ⓘ beside the token → Open in Access Token
   Tool → **Extend Access Token**, and copy the new token. (Or skip this and
   add the app's id as the variable `META_APP_ID` and its secret as
   `META_APP_SECRET`; the specialist extends it itself on its first run.)
6. Paste it as the `INSTAGRAM_ACCESS_TOKEN` secret below. On its first run
   the specialist swaps it for the Page's own token, which doesn't expire,
   and keeps that sealed in the Vault. Paste a new one any time; it wins at
   once.

Approved posts go to the Page too. To keep them Instagram-only, add the
repository variable `FACEBOOK_CROSSPOST` = `off` (Settings → Secrets and
variables → Actions → Variables). If the token reaches more than one Page, set
the variable `FACEBOOK_PAGE_ID` to the right one.

Instagram login instead (Instagram only): in the app, API setup with
Instagram login → Generate access tokens → Add account, and paste that token.
It lasts 60 days, and the specialist renews it every week on its own.

### YouTube Shorts (once, about 15 minutes)

Approved Reels also go to youtube.com/@WrightAISolutions as Shorts (Thomas,
2026-11-21), under the same rule as the Page: only what he approved, once, and a
refusal is logged and never retried. Until Google audits the API project,
YouTube locks every upload private and it can't be made public by hand, so
apply for the audit (YouTube API Services audit form) right after setup.

1. Google Cloud console, signed in as the channel's account: in the project,
   enable **YouTube Data API v3**.
2. Google Auth Platform (OAuth consent screen): app name "Wright AI Social",
   audience **External**, then **Publish app** so it's "In production"
   (a refresh token from an app left in Testing stops working after 7 days).
3. Clients → Create client → **Web application**, with the authorised
   redirect URI `https://developers.google.com/oauthplayground`. Keep the
   client ID and secret.
4. developers.google.com/oauthplayground → the gear → "Use your own OAuth
   credentials" with that ID and secret. In step 1 type the scopes
   `https://www.googleapis.com/auth/youtube.upload` and
   `https://www.googleapis.com/auth/youtube.readonly`, Authorize, sign in as
   the channel (pick the channel if asked; Google warns the app isn't verified:
   Advanced → continue). Step 2 → Exchange: copy the **refresh token**.
5. Secrets `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
   `YOUTUBE_REFRESH_TOKEN`, then run `youtube-test`: it prints the channel
   and uploads nothing. Nothing uploads until the variable `YOUTUBE_CROSSPOST`
   is `on` (Thomas is waiting for Google's audit first); `off` stops it again.

### Secrets

Add these as Actions secrets in this repo (Settings → Secrets and variables →
Actions → New repository secret).

| Secret | What to put in |
|---|---|
| `VAULT_DATABASE_URL` | The Vault's Turso URL (the same value as in the other employees' repos) |
| `VAULT_DATABASE_AUTH_TOKEN` | The Vault's Turso token (the same value as in the other employees' repos) |
| `SOCIAL_SEAL_KEY` | Any long random string, used only here. It locks the Instagram and Page token the specialist keeps in the Vault database, so the shared Vault token alone can't open it. Until it's set, the old lock (made from `VAULT_DATABASE_AUTH_TOKEN`) is used; the first run with it locks the token again. Keep it: without it the token is fetched again from `INSTAGRAM_ACCESS_TOKEN`. |
| `VAULT_PUBLIC_URL` | The Vault's own web address, like `https://your-vault.vercel.app`. Instagram fetches each image from it. |
| `CLAUDE_CODE_OAUTH_TOKEN` | From `claude setup-token` on your computer |
| `HITTA_API_KEY` | A new key for a "Social Media Specialist" employee in Hitta |
| `INSTAGRAM_ACCESS_TOKEN` | The token from step 5 above |
| `INSTAGRAM_USER_ID` | Optional; it finds the account itself |
| `META_APP_SECRET` | Optional (step 5) |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | Optional: YouTube Shorts (above) |

Then, from the Actions tab → Social Media Specialist → Run workflow:

1. `hitta-test`: Hitta should get a low-urgency test (201).
2. `instagram-test`: prints the Instagram account and the Facebook Page. Posts nothing.
3. `preview`: drafts one post and keeps its image as a run artifact; saves
   nothing and posts nothing.
4. `run`: the first real morning run. Drafts show up on the Vault page.
5. `diagnose`: stage 0 of the content pipeline (`pipeline/README.md`). Reads
   Insights for everything posted and names the top 3 reasons it
   underperformed, each with a number; the result is on the Vault page.
6. `research`: stage 1 (`pipeline/stages/1-research.md`). For each format
   (or the one typed in the run's **format** box) it reads the accounts in
   `pipeline/research/accounts.json` through Business Discovery (business
   and creator accounts only), compares each account's winning Reels with
   its average ones, and tests our own rules on them. To study other
   accounts for one run, type them in the **accounts** box, like
   `story: name1, name2; ad: name3`. The report is the run's **research**
   artifact, and a summary goes into the History. It posts nothing. One
   format takes about 20 minutes, all four over an hour.
   `accounts-test` takes the same two boxes and only says which accounts
   stage 1 could use (how many winners and average Reels each has, and how
   many come with a video file). It takes a minute, asks Claude nothing and
   saves nothing: try an account with it before adding it to the file.
   Instagram allows only a few dozen such reads an hour for the whole app,
   so test a handful of accounts at a time; both commands say how much of
   the hour's allowance is used and stop reading at 75%.
   With `ELEVENLABS_API_KEY` set it also transcribes each Reel (ElevenLabs
   speech to text, about $0.20 an hour of sound, so a few cents a run); a
   key limited to some features needs Speech to Text turned on. Set the
   variable `RESEARCH_TRANSCRIBE` to `off` to skip it.

For the Vault page's **Draft now** button, the Vault needs a GitHub token
with Actions read and write on this repo, as `SOCIAL_DISPATCH_TOKEN` on
Vercel (or make `CDO_DISPATCH_TOKEN` cover this repo too).

## Commands

```
npx social requests        answer Hitta's open requests
npx social run             the morning run: token, stats, drafts, Hitta
npx social publish         post every approved post that's due
npx social reel-drafts     add the Reels in posts/reels/drafts.json to the Vault page as drafts
npx social preview         draft one post into preview.jpg; saves nothing, posts nothing
npx social diagnose        content pipeline stage 0: Insights diagnosis (pipeline/README.md)
npx social research        content pipeline stage 1, every format: winners against average Reels
npx social research story  the same for one format; add "story: a, b" to study other accounts
npx social accounts-test   which of those accounts stage 1 could use; saves nothing, posts nothing
npx social instagram-test  read the Instagram account; posts nothing
npx social hitta-test      send Hitta a test report
npm test                   the tests
```
