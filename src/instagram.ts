// Instagram's own API (the "Instagram API with Instagram Login", or with
// Facebook Login when INSTAGRAM_GRAPH_HOST is graph.facebook.com). It only
// posts what Thomas approved on the Vault page: social.ts calls publishImage
// for an approved post whose time has come, and nothing else here writes.
//
// Publishing is two steps: make a media container from the image's public
// URL and the caption, wait until Instagram has fetched the image, then
// publish the container. The image is served by the Vault
// (/api/social/media/<token>.jpg), because Instagram fetches it from a URL.
//
// Tokens from Instagram Login last 60 days and can be refreshed once they're
// a day old; refreshed ones are kept sealed in the Vault (SocialToken). A
// token pasted into the INSTAGRAM_ACCESS_TOKEN secret wins over the stored
// one as soon as it changes.
import { seedOf, type Vault } from "./vault.ts";
import { DAY_MS } from "./time.ts";

export const GRAPH_VERSION = "v23.0";

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: number | null,
  ) {
    super(message);
  }
  /** The token is wrong, expired or was revoked: only Thomas can fix that. */
  get tokenProblem(): boolean {
    return this.code === 190 || this.status === 401;
  }
}

export type Account = { id: string; username: string; followers: number | null; posts: number | null };
export type MediaStats = { likes: number | null; comments: number | null; reach: number | null; saves: number | null; shares: number | null; views: number | null; permalink: string | null };

export type Media = {
  id: string;
  caption: string | null;
  mediaType: string;
  /** FEED, REELS, STORY … */
  productType: string | null;
  timestamp: string;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  likes: number | null;
  comments: number | null;
};

/** Reel metrics from Instagram's insights (null when Instagram doesn't give one). */
export type ReelInsights = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  totalInteractions: number | null;
  /** Seconds (Instagram gives milliseconds). */
  avgWatchSeconds: number | null;
  /** Seconds of total watch time, replays included. */
  totalWatchSeconds: number | null;
  /** Share of initial views that skipped in the first 3 seconds, 0 to 1. */
  skipRate: number | null;
};

/** Trial Reels: shown to non-followers first. MANUAL = Thomas shares it with followers in the app; SS_PERFORMANCE = Instagram does if it does well. */
export type TrialStrategy = "MANUAL" | "SS_PERFORMANCE";

export type InstagramClient = {
  account(): Promise<Account>;
  publishImage(imageUrl: string, caption: string): Promise<{ containerId: string; mediaId: string; permalink: string | null }>;
  stats(mediaId: string): Promise<MediaStats>;
  /** Everything on the account, newest first (up to `max`). */
  listMedia?(max?: number): Promise<Media[]>;
  reelInsights?(mediaId: string): Promise<ReelInsights>;
  /** Follows in the last `days` days (at most 30), when Instagram gives it. */
  recentFollows?(days?: number): Promise<number | null>;
  /** Posts a Reel from a public video URL; a trial Reel when `trial` is set. */
  publishReel?(videoUrl: string, caption: string, opts?: { trial?: TrialStrategy; coverUrl?: string; thumbOffsetMs?: number; shareToFeed?: boolean }): Promise<{ containerId: string; mediaId: string; permalink: string | null }>;
};

export const REEL_METRICS = ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time", "reels_skip_rate"] as const;

/** Instagram's insights rows into ReelInsights. */
export function parseReelInsights(data: { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[]): ReelInsights {
  const out: ReelInsights = { views: null, reach: null, likes: null, comments: null, saves: null, shares: null, totalInteractions: null, avgWatchSeconds: null, totalWatchSeconds: null, skipRate: null };
  for (const m of data) {
    const v = n(m.values?.[0]?.value ?? m.total_value?.value);
    switch (m.name) {
      case "views": out.views = v; break;
      case "reach": out.reach = v; break;
      case "likes": out.likes = v; break;
      case "comments": out.comments = v; break;
      case "saved": out.saves = v; break;
      case "shares": out.shares = v; break;
      case "total_interactions": out.totalInteractions = v; break;
      case "ig_reels_avg_watch_time": out.avgWatchSeconds = v === null ? null : v / 1000; break;
      case "ig_reels_video_view_total_time": out.totalWatchSeconds = v === null ? null : v / 1000; break;
      // A percentage (e.g. 62.5); kept as a share.
      case "reels_skip_rate": out.skipRate = v === null ? null : v > 1 ? v / 100 : v; break;
    }
  }
  return out;
}

const host = () => process.env.INSTAGRAM_GRAPH_HOST?.trim() || "graph.instagram.com";

type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(fetchImpl: Fetch, method: "GET" | "POST", path: string, token: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const url = new URL(`https://${host()}/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  try {
    res =
      method === "GET"
        ? await fetchImpl(`${url}?${body}`, { signal: AbortSignal.timeout(30_000) })
        : await fetchImpl(url, { method: "POST", body, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new InstagramError(`Instagram couldn't be reached: ${err instanceof Error ? err.message : String(err)}`, null, null);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number; error_user_msg?: string } };
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    // The message comes back from Meta; it never contains the token.
    throw new InstagramError(`Instagram said: ${e.error_user_msg || e.message || `HTTP ${res.status}`}`, res.status, typeof e.code === "number" ? e.code : null);
  }
  return json;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function instagramClient(token: string, opts: { fetchImpl?: Fetch; userId?: string; pollMs?: number } = {}): InstagramClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? 3_000;
  let userId = opts.userId ?? process.env.INSTAGRAM_USER_ID?.trim() ?? "";

  async function id(): Promise<string> {
    if (userId) return userId;
    const me = await call(fetchImpl, "GET", "me", token, { fields: "user_id,username" });
    userId = String(me.user_id ?? me.id ?? "");
    if (!userId) throw new InstagramError("Instagram didn't say which account the token belongs to. Set INSTAGRAM_USER_ID.", null, null);
    return userId;
  }

  return {
    async account() {
      const me = await call(fetchImpl, "GET", await id(), token, { fields: "username,followers_count,media_count" });
      return { id: userId, username: String(me.username ?? ""), followers: n(me.followers_count), posts: n(me.media_count) };
    },

    async publishImage(imageUrl, caption) {
      const ig = await id();
      const container = await call(fetchImpl, "POST", `${ig}/media`, token, { image_url: imageUrl, caption });
      const containerId = String(container.id ?? "");
      if (!containerId) throw new InstagramError("Instagram didn't make a media container.", null, null);
      // Instagram fetches the image itself; wait for it (about a minute at most).
      for (let i = 0; i < 20; i++) {
        const s = await call(fetchImpl, "GET", containerId, token, { fields: "status_code,status" });
        if (s.status_code === "FINISHED") break;
        if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new InstagramError(`Instagram couldn't use the image: ${String(s.status ?? s.status_code)}`, null, null);
        if (i === 19) throw new InstagramError("Instagram was still fetching the image after a minute.", null, null);
        await sleep(pollMs);
      }
      const published = await call(fetchImpl, "POST", `${ig}/media_publish`, token, { creation_id: containerId });
      const mediaId = String(published.id ?? "");
      if (!mediaId) throw new InstagramError("Instagram didn't say the post went out.", null, null);
      // Read it back: the post exists and has a link.
      const back = await call(fetchImpl, "GET", mediaId, token, { fields: "permalink,timestamp" }).catch(() => ({}) as Record<string, unknown>);
      return { containerId, mediaId, permalink: typeof back.permalink === "string" ? back.permalink : null };
    },

    async listMedia(max = 100) {
      const ig = await id();
      const out: Media[] = [];
      let after: string | null = null;
      while (out.length < max) {
        const page = await call(fetchImpl, "GET", `${ig}/media`, token, { fields: "id,caption,media_type,media_product_type,timestamp,permalink,media_url,thumbnail_url,like_count,comments_count", limit: "50", ...(after ? { after } : {}) });
        for (const m of (page.data as Record<string, unknown>[] | undefined) ?? []) {
          out.push({
            id: String(m.id),
            caption: typeof m.caption === "string" ? m.caption : null,
            mediaType: String(m.media_type ?? ""),
            productType: typeof m.media_product_type === "string" ? m.media_product_type : null,
            timestamp: String(m.timestamp ?? ""),
            permalink: typeof m.permalink === "string" ? m.permalink : null,
            mediaUrl: typeof m.media_url === "string" ? m.media_url : null,
            thumbnailUrl: typeof m.thumbnail_url === "string" ? m.thumbnail_url : null,
            likes: n(m.like_count),
            comments: n(m.comments_count),
          });
        }
        const next = (page.paging as { cursors?: { after?: string }; next?: string } | undefined) ?? {};
        if (!next.next || !next.cursors?.after) break;
        after = next.cursors.after;
      }
      return out.slice(0, max);
    },

    async reelInsights(mediaId) {
      // All at once; when Instagram refuses one metric (some are "in development"), one at a time.
      const all = await call(fetchImpl, "GET", `${mediaId}/insights`, token, { metric: REEL_METRICS.join(",") }).catch(() => null);
      if (all) return parseReelInsights((all.data as never[]) ?? []);
      const rows: never[] = [];
      for (const metric of REEL_METRICS) {
        const one = await call(fetchImpl, "GET", `${mediaId}/insights`, token, { metric }).catch(() => null);
        rows.push(...(((one?.data as never[]) ?? []) as never[]));
      }
      return parseReelInsights(rows);
    },

    async recentFollows(days = 30) {
      const ig = await id();
      const until = Math.floor(Date.now() / 1000);
      const since = until - Math.min(days, 30) * 86_400;
      const r = await call(fetchImpl, "GET", `${ig}/insights`, token, { metric: "follows_and_unfollows", period: "day", metric_type: "total_value", breakdown: "follow_type", since: String(since), until: String(until) }).catch(() => null);
      const m = (r?.data as { total_value?: { breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] } }[] | undefined)?.[0];
      const results = m?.total_value?.breakdowns?.[0]?.results ?? [];
      const follows = results.find((x) => x.dimension_values?.includes("FOLLOWER"))?.value;
      return typeof follows === "number" ? follows : null;
    },

    async publishReel(videoUrl, caption, opts = {}) {
      const ig = await id();
      const params: Record<string, string> = { media_type: "REELS", video_url: videoUrl, caption };
      if (opts.trial) params.trial_params = JSON.stringify({ graduation_strategy: opts.trial });
      if (opts.coverUrl) params.cover_url = opts.coverUrl;
      if (opts.thumbOffsetMs !== undefined) params.thumb_offset = String(Math.round(opts.thumbOffsetMs));
      if (opts.shareToFeed !== undefined) params.share_to_feed = String(opts.shareToFeed);
      const container = await call(fetchImpl, "POST", `${ig}/media`, token, params);
      const containerId = String(container.id ?? "");
      if (!containerId) throw new InstagramError("Instagram didn't make a media container.", null, null);
      // Video processing takes longer than an image: up to five minutes.
      for (let i = 0; i < 100; i++) {
        const s = await call(fetchImpl, "GET", containerId, token, { fields: "status_code,status" });
        if (s.status_code === "FINISHED") break;
        if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new InstagramError(`Instagram couldn't use the video: ${String(s.status ?? s.status_code)}`, null, null);
        if (i === 99) throw new InstagramError("Instagram was still processing the video after five minutes.", null, null);
        await sleep(pollMs);
      }
      const published = await call(fetchImpl, "POST", `${ig}/media_publish`, token, { creation_id: containerId });
      const mediaId = String(published.id ?? "");
      if (!mediaId) throw new InstagramError("Instagram didn't say the Reel went out.", null, null);
      const back = await call(fetchImpl, "GET", mediaId, token, { fields: "permalink" }).catch(() => ({}) as Record<string, unknown>);
      return { containerId, mediaId, permalink: typeof back.permalink === "string" ? back.permalink : null };
    },

    async stats(mediaId) {
      const base = await call(fetchImpl, "GET", mediaId, token, { fields: "like_count,comments_count,permalink" });
      const out: MediaStats = { likes: n(base.like_count), comments: n(base.comments_count), reach: null, saves: null, shares: null, views: null, permalink: typeof base.permalink === "string" ? base.permalink : null };
      // Insights need instagram_business_manage_insights; without it the counts above still show.
      const insights = await call(fetchImpl, "GET", `${mediaId}/insights`, token, { metric: "reach,saved,shares,views" }).catch(() => null);
      for (const m of (insights?.data as { name?: string; values?: { value?: unknown }[] }[] | undefined) ?? []) {
        const v = n(m.values?.[0]?.value);
        if (m.name === "reach") out.reach = v;
        if (m.name === "saved") out.saves = v;
        if (m.name === "shares") out.shares = v;
        if (m.name === "views") out.views = v;
      }
      return out;
    },
  };
}

export type TokenState = { token: string; expiresAt: string | null; refreshed: boolean };

/**
 * The token to use: the stored (refreshed) one if it came from the secret
 * that's pasted now, else the pasted one. Refreshes it when it's a week old,
 * so it never reaches its 60 days. Null when no token is set up.
 */
export async function currentToken(vault: Vault, opts: { fetchImpl?: Fetch; now?: Date; log?: (m: string) => void } = {}): Promise<TokenState | null> {
  const pasted = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!pasted) return null;
  const now = opts.now ?? new Date();
  const seed = seedOf(pasted);
  const stored = await vault.storedToken().catch(() => null);
  let token = stored && stored.seed === seed ? stored.token : pasted;
  let expiresAt = stored && stored.seed === seed ? stored.expiresAt : null;
  const refreshedAt = stored && stored.seed === seed ? Date.parse(stored.refreshedAt) : 0;
  if (!stored || stored.seed !== seed) await vault.saveToken(token, seed, null, now);
  // Only Instagram Login tokens refresh this way; a Facebook system-user token doesn't expire.
  if (host() !== "graph.instagram.com" || now.getTime() - refreshedAt < 7 * DAY_MS) return { token, expiresAt, refreshed: false };
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(30_000) });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!res.ok || !json.access_token) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    token = json.access_token;
    const expires = json.expires_in ? new Date(now.getTime() + json.expires_in * 1000) : null;
    expiresAt = expires?.toISOString() ?? null;
    await vault.saveToken(token, seed, expires, now);
    await vault.logAction({ kind: "token_refreshed", summary: `Refreshed the Instagram token${expiresAt ? `; good until ${expiresAt.slice(0, 10)}` : ""}.`, onInstagram: false }, now);
    opts.log?.(`Refreshed the Instagram token${expiresAt ? `; good until ${expiresAt.slice(0, 10)}` : ""}.`);
    return { token, expiresAt, refreshed: true };
  } catch (err) {
    // A brand-new token can't be refreshed for a day; the next run tries again.
    opts.log?.(`Couldn't refresh the Instagram token: ${err instanceof Error ? err.message : String(err)}`);
    return { token, expiresAt, refreshed: false };
  }
}
