import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { discoverAccount, type DiscoveredAccount, type Media } from "../src/instagram.ts";
import { cutsFrom, gateResearchMeasured, pickReels, postsPerWeek, runResearch, soundShareFrom, withMeasured, type MeasuredReel } from "../src/pipeline/research.ts";
import { Vault } from "../src/vault.ts";

const NOW = new Date("2026-11-11T20:00:00Z");

async function memoryVault(): Promise<Vault> {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  return vault;
}

const reel = (acc: string, i: number, likes: number, daysAgo = i): Media => ({
  id: `${acc}-${i}`,
  caption: `${acc} reel ${i}`,
  mediaType: "VIDEO",
  productType: "REELS",
  timestamp: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  permalink: `https://www.instagram.com/reel/${acc}${i}/`,
  mediaUrl: `https://cdn.example/${acc}${i}.mp4`,
  thumbnailUrl: null,
  likes,
  comments: 1,
});

const account = (username: string, count: number): DiscoveredAccount => ({ username, followers: 1000, posts: count, media: Array.from({ length: count }, (_, i) => reel(username, i, 100 - i)) });

describe("stage 1 helpers", () => {
  it("counts posts a week over what was fetched", () => {
    expect(postsPerWeek([reel("a", 0, 1, 0), reel("a", 1, 1, 14)], NOW)).toBe(1);
    expect(postsPerWeek([reel("a", 0, 1, 0)], NOW)).toBeNull();
  });

  it("picks each account's best Reels in turns, at most 20", () => {
    const picked = pickReels([account("a", 30), account("b", 3)]);
    expect(picked).toHaveLength(20);
    expect(picked.slice(0, 2).map((p) => p.media.id)).toEqual(["a-0", "b-0"]);
    expect(picked.filter((p) => p.account.username === "b")).toHaveLength(3);
  });

  it("reads cuts and sound from ffmpeg's output", () => {
    expect(cutsFrom("pts_time:1.0\npts_time:2.0\npts_time:3.0\npts_time:4.0", 20)).toBe(2);
    expect(soundShareFrom("silence_start: 0\nsilence_end: 2 | silence_duration: 2", 10)).toBe(0.8);
    expect(soundShareFrom("silence_start: 5", 10)).toBe(0.5);
    expect(soundShareFrom("", 10)).toBe(1);
  });

  const measured: MeasuredReel[] = Array.from({ length: 15 }, (_, i) => ({ url: `https://x/${i}`, account: "a", postedAt: "2026-11-01", caption: "", views: null, likes: 50 + i, comments: 2, lengthSeconds: 30, cutsPerTenSeconds: 3, soundShare: 0.9, postsPerWeek: 4, frames: `reel-${i}.jpg` }));

  it("puts the measured numbers back over Claude's copies", () => {
    const r = withMeasured({ reels: [{ url: "https://x/0", likes: 9999, lengthSeconds: 1, first2s: "f", art: "a", onScreenText: "t" }] }, measured)!;
    expect(r.reels![0]).toMatchObject({ likes: 50, lengthSeconds: 30, cutsPerTenSeconds: 3, postsPerWeek: 4, voice: "sound for 90% of it" });
    expect(r.reels![0]!.commentThemes).toContain("2 comments");
  });

  it("fails a Reel that wasn't looked up, passes a full answer", () => {
    const full = measured.map((m) => ({ url: m.url, first2s: "a stick figure falls", art: "stick figures", onScreenText: "big caption" }));
    const ok = gateResearchMeasured({ reels: full, patterns: [{ pattern: "falls in the first second", examples: full.slice(0, 3).map((x) => x.url) }] }, measured);
    expect(ok.passed).toBe(true);
    const bad = gateResearchMeasured({ reels: [...full.slice(1), { ...full[0]!, url: "https://made/up" }], patterns: [{ pattern: "p", examples: full.slice(1, 4).map((x) => x.url) }] }, measured);
    expect(bad.passed).toBe(false);
    expect(bad.checks[0]).toMatchObject({ passed: false, detail: expect.stringContaining("https://made/up") });
  });
});

describe("discoverAccount", () => {
  it("reads another account through Business Discovery", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ business_discovery: { username: "stickmanstorys22", followers_count: 5000, media_count: 2, media: { data: [{ id: "1", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-01T00:00:00+0000", permalink: "https://www.instagram.com/reel/1/", media_url: "https://cdn/1.mp4", like_count: 10, comments_count: 2 }] } } }), { status: 200 });
    }) as typeof fetch;
    const a = await discoverAccount(fetchImpl, "EAAx", "ig1", "https://www.instagram.com/stickmanstorys22/");
    expect(a).toMatchObject({ username: "stickmanstorys22", followers: 5000, media: [{ id: "1", likes: 10, comments: 2, productType: "REELS" }] });
    expect(decodeURIComponent(urls[0]!)).toContain("business_discovery.username(stickmanstorys22)");
    expect(urls[0]).toContain("graph.facebook.com");
  });

  it("refuses something that isn't a username", async () => {
    await expect(discoverAccount(fetch, "EAAx", "ig1", "not a name!")).rejects.toThrow("isn't an Instagram username");
  });
});

describe("runResearch", () => {
  const discover = async (_f: typeof fetch, _t: string, _ig: string, name: string) => account(name, 10);

  it("needs 15 Reels before asking Claude", async () => {
    const vault = await memoryVault();
    let asked = false;
    const r = await runResearch({ vault, token: "EAAx", igUserId: "ig1", accounts: ["a"], discover, ask: async () => ((asked = true), "{}"), now: () => NOW });
    expect(r.passed).toBe(false);
    expect(r.problem).toContain("Only 10 Reels");
    expect(asked).toBe(false);
  });

  it("measures each Reel, passes the gate, and saves the patterns as lessons", async () => {
    const vault = await memoryVault();
    const answer = (prompt: string) => {
      const urls = [...prompt.matchAll(/"url": "([^"]+)"/g)].map((m) => m[1]!);
      return JSON.stringify({ reels: urls.map((url) => ({ url, likes: 1, first2s: "falls", art: "stick", onScreenText: "caption" })), patterns: [{ pattern: "Something goes wrong in the first second", examples: urls.slice(0, 3) }] });
    };
    const r = await runResearch({
      vault,
      token: "EAAx",
      igUserId: "ig1",
      accounts: ["a", "b"],
      discover,
      probe: async () => 30,
      measure: async (_u, _s, _d, name) => ({ cutsPerTenSeconds: 2, soundShare: 1, frames: `${name}.jpg` }),
      ask: async (p) => answer(p),
      now: () => NOW,
    });
    expect(r.passed).toBe(true);
    expect(r.measured).toHaveLength(20);
    expect(r.research!.reels![0]!.likes).toBe(100);
    const lessons = await vault.lessons("pattern");
    expect(lessons.map((l) => l.text)).toEqual(["Something goes wrong in the first second"]);
  });
});
