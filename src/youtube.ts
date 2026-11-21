// YouTube Shorts (Thomas, 2026-11-21: "what about getting a tiktok and youtube
// shorts and wiring the ai up to those"). The channel is youtube.com/@WrightAISolutions.
// It writes only when publishDue cross-posts a Reel Thomas approved, the same
// rule as the Facebook Page: a refusal is logged and never retried, and
// nothing else uploads. A vertical video under 3 minutes becomes a Short.
//
// Until Google audits the API project, YouTube locks every API upload as
// private (it can't be made public by hand), so the Short only shows once the
// audit passes. Thomas chose to wait for it (2026-11-21), so nothing uploads
// until the repository variable YOUTUBE_CROSSPOST is "on".

type Fetch = typeof fetch;

import { maskInLogs } from "./mask.ts";

export const YT_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YT_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
export const YT_API = "https://www.googleapis.com/youtube/v3";
/** YouTube's longest title. */
export const YT_TITLE_MAX = 100;
/** Science & Technology. */
export const YT_CATEGORY = "28";

export type YouTubeChannel = { id: string; title: string; handle: string | null; subscribers: number | null; videos: number | null };
export type YouTubeUpload = { videoId: string; url: string; privacy: string | null };

export type YouTubeClient = {
  channel(): Promise<YouTubeChannel>;
  /** Uploads the video as a public Short (YouTube keeps it private until the API audit passes). */
  uploadShort(video: Uint8Array, meta: { title: string; description: string; tags: string[] }): Promise<YouTubeUpload>;
};

export class YouTubeError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "YouTubeError";
  }
}

export type YouTubeCreds = { clientId: string; clientSecret: string; refreshToken: string };

/** The OAuth client and refresh token from the environment, or null while any is missing. */
export function youtubeCreds(env: NodeJS.ProcessEnv = process.env): YouTubeCreds | null {
  const clientId = env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = env.YOUTUBE_CLIENT_SECRET?.trim();
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

/**
 * Reels go to YouTube only once it's set up and YOUTUBE_CROSSPOST is "on". Thomas chose to wait for Google's
 * audit (2026-11-21: uploads until then are locked private), so it's off until he says it passed.
 */
export const youtubeOn = (env: NodeJS.ProcessEnv = process.env) => youtubeCreds(env) !== null && env.YOUTUBE_CROSSPOST?.trim().toLowerCase() === "on";

/** A Short's title: the headline, cut at a word to fit YouTube's 100 characters, with #Shorts when it fits. */
export function shortTitle(headline: string): string {
  const base = headline.replace(/\s+/g, " ").trim();
  const withTag = `${base} #Shorts`;
  if (withTag.length <= YT_TITLE_MAX) return withTag;
  if (base.length <= YT_TITLE_MAX) return base;
  const cut = base.slice(0, YT_TITLE_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}

/** YouTube tags: the hashtags without "#", within its 500-character limit. */
export function shortTags(hashtags: string[]): string[] {
  const out: string[] = [];
  let len = 0;
  for (const h of hashtags) {
    const t = h.replace(/^#/, "").trim();
    if (!t || out.includes(t)) continue;
    if (len + t.length + 1 > 450) break;
    out.push(t);
    len += t.length + 1;
  }
  return out;
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string; error_description?: string } | null;
  const e = body?.error;
  return (typeof e === "string" ? `${e}${body?.error_description ? `: ${body.error_description}` : ""}` : e?.message) || `HTTP ${res.status}`;
}

export function youtubeClient(creds: YouTubeCreds, opts: { fetchImpl?: Fetch } = {}): YouTubeClient {
  const f = opts.fetchImpl ?? fetch;
  let access: { token: string; until: number } | null = null;

  async function token(): Promise<string> {
    if (access && access.until > Date.now() + 60_000) return access.token;
    const res = await f(YT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new YouTubeError(`Google refused the YouTube sign-in: ${await errorText(res)}. The refresh token may need replacing (README, "YouTube").`, res.status);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new YouTubeError("Google gave no YouTube access token.", res.status);
    maskInLogs(json.access_token);
    access = { token: json.access_token, until: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return access.token;
  }

  return {
    async channel() {
      const res = await f(`${YT_API}/channels?part=snippet,statistics&mine=true`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!res.ok) throw new YouTubeError(`YouTube didn't return the channel: ${await errorText(res)}`, res.status);
      const json = (await res.json()) as { items?: { id: string; snippet?: { title?: string; customUrl?: string }; statistics?: { subscriberCount?: string; videoCount?: string } }[] };
      const c = json.items?.[0];
      if (!c) throw new YouTubeError("This Google account has no YouTube channel.", res.status);
      const num = (v?: string) => (v === undefined ? null : Number(v));
      return { id: c.id, title: c.snippet?.title ?? "", handle: c.snippet?.customUrl ?? null, subscribers: num(c.statistics?.subscriberCount), videos: num(c.statistics?.videoCount) };
    },

    async uploadShort(video, meta) {
      const auth = `Bearer ${await token()}`;
      const start = await f(`${YT_UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(video.byteLength) },
        body: JSON.stringify({
          snippet: { title: shortTitle(meta.title), description: meta.description.slice(0, 4900), tags: shortTags(meta.tags), categoryId: YT_CATEGORY },
          status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
        }),
      });
      if (!start.ok) throw new YouTubeError(`YouTube didn't start the upload: ${await errorText(start)}`, start.status);
      const uploadUrl = start.headers.get("location");
      if (!uploadUrl?.startsWith("https://www.googleapis.com/")) throw new YouTubeError("YouTube gave no upload address.", start.status);
      const res = await f(uploadUrl, { method: "PUT", headers: { Authorization: auth, "Content-Type": "video/mp4" }, body: new Blob([video as Uint8Array<ArrayBuffer>]), signal: AbortSignal.timeout(10 * 60_000) });
      if (!res.ok) throw new YouTubeError(`YouTube didn't take the video: ${await errorText(res)}`, res.status);
      const json = (await res.json()) as { id?: string; status?: { privacyStatus?: string } };
      if (!json.id) throw new YouTubeError("YouTube took the video but gave no id.", res.status);
      return { videoId: json.id, url: `https://www.youtube.com/shorts/${json.id}`, privacy: json.status?.privacyStatus ?? null };
    },
  };
}
