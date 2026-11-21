// One Social Media Specialist run.
//
// Every morning (`social run`):
//   1. keep the Instagram token fresh and read the account
//   2. read likes, comments and reach on what went out in the last 30 days
//   3. draft posts until there's a week's worth waiting or scheduled
//      (postsPerWeek), at most three a morning: Thomas's ideas first, then
//      the product posted about longest ago
//   4. tell Hitta once when new drafts wait for Thomas (normal urgency)
//
// Every hour (`social publish`): post every approved post whose time has
// come, then read it back. Nothing is ever posted that Thomas didn't approve
// on the Vault page, and a failed post is never retried on its own (a retry
// could post it twice); Thomas taps Try again.
import { fullCaption, pickNext, readSite, screenDraft, buildDraftPrompt, type Subject } from "./draft.ts";
import { crosspostOn, facebookPageClient, pageText, type FacebookPageClient } from "./facebook.ts";
import { youtubeClient, youtubeCreds, youtubeOn, type YouTubeClient } from "./youtube.ts";
import { HITTA_PROJECT, type HittaReport, type HittaResult } from "./hitta.ts";
import { currentToken, instagramClient, InstagramError, type InstagramClient } from "./instagram.ts";
import type { Renderer } from "./render.ts";
import { readReel } from "./reel-drafts.ts";
import { DAY_MS } from "./time.ts";
import { siteProducts, SITE_URL } from "./site.ts";
import { vaultNow, type Post, type Product, type SocialSnapshot, type Vault } from "./vault.ts";

/** Image (feed) posts are off unless FEED_IMAGE_POSTS is "on". */
export const feedImagePostsOn = () => process.env.FEED_IMAGE_POSTS?.trim().toLowerCase() === "on";

export type Deps = {
  vault: Vault;
  hitta: (r: HittaReport) => Promise<HittaResult>;
  log: (m: string) => void;
  /** One Claude turn: the prompt in, the answer out. */
  ask: (prompt: string) => Promise<string>;
  renderer: () => Promise<Renderer>;
  /** Instagram for a token; tests pass a fake. */
  instagram?: (token: string) => InstagramClient;
  /** The Facebook Page for a token (null with an Instagram-login token); tests pass a fake. */
  facebook?: (token: string) => FacebookPageClient | null;
  /** The YouTube channel (null until it's set up); tests pass a fake. */
  youtube?: () => YouTubeClient | null;
  fetchImpl?: typeof fetch;
  /** A reel post's video bytes; the file in posts/reels unless a test passes its own. */
  readReel?: (sourceUrl: string | null) => Promise<Uint8Array>;
  /** The products to post about; the website's product cards unless a test passes its own. */
  products?: () => Promise<Product[]>;
  now?: Date;
};

/** Most drafts in one morning, so a bad day costs little. */
export const MAX_DRAFTS_A_DAY = 3;

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};

/** Where Instagram fetches a post's image: the Vault serves it. */
export function mediaUrl(p: Pick<Post, "mediaToken">): string | null {
  const base = process.env.VAULT_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/api/social/media/${p.mediaToken}.jpg` : null;
}

export async function runDaily(d: Deps): Promise<{ snapshot: SocialSnapshot; alertError: string | null }> {
  const now = d.now ?? new Date();
  const { vault, log } = d;
  await vault.ensureTables();
  const settings = await vault.settings();
  const snapshot: SocialSnapshot = { checkedAt: now.toISOString(), account: null, instagramOk: false, tokenExpiresAt: null, drafted: 0, waiting: 0, scheduled: 0, published30d: 0, notes: [] };
  let alertError: string | null = null;

  // 1. Instagram: token and account.
  const token = await currentToken(vault, { fetchImpl: d.fetchImpl, now, log }).catch((err) => {
    snapshot.instagramError = `The token couldn't be read: ${err instanceof Error ? err.message : String(err)}`;
    return null;
  });
  let ig: InstagramClient | null = null;
  if (!token) {
    snapshot.instagramError ??= "INSTAGRAM_ACCESS_TOKEN isn't set, so approved posts can't go out yet.";
  } else {
    snapshot.tokenExpiresAt = token.expiresAt;
    ig = (d.instagram ?? ((t) => instagramClient(t, { fetchImpl: d.fetchImpl })))(token.token);
    try {
      const a = await ig.account();
      snapshot.account = { username: a.username, followers: a.followers, posts: a.posts };
      snapshot.instagramOk = true;
    } catch (err) {
      snapshot.instagramError = err instanceof Error ? err.message : String(err);
      ig = null;
    }
  }
  if (snapshot.instagramError) {
    log(`Instagram: ${snapshot.instagramError}`);
    alertError = await reportOnce(d, `instagram-down:${now.toISOString().slice(0, 10)}`, {
      title: "Your Social Media Specialist can't reach Instagram",
      summary: `${snapshot.instagramError.slice(0, 220)} Until it's fixed, posts you approve won't go out. Drafts still get made. The setup steps are in the Social Media Specialist repo's README.`,
      urgency: "normal",
    }, (await vault.posts(`"state" = 'approved'`)).length > 0 || !!token);
  }
  // A token that will run out soon and couldn't be refreshed.
  if (token?.expiresAt && Date.parse(token.expiresAt) - now.getTime() < 7 * DAY_MS) {
    const err = await reportOnce(d, `token-expiring:${token.expiresAt.slice(0, 10)}`, {
      title: "Your Instagram token runs out this week",
      summary: `The Social Media Specialist's Instagram token stops working on ${new Date(token.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })} and couldn't be renewed. Make a new one and paste it into the INSTAGRAM_ACCESS_TOKEN secret, as in the README.`,
      urgency: "normal",
    });
    alertError ??= err;
  }

  // 2. How the last 30 days' posts did.
  const all = await vault.posts();
  const recent = all.filter((p) => p.state === "published" && p.igMediaId && p.publishedAt && now.getTime() - Date.parse(p.publishedAt) < 30 * DAY_MS);
  snapshot.published30d = recent.length;
  if (ig) {
    for (const p of recent) {
      try {
        const s = await ig.stats(p.igMediaId!);
        await vault.updatePost(p.id, { likes: s.likes, comments: s.comments, reach: s.reach, saves: s.saves, shares: s.shares, views: s.views, statsAt: vaultNow(now), ...(s.permalink && !p.permalink ? { permalink: s.permalink } : {}) }, now);
      } catch (err) {
        log(`Couldn't read how "${p.headline}" did: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. Drafts. Thomas, 2026-11-18: "everything should be reels", so image
  // posts are off unless FEED_IMAGE_POSTS is "on"; his ideas wait for the Reels.
  if (!feedImagePostsOn()) {
    log("Image posts are off (everything is Reels now), so no image drafts.");
  } else if (settings.paused) {
    snapshot.notes.push("Paused: no drafts and nothing posted until it's resumed.");
  } else {
    const waiting = all.filter((p) => p.state === "draft").length;
    const lined = all.filter((p) => p.state === "approved").length;
    const need = Math.max(0, Math.min(MAX_DRAFTS_A_DAY, settings.postsPerWeek - waiting - lined));
    if (need === 0) log(`${waiting} drafts waiting and ${lined} scheduled: enough for a week, no new drafts.`);
    else {
      const products = await (d.products ?? (() => siteProducts(d.fetchImpl ?? fetch)))().catch((err) => {
        const why = err instanceof Error ? err.message : String(err);
        log(`Couldn't read the products from ${SITE_URL()}: ${why}`);
        snapshot.notes.push(`Couldn't read the products from ${SITE_URL()} (${why}), so only your ideas were drafted.`);
        return [] as Product[];
      });
      log(`Products on ${SITE_URL()}: ${products.map((p) => p.name).join(", ") || "none"}.`);
      const ideas = await vault.openIdeas();
      if (products.length === 0 && ideas.length === 0) snapshot.notes.push(`No products on ${SITE_URL()} and no ideas queued, so there's nothing to post about.`);
      const picks = pickNext(products, ideas, all, settings, need);
      let renderer: Renderer | null = null;
      try {
        for (const pick of picks) {
          const label = pick.idea ? `your idea "${pick.idea.text.slice(0, 60)}"` : pick.product?.name ?? "Wright AI Solutions";
          try {
            renderer ??= await d.renderer();
            const made = await draftOne(d, pick, renderer, settings, all, now);
            if (made) {
              snapshot.drafted++;
              all.unshift(made);
              log(`Drafted "${made.headline}" (${label}).`);
            }
          } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            snapshot.notes.push(`Couldn't draft a post about ${label}: ${why.slice(0, 160)}`);
            log(`Couldn't draft a post about ${label}: ${why}`);
          }
        }
      } finally {
        await renderer?.close().catch(() => {});
      }
    }
  }
  snapshot.waiting = all.filter((p) => p.state === "draft").length;
  snapshot.scheduled = all.filter((p) => p.state === "approved").length;

  // 4. Tell Thomas when there's something new to look at.
  if (snapshot.drafted > 0) {
    const err = await reportOnce(d, `drafts:${now.toISOString().slice(0, 10)}`, {
      title: snapshot.waiting === 1 ? "An Instagram post is waiting for your OK" : `${snapshot.waiting} Instagram posts are waiting for your OK`,
      summary: `Your Social Media Specialist drafted ${snapshot.drafted} new ${snapshot.drafted === 1 ? "post" : "posts"} this morning${draftedAbout(all.slice(0, snapshot.drafted))}. Nothing goes out until you approve it on the Social Media Specialist page in the Vault. ${snapshot.scheduled > 0 ? `${snapshot.scheduled} approved ${snapshot.scheduled === 1 ? "post is" : "posts are"} already scheduled.` : "Nothing is scheduled yet."}`,
      urgency: "normal",
    });
    alertError ??= err;
  }

  await vault.saveStatus(!snapshot.error && snapshot.instagramOk, snapshot, now);
  return { snapshot, alertError };
}

function draftedAbout(posts: Post[]): string {
  const names = [...new Set(posts.map((p) => p.productName).filter((n): n is string => !!n))];
  return names.length ? `, about ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`}` : "";
}

async function draftOne(d: Deps, pick: Subject, renderer: Renderer, settings: Awaited<ReturnType<Vault["settings"]>>, history: Post[], now: Date): Promise<Post | null> {
  const site = pick.product ? await readSite(pick.product.url, d.fetchImpl) : null;
  const prompt = buildDraftPrompt({ pick, site, settings, history });
  let screened = screenDraft(await d.ask(prompt), { ...pick, site });
  // One more try, told what was wrong.
  if (!screened.ok) {
    d.log(`First draft dropped: ${screened.reason}. Asking once more.`);
    screened = screenDraft(await d.ask(`${prompt}\n\nYour last answer couldn't be used because ${screened.reason}. Fix that.`), { ...pick, site });
  }
  if (!screened.ok) throw new Error(`the draft couldn't be used (${screened.reason})`);
  const post = screened.post;
  let shot: Buffer | null = null;
  if (post.kind === "screenshot" && post.sourceUrl) {
    shot = await renderer.screenshot(post.sourceUrl).catch((err) => {
      d.log(`Couldn't screenshot ${post.sourceUrl}: ${err instanceof Error ? err.message : err}. Making a card instead.`);
      return null;
    });
    if (!shot) {
      post.kind = "card";
      post.sourceUrl = null;
    }
  }
  const image = await renderer.image({ kind: post.kind, theme: post.theme, headline: post.headline, subline: post.subline, productName: post.productName, host: hostOf(post.sourceUrl), screenshot: shot });
  const saved = await d.vault.addPost(post, image, now);
  if (pick.idea) await d.vault.useIdea(pick.idea.id, saved.id, now);
  await d.vault.logAction({ kind: "drafted", summary: `Drafted "${saved.headline}"${saved.productName ? ` about ${saved.productName}` : ""}; it waits for your OK.`, target: saved.id }, now);
  return saved;
}

export type PublishResult = { published: Post[]; failed: { post: Post; error: string }[]; skipped: string | null };

/** Posts every approved post whose time has come (at most three an hour). */
export async function publishDue(d: Omit<Deps, "ask" | "renderer">): Promise<PublishResult> {
  const now = d.now ?? new Date();
  const { vault, log } = d;
  await vault.ensureTables();
  const result: PublishResult = { published: [], failed: [], skipped: null };
  const settings = await vault.settings();
  if (settings.paused) return { ...result, skipped: "paused" };
  const due = (await vault.duePosts(now)).slice(0, 3);
  if (due.length === 0) return { ...result, skipped: "nothing due" };
  const token = await currentToken(vault, { fetchImpl: d.fetchImpl, now, log }).catch(() => null);
  // Instagram fetches a picture from the Vault; a Reel's video is uploaded from the repo instead.
  const needsVault = due.some((p) => p.kind !== "reel");
  const missing = !token ? "INSTAGRAM_ACCESS_TOKEN isn't set" : needsVault && !process.env.VAULT_PUBLIC_URL?.trim() ? "VAULT_PUBLIC_URL isn't set, so Instagram can't fetch the image" : null;
  if (missing) {
    // Left approved: it goes out as soon as the setup is fixed.
    log(`${due.length} approved ${due.length === 1 ? "post is" : "posts are"} due, but ${missing}.`);
    await reportOnce(d, `publish-blocked:${now.toISOString().slice(0, 10)}`, {
      title: "Your approved Instagram post can't go out",
      summary: `${due.length} approved ${due.length === 1 ? "post is" : "posts are"} due, but ${missing}. ${due.length === 1 ? "It goes" : "They go"} out on the next hourly run after that's fixed. The setup steps are in the Social Media Specialist repo's README.`,
      urgency: "normal",
    });
    return { ...result, skipped: missing };
  }
  const ig = (d.instagram ?? ((t) => instagramClient(t, { fetchImpl: d.fetchImpl })))(token!.token);
  const page = crosspostOn() ? (d.facebook ?? ((t) => facebookPageClient(t, { fetchImpl: d.fetchImpl })))(token!.token) : null;
  const yt = youtubeCrosspost(d);
  for (const p of due) {
    if (!(await vault.claimForPublishing(p.id, now))) continue;
    try {
      if (p.kind === "reel") {
        await publishApprovedReel(d, ig, page, yt, p, now, result);
        continue;
      }
      const url = mediaUrl(p)!;
      await checkImage(url, d.fetchImpl);
      const r = await ig.publishImage(url, fullCaption(p));
      await vault.updatePost(p.id, { state: "published", publishedAt: vaultNow(now), igContainerId: r.containerId, igMediaId: r.mediaId, permalink: r.permalink, error: null }, now);
      result.published.push({ ...p, state: "published", permalink: r.permalink });
      log(`Posted "${p.headline}"${r.permalink ? `: ${r.permalink}` : ""}.`);
      await vault.logAction({ kind: "posted", summary: `Posted "${p.headline}" to Instagram.`, detail: r.permalink, target: p.id, onInstagram: true }, now);
      // The same approved post on the Facebook Page. A refusal there never undoes or retries the Instagram post.
      if (page) {
        try {
          const fb = await page.publishPhoto(url, pageText(fullCaption(p), SITE_URL()));
          log(`Posted "${p.headline}" to the Facebook Page${fb.permalink ? `: ${fb.permalink}` : ""}.`);
          await vault.logAction({ kind: "posted", summary: `Posted "${p.headline}" to the Facebook Page.`, detail: fb.permalink ?? fb.postId, target: p.id, onInstagram: true }, now);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          log(`Posted "${p.headline}" to Instagram, but the Facebook Page refused it: ${error}`);
          await vault.logAction({ kind: "post_failed", summary: `Posted "${p.headline}" to Instagram, but the Facebook Page refused it.`, detail: error.slice(0, 500), target: p.id, onInstagram: true, ok: false }, now);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await vault.updatePost(p.id, { state: "failed", error: error.slice(0, 500) }, now);
      result.failed.push({ post: p, error });
      log(`Couldn't post "${p.headline}": ${error}`);
      await vault.logAction({ kind: "post_failed", summary: `Tried to post "${p.headline}"; Instagram refused it.`, detail: error.slice(0, 500), target: p.id, onInstagram: true, ok: false }, now);
      await reportOnce(d, `failed:${p.id}:${p.attempts + 1}`, {
        title: "An approved Instagram post didn't go out",
        summary: `Instagram refused your approved post "${p.headline.slice(0, 80)}". ${error.slice(0, 200)}${err instanceof InstagramError && err.tokenProblem ? " The Instagram token needs replacing." : ""} It won't try again on its own; tap Try again on the Social Media Specialist page once it's fixed.`,
        urgency: "normal",
      });
    }
  }
  return result;
}

/**
 * An approved Reel from posts/reels: uploads the video and posts it as a normal
 * Reel (Thomas approved it, so it isn't a Trial Reel), then the same video as a
 * Reel on the Facebook Page and as a YouTube Short. A refusal on the Page or
 * YouTube is logged and never retried, and never undoes the Instagram post.
 */
async function publishApprovedReel(d: Omit<Deps, "ask" | "renderer">, ig: InstagramClient, page: FacebookPageClient | null, yt: YouTubeClient | null, p: Post, now: Date, result: PublishResult): Promise<void> {
  if (!ig.publishReelFile) throw new Error("This Instagram client can't upload a video.");
  const video = await (d.readReel ?? readReel)(p.sourceUrl);
  const r = await ig.publishReelFile(video, fullCaption(p));
  await d.vault.updatePost(p.id, { state: "published", publishedAt: vaultNow(now), igContainerId: r.containerId, igMediaId: r.mediaId, permalink: r.permalink, error: null }, now);
  result.published.push({ ...p, state: "published", permalink: r.permalink });
  d.log(`Posted the Reel "${p.headline}"${r.permalink ? `: ${r.permalink}` : ""}.`);
  await d.vault.logAction({ kind: "posted", summary: `Posted the Reel "${p.headline}" to Instagram.`, detail: r.permalink, target: p.id, onInstagram: true }, now);
  if (page) await reelToPage(d, page, video, p, now);
  if (yt) await reelToYouTube(d, yt, video, p, now);
}

/** YouTube for Reels: the test's fake, else the channel once YOUTUBE_CROSSPOST is "on" (youtubeOn); "off" stops both. */
export function youtubeCrosspost(d: Pick<Deps, "youtube" | "fetchImpl">): YouTubeClient | null {
  if (process.env.YOUTUBE_CROSSPOST?.trim().toLowerCase() === "off") return null;
  if (d.youtube) return d.youtube();
  const creds = youtubeOn() ? youtubeCreds() : null;
  return creds ? youtubeClient(creds, { fetchImpl: d.fetchImpl }) : null;
}

async function reelToYouTube(d: Omit<Deps, "ask" | "renderer">, yt: YouTubeClient, video: Uint8Array, p: Post, now: Date): Promise<void> {
  try {
    const r = await yt.uploadShort(video, { title: p.headline, description: pageText(fullCaption(p), SITE_URL()), tags: p.hashtags });
    const locked = r.privacy && r.privacy !== "public" ? ` YouTube kept it ${r.privacy} (until Google's API audit passes, every upload is).` : "";
    d.log(`Posted the Reel "${p.headline}" to YouTube as a Short: ${r.url}.${locked}`);
    await d.vault.logAction({ kind: "posted", summary: `Posted the Reel "${p.headline}" to YouTube as a Short.${locked}`, detail: r.url, target: p.id, onInstagram: true }, now);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    d.log(`Posted the Reel "${p.headline}" to Instagram, but YouTube refused it: ${error}`);
    await d.vault.logAction({ kind: "post_failed", summary: `Posted the Reel "${p.headline}" to Instagram, but YouTube refused it.`, detail: error.slice(0, 500), target: p.id, onInstagram: true, ok: false }, now);
  }
}

async function reelToPage(d: Omit<Deps, "ask" | "renderer">, page: FacebookPageClient, video: Uint8Array, p: Post, now: Date): Promise<void> {
  try {
    if (!page.publishReelFile) throw new Error("This Facebook Page client can't upload a video.");
    const fb = await page.publishReelFile(video, pageText(fullCaption(p), SITE_URL()));
    d.log(`Posted the Reel "${p.headline}" to the Facebook Page${fb.permalink ? `: ${fb.permalink}` : ""}.`);
    await d.vault.logAction({ kind: "posted", summary: `Posted the Reel "${p.headline}" to the Facebook Page.`, detail: fb.permalink ?? fb.videoId, target: p.id, onInstagram: true }, now);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    d.log(`Posted the Reel "${p.headline}" to Instagram, but the Facebook Page refused it: ${error}`);
    await d.vault.logAction({ kind: "post_failed", summary: `Posted the Reel "${p.headline}" to Instagram, but the Facebook Page refused it.`, detail: error.slice(0, 500), target: p.id, onInstagram: true, ok: false }, now);
  }
}

/** Instagram fetches the image itself; make sure the Vault really serves it first, for a clear error. */
async function checkImage(url: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) throw new Error(`The Vault didn't answer for the image at ${new URL(url).origin}. Check VAULT_PUBLIC_URL.`);
  if (!res.ok) throw new Error(`The Vault answered ${res.status} for the image. Check VAULT_PUBLIC_URL and that the Vault is deployed with the Social Media Specialist page.`);
  if (!(res.headers.get("content-type") ?? "").startsWith("image/jpeg")) throw new Error("The Vault didn't serve the image as a JPEG. Check VAULT_PUBLIC_URL.");
}

async function reportOnce(d: Pick<Deps, "vault" | "hitta" | "log">, key: string, r: Omit<HittaReport, "project">, when = true): Promise<string | null> {
  if (!when || !process.env.HITTA_API_KEY?.trim()) return null;
  if (await d.vault.alreadyReported(key).catch(() => true)) return null;
  const result = await d.hitta({ project: HITTA_PROJECT, ...r });
  d.log(`Told Hitta "${r.title}": ${result.message}`);
  if (result.ok) await d.vault.markReported(key, r.title, r.urgency).catch(() => {});
  return result.ok ? null : result.message;
}
