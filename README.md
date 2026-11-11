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
| `INSTAGRAM_ACCESS_TOKEN` | The token from step 5 above |
| `INSTAGRAM_USER_ID` | Optional; it finds the account itself |
| `META_APP_SECRET` | Optional (step 5) |

Then, from the Actions tab → Social Media Specialist → Run workflow:

1. `hitta-test`: Hitta should get a low-urgency test (201).
2. `instagram-test`: prints the Instagram account and the Facebook Page. Posts nothing.
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
