// The Facebook Page ("Wright AI Solutions LLC"), through the same Facebook
// token as Instagram (Facebook login). It reads the Page and its posts, and
// writes only when called: publishDue cross-posts a post Thomas approved
// (FACEBOOK_CROSSPOST=off turns that off), a Reel as a Page Reel. Every write is logged by its
// caller through vault.logAction.
import { call, FB_HOST, findPage, GRAPH_VERSION, graphHost, InstagramError, RUPLOAD_HOST } from "./instagram.ts";
import { maskInLogs } from "./mask.ts";

type Fetch = typeof fetch;

export type PageInfo = { id: string; name: string; followers: number | null; likes: number | null; link: string | null; instagramId: string | null };
export type PagePost = { id: string; message: string | null; createdAt: string; permalink: string | null; reactions: number | null; comments: number | null; shares: number | null };
export type PageComment = { id: string; from: string | null; message: string; createdAt: string };

export type FacebookPageClient = {
  info(): Promise<PageInfo>;
  /** The Page's posts, newest first. */
  posts(max?: number): Promise<PagePost[]>;
  /** A photo post from a public image URL. */
  publishPhoto(imageUrl: string, message: string): Promise<{ postId: string; permalink: string | null }>;
  /** A video post from a public video URL. */
  publishVideo(videoUrl: string, description: string): Promise<{ videoId: string; permalink: string | null }>;
  /** A Page Reel uploaded from the video's bytes (Facebook's video_reels start, upload, finish). */
  publishReelFile?(video: Uint8Array, description: string): Promise<{ videoId: string; permalink: string | null }>;
  comments(objectId: string): Promise<PageComment[]>;
  reply(objectId: string, message: string): Promise<{ id: string }>;
  /** Everything an audit of the Page looks at, read only (Thomas, 2026-11-21: "do an audit of the facebook page"). */
  audit?(): Promise<PageAudit>;
};

export type PageAudit = {
  /** Each profile field Facebook gave, or the reason it didn't. */
  profile: Record<string, unknown>;
  posts: PagePost[];
  reels: { id: string; description: string | null; createdAt: string; permalink: string | null; views: number | null }[];
  /** Page insights over the last 28 days, by metric; null where Facebook gave none. */
  insights: Record<string, number | null>;
  errors: string[];
};

/** The Page fields an audit reads, one at a time so one Facebook refuses doesn't hide the rest. */
export const AUDIT_FIELDS = [
  "name", "username", "link", "category", "category_list", "about", "description", "general_info", "mission", "company_overview", "founded",
  "website", "emails", "phone", "whatsapp_number", "single_line_address", "location", "hours", "price_range", "is_published", "is_verified",
  "verification_status", "followers_count", "fan_count", "rating_count", "overall_star_rating", "picture.type(large){url,is_silhouette}",
  "cover{source}", "instagram_business_account{username}", "call_to_actions{type,status,web_url}", "has_added_app", "can_post", "is_messenger_platform_bot", "messenger_ads_default_icebreakers", "new_like_count", "talking_about_count", "were_here_count",
];
/** Page insights worth a look; Facebook has retired some, so each is asked on its own. */
export const AUDIT_METRICS = ["page_impressions_unique", "page_post_engagements", "page_follows", "page_daily_follows_unique", "page_views_total", "page_video_views", "page_media_view"];

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const total = (v: unknown) => n((v as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count);

/**
 * A Page post's text: the caption, then the website as a link Facebook makes clickable (Thomas, 2026-11-21: "i
 * also want a link to the website as a clickable popup at the bottom of every post"). Instagram makes no caption
 * link clickable, so only the Page gets it; Instagram keeps "Link in bio".
 */
export function pageText(caption: string, site: string): string {
  const link = site.replace(/\/+$/, "");
  const bare = link.replace(/^https?:\/\//, "");
  // A Page has no bio to point at (the 2026-11-21 audit): its "Link in bio" points at the link below instead.
  const text = caption.replace(/\blink in (?:the |our )?bio\b/gi, (m) => (m[0] === "L" ? "Link below" : "link below"));
  if (text.includes(bare)) return text;
  return `${text.trimEnd()}\n\n👉 ${link}`;
}

/** Cross-posting approved posts to the Page is on unless FACEBOOK_CROSSPOST is "off". */
export const crosspostOn = () => (process.env.FACEBOOK_CROSSPOST?.trim().toLowerCase() ?? "") !== "off";

/** The Page client for a Facebook token; null for an Instagram-login token, which can't reach a Page. */
export function facebookPageClient(token: string, opts: { fetchImpl?: Fetch; pageId?: string } = {}): FacebookPageClient | null {
  if (graphHost(token) !== FB_HOST) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let pageId = opts.pageId ?? process.env.FACEBOOK_PAGE_ID?.trim() ?? "";
  let pageToken = token;
  let resolved = false;
  const get = (path: string, params: Record<string, string> = {}) => call(fetchImpl, "GET", path, pageToken, params, FB_HOST);
  const post = (path: string, params: Record<string, string>) => call(fetchImpl, "POST", path, pageToken, params, FB_HOST);

  async function id(): Promise<string> {
    if (resolved) return pageId;
    const page = await findPage(fetchImpl, token);
    if (!page) throw new InstagramError("The Facebook token doesn't reach any Page.", null, null);
    if (!pageId) pageId = page.id;
    // Page writes need the Page's own token.
    if (page.id === pageId && page.accessToken) {
      pageToken = page.accessToken;
      maskInLogs(pageToken);
    }
    resolved = true;
    return pageId;
  }

  return {
    async info() {
      const p = await get(await id(), { fields: "id,name,followers_count,fan_count,link,instagram_business_account" });
      const ig = (p.instagram_business_account as { id?: unknown } | undefined)?.id;
      return { id: String(p.id), name: String(p.name ?? ""), followers: n(p.followers_count), likes: n(p.fan_count), link: typeof p.link === "string" ? p.link : null, instagramId: ig ? String(ig) : null };
    },

    async posts(max = 50) {
      const page = await id();
      const out: PagePost[] = [];
      let after: string | null = null;
      while (out.length < max) {
        const r = await get(`${page}/posts`, { fields: "id,message,created_time,permalink_url,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)", limit: "50", ...(after ? { after } : {}) });
        for (const m of (r.data as Record<string, unknown>[] | undefined) ?? []) {
          out.push({
            id: String(m.id),
            message: typeof m.message === "string" ? m.message : null,
            createdAt: String(m.created_time ?? ""),
            permalink: typeof m.permalink_url === "string" ? m.permalink_url : null,
            reactions: total(m.reactions),
            comments: total(m.comments),
            shares: n((m.shares as { count?: unknown } | undefined)?.count),
          });
        }
        const paging = (r.paging as { cursors?: { after?: string }; next?: string } | undefined) ?? {};
        if (!paging.next || !paging.cursors?.after) break;
        after = paging.cursors.after;
      }
      return out.slice(0, max);
    },

    async audit() {
      const page = await id();
      const errors: string[] = [];
      const why = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160);
      const profile: Record<string, unknown> = {};
      for (const f of AUDIT_FIELDS) {
        const key = f.split(/[.{]/)[0]!;
        try {
          const r = await get(page, { fields: f });
          profile[key] = r[key] ?? null;
        } catch (err) {
          profile[key] = `(not readable: ${why(err)})`;
        }
      }
      const posts = await this.posts(25).catch((err) => (errors.push(`posts: ${why(err)}`), [] as PagePost[]));
      const reels: PageAudit["reels"] = [];
      try {
        const r = await get(`${page}/video_reels`, { fields: "id,description,created_time,permalink_url,video_insights.metric(blue_reels_play_count){values}", limit: "25" });
        for (const v of (r.data as Record<string, unknown>[] | undefined) ?? []) {
          const plays = ((v.video_insights as { data?: { values?: { value?: unknown }[] }[] } | undefined)?.data?.[0]?.values?.[0]?.value);
          const link = typeof v.permalink_url === "string" ? v.permalink_url : null;
          reels.push({ id: String(v.id), description: typeof v.description === "string" ? v.description : null, createdAt: String(v.created_time ?? ""), permalink: link && link.startsWith("/") ? `https://www.facebook.com${link}` : link, views: n(plays) });
        }
      } catch (err) {
        errors.push(`reels: ${why(err)}`);
      }
      const insights: Record<string, number | null> = {};
      for (const m of AUDIT_METRICS) {
        try {
          const r = await get(`${page}/insights`, { metric: m, period: "days_28" });
          const vals = ((r.data as { values?: { value?: unknown }[] }[] | undefined)?.[0]?.values ?? []).map((x) => n(x.value));
          insights[m] = vals.length ? vals[vals.length - 1]! : null;
        } catch (err) {
          insights[m] = null;
          errors.push(`insight ${m}: ${why(err)}`);
        }
      }
      return { profile, posts, reels, insights, errors };
    },

    async publishPhoto(imageUrl, message) {
      const r = await post(`${await id()}/photos`, { url: imageUrl, caption: message });
      const postId = String(r.post_id ?? r.id ?? "");
      if (!postId) throw new InstagramError("Facebook didn't say the post went out.", null, null);
      const back = await get(postId, { fields: "permalink_url" }).catch(() => ({}) as Record<string, unknown>);
      return { postId, permalink: typeof back.permalink_url === "string" ? back.permalink_url : null };
    },

    async publishVideo(videoUrl, description) {
      const r = await post(`${await id()}/videos`, { file_url: videoUrl, description });
      const videoId = String(r.id ?? "");
      if (!videoId) throw new InstagramError("Facebook didn't say the video went out.", null, null);
      const back = await get(videoId, { fields: "permalink_url" }).catch(() => ({}) as Record<string, unknown>);
      const link = typeof back.permalink_url === "string" ? back.permalink_url : null;
      return { videoId, permalink: link && link.startsWith("/") ? `https://www.facebook.com${link}` : link };
    },

    async publishReelFile(video, description) {
      const page = await id();
      const start = await post(`${page}/video_reels`, { upload_phase: "start" });
      const videoId = String(start.video_id ?? "");
      if (!videoId) throw new InstagramError("Facebook didn't start the Reel upload.", null, null);
      const uri = typeof start.upload_url === "string" && start.upload_url.startsWith(`https://${RUPLOAD_HOST}/`) ? start.upload_url : `https://${RUPLOAD_HOST}/video-upload/${GRAPH_VERSION}/${videoId}`;
      let res: Response;
      try {
        res = await fetchImpl(uri, { method: "POST", headers: { Authorization: `OAuth ${pageToken}`, offset: "0", file_size: String(video.byteLength) }, body: new Blob([video as Uint8Array<ArrayBuffer>]), signal: AbortSignal.timeout(5 * 60_000) });
      } catch (err) {
        throw new InstagramError(`The Reel upload didn't reach Facebook: ${err instanceof Error ? err.message : String(err)}`, null, null);
      }
      const up = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || up.error || up.success === false) throw new InstagramError(`Facebook didn't take the Reel upload: ${up.error?.message || `HTTP ${res.status}`}`, res.status, null);
      const done = await post(`${page}/video_reels`, { upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description });
      if (done.success === false) throw new InstagramError("Facebook didn't publish the Reel.", null, null);
      const back = await get(videoId, { fields: "permalink_url" }).catch(() => ({}) as Record<string, unknown>);
      const link = typeof back.permalink_url === "string" ? back.permalink_url : null;
      return { videoId, permalink: link && link.startsWith("/") ? `https://www.facebook.com${link}` : link };
    },

    async comments(objectId) {
      await id();
      const r = await get(`${objectId}/comments`, { fields: "id,from,message,created_time", limit: "100" });
      return ((r.data as Record<string, unknown>[] | undefined) ?? []).map((c) => ({
        id: String(c.id),
        from: typeof (c.from as { name?: unknown } | undefined)?.name === "string" ? String((c.from as { name: string }).name) : null,
        message: String(c.message ?? ""),
        createdAt: String(c.created_time ?? ""),
      }));
    },

    async reply(objectId, message) {
      await id();
      const r = await post(`${objectId}/comments`, { message });
      return { id: String(r.id ?? "") };
    },
  };
}
