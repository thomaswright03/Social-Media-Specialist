import { describe, expect, it } from "vitest";
import { shortTags, shortTitle, youtubeClient, youtubeCreds, youtubeOn, YT_TITLE_MAX } from "../src/youtube.ts";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const creds = { clientId: "cid", clientSecret: "secret", refreshToken: "rt" };

describe("YouTube Shorts", () => {
  it("is off until the client id, secret and refresh token are all set and YOUTUBE_CROSSPOST is on (waiting for Google's audit)", () => {
    expect(youtubeCreds({ YOUTUBE_CLIENT_ID: "a", YOUTUBE_CLIENT_SECRET: "b" })).toBeNull();
    const env = { YOUTUBE_CLIENT_ID: " a ", YOUTUBE_CLIENT_SECRET: "b", YOUTUBE_REFRESH_TOKEN: "c\n" };
    expect(youtubeCreds(env)).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
    expect(youtubeOn(env)).toBe(false);
    expect(youtubeOn({ ...env, YOUTUBE_CROSSPOST: " On " })).toBe(true);
    expect(youtubeOn({ ...env, YOUTUBE_CROSSPOST: "off" })).toBe(false);
    expect(youtubeOn({ YOUTUBE_CROSSPOST: "on" })).toBe(false);
  });

  it("titles a Short with its headline and #Shorts, within 100 characters, and tags it with the hashtags", () => {
    expect(shortTitle("Which colour wins?")).toBe("Which colour wins? #Shorts");
    const long = shortTitle("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(YT_TITLE_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(shortTags(["#AI", "#news", "#AI", "#"])).toEqual(["AI", "news"]);
  });

  it("signs in with the refresh token, starts a resumable upload as public, then sends the bytes", async () => {
    const calls: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body instanceof Blob ? await init.body.text() : String(init?.body ?? "");
      calls.push({ url, method: init?.method ?? "GET", body, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "AT", expires_in: 3600 });
      if (url.includes("uploadType=resumable")) return json({}, 200, { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1" });
      if (url.includes("upload_id=U1")) return json({ id: "vid1", status: { privacyStatus: "private" } });
      return json({ error: { message: "unexpected" } }, 500);
    }) as typeof fetch;
    const r = await youtubeClient(creds, { fetchImpl }).uploadShort(new TextEncoder().encode("VIDEO"), { title: "Hi", description: "About it", tags: ["#AI"] });
    expect(r).toEqual({ videoId: "vid1", url: "https://www.youtube.com/shorts/vid1", privacy: "private" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "POST", "PUT"]);
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
    const meta = JSON.parse(calls[1]!.body);
    expect(meta).toMatchObject({ snippet: { title: "Hi #Shorts", description: "About it", tags: ["AI"] }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } });
    expect(calls[1]!.headers.Authorization).toBe("Bearer AT");
    expect(calls[2]!.body).toBe("VIDEO");
  });

  it("says plainly when Google refuses the sign-in, and never sends the video then", async () => {
    let uploads = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      uploads++;
      return json({});
    }) as typeof fetch;
    await expect(youtubeClient(creds, { fetchImpl }).uploadShort(new Uint8Array([1]), { title: "Hi", description: "", tags: [] })).rejects.toThrow(/invalid_grant: Token has been expired or revoked/);
    expect(uploads).toBe(0);
  });

  it("reads the channel", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "AT" });
      return json({ items: [{ id: "UC1", snippet: { title: "Wright AI Solutions", customUrl: "@wrightaisolutions" }, statistics: { subscriberCount: "3", videoCount: "0", viewCount: "12" } }] });
    }) as typeof fetch;
    expect(await youtubeClient(creds, { fetchImpl }).channel()).toEqual({ id: "UC1", title: "Wright AI Solutions", handle: "@wrightaisolutions", subscribers: 3, videos: 0, views: 12 });
  });
});
