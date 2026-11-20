import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { facebookPageClient, type FacebookPageClient } from "../src/facebook.ts";
import type { InstagramClient } from "../src/instagram.ts";
import { addReelDrafts, parseReelDrafts, readReel, reelPath, REEL_DIR } from "../src/reel-drafts.ts";
import { publishDue } from "../src/social.ts";
import { Vault, vaultNow } from "../src/vault.ts";

const NOW = new Date("2026-11-20T21:00:00Z");

async function memoryVault(): Promise<Vault> {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  return vault;
}

async function repoWith(entries: unknown[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reels-"));
  await mkdir(join(root, REEL_DIR), { recursive: true });
  await writeFile(join(root, REEL_DIR, "a.mp4"), "VIDEO-A");
  await writeFile(join(root, REEL_DIR, "a.jpg"), "JPEG-A");
  await writeFile(join(root, REEL_DIR, "drafts.json"), JSON.stringify(entries));
  return root;
}

const ENTRY = { file: "a.mp4", cover: "a.jpg", headline: "Which colour wins?", caption: "Pick yours.", hashtags: ["#satisfying"] };

describe("Reel drafts from the repo", () => {
  it("adds each listed Reel once, as a draft waiting for Thomas, and logs it", async () => {
    const vault = await memoryVault();
    const root = await repoWith([ENTRY]);
    const first = await addReelDrafts({ vault, root, log: () => {}, now: NOW });
    expect(first.added).toHaveLength(1);
    expect(first.added[0]).toMatchObject({ kind: "reel", state: "draft", headline: "Which colour wins?", sourceUrl: "repo:posts/reels/a.mp4", hashtags: ["#satisfying"] });
    expect((await vault.actions()).map((a) => a.kind)).toEqual(["drafted"]);
    const again = await addReelDrafts({ vault, root, log: () => {}, now: NOW });
    expect(again).toMatchObject({ added: [], skipped: ["a.mp4"] });
    expect(await vault.posts()).toHaveLength(1);
  });

  it("refuses a list entry that's missing something or points outside posts/reels", () => {
    expect(() => parseReelDrafts([{ ...ENTRY, hashtags: ["satisfying"] }])).toThrow(/hashtags/);
    expect(() => parseReelDrafts([{ ...ENTRY, file: "../secret.mp4" }])).toThrow();
    expect(() => reelPath("repo:posts/reels/../../.env")).toThrow();
    expect(() => reelPath("https://example.com/a.mp4")).toThrow();
  });

  it("stops when a listed video isn't in the repo", async () => {
    const vault = await memoryVault();
    const root = await repoWith([{ ...ENTRY, file: "gone.mp4" }]);
    await expect(addReelDrafts({ vault, root, log: () => {}, now: NOW })).rejects.toThrow(/isn't in the repo/);
    expect(await vault.posts()).toHaveLength(0);
  });

  it("reads the video bytes from posts/reels", async () => {
    const root = await repoWith([ENTRY]);
    expect(Buffer.from(await readReel("repo:posts/reels/a.mp4", root)).toString()).toBe("VIDEO-A");
  });

  it("keeps the real list valid, with every video and cover in the repo", async () => {
    const list = parseReelDrafts(JSON.parse(await readFile(join(REEL_DIR, "drafts.json"), "utf8")));
    expect(list.length).toBeGreaterThan(0);
    for (const r of list) {
      await readFile(join(REEL_DIR, r.file));
      await readFile(join(REEL_DIR, r.cover));
    }
  });
});

describe("posting an approved Reel", () => {
  beforeEach(() => {
    process.env.INSTAGRAM_ACCESS_TOKEN = "IGTOKEN";
    process.env.INSTAGRAM_GRAPH_HOST = "graph.facebook.com";
    process.env.FACEBOOK_CROSSPOST = "on";
    delete process.env.VAULT_PUBLIC_URL; // a Reel doesn't need the Vault to serve anything
  });
  afterEach(() => {
    for (const k of ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_GRAPH_HOST", "FACEBOOK_CROSSPOST"]) delete process.env[k];
  });

  const fakeIg = (fail = false) => {
    const calls: { bytes: string; caption: string; opts: unknown }[] = [];
    const client: InstagramClient = {
      account: async () => ({ id: "1", username: "wright", followers: 10, posts: 1 }),
      publishImage: async () => {
        throw new Error("a Reel isn't an image");
      },
      async publishReelFile(video, caption, opts) {
        calls.push({ bytes: Buffer.from(video).toString(), caption, opts });
        if (fail) throw new Error("Instagram said: bad video");
        return { containerId: "c1", mediaId: "m1", permalink: "https://instagram.com/reel/x" };
      },
      stats: async () => ({ likes: null, comments: null, reach: null, saves: null, shares: null, views: null, permalink: null }),
    };
    return { client, calls };
  };

  const fakePage = (fail = false) => {
    const calls: { bytes: string; description: string }[] = [];
    const client: FacebookPageClient = {
      info: async () => ({ id: "pg", name: "Wright AI Solutions LLC", followers: 3, likes: 3, link: null, instagramId: "IG" }),
      posts: async () => [],
      publishPhoto: async () => {
        throw new Error("a Reel isn't a photo");
      },
      publishVideo: async () => {
        throw new Error("a Reel isn't uploaded from a link");
      },
      async publishReelFile(video, description) {
        calls.push({ bytes: Buffer.from(video).toString(), description });
        if (fail) throw new Error("Facebook said: no");
        return { videoId: "v1", permalink: "https://www.facebook.com/reel/v1" };
      },
      comments: async () => [],
      reply: async () => ({ id: "r" }),
    };
    return { client, calls };
  };

  async function reelPost(state: string) {
    const vault = await memoryVault();
    const root = await repoWith([ENTRY]);
    const [post] = (await addReelDrafts({ vault, root, log: () => {}, now: NOW })).added;
    if (state !== "draft") await vault.updatePost(post!.id, { state, scheduledFor: vaultNow(new Date(NOW.getTime() - 60_000)) });
    return { vault, post: post!, read: (s: string | null) => readReel(s, root) };
  }

  const hitta = async () => ({ ok: true, status: 201, message: "201" });

  it("never posts a draft Thomas hasn't approved", async () => {
    const { vault, read } = await reelPost("draft");
    const ig = fakeIg();
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => null, readReel: read, now: NOW });
    expect(r.skipped).toBe("nothing due");
    expect(ig.calls).toHaveLength(0);
  });

  it("uploads an approved Reel's video to Instagram and the Facebook Page, logs both, and never posts it twice", async () => {
    const { vault, post, read } = await reelPost("approved");
    const ig = fakeIg();
    const page = fakePage();
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => page.client, readReel: read, now: NOW });
    expect(r.published).toHaveLength(1);
    expect(ig.calls).toEqual([{ bytes: "VIDEO-A", caption: "Pick yours.\n\n#satisfying", opts: undefined }]);
    expect(page.calls).toEqual([{ bytes: "VIDEO-A", description: "Pick yours.\n\n#satisfying" }]);
    expect(await vault.post(post.id)).toMatchObject({ state: "published", igMediaId: "m1", permalink: "https://instagram.com/reel/x" });
    const history = (await vault.actions()).map((a) => a.summary);
    expect(history.some((h) => /Posted the Reel .* to Instagram/.test(h))).toBe(true);
    expect(history.some((h) => /Posted the Reel .* to the Facebook Page/.test(h))).toBe(true);
    await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => page.client, readReel: read, now: NOW });
    expect(ig.calls).toHaveLength(1);
    expect(page.calls).toHaveLength(1);
  });

  it("keeps the Instagram Reel when the Page refuses it, logs that, and never retries the Page", async () => {
    const { vault, post, read } = await reelPost("approved");
    const page = fakePage(true);
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => fakeIg().client, facebook: () => page.client, readReel: read, now: NOW });
    expect(r.published).toHaveLength(1);
    expect((await vault.post(post.id))!.state).toBe("published");
    expect((await vault.actions()).find((a) => a.kind === "post_failed")?.summary).toMatch(/Facebook Page refused/);
    await publishDue({ vault, hitta, log: () => {}, instagram: () => fakeIg().client, facebook: () => page.client, readReel: read, now: NOW });
    expect(page.calls).toHaveLength(1);
  });

  it("uploads a Page Reel in three steps: start, the bytes, then publish with the caption", async () => {
    const seen: { url: string; body: string }[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body instanceof Blob ? await init.body.text() : String(init?.body ?? "");
      seen.push({ url, body });
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (url.includes("/me?")) return json({ id: "pg", name: "Page", instagram_business_account: { id: "IG" } });
      if (url.includes("/video_reels") && body.includes("upload_phase=start")) return json({ video_id: "v9", upload_url: "https://rupload.facebook.com/video-upload/v23.0/v9" });
      if (url.startsWith("https://rupload.facebook.com/")) return json({ success: true });
      if (url.includes("/video_reels")) return json({ success: true });
      return json({ permalink_url: "/reel/v9" });
    }) as typeof fetch;
    const page = facebookPageClient("EAAtoken", { fetchImpl })!;
    const r = await page.publishReelFile!(new TextEncoder().encode("VIDEO"), "Hi #satisfying");
    expect(r).toEqual({ videoId: "v9", permalink: "https://www.facebook.com/reel/v9" });
    const upload = seen.find((s) => s.url.startsWith("https://rupload.facebook.com/"))!;
    expect(upload.body).toBe("VIDEO");
    const finish = seen.find((s) => s.body.includes("upload_phase=finish"))!;
    expect(finish.body).toContain("video_state=PUBLISHED");
    expect(finish.body).toContain("video_id=v9");
  });

  it("marks a refused Reel failed, logs it, and doesn't try again on its own", async () => {
    const { vault, post, read } = await reelPost("approved");
    const ig = fakeIg(true);
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => null, readReel: read, now: NOW });
    expect(r.failed).toHaveLength(1);
    expect((await vault.post(post.id))!.state).toBe("failed");
    expect((await vault.actions()).some((a) => a.kind === "post_failed")).toBe(true);
    await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => null, readReel: read, now: NOW });
    expect(ig.calls).toHaveLength(1);
  });
});
