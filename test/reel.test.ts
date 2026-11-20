import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { addUsage, claudeUsage, usageMark, usageSince, usageText } from "../src/claude-usage.ts";
import { instagramClient, type InstagramClient } from "../src/instagram.ts";
import { gate, check } from "../src/pipeline/gates.ts";
import type { IdeasResult } from "../src/pipeline/ideas.ts";
import type { ProduceResult } from "../src/pipeline/produce.ts";
import { reelAssets } from "../src/pipeline/produce.ts";
import { packageReel, runReel } from "../src/pipeline/reel.ts";
import type { ScriptResult } from "../src/pipeline/script.ts";
import { Vault } from "../src/vault.ts";

async function memoryVault(): Promise<Vault> {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  return vault;
}

const NOW = new Date("2026-11-20T16:00:00Z");
const shots = [
  { at: 0, dur: 2.5, onScreenText: "AI just did WHAT?" },
  { at: 2.5, dur: 3, onScreenText: "" },
];
const caption = "OpenAI shipped a model that books your flights.\nCredit: The Verge. Good idea or bad idea?\n#ai #tech #news #openai";

describe("stage 6 packaging", () => {
  it("adds a call to action before the hashtags, takes them as keywords and picks the first shot with text as the cover", () => {
    const p = packageReel({ format: "explainer", caption, shots, assets: [] });
    const lines = p.caption.split("\n");
    expect(lines[0]).toBe("OpenAI shipped a model that books your flights.");
    expect(lines[2]).toMatch(/^Follow/);
    expect(lines.at(-1)).toBe("#ai #tech #news #openai");
    expect(p.keywords).toEqual(["#ai", "#tech", "#news", "#openai"]);
    expect(p.coverAt).toBe(1);
    expect(p.coverText).toBe("AI just did WHAT?");
    expect(p.thumbOffsetMs).toBe(1000);
  });

  it("keeps a call to action that's already there", () => {
    const p = packageReel({ format: "ad", caption: "Your leads, found while you sleep.\nLink in bio\n#sales #leads #ai", shots, assets: [] });
    expect(p.caption).toBe("Your leads, found while you sleep.\nLink in bio\n#sales #leads #ai");
  });

  it("splits a long first line at its first sentence", () => {
    const long = `This is the hook. ${"And then a very long explanation that keeps going ".repeat(4)}\n#a #b #c`;
    const p = packageReel({ format: "satisfying", caption: long, shots, assets: [] });
    expect(p.caption.split("\n")[0]).toBe("This is the hook.");
  });

  it("has no cover when no shot has text", () => {
    const p = packageReel({ format: "satisfying", caption, shots: [{ at: 0, dur: 30 }], assets: [] });
    expect(p.coverAt).toBeNull();
    expect(p.thumbOffsetMs).toBeNull();
  });

  it("lists every source with a license", () => {
    const a = reelAssets({ voiced: 8, sfx: 3, physics: false, motion: true });
    expect(a.map((x) => x.kind)).toEqual(["voice", "sfx", "music", "art", "art", "art"]);
    expect(a.every((x) => x.source && x.license)).toBe(true);
    expect(reelAssets({ voiced: 0, sfx: 0, physics: true, motion: false }).some((x) => x.kind === "voice")).toBe(false);
  });
});

describe("Claude usage", () => {
  it("adds up each call's tokens and cost", () => {
    const mark = usageMark();
    addUsage({ usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 }, total_cost_usd: 0.05 });
    addUsage({ usage: { input_tokens: 10, output_tokens: 5 } });
    const u = usageSince(mark);
    expect(u).toMatchObject({ calls: 2, input: 1010, output: 505, cacheRead: 20_000 });
    expect(u.costUsd).toBeCloseTo(0.05);
    expect(usageText(u)).toBe("2 Claude calls, 22k tokens (505 written), about $0.05 at API prices");
    expect(claudeUsage.calls).toBeGreaterThanOrEqual(2);
  });
});

describe("Instagram resumable upload", () => {
  it("makes a resumable trial container, sends the bytes to rupload, then publishes", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.startsWith("https://rupload.facebook.com/")) return Response.json({ success: true });
      if (u.includes("/media_publish")) return Response.json({ id: "M1" });
      if (u.includes("/media") && init?.method === "POST") return Response.json({ id: "C1", uri: "https://rupload.facebook.com/ig-api-upload/v23.0/C1" });
      if (u.includes("/C1?")) return Response.json({ status_code: "FINISHED" });
      if (u.includes("/M1?")) return Response.json({ permalink: "https://instagram.com/reel/y" });
      return Response.json({});
    }) as typeof fetch;
    const ig = instagramClient("EAAtok", { fetchImpl, userId: "IG", pollMs: 0 });
    const r = await ig.publishReelFile!(new Uint8Array([1, 2, 3, 4]), "Hook", { trial: "MANUAL", thumbOffsetMs: 1000 });
    expect(r).toEqual({ containerId: "C1", mediaId: "M1", permalink: "https://instagram.com/reel/y" });
    const create = new URLSearchParams(String(calls[0]!.init!.body));
    expect(create.get("upload_type")).toBe("resumable");
    expect(create.get("video_url")).toBeNull();
    expect(JSON.parse(create.get("trial_params")!)).toEqual({ graduation_strategy: "MANUAL" });
    expect(create.get("thumb_offset")).toBe("1000");
    const up = calls[1]!;
    expect(up.url).toBe("https://rupload.facebook.com/ig-api-upload/v23.0/C1");
    const h = up.init!.headers as Record<string, string>;
    expect(h.Authorization).toBe("OAuth EAAtok");
    expect(h.offset).toBe("0");
    expect(h.file_size).toBe("4");
  });

  it("stops when the upload is refused, without publishing", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      urls.push(u);
      if (u.startsWith("https://rupload.facebook.com/")) return Response.json({ error: { message: "bad video" } }, { status: 400 });
      if (u.includes("/media") && init?.method === "POST") return Response.json({ id: "C1" });
      return Response.json({});
    }) as typeof fetch;
    const ig = instagramClient("EAAtok", { fetchImpl, userId: "IG", pollMs: 0 });
    await expect(ig.publishReelFile!(new Uint8Array([1]), "Hook")).rejects.toThrow(/bad video/);
    expect(urls.some((u) => u.includes("media_publish"))).toBe(false);
  });
});

// --- The daily chain ---------------------------------------------------------

const passed = gate([check("ok", true)]);
const ideasOk = async (): Promise<IdeasResult> => ({ subject: "reel:1", choice: { format: "explainer", product: null }, passed: true, finalists: ["a"], gate: passed, tries: 1 });
const scriptOk = async (): Promise<ScriptResult> => ({ subject: "reel:1", premise: "p", opening: null, script: { caption }, passed: true, stage: 4, gate: passed, problem: null });
const goodFacts = { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fps: 30, seconds: 44, lufs: -14, truePeak: -1.5 };
const produced = (over: Partial<ProduceResult> = {}): ProduceResult => ({
  subject: "reel:1",
  video: "reel/reel.mp4",
  seconds: 42,
  passed: true,
  gate: passed,
  facts: goodFacts,
  boxes: [{ text: "AI just did WHAT?", x: 100, y: 500, w: 800, h: 100 }],
  fixFirst: null,
  problem: null,
  format: "explainer",
  script: { caption },
  shots,
  assets: reelAssets({ voiced: 8, sfx: 2, physics: false, motion: true }),
  ...over,
});
const client = (over: Partial<InstagramClient> = {}) => {
  const posts: { caption: string; opts: unknown }[] = [];
  const c = {
    async account() {
      return { id: "IG", username: "x", followers: 1, posts: 1 };
    },
    async publishImage() {
      throw new Error("no images here");
    },
    async stats() {
      throw new Error("no");
    },
    async publishReelFile(_v: Uint8Array, cap: string, opts?: unknown) {
      posts.push({ caption: cap, opts });
      return { containerId: "C1", mediaId: "M1", permalink: "https://instagram.com/reel/z" };
    },
    ...over,
  } as InstagramClient;
  return { c, posts };
};
const base = async (vault: Vault, over: Partial<Parameters<typeof runReel>[0]> = {}) =>
  runReel({ vault, format: "explainer", products: [], ask: async () => "{}", produce: async () => produced(), client: null, post: true, ideas: ideasOk, script: scriptOk, readVideo: async () => new Uint8Array([1]), now: () => NOW, ...over });

describe("the daily Reel", () => {
  it("posts a Reel that passed every gate once, as a Trial Reel (MANUAL), and logs it with its token use", async () => {
    const vault = await memoryVault();
    const { c, posts } = client();
    const r = await base(vault, { client: c });
    expect(r.posted).toEqual({ mediaId: "M1", permalink: "https://instagram.com/reel/z" });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.opts).toEqual({ trial: "MANUAL", thumbOffsetMs: 1000 });
    expect(posts[0]!.caption).toMatch(/Follow/);
    const log = await vault.actions();
    expect(log.some((a) => a.kind === "posted" && a.onInstagram)).toBe(true);
    expect(log.some((a) => /Daily explainer Reel: posted as a Trial Reel\. Used \d+ Claude call/.test(a.summary))).toBe(true);
    expect(await vault.latestStage(6, { subject: "reel:1", passedOnly: true })).not.toBeNull();
  });

  it("posts nothing on a test run", async () => {
    const vault = await memoryVault();
    const { c, posts } = client();
    const r = await base(vault, { client: c, post: false });
    expect(r.posted).toBeNull();
    expect(r.problem).toMatch(/test run/);
    expect(posts).toHaveLength(0);
  });

  it("posts nothing while paused", async () => {
    const vault = await memoryVault();
    await vault.saveSettings({ paused: true });
    const { c, posts } = client();
    let made = false;
    const r = await base(vault, { client: c, ideas: async () => ((made = true), ideasOk()) });
    expect(r.problem).toBe("the specialist is paused");
    expect(made).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("stops at the first gate that fails", async () => {
    const vault = await memoryVault();
    const { c, posts } = client();
    let produceCalled = false;
    const r = await base(vault, {
      client: c,
      script: async () => ({ ...(await scriptOk()), passed: false, gate: gate([check("Script reads aloud in time", false)]) }),
      produce: async () => ((produceCalled = true), produced()),
    });
    expect(r.stage).toBe(4);
    expect(produceCalled).toBe(false);
    expect(posts).toHaveLength(0);
    const r5 = await base(vault, { client: c, produce: async () => produced({ passed: false, gate: gate([check("A cold viewer of the frames and voice gets the story", false)]) }) });
    expect(r5.stage).toBe(5);
    expect(r5.problem).toMatch(/cold viewer/);
    expect(posts).toHaveLength(0);
  });

  it("doesn't post when a pre-publish check fails", async () => {
    const vault = await memoryVault();
    const { c, posts } = client();
    const r = await base(vault, { client: c, produce: async () => produced({ facts: { ...goodFacts, lufs: -20 } }) });
    expect(r.stage).toBe(6);
    expect(r.problem).toMatch(/Loudness/);
    expect(posts).toHaveLength(0);
    expect(await vault.latestStage(6, { subject: "reel:1" })).not.toBeNull();
  });

  it("logs a refused post and never tries it again", async () => {
    const vault = await memoryVault();
    let tries = 0;
    const { c } = client({
      async publishReelFile() {
        tries++;
        throw new Error("Instagram said: no");
      },
    });
    const r = await base(vault, { client: c });
    expect(tries).toBe(1);
    expect(r.posted).toBeNull();
    expect((await vault.actions()).some((a) => a.kind === "post_failed" && !a.ok)).toBe(true);
  });
});
