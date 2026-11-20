import { describe, expect, it } from "vitest";
import { ENTERTAINMENT, formatBrief, formatPrompt, gateFormat, HAS_CAST, NARRATED, nextFormat, type Format, type Made } from "../src/pipeline/formats.ts";
import type { Product } from "../src/vault.ts";

const P: Product[] = [
  { id: "site:ai-waste-bot", name: "AI Waste Bot", description: "Texts new leads back.", url: "https://hauler.example/" },
  { id: "site:room-designer-3d", name: "Room Designer 3D", description: null, url: "https://rooms.example/" },
];
const at = (i: number) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString();
const made = (formats: (Made["format"] | [Made["format"], string])[]): Made[] => formats.map((f, i) => (Array.isArray(f) ? { format: f[0], productId: f[1], at: at(i) } : { format: f, at: at(i) }));

describe("the content mix", () => {
  it("starts with entertainment and rotates the three kinds", () => {
    expect(nextFormat([], P).format).toBe("story");
    expect(nextFormat(made(["story"]), P).format).toBe("satisfying");
    expect(nextFormat(made(["story", "satisfying"]), P).format).toBe("explainer");
  });

  it("keeps ads at 20% of the last 10, with entertainment between them", () => {
    let history: Made[] = [];
    for (let i = 0; i < 50; i++) {
      const c = nextFormat(history, P);
      history.push({ format: c.format, productId: c.product?.id ?? null, at: at(i) });
      const last10 = history.slice(-10);
      expect(last10.filter((m) => m.format === "ad").length).toBeLessThanOrEqual(2);
    }
    const ads = history.filter((m) => m.format === "ad");
    expect(ads.length).toBe(10);
    // Never two ads within 3 Reels of each other.
    const idx = history.map((m, i) => (m.format === "ad" ? i : -1)).filter((i) => i >= 0);
    expect(idx.every((v, i) => i === 0 || v - idx[i - 1]! > 3)).toBe(true);
    // Ads take turns between the products.
    expect(ads.map((a) => a.productId).slice(0, 4)).toEqual(["site:ai-waste-bot", "site:room-designer-3d", "site:ai-waste-bot", "site:room-designer-3d"]);
  });

  it("makes no ads when there are no products", () => {
    expect(nextFormat(made(["story", "satisfying", "explainer", "story"]), []).format).not.toBe("ad");
  });

  it("has its own ideas, script and style prompt for every format", () => {
    for (const f of [...ENTERTAINMENT, "ad"] as Format[]) for (const b of ["ideas", "script", "style"] as const) expect(formatPrompt(f, b).length).toBeGreaterThan(200);
    expect(formatPrompt("satisfying", "script")).toMatch(/No narrator/);
    expect(formatPrompt("satisfying", "script")).toMatch(/Made with AI/);
    expect(formatPrompt("explainer", "script")).toMatch(/last 14 days/);
    expect(formatPrompt("story", "style")).toMatch(/stick figures/);
    expect(formatPrompt("satisfying", "style")).toMatch(/physics/);
    expect(formatBrief({ format: "explainer", product: null }, "ideas")).toMatch(/Never use news from memory/);
    expect([HAS_CAST.story, HAS_CAST.ad, HAS_CAST.satisfying, HAS_CAST.explainer]).toEqual([true, true, false, false]);
    expect(NARRATED.satisfying).toBe(false);
  });

  it("puts the product in an ad's brief", () => {
    const b = formatBrief({ format: "ad", product: P[0]! });
    expect(b).toContain("AI Waste Bot");
    expect(b).toContain("custom AI agents and software");
  });
});

describe("gateFormat", () => {
  const ad = { format: "ad" as const, product: P[0]! };
  it("passes an ad for one product that pitches custom builds and asks for the click", () => {
    const g = gateFormat(ad, { caption: "Missed leads cost haulers money. Link in bio.", shots: [{ line: "AI Waste Bot texts every new lead back in seconds." }, { onScreenText: "We build custom AI agents for your business too" }] }, P);
    expect(g.passed).toBe(true);
  });

  it("fails an ad that names two products or skips the custom-build line", () => {
    const g = gateFormat(ad, { caption: "Try AI Waste Bot and Room Designer 3D. Link in bio.", shots: [] }, P);
    expect(g.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["The ad markets only one product", "The ad says we build custom AI agents and software for businesses"]);
  });

  it("fails entertainment that sells, but not news that mentions money", () => {
    const story = { format: "story" as const, product: null };
    expect(gateFormat(story, { caption: "MOST OF YOU SAID run. Link in bio for the app", shots: [] }, P).passed).toBe(false);
    expect(gateFormat(story, { caption: "He finds Room Designer 3D", shots: [] }, P).passed).toBe(false);
    const news = { format: "explainer" as const, product: null };
    const now = new Date("2026-11-18T00:00:00Z");
    const sources = [
      { url: "https://news.example/a", published: "2026-11-16" },
      { url: "https://news.example/b", published: "2026-11-10" },
    ];
    const ask = [{ start: 0, line: "A $2 billion bridge just opened." }, { start: 3, line: "Would you pay the toll?" }];
    expect(gateFormat(news, { caption: "The $2 billion bridge, explained", shots: ask, sources }, P, now).passed).toBe(true);
    expect(gateFormat(news, { caption: "x", shots: [], sources: [sources[0]!, { url: "https://old.example", published: "2026-09-01" }] }, P, now).passed).toBe(false);
  });

  it("keeps a satisfying video's later words off who leads, and off things the scene doesn't have", () => {
    const sat = { format: "satisfying" as const, product: null };
    const g = (shots: { start: number; onScreenText: string }[]) => gateFormat(sat, { caption: "Made with AI #satisfying", shots }, P);
    const named = (r: ReturnType<typeof g>) => r.checks.find((c) => c.name.startsWith("On-screen words after the hook"))!;
    const things = (r: ReturnType<typeof g>) => r.checks.find((c) => c.name.startsWith("On-screen words name nothing"))!;
    expect(named(g([{ start: 0, onScreenText: "WHICH COLOUR WINS?" }, { start: 3, onScreenText: "SO CLOSE" }])).passed).toBe(true);
    expect(named(g([{ start: 0, onScreenText: "CAN GREEN ESCAPE?" }, { start: 3, onScreenText: "ALMOST" }])).passed).toBe(true);
    expect(named(g([{ start: 0, onScreenText: "WHICH COLOUR WINS?" }, { start: 3, onScreenText: "PINK PULLS AHEAD" }]))).toMatchObject({ passed: false, detail: 'says "PINK"' });
    expect(things(g([{ start: 0, onScreenText: "WHOSE FLAG WINS?" }])).passed).toBe(false);
  });

  it("keeps an explainer to one story: no line jumps to another fact with \"separately\" or \"elsewhere\"", () => {
    const news = { format: "explainer" as const, product: null };
    const one = (line: string) => gateFormat(news, { caption: "x", shots: [{ start: 0, line: "Cotton prices doubled on one island." }, { start: 3, line }] }, P).checks.find((c) => c.name.startsWith("Tells one story"))!;
    expect(one("So farmers there are planting less of it.").passed).toBe(true);
    expect(one("Separately, 65% of residents in three islands want help.")).toMatchObject({ passed: false, detail: 'says "Separately"' });
    expect(one("Meanwhile a bank cut its rates.").passed).toBe(false);
  });

  it("ends an explainer on a question to the viewer (Thomas, 2026-11-20)", () => {
    const news = { format: "explainer" as const, product: null };
    const now = new Date("2026-11-18T00:00:00Z");
    const sources = [
      { url: "https://news.example/a", published: "2026-11-16" },
      { url: "https://news.example/b", published: "2026-11-10" },
    ];
    const q = (shots: { start: number; line: string }[]) => gateFormat(news, { caption: "x", shots, sources }, P, now).checks.find((c) => c.name === "Ends on a question to the viewer")!;
    expect(q([{ start: 3, line: "Would you?" }, { start: 0, line: "It opened." }]).passed).toBe(true);
    expect(q([{ start: 0, line: "Is it fair?" }, { start: 3, line: "It opened." }]).passed).toBe(false);
    expect(q([{ start: 0, line: 'She asked, "Is it fair?"' }]).passed).toBe(true);
    expect(gateFormat({ format: "story", product: null }, { caption: "x", shots: [{ line: "The end." }] }, P).checks.some((c) => c.name.startsWith("Ends on a question"))).toBe(false);
  });

  it("needs satisfying videos labelled as made with AI", () => {
    const s = { format: "satisfying" as const, product: null };
    expect(gateFormat(s, { caption: "Wait for the last one", shots: [] }, P).passed).toBe(false);
    expect(gateFormat(s, { caption: "Wait for the last one. Made with AI.", shots: [] }, P).passed).toBe(true);
  });
});
