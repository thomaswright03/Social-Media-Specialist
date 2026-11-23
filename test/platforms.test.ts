import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { FacebookPageClient } from "../src/facebook.ts";
import type { InstagramClient } from "../src/instagram.ts";
import { PLATFORMS_ROW, platformsReport, refreshPlatforms } from "../src/platforms.ts";
import { Vault } from "../src/vault.ts";
import type { YouTubeClient } from "../src/youtube.ts";

const NOW = new Date("2026-11-23T15:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const ig = {
  async account() {
    return { id: "1", username: "wrightaisolutionsllc", followers: 120, posts: 40 };
  },
  async listMedia() {
    const m = (id: string, days: number, likes: number) => ({ id, caption: null, mediaType: "VIDEO", productType: "REELS", timestamp: ago(days), permalink: null, mediaUrl: null, thumbnailUrl: null, likes, comments: 1 });
    return [m("a", 1, 5), m("b", 3, 2), m("old", 9, 100)];
  },
  async reelInsights(id: string) {
    return { views: id === "a" ? 300 : 100, reach: 50, likes: null, comments: null, saves: null, shares: 1, totalInteractions: null, avgWatchSeconds: null, totalWatchSeconds: null, skipRate: null };
  },
  async recentFollows() {
    return 7;
  },
} as unknown as InstagramClient;

const pageInfo = { id: "p", name: "Wright AI Solutions LLC", followers: 3, likes: 2, link: "https://www.facebook.com/WrightAISolutions", instagramId: "1" };
const page = {
  async info() {
    return pageInfo;
  },
  async performance() {
    return { info: pageInfo, posts: 4, reels: 4, reelViews: 30, reactions: 2, comments: 0, reach: 90, engagements: 6 };
  },
} as unknown as FacebookPageClient;

const yt = {
  async channel() {
    return { id: "UC1", title: "Wright AI Solutions", handle: "@wrightaisolutions", subscribers: 0, videos: 2, views: 11 };
  },
} as unknown as YouTubeClient;

const stat = (p: { stats: { label: string; value: number | null }[] }, label: string) => p.stats.find((s) => s.label === label)?.value;

describe("platforms report", () => {
  it("reads each platform, read only, with the last 7 days", async () => {
    const r = await platformsReport({ ig, page, youtube: yt, youtubeOn: false, now: NOW });
    expect(r.platforms.map((p) => [p.id, p.connected])).toEqual([["instagram", true], ["facebook", true], ["youtube", true], ["tiktok", false]]);
    const [i, f, y, t] = r.platforms;
    expect([stat(i!, "Followers"), stat(i!, "Posts, last 7 days"), stat(i!, "Reel views, last 7 days"), stat(i!, "Likes, last 7 days"), stat(i!, "New followers, last 28 days")]).toEqual([120, 2, 400, 7, 7]);
    expect(i!.url).toBe("https://www.instagram.com/wrightaisolutionsllc/");
    expect([stat(f!, "Followers"), stat(f!, "Reel plays, last 7 days"), stat(f!, "People reached, last 28 days")]).toEqual([3, 30, 90]);
    expect(y!.status).toContain("waits for Google's API audit");
    expect(y!.url).toBe("https://www.youtube.com/@wrightaisolutions");
    expect(stat(y!, "Views in all")).toBe(11);
    expect(t!.status).toContain("Not set up yet");
  });

  it("says why a platform isn't connected instead of failing", async () => {
    const broken = { async channel() { throw new Error("invalid_grant"); } } as unknown as YouTubeClient;
    const r = await platformsReport({ ig: null, igError: "token expired", page: null, youtube: broken, youtubeOn: true, now: NOW });
    expect(r.platforms[0]!.status).toBe("Not connected: token expired");
    expect(r.platforms[1]!.connected).toBe(false);
    expect(r.platforms[2]!.status).toContain("invalid_grant");
  });

  it("saves to the Vault every few hours, or now when forced", async () => {
    const db = createClient({ url: ":memory:" });
    await db.execute(`CREATE TABLE "Product" ("id" TEXT PRIMARY KEY, "name" TEXT, "description" TEXT, "url" TEXT, "status" TEXT)`);
    const vault = new Vault(db);
    let reads = 0;
    const deps = async () => (reads++, { ig, page, youtube: yt, youtubeOn: true });
    expect(await refreshPlatforms(vault, deps, { now: NOW })).toBe(true);
    expect(await refreshPlatforms(vault, deps, { now: new Date(NOW.getTime() + 3600_000) })).toBe(false);
    expect(await refreshPlatforms(vault, deps, { now: new Date(NOW.getTime() + 3600_000), force: true })).toBe(true);
    expect(await refreshPlatforms(vault, deps, { now: new Date(NOW.getTime() + 5 * 3600_000) })).toBe(true);
    expect(reads).toBe(3);
    const row = await vault.statusRow(PLATFORMS_ROW);
    expect(JSON.parse(row!.snapshot).platforms[2].status).toContain("also uploaded as a Short");
  });
});
