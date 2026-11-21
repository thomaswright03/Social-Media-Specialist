import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { pickNext, screenDraft, fullCaption } from "../src/draft.ts";
import type { HittaReport } from "../src/hitta.ts";
import type { FacebookPageClient } from "../src/facebook.ts";
import { currentToken, graphHost, instagramClient, type InstagramClient } from "../src/instagram.ts";
import type { Renderer } from "../src/render.ts";
import { pickPost, socialAnswerer } from "../src/requests.ts";
import { nextSlot } from "../src/schedule.ts";
import { publishDue, runDaily } from "../src/social.ts";
import { parseSiteProducts, siteProducts } from "../src/site.ts";
import { call, setRetryMs } from "../src/instagram.ts";
import { DEFAULT_SETTINGS, legacySealKey, seal, unseal, Vault, vaultNow, type Post, type Product } from "../src/vault.ts";

// These tests cover the image posts, which are off by default (Reels only).
process.env.FEED_IMAGE_POSTS = "on";

const NOW = new Date("2026-10-27T15:00:00Z"); // a Tuesday, 8:00 in Arizona

async function memoryVault(products: Product[] = []): Promise<Vault> {
  const db = createClient({ url: ":memory:" });
  await db.execute(`CREATE TABLE "Product" ("id" TEXT PRIMARY KEY, "name" TEXT, "description" TEXT, "url" TEXT, "status" TEXT)`);
  for (const p of products) await db.execute({ sql: `INSERT INTO "Product" VALUES (?,?,?,?, 'active')`, args: [p.id, p.name, p.description, p.url] });
  const vault = new Vault(db);
  await vault.ensureTables();
  return vault;
}

const PRODUCTS: Product[] = [
  { id: "p1", name: "Room Designer 3D", description: "3D bathroom designer", url: "https://rooms.example.com/" },
  { id: "p2", name: "Lead Finder", description: null, url: "https://leads.example.com/" },
];

describe("Reels only", () => {
  it("drafts no image posts unless FEED_IMAGE_POSTS is on", async () => {
    process.env.FEED_IMAGE_POSTS = "";
    try {
      const vault = await memoryVault(PRODUCTS);
      let asked = 0;
      const { snapshot } = await runDaily({ vault, hitta: async () => ({ ok: true, status: 201, message: "ok" }), log: () => {}, ask: async () => (asked++, goodAnswer()), renderer: async () => fakeRenderer(), fetchImpl: siteFetch, now: NOW });
      expect(snapshot.drafted).toBe(0);
      expect(asked).toBe(0);
    } finally {
      process.env.FEED_IMAGE_POSTS = "on";
    }
  });
});

describe("network blips", () => {
  it("tries a read again when it didn't reach Meta, but never a write", async () => {
    setRetryMs(0);
    let gets = 0;
    let posts = 0;
    const flaky = (async (_u: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        throw new TypeError("fetch failed");
      }
      if (++gets < 3) throw new TypeError("fetch failed");
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(call(flaky, "GET", "me", "IGx")).resolves.toEqual({ id: "1" });
    expect(gets).toBe(3);
    await expect(call(flaky, "POST", "me/media", "IGx", {})).rejects.toThrow("couldn't be reached");
    expect(posts).toBe(1);
    setRetryMs(2_000);
  });
});

describe("products from the website", () => {
  it("reads the product cards in Our Services, with each product's front page", () => {
    const got = parseSiteProducts(siteHtml(PRODUCTS), "https://wright-ai-solutions.com/");
    expect(got).toEqual([
      { id: "site:room-designer-3d", name: "Room Designer 3D", description: "3D bathroom designer", url: "https://rooms.example.com/" },
      { id: "site:lead-finder", name: "Lead Finder", description: null, url: "https://leads.example.com/" },
    ]);
    expect(parseSiteProducts("<html>no section</html>", "https://x/")).toEqual([]);
  });

  it("fails loudly when the site can't be read or lists nothing", async () => {
    await expect(siteProducts((async () => new Response("", { status: 503 })) as unknown as typeof fetch)).rejects.toThrow("503");
    await expect(siteProducts((async () => new Response("<html></html>")) as unknown as typeof fetch)).rejects.toThrow("no product cards");
  });

  it("drafts only what the website lists, not the Vault's products", async () => {
    const vault = await memoryVault([{ id: "old", name: "ParkLess", description: null, url: "https://parkless.example.com/" }]);
    const renderer = fakeRenderer();
    const { snapshot } = await runDaily({ vault, hitta: async () => ({ ok: true, status: 201, message: "ok" }), log: () => {}, ask: async () => goodAnswer(), renderer: async () => renderer, fetchImpl: siteFetch, now: NOW });
    expect(snapshot.drafted).toBe(3);
    expect((await vault.posts()).map((p) => p.productName)).not.toContain("ParkLess");
  });
});

describe("products", () => {
  it("leaves out inactive products and products whose project was retired", async () => {
    const vault = await memoryVault([...PRODUCTS, { id: "p3", name: "ParkLess", description: null, url: "https://parkless.example.com/" }]);
    expect((await vault.products()).map((p) => p.name)).toEqual(["Lead Finder", "ParkLess", "Room Designer 3D"]);
    await vault.client.execute(`CREATE TABLE "Project" ("id" TEXT PRIMARY KEY, "name" TEXT, "retiredAt" TEXT)`);
    await vault.client.execute(`INSERT INTO "Project" VALUES ('x', 'parkless ', '2026-11-01T00:00:00.000Z'), ('y', 'Lead Finder', NULL)`);
    await vault.client.execute(`UPDATE "Product" SET "status" = 'inactive' WHERE "id" = 'p1'`);
    expect((await vault.products()).map((p) => p.name)).toEqual(["Lead Finder"]);
  });
});

const goodAnswer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    angle: "show the customer first",
    headline: "Show it before you build it",
    subline: "Design the bathroom with your customer, in 3D, on the first visit.",
    kind: "screenshot",
    sourceUrl: "https://rooms.example.com/designer.html",
    theme: "ocean",
    caption: "Your customer can't picture a remodel from a tile sample.\n\nDesign it together on the first visit and they see the finished room before you quote it.\n\nLink in bio to try it free for a week.",
    hashtags: ["#remodeling", "bathroomremodel", "#contractors", "#3Ddesign"],
    ...over,
  });

const fakeRenderer = (): Renderer & { shots: string[] } => {
  const shots: string[] = [];
  return {
    shots,
    async screenshot(url) {
      shots.push(url);
      return Buffer.from("shot");
    },
    async image() {
      return Buffer.from("jpeg");
    },
    async close() {},
  };
};

// Thomas's website, with a product card for each product.
const siteHtml = (products: Product[]) =>
  `<html><body><section class="hero"><h3>Not a product</h3></section><section class="products" id="our-services"><div class="cards">${products
    .map((p) => `<article class="card product-card"><span class="tag">x</span><h3>${p.name}</h3><p>${p.description ?? ""}</p><a href="${p.url}signup.html" target="_blank" class="btn btn-primary product-signup">Sign up</a></article>`)
    .join("")}</div></section><section id="work"><article class="work-item"><h3>Client work</h3><a href="https://client.example/" class="work-link">x</a></article></section></body></html>`;

const siteFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } });
  if (u.startsWith("https://wright-ai-solutions.com")) return new Response(siteHtml(PRODUCTS));
  if (u.includes("example.com")) return new Response(`<html><body><h1>Design bathrooms in 3D</h1><a href="/designer.html">Designer</a><a href="https://other.com/x">x</a></body></html>`);
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

describe("scheduling", () => {
  const s = { postDays: [1, 3, 5], postTime: "11:30" };
  it("picks the next posting day at the posting time, Arizona time", () => {
    // Tuesday -> Wednesday 11:30 Arizona = 18:30 UTC
    expect(nextSlot(s, [], NOW).toISOString()).toBe("2026-10-28T18:30:00.000Z");
  });
  it("skips days that already have a post", () => {
    expect(nextSlot(s, ["2026-10-28T18:30:00.000Z"], NOW).toISOString()).toBe("2026-10-30T18:30:00.000Z");
  });
  it("uses today when the time hasn't passed", () => {
    expect(nextSlot({ postDays: [2], postTime: "11:30" }, [], NOW).toISOString()).toBe("2026-10-27T18:30:00.000Z");
    expect(nextSlot({ postDays: [2], postTime: "08:05" }, [], NOW).toISOString()).toBe("2026-11-03T15:05:00.000Z");
  });
});

describe("drafts", () => {
  const site = { url: "https://rooms.example.com/", text: "Design bathrooms in 3D", links: ["https://rooms.example.com/designer.html"] };
  const pick = { product: PRODUCTS[0]!, idea: null };

  it("takes a good answer and keeps the screenshot on the product's own site", () => {
    const r = screenDraft(goodAnswer(), { ...pick, site });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.post.sourceUrl).toBe("https://rooms.example.com/designer.html");
    expect(r.post.hashtags).toEqual(["#remodeling", "#bathroomremodel", "#contractors", "#3Ddesign"]);
    expect(fullCaption(r.post)).toMatch(/Link in bio to try it free for a week\.\n\n#remodeling #bathroomremodel/);
    const offsite = screenDraft(goodAnswer({ sourceUrl: "https://evil.com/" }), { ...pick, site });
    expect(offsite.ok && offsite.post.sourceUrl).toBe("https://rooms.example.com/");
  });

  it("drops links, Hitta, made-up claims and missing hashtags", () => {
    expect(screenDraft(goodAnswer({ caption: "Try it now at https://rooms.example.com, it's really good for your business." }), { ...pick, site })).toMatchObject({ ok: false });
    expect(screenDraft(goodAnswer({ caption: "Hitta and this designer make a great pair for your business, honestly." }), { ...pick, site })).toMatchObject({ ok: false });
    expect(screenDraft(goodAnswer({ headline: "Guaranteed to win every job" }), { ...pick, site })).toMatchObject({ ok: false });
    expect(screenDraft(goodAnswer({ caption: "Rated #1 by remodelers across the whole country, every single one." }), { ...pick, site })).toMatchObject({ ok: false });
    expect(screenDraft(goodAnswer({ hashtags: ["#one"] }), { ...pick, site })).toMatchObject({ ok: false });
    expect(screenDraft("no json here", { ...pick, site })).toMatchObject({ ok: false });
  });

  it("makes a card when the site couldn't be read", () => {
    const r = screenDraft(goodAnswer(), { ...pick, site: null });
    expect(r.ok && r.post.kind).toBe("card");
    expect(r.ok && r.post.sourceUrl).toBeNull();
  });

  it("does Thomas's ideas first, then the product posted about longest ago, never one he left out", () => {
    const posted = { productId: "p1", state: "published", publishedAt: "2026-10-20T00:00:00.000Z", createdAt: "2026-10-19T00:00:00.000Z" } as Post;
    const idea = { id: "i1", text: "our fall offer", productId: "p1", source: "hitta", createdAt: "", usedAt: null, postId: null };
    const picks = pickNext(PRODUCTS, [idea], [posted], DEFAULT_SETTINGS, 3);
    expect(picks.map((p) => [p.idea?.id ?? null, p.product?.id])).toEqual([
      ["i1", "p1"],
      [null, "p2"],
      [null, "p1"],
    ]);
    expect(pickNext(PRODUCTS, [], [], { ...DEFAULT_SETTINGS, leftOut: ["p2"] }, 2).map((p) => p.product?.id)).toEqual(["p1", "p1"]);
  });
});

describe("the morning run", () => {
  let reports: HittaReport[];
  const hitta = async (r: HittaReport) => {
    reports.push(r);
    return { ok: true, status: 201, message: "Hitta got it (201)." };
  };
  beforeEach(() => {
    reports = [];
    process.env.HITTA_API_KEY = "test";
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
  });
  afterEach(() => {
    delete process.env.HITTA_API_KEY;
  });

  it("drafts a week's worth, tells Hitta once, and doesn't draft again while they wait", async () => {
    const vault = await memoryVault(PRODUCTS);
    const renderer = fakeRenderer();
    const prompts: string[] = [];
    const deps = { vault, hitta, log: () => {}, ask: async (p: string) => (prompts.push(p), goodAnswer()), renderer: async () => renderer, fetchImpl: siteFetch, now: NOW };
    const { snapshot } = await runDaily(deps);
    expect(snapshot.drafted).toBe(3);
    expect(snapshot.waiting).toBe(3);
    expect(snapshot.instagramError).toMatch(/INSTAGRAM_ACCESS_TOKEN/);
    // Lead Finder first (never posted, A to Z), and its screenshot stays on its own site.
    expect(renderer.shots).toEqual(["https://leads.example.com/", "https://rooms.example.com/designer.html", "https://leads.example.com/"]);
    expect(prompts[0]).toContain("Only claim what the website text below says");
    expect(prompts[0]).toContain("Design bathrooms in 3D");
    const posts = await vault.posts();
    expect(posts.every((p) => p.state === "draft" && p.mediaToken.length === 32)).toBe(true);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ project: "Social Media Specialist", urgency: "normal", title: "3 Instagram posts are waiting for your OK" });

    const again = await runDaily({ ...deps, now: new Date(NOW.getTime() + 86_400_000) });
    expect(again.snapshot.drafted).toBe(0);
    expect(reports).toHaveLength(1);
  });

  it("learns from turned-down posts and makes nothing while paused", async () => {
    const vault = await memoryVault(PRODUCTS);
    const prompts: string[] = [];
    const deps = { vault, hitta, log: () => {}, ask: async (p: string) => (prompts.push(p), goodAnswer()), renderer: async () => fakeRenderer(), fetchImpl: siteFetch, now: NOW };
    await vault.saveSettings({ postsPerWeek: 1 });
    await runDaily(deps);
    const [first] = await vault.posts();
    await vault.updatePost(first!.id, { state: "rejected", note: "too salesy" });
    await runDaily({ ...deps, now: new Date(NOW.getTime() + 86_400_000) });
    expect(prompts.at(-1)).toContain("too salesy");

    await vault.saveSettings({ paused: true });
    const paused = await runDaily({ ...deps, now: new Date(NOW.getTime() + 2 * 86_400_000) });
    expect(paused.snapshot.drafted).toBe(0);
    expect(paused.snapshot.notes[0]).toMatch(/Paused/);
  });

  it("asks once more when the first answer can't be used, then gives up on that one", async () => {
    const vault = await memoryVault(PRODUCTS);
    await vault.saveSettings({ postsPerWeek: 1 });
    let n = 0;
    const { snapshot } = await runDaily({ vault, hitta, log: () => {}, ask: async () => (n++ === 0 ? "nope" : goodAnswer()), renderer: async () => fakeRenderer(), fetchImpl: siteFetch, now: NOW });
    expect(snapshot.drafted).toBe(1);
    const vault2 = await memoryVault(PRODUCTS);
    await vault2.saveSettings({ postsPerWeek: 1 });
    const bad = await runDaily({ vault: vault2, hitta, log: () => {}, ask: async () => "nope", renderer: async () => fakeRenderer(), fetchImpl: siteFetch, now: NOW });
    expect(bad.snapshot.drafted).toBe(0);
    expect(bad.snapshot.notes[0]).toMatch(/couldn't be used/);
  });
});

describe("posting", () => {
  let reports: HittaReport[];
  const hitta = async (r: HittaReport) => {
    reports.push(r);
    return { ok: true, status: 201, message: "201" };
  };
  beforeEach(() => {
    reports = [];
    process.env.HITTA_API_KEY = "test";
    process.env.INSTAGRAM_ACCESS_TOKEN = "IGTOKEN";
    process.env.VAULT_PUBLIC_URL = "https://vault.example.com/";
    process.env.INSTAGRAM_GRAPH_HOST = "graph.facebook.com"; // no refresh calls in these tests
    process.env.FACEBOOK_CROSSPOST = "off"; // turned on in the Facebook Page tests
  });
  afterEach(() => {
    for (const k of ["HITTA_API_KEY", "INSTAGRAM_ACCESS_TOKEN", "VAULT_PUBLIC_URL", "INSTAGRAM_GRAPH_HOST", "FACEBOOK_CROSSPOST"]) delete process.env[k];
  });

  async function withPost(state: string, scheduledFor: Date | null) {
    const vault = await memoryVault(PRODUCTS);
    const r = screenDraft(goodAnswer(), { product: PRODUCTS[0]!, idea: null, site: null });
    if (!r.ok) throw new Error("bad fixture");
    const p = await vault.addPost(r.post, Buffer.from("jpeg"), NOW);
    await vault.updatePost(p.id, { state, scheduledFor: scheduledFor ? vaultNow(scheduledFor) : null });
    return { vault, post: p };
  }

  const fakeIg = (fail = false) => {
    const calls: { url: string; caption: string }[] = [];
    const client: InstagramClient = {
      async account() {
        return { id: "1", username: "wright", followers: 10, posts: 1 };
      },
      async publishImage(url, caption) {
        calls.push({ url, caption });
        if (fail) throw new Error("Instagram said: bad image");
        return { containerId: "c1", mediaId: "m1", permalink: "https://instagram.com/p/x" };
      },
      async stats() {
        return { likes: 5, comments: 1, reach: 80, saves: 2, shares: 0, views: 120, permalink: null };
      },
    };
    return { client, calls };
  };

  it("posts an approved post whose time has come, with its image from the Vault", async () => {
    const { vault, post } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    const ig = fakeIg();
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(r.published).toHaveLength(1);
    expect(ig.calls[0]!.url).toBe(`https://vault.example.com/api/social/media/${post.mediaToken}.jpg`);
    expect(ig.calls[0]!.caption).toContain("#remodeling");
    const after = await vault.post(post.id);
    expect(after).toMatchObject({ state: "published", igMediaId: "m1", permalink: "https://instagram.com/p/x", attempts: 1 });
    expect(reports).toHaveLength(0);
    // Never twice.
    await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(ig.calls).toHaveLength(1);
  });

  const fakePage = (fail = false) => {
    const calls: { url: string; message: string }[] = [];
    const client: FacebookPageClient = {
      info: async () => ({ id: "pg", name: "Wright AI Solutions LLC", followers: 3, likes: 3, link: null, instagramId: "IG" }),
      posts: async () => [],
      async publishPhoto(url, message) {
        calls.push({ url, message });
        if (fail) throw new Error("Facebook said: no");
        return { postId: "pg_1", permalink: "https://facebook.com/pg/posts/1" };
      },
      publishVideo: async () => ({ videoId: "v", permalink: null }),
      comments: async () => [],
      reply: async () => ({ id: "r" }),
    };
    return { client, calls };
  };

  it("also posts an approved post to the Facebook Page, and logs both", async () => {
    process.env.FACEBOOK_CROSSPOST = "on";
    const { vault, post } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    const ig = fakeIg();
    const page = fakePage();
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => page.client, fetchImpl: siteFetch, now: NOW });
    expect(r.published).toHaveLength(1);
    expect(page.calls).toEqual([{ url: `https://vault.example.com/api/social/media/${post.mediaToken}.jpg`, message: `${ig.calls[0]!.caption.replace("Link in bio", "Link below")}\n\n👉 https://wright-ai-solutions.com` }]);
    const history = (await vault.actions()).map((a) => a.summary);
    expect(history.some((h) => h.includes("to Instagram"))).toBe(true);
    expect(history.some((h) => h.includes("to the Facebook Page"))).toBe(true);
  });

  it("keeps the Instagram post when the Page refuses it, and never retries the Page", async () => {
    process.env.FACEBOOK_CROSSPOST = "on";
    const { vault, post } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    const ig = fakeIg();
    const page = fakePage(true);
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => page.client, fetchImpl: siteFetch, now: NOW });
    expect(r.published).toHaveLength(1);
    expect((await vault.post(post.id))!.state).toBe("published");
    expect((await vault.actions()).find((a) => a.kind === "post_failed")?.summary).toMatch(/Facebook Page refused/);
    await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, facebook: () => page.client, fetchImpl: siteFetch, now: NOW });
    expect(page.calls).toHaveLength(1);
  });

  it("leaves the Page alone when FACEBOOK_CROSSPOST is off, and never posts a draft there", async () => {
    const { vault } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    const page = fakePage();
    await publishDue({ vault, hitta, log: () => {}, instagram: () => fakeIg().client, facebook: () => page.client, fetchImpl: siteFetch, now: NOW });
    expect(page.calls).toHaveLength(0);
    process.env.FACEBOOK_CROSSPOST = "on";
    const draft = await withPost("draft", new Date(NOW.getTime() - 60_000));
    await publishDue({ vault: draft.vault, hitta, log: () => {}, instagram: () => fakeIg().client, facebook: () => page.client, fetchImpl: siteFetch, now: NOW });
    expect(page.calls).toHaveLength(0);
  });

  it("never posts a draft, a future post, or anything while paused", async () => {
    for (const [state, when] of [
      ["draft", new Date(NOW.getTime() - 60_000)],
      ["approved", new Date(NOW.getTime() + 3_600_000)],
      ["rejected", new Date(NOW.getTime() - 60_000)],
    ] as const) {
      const { vault } = await withPost(state, when);
      const ig = fakeIg();
      await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
      expect(ig.calls).toHaveLength(0);
    }
    const { vault } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    await vault.saveSettings({ paused: true });
    const ig = fakeIg();
    expect((await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW })).skipped).toBe("paused");
    expect(ig.calls).toHaveLength(0);
  });

  it("marks a refused post failed, tells Hitta once, and doesn't retry on its own", async () => {
    const { vault, post } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    const ig = fakeIg(true);
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(r.failed).toHaveLength(1);
    expect(await vault.post(post.id)).toMatchObject({ state: "failed", error: "Instagram said: bad image" });
    expect(reports).toHaveLength(1);
    await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(ig.calls).toHaveLength(1);
  });

  it("leaves it approved when the setup isn't done, and says so once a day", async () => {
    delete process.env.VAULT_PUBLIC_URL;
    const { vault, post } = await withPost("approved", new Date(NOW.getTime() - 60_000));
    const ig = fakeIg();
    const r = await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(r.skipped).toMatch(/VAULT_PUBLIC_URL/);
    expect((await vault.post(post.id))!.state).toBe("approved");
    await publishDue({ vault, hitta, log: () => {}, instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(reports).toHaveLength(1);
  });

  it("reads how published posts did on the morning run", async () => {
    const { vault, post } = await withPost("published", null);
    await vault.updatePost(post.id, { igMediaId: "m1", publishedAt: vaultNow(new Date(NOW.getTime() - 86_400_000)) });
    await vault.saveSettings({ paused: true });
    const ig = fakeIg();
    const { snapshot } = await runDaily({ vault, hitta, log: () => {}, ask: async () => "", renderer: async () => fakeRenderer(), instagram: () => ig.client, fetchImpl: siteFetch, now: NOW });
    expect(snapshot.account).toEqual({ username: "wright", followers: 10, posts: 1 });
    expect(snapshot.published30d).toBe(1);
    expect(await vault.post(post.id)).toMatchObject({ likes: 5, reach: 80, views: 120 });
  });
});

describe("the Instagram token", () => {
  afterEach(() => {
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.INSTAGRAM_GRAPH_HOST;
  });

  it("seals what it stores", () => {
    const key = Buffer.alloc(32, 7);
    const sealed = seal("secret-token", key);
    expect(sealed).not.toContain("secret-token");
    expect(unseal(sealed, key)).toBe("secret-token");
    expect(unseal(sealed, Buffer.alloc(32, 8))).toBeNull();
  });

  it("uses its own seal key when set, opens tokens sealed with the old key, and seals them again (security check, 2026-11-21)", async () => {
    const vault = await memoryVault();
    process.env.VAULT_DATABASE_AUTH_TOKEN = "db-token";
    try {
      await vault.saveToken("ig-token", "seed1", null);
      process.env.SOCIAL_SEAL_KEY = "own-key";
      expect((await vault.storedToken())?.token).toBe("ig-token");
      const db = (vault as unknown as { db: { execute(sql: string): Promise<{ rows: Record<string, unknown>[] }> } }).db;
      const rs = await db.execute(`SELECT "sealed" FROM "SocialToken"`);
      // Sealed again with the new key: the database token alone can't open it now.
      expect(unseal(String(rs.rows[0]?.sealed), legacySealKey())).toBeNull();
      expect((await vault.storedToken())?.token).toBe("ig-token");
      delete process.env.SOCIAL_SEAL_KEY;
      expect(await vault.storedToken()).toBeNull();
    } finally {
      delete process.env.SOCIAL_SEAL_KEY;
      delete process.env.VAULT_DATABASE_AUTH_TOKEN;
    }
  });

  it("refreshes a week-old token, keeps using the refreshed one, and switches when a new one is pasted", async () => {
    const vault = await memoryVault();
    process.env.INSTAGRAM_ACCESS_TOKEN = "first";
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ access_token: "refreshed", expires_in: 5_184_000 }));
    }) as unknown as typeof fetch;
    expect((await currentToken(vault, { fetchImpl, now: NOW }))!.token).toBe("refreshed");
    expect(asked[0]).toContain("refresh_access_token");
    // A day later: the stored one, no refresh.
    expect(await currentToken(vault, { fetchImpl, now: new Date(NOW.getTime() + 86_400_000) })).toMatchObject({ token: "refreshed", refreshed: false });
    expect(asked).toHaveLength(1);
    process.env.INSTAGRAM_ACCESS_TOKEN = "second";
    process.env.INSTAGRAM_GRAPH_HOST = "graph.facebook.com";
    expect((await currentToken(vault, { fetchImpl, now: NOW }))!.token).toBe("second");
  });
});

describe("Hitta", () => {
  it("finds the post Thomas means by its headline", () => {
    const posts = [
      { id: "a", headline: "Show it before you build it", productName: "Room Designer 3D", angle: null, caption: "" },
      { id: "b", headline: "Find compactor leads fast", productName: "Lead Finder", angle: null, caption: "" },
    ] as Post[];
    expect(pickPost(posts, "the lead finder one")!.id).toBe("b");
    expect(pickPost(posts, "show it before you build it")!.id).toBe("a");
    expect(pickPost(posts, "zzz")).toBeNull();
  });
});

describe("Hitta resuming (security check, 2026-11-21)", () => {
  const resumeStep = async () => JSON.stringify({ answer: "", action: { name: "resume", args: {} } });
  const noDb = { query: async () => [], describe: "" };
  const req = (request: string) => ({ id: "req_1", kind: "task" as const, request, asked_at: "2026-11-21T20:00:00Z" });

  it("turns posting back on only when Thomas asks for that himself", async () => {
    const vault = await memoryVault();
    await vault.saveSettings({ paused: true });
    const answer = socialAnswerer({ vault, vaultQueryDb: noDb, ask: resumeStep });
    expect(await answer(req("what did the last reel say?"))).toMatch(/only you can turn it back on/);
    expect((await vault.settings()).paused).toBe(true);
    await answer(req("resume posting please"));
    expect((await vault.settings()).paused).toBe(false);
  });
});

describe("Facebook login", () => {
  afterEach(() => {
    for (const k of ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_GRAPH_HOST", "FACEBOOK_PAGE_ID"]) delete process.env[k];
  });

  const graph = (routes: Record<string, unknown>) => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const u = new URL(String(url));
      asked.push(`${u.host}${u.pathname}`);
      const key = Object.keys(routes).find((k) => u.pathname.endsWith(k));
      return new Response(JSON.stringify(key ? routes[key] : { error: { message: "no", code: 100 } }), { status: key ? 200 : 400 });
    }) as unknown as typeof fetch;
    return { fetchImpl, asked };
  };

  it("tells Facebook tokens from Instagram ones", () => {
    expect(graphHost("EAAbc")).toBe("graph.facebook.com");
    expect(graphHost("IGAAbc")).toBe("graph.instagram.com");
    process.env.INSTAGRAM_GRAPH_HOST = "graph.instagram.com";
    expect(graphHost("EAAbc")).toBe("graph.instagram.com");
  });

  it("swaps a pasted Facebook token for the Page's own token, which doesn't expire, and logs it", async () => {
    const vault = await memoryVault();
    process.env.INSTAGRAM_ACCESS_TOKEN = "EAAuser";
    const { fetchImpl } = graph({
      "/me/accounts": { data: [{ id: "other", name: "Everything Jesus", access_token: "EAAother" }, { id: "pg", name: "Wright AI Solutions LLC", access_token: "EAApage", instagram_business_account: { id: "IG1" } }] },
      "/debug_token": { data: { expires_at: 0 } },
    });
    const t = await currentToken(vault, { fetchImpl, now: NOW });
    expect(t).toMatchObject({ token: "EAApage", expiresAt: null });
    // Stored: the next run uses the Page token without asking again.
    expect((await currentToken(vault, { fetchImpl: graph({}).fetchImpl, now: NOW }))!.token).toBe("EAApage");
    expect((await vault.actions()).map((a) => a.summary).join(" ")).toMatch(/Wright AI Solutions LLC/);
  });

  it("finds the Instagram account through the Page", async () => {
    const { fetchImpl, asked } = graph({
      "/me": { id: "pg", name: "Wright AI Solutions LLC", instagram_business_account: { id: "IG1" } },
      "/IG1": { username: "wrightaisolutionsllc", followers_count: 12, media_count: 4 },
    });
    const a = await instagramClient("EAApage", { fetchImpl }).account();
    expect(a).toEqual({ id: "IG1", username: "wrightaisolutionsllc", followers: 12, posts: 4 });
    expect(asked.every((x) => x.startsWith("graph.facebook.com/"))).toBe(true);
  });
});
