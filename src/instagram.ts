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

export type InstagramClient = {
  account(): Promise<Account>;
  publishImage(imageUrl: string, caption: string): Promise<{ containerId: string; mediaId: string; permalink: string | null }>;
  stats(mediaId: string): Promise<MediaStats>;
};

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
    opts.log?.(`Refreshed the Instagram token${expiresAt ? `; good until ${expiresAt.slice(0, 10)}` : ""}.`);
    return { token, expiresAt, refreshed: true };
  } catch (err) {
    // A brand-new token can't be refreshed for a day; the next run tries again.
    opts.log?.(`Couldn't refresh the Instagram token: ${err instanceof Error ? err.message : String(err)}`);
    return { token, expiresAt, refreshed: false };
  }
}
