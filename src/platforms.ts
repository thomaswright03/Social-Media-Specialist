// Where the account stands on each platform (Thomas, 2026-11-23: "sections for
// Facebook, TikTok, and YouTube Shorts about the status of the pages, if they
// are connected, and how our account is performing on each of those
// platforms"). Read only: account info and insights, never a post. The morning
// run and the Reel slot runs refresh it every few hours into SocialStatus row "platforms", and the
// Vault page shows one section per platform (its parsePlatforms must match).
import { crosspostOn, type FacebookPageClient } from "./facebook.ts";
import type { InstagramClient } from "./instagram.ts";
import type { YouTubeClient } from "./youtube.ts";
import type { Vault } from "./vault.ts";

export type PlatformId = "instagram" | "facebook" | "youtube" | "tiktok";
export type PlatformStat = { label: string; value: number | null };
export type Platform = {
  id: PlatformId;
  name: string;
  connected: boolean;
  /** One plain sentence: connected as what, posting or not, and why. */
  status: string;
  url: string | null;
  stats: PlatformStat[];
  notes: string[];
};
export type PlatformsReport = { checkedAt: string; platforms: Platform[] };

export const PLATFORMS_ROW = "platforms";
/** How often the runs read the platforms again (the morning run and each Reel slot run check). */
export const PLATFORMS_EVERY_MS = 3 * 3600_000;
const WEEK_MS = 7 * 86_400_000;
const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);
const sum = (xs: (number | null | undefined)[]) => (xs.some((x) => typeof x === "number") ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);

export type PlatformDeps = {
  ig: InstagramClient | null;
  igError?: string | null;
  page: FacebookPageClient | null;
  youtube: YouTubeClient | null;
  /** YOUTUBE_CROSSPOST is on (uploads public once Google's audit passed). */
  youtubeOn: boolean;
  now?: Date;
};

async function instagram(ig: InstagramClient | null, igError: string | null | undefined, now: Date): Promise<Platform> {
  const base = { id: "instagram" as const, name: "Instagram", url: null as string | null, stats: [] as PlatformStat[], notes: [] as string[] };
  if (!ig) return { ...base, connected: false, status: igError ? `Not connected: ${igError}` : "Not connected: the Instagram token isn't set." };
  try {
    const a = await ig.account();
    const media = ig.listMedia ? await ig.listMedia(40).catch(() => []) : [];
    const week = media.filter((m) => Date.parse(m.timestamp) >= now.getTime() - WEEK_MS);
    const reels = week.filter((m) => m.productType === "REELS" || m.mediaType === "VIDEO");
    const insights = ig.reelInsights ? await Promise.all(reels.map((m) => ig.reelInsights!(m.id).catch(() => null))) : [];
    const follows = ig.recentFollows ? await ig.recentFollows(28).catch(() => null) : null;
    return {
      ...base,
      connected: true,
      status: `Connected as @${a.username}. Its own Reels post five a day; your approved posts go out on their times.`,
      url: `https://www.instagram.com/${a.username}/`,
      stats: [
        { label: "Followers", value: a.followers },
        { label: "Posts in all", value: a.posts },
        { label: "Posts, last 7 days", value: week.length },
        { label: "Reel views, last 7 days", value: sum(insights.map((i) => i?.views)) },
        { label: "Accounts reached by those Reels", value: sum(insights.map((i) => i?.reach)) },
        { label: "Likes, last 7 days", value: sum(week.map((m) => m.likes)) },
        { label: "Comments, last 7 days", value: sum(week.map((m) => m.comments)) },
        { label: "Shares, last 7 days", value: sum(insights.map((i) => i?.shares)) },
        { label: "New followers, last 28 days", value: follows },
      ],
    };
  } catch (err) {
    return { ...base, connected: false, status: `Not connected: Instagram refused the token (${why(err)}).` };
  }
}

async function facebook(page: FacebookPageClient | null): Promise<Platform> {
  const base = { id: "facebook" as const, name: "Facebook Page", url: null as string | null, stats: [] as PlatformStat[], notes: [] as string[] };
  if (!page) return { ...base, connected: false, status: "Not connected: the token is an Instagram-login token, which can't reach the Page." };
  try {
    const p = page.performance ? await page.performance(7) : null;
    const info = p?.info ?? (await page.info());
    const posting = crosspostOn() ? "Every Reel that goes out on Instagram also goes to the Page, with a clickable link to the website." : "Posting to the Page is off (FACEBOOK_CROSSPOST=off).";
    return {
      ...base,
      connected: true,
      status: `Connected to ${info.name}. ${posting}`,
      url: info.link,
      stats: [
        { label: "Followers", value: info.followers },
        { label: "Page likes", value: info.likes },
        { label: "Posts, last 7 days", value: p ? p.posts : null },
        { label: "Reels, last 7 days", value: p ? p.reels : null },
        { label: "Reel plays, last 7 days", value: p?.reelViews ?? null },
        { label: "Reactions, last 7 days", value: p?.reactions ?? null },
        { label: "Comments, last 7 days", value: p?.comments ?? null },
        { label: "People reached, last 28 days", value: p?.reach ?? null },
        { label: "Post engagements, last 28 days", value: p?.engagements ?? null },
      ],
      notes: info.instagramId ? [] : ["The Page isn't linked to the Instagram account."],
    };
  } catch (err) {
    return { ...base, connected: false, status: `Not connected: Facebook refused it (${why(err)}).` };
  }
}

async function youtube(yt: YouTubeClient | null, on: boolean): Promise<Platform> {
  const base = { id: "youtube" as const, name: "YouTube Shorts", url: null as string | null, stats: [] as PlatformStat[], notes: [] as string[] };
  if (!yt) return { ...base, connected: false, status: "Not connected: the YouTube secrets aren't set." };
  try {
    const c = await yt.channel();
    const handle = c.handle ? (c.handle.startsWith("@") ? c.handle : `@${c.handle}`) : null;
    return {
      ...base,
      connected: true,
      status: on
        ? `Connected as ${handle ?? c.title}. Every Reel that goes out on Instagram is also uploaded as a Short.`
        : `Connected as ${handle ?? c.title}, but not posting yet: it waits for Google's API audit, because until then uploads stay private. The day it passes, it's turned on and the earlier Reels are uploaded.`,
      url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${c.id}`,
      stats: [
        { label: "Subscribers", value: c.subscribers },
        { label: "Videos", value: c.videos },
        { label: "Views in all", value: c.views ?? null },
      ],
    };
  } catch (err) {
    return { ...base, connected: false, status: `Not connected: YouTube refused it (${why(err)}).` };
  }
}

function tiktok(): Platform {
  return {
    id: "tiktok",
    name: "TikTok",
    connected: false,
    status: "Not set up yet. It needs a TikTok Business account and a TikTok developer app; until TikTok reviews the app, posts can only go to your TikTok inbox as drafts for you to post.",
    url: null,
    stats: [],
    notes: [],
  };
}

export async function platformsReport(d: PlatformDeps): Promise<PlatformsReport> {
  const now = d.now ?? new Date();
  const [ig, fb, yt] = await Promise.all([instagram(d.ig, d.igError, now), facebook(d.page), youtube(d.youtube, d.youtubeOn)]);
  return { checkedAt: now.toISOString(), platforms: [ig, fb, yt, tiktok()] };
}

/** Reads the platforms again when the saved report is older than PLATFORMS_EVERY_MS (or `force`). True when it saved one. */
export async function refreshPlatforms(vault: Vault, deps: () => Promise<PlatformDeps>, opts: { force?: boolean; now?: Date } = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  const saved = await vault.statusRow(PLATFORMS_ROW);
  if (!opts.force && saved && now.getTime() - Date.parse(saved.updatedAt) < PLATFORMS_EVERY_MS) return false;
  const report = await platformsReport({ ...(await deps()), now });
  await vault.saveStatusRow(PLATFORMS_ROW, report.platforms.some((p) => p.connected), JSON.stringify(report), now);
  return true;
}
