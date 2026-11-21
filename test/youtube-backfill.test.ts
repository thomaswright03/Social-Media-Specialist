import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import type { InstagramClient, Media } from "../src/instagram.ts";
import { Vault } from "../src/vault.ts";
import { backfillYouTube, hashtagsIn, igTarget, skipped, titleFromCaption } from "../src/youtube-backfill.ts";
import { YouTubeError, type YouTubeClient } from "../src/youtube.ts";

const NOW = new Date("2026-11-21T22:00:00Z");

async function memoryVault(): Promise<Vault> {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  return vault;
}

const reel = (id: string, day: number, caption: string, extra: Partial<Media> = {}): Media => ({
  id, caption, mediaType: "VIDEO", productType: "REELS", timestamp: `2026-11-${String(day).padStart(2, "0")}T12:00:00+0000`,
  permalink: `https://www.instagram.com/reel/CODE${id}/`, mediaUrl: `https://cdn.example.com/${id}.mp4`, thumbnailUrl: null, likes: null, comments: null, ...extra,
});

const MEDIA: Media[] = [
  reel("3", 20, "Which colour wins? 👇\n\nPick yours. Link in bio\n#satisfying #physics"),
  reel("1", 10, "Pinned ad #ai"),
  { ...reel("img", 12, "A photo"), mediaType: "IMAGE", productType: "FEED" },
  reel("2", 15, "#news\nKiller robots stalled"),
];

const fakeIg = (): InstagramClient => ({
  account: async () => ({ id: "IG", username: "wright", followers: 5, posts: 4 }),
  publishImage: async () => {
    throw new Error("never");
  },
  stats: async () => ({ likes: null, comments: null, reach: null, saves: null, shares: null, views: null, permalink: null }),
  listMedia: async () => MEDIA,
});

const fakeYt = (fail: (title: string) => Error | null = () => null) => {
  const calls: { bytes: string; title: string; description: string; tags: string[] }[] = [];
  const client: YouTubeClient = {
    channel: async () => ({ id: "UC", title: "Wright AI Solutions", handle: null, subscribers: 0, videos: 0 }),
    async uploadShort(video, meta) {
      const e = fail(meta.title);
      if (e) throw e;
      calls.push({ bytes: Buffer.from(video).toString(), ...meta });
      return { videoId: `yt${calls.length}`, url: `https://www.youtube.com/shorts/yt${calls.length}`, privacy: "private" };
    },
  };
  return { client, calls };
};

const cdn = (async (input: RequestInfo | URL) => new Response(`BYTES-${String(input).split("/").pop()}`)) as typeof fetch;

describe("past Instagram Reels onto YouTube", () => {
  it("titles a Short from the caption's first line without hashtags, and keeps the hashtags as tags", () => {
    expect(titleFromCaption("#news\nKiller robots stalled #ai")).toBe("Killer robots stalled");
    expect(titleFromCaption(null)).toBe("Wright AI Solutions");
    expect(hashtagsIn("a #x b #y #x")).toEqual(["#x", "#y"]);
    expect(skipped(MEDIA[1]!, ["https://www.instagram.com/reel/CODE1/"])).toBe(true);
    expect(skipped(MEDIA[1]!, ["CODE1"])).toBe(true);
    expect(skipped(MEDIA[1]!, ["1"])).toBe(true);
    expect(skipped(MEDIA[0]!, ["CODE1"])).toBe(false);
  });

  it("only lists without go, oldest first, Reels only, leaving out the ones to skip", async () => {
    const vault = await memoryVault();
    const yt = fakeYt();
    const r = await backfillYouTube({ vault, ig: fakeIg(), yt: yt.client, log: () => {}, skip: ["CODE1"], go: false, fetchImpl: cdn, now: NOW });
    expect(r.planned.map((m) => m.id)).toEqual(["2", "3"]);
    expect(yt.calls).toHaveLength(0);
    expect(await vault.actions()).toHaveLength(0);
  });

  it("uploads each once with the Page's caption and link, logs it, and never sends one twice", async () => {
    const vault = await memoryVault();
    const yt = fakeYt();
    const r = await backfillYouTube({ vault, ig: fakeIg(), yt: yt.client, log: () => {}, skip: ["CODE1"], go: true, fetchImpl: cdn, now: NOW });
    expect(r.uploaded).toHaveLength(2);
    expect(yt.calls.map((c) => [c.bytes, c.title])).toEqual([["BYTES-2.mp4", "Killer robots stalled"], ["BYTES-3.mp4", "Which colour wins? 👇"]]);
    expect(yt.calls[1]!.description).toBe("Which colour wins? 👇\n\nPick yours. Link below\n#satisfying #physics\n\n👉 https://wright-ai-solutions.com");
    expect(yt.calls[1]!.tags).toEqual(["#satisfying", "#physics"]);
    const logged = await vault.actions();
    expect(logged.map((a) => a.target).sort()).toEqual([igTarget("2"), igTarget("3")]);
    expect(logged.every((a) => a.kind === "posted" && /YouTube/.test(a.summary))).toBe(true);
    const again = await backfillYouTube({ vault, ig: fakeIg(), yt: yt.client, log: () => {}, skip: ["CODE1"], go: true, fetchImpl: cdn, now: NOW });
    expect(again.planned).toHaveLength(0);
    expect(again.already).toBe(2);
    expect(yt.calls).toHaveLength(2);
  });

  it("uploads nothing while the specialist is paused (security check, 2026-11-21)", async () => {
    const vault = await memoryVault();
    await vault.saveSettings({ paused: true });
    const yt = fakeYt();
    const r = await backfillYouTube({ vault, ig: fakeIg(), yt: yt.client, log: () => {}, skip: [], go: true, fetchImpl: cdn, now: NOW });
    expect(r.uploaded).toHaveLength(0);
    expect(yt.calls).toHaveLength(0);
    expect(await vault.actions()).toHaveLength(0);
  });

  it("skips a Reel publishDue already sent to YouTube", async () => {
    const vault = await memoryVault();
    const post = await vault.addPost({ productId: null, productName: null, ideaId: null, kind: "reel", angle: "Reel", headline: "Robots", subline: null, caption: "c", hashtags: [], theme: "ink", sourceUrl: "repo:posts/reels/a.mp4" }, Buffer.from([1]), NOW);
    await vault.updatePost(post.id, { state: "published", igMediaId: "2" }, NOW);
    await vault.logAction({ kind: "posted", summary: `Posted the Reel "Robots" to YouTube as a Short.`, target: post.id }, NOW);
    // A title that mentions YouTube doesn't count as being on YouTube.
    await vault.logAction({ kind: "posted", summary: `Posted the Reel "YouTube may pay schools" to Instagram.`, target: igTarget("3") }, NOW);
    const yt = fakeYt();
    const r = await backfillYouTube({ vault, ig: fakeIg(), yt: yt.client, log: () => {}, skip: ["CODE1"], go: true, fetchImpl: cdn, now: NOW });
    expect(r.uploaded.map((u) => u.media.id)).toEqual(["3"]);
  });

  it("records a refusal and never retries it, and stops without marking anything when the daily allowance runs out", async () => {
    const vault = await memoryVault();
    const refused = fakeYt((t) => (t === "Killer robots stalled" ? new YouTubeError("YouTube didn't take the video: bad file", 400) : null));
    const r = await backfillYouTube({ vault, ig: fakeIg(), yt: refused.client, log: () => {}, skip: ["CODE1"], go: true, fetchImpl: cdn, now: NOW });
    expect(r.failed.map((f) => f.media.id)).toEqual(["2"]);
    expect(r.uploaded.map((u) => u.media.id)).toEqual(["3"]);
    const again = await backfillYouTube({ vault, ig: fakeIg(), yt: fakeYt().client, log: () => {}, skip: ["CODE1"], go: true, fetchImpl: cdn, now: NOW });
    expect(again.planned).toHaveLength(0);

    const fresh = await memoryVault();
    const quota = fakeYt(() => new YouTubeError("YouTube didn't start the upload: The request cannot be completed because you have exceeded your quota.", 403));
    const q = await backfillYouTube({ vault: fresh, ig: fakeIg(), yt: quota.client, log: () => {}, skip: [], go: true, fetchImpl: cdn, now: NOW });
    expect(q.stoppedForQuota).toBe(true);
    expect(await fresh.actions()).toHaveLength(0);
    const later = await backfillYouTube({ vault: fresh, ig: fakeIg(), yt: fakeYt().client, log: () => {}, skip: [], go: false, fetchImpl: cdn, now: NOW });
    expect(later.planned).toHaveLength(3);
  });
});
