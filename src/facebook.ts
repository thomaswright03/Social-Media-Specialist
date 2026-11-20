// The Facebook Page ("Wright AI Solutions LLC"), through the same Facebook
// token as Instagram (Facebook login). It reads the Page and its posts, and
// writes only when called: publishDue cross-posts a post Thomas approved
// (FACEBOOK_CROSSPOST=off turns that off), a Reel as a Page Reel. Every write is logged by its
// caller through vault.logAction.
import { call, FB_HOST, findPage, GRAPH_VERSION, graphHost, InstagramError, RUPLOAD_HOST } from "./instagram.ts";

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
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const total = (v: unknown) => n((v as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count);

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
    if (page.id === pageId && page.accessToken) pageToken = page.accessToken;
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
