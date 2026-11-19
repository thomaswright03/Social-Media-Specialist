// Thomas's prompt rewrite (2026-11-19): the new fields, the explainer's news
// and the new checks.
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { fillPrompt, stagePrompt, testerPrompt } from "../src/pipeline/stages.ts";
import { lookProblems, lookSheet } from "../src/pipeline/scenes.ts";
import { picturesLine } from "../src/pipeline/produce.ts";
import { figures, newsList, parseFeed, sourceChecks, sourcedFigure, type SourceText } from "../src/pipeline/news.ts";
import { gateScript } from "../src/pipeline/gates.ts";
import { gateIdeasFormat, runIdeas } from "../src/pipeline/ideas.ts";
import { learnedChecks, runScript } from "../src/pipeline/script.ts";
import { formatBrief } from "../src/pipeline/formats.ts";
import { Vault } from "../src/vault.ts";

const NOW = new Date("2026-11-19T17:00:00Z");

describe("prompt files", () => {
  it("drops a wrapper left empty and keeps a filled one", () => {
    expect(fillPrompt("a\n<last_refusal>\n{{P}}\n</last_refusal>\nb", {})).toBe("a\nb");
    expect(fillPrompt("<last_refusal>\n{{P}}\n</last_refusal>", { P: "too big" })).toContain("too big");
  });

  it("every tester reads from its file", () => {
    expect(testerPrompt("cold-read", { SENTENCE: "A dog types." })).toMatch(/"A dog types\."[\s\S]*YES or NO/);
    expect(testerPrompt("learned-check", { RULE: "r", OUTPUT: "{}" })).toMatch(/a colon and the part of the output/);
    expect(stagePrompt(5, { WATCHED: "shot-01.jpg" }, "follow")).toMatch(/shot-01\.jpg[\s\S]*PICTURES:/);
    expect(stagePrompt(8, { REEL: "the reel", BASELINE: "the start" })).toMatch(/the reel[\s\S]*the start/);
  });

  it("the explainer's prompts carry the news and the sources", () => {
    expect(formatBrief({ format: "explainer", product: null }, "ideas", { NEWS: "1. Eggs up 3% | NPR" })).toContain("1. Eggs up 3% | NPR");
    expect(formatBrief({ format: "explainer", product: null }, "script", { SOURCES: "Source 1: Eggs" })).toContain("Source 1: Eggs");
  });
});

describe("look sheet", () => {
  const good = "PALETTE\n#000 wall\nLIGHT\nlamp\nCHARACTERS\nnone\nOBJECTS\np-box\nPLACES\nshop\nSHOT BY SHOT\n1. wide, shelves\nShot 2: close-up";
  it("needs all six headings and a line per shot", () => {
    expect(lookProblems(good, 2)).toEqual([]);
    expect(lookProblems(good, 3).join(" ")).toMatch(/no line for shot 3/);
    expect(lookProblems("PALETTE\nLIGHT", 1).join(" ")).toMatch(/no CHARACTERS, OBJECTS, PLACES, SHOT BY SHOT heading/);
  });
  it("asks again with what was wrong, then keeps the best", async () => {
    const seen: string[] = [];
    const answers = ["PALETTE only", good];
    const look = await lookSheet([{ visual: "a" }, { visual: "b" }], async (p) => (seen.push(p), answers.shift() ?? ""));
    expect(look).toBe(good);
    expect(seen[1]).toMatch(/Your last look sheet was refused: It has no LIGHT/);
  });
});

describe("follow check", () => {
  it("reads the PICTURES line", () => {
    expect(picturesLine("story\nCONFUSED: nothing\nPICTURES: fine").ok).toBe(true);
    expect(picturesLine("story\nCONFUSED: nothing\nPICTURES: 3, 7")).toEqual({ ok: false, detail: "doesn't match the voice: 3, 7" });
    expect(picturesLine("story\nCONFUSED: nothing").ok).toBe(true);
  });
});

describe("learned checks", () => {
  it("passes on the reason a rule failed", async () => {
    const vault = new Vault(createClient({ url: ":memory:" }));
    await vault.ensureTables();
    await vault.addLesson({ kind: "check", stage: 4, text: "The first line names the object", source: "test" });
    const [c] = await learnedChecks(vault, 4, { shots: [] }, async () => "NO: shot 1 never names it");
    expect(c).toEqual({ name: "Learned: The first line names the object", passed: false, detail: "shot 1 never names it" });
  });
});

describe("words a second", () => {
  it("fails a line too long for its shot", () => {
    const shots = [
      { start: 0, end: 1, line: "one two three four five", onScreen: "x", visual: "a" },
      { start: 1, end: 31, line: "fine", onScreen: "x", visual: "b" },
    ];
    const c = gateScript({ shots, payoff: "p", nextHook: "n" }, null, { problems: [] }).checks.find((x) => x.name.startsWith("Every line can be said"))!;
    expect(c.passed).toBe(false);
    expect(c.detail).toBe("shot at 0 s: 5 words in 1.0 s");
  });
});

const RSS = `<rss><channel>
<item><title>Egg prices up 3.1%</title><link>https://npr.example/eggs</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Eggs cost &amp; more.</p>]]></description></item>
<item><title>Old news</title><link>https://npr.example/old</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate><description>old</description></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>Eggs: a 3.1% jump</title><link rel="alternate" href="https://verge.example/eggs"/><published>2026-11-18T08:00:00Z</published><summary>More eggs.</summary></entry></feed>`;

describe("news", () => {
  it("reads RSS and Atom", () => {
    expect(parseFeed(RSS, "NPR")[0]).toEqual({ headline: "Egg prices up 3.1%", publisher: "NPR", url: "https://npr.example/eggs", published: "2026-11-17", summary: "Eggs cost & more." });
    expect(parseFeed(ATOM, "The Verge")[0]!.url).toBe("https://verge.example/eggs");
  });

  it("keeps the last 14 days, newest first, numbered", async () => {
    const list = await newsList(NOW, async (u) => (u.includes("npr.org/1001") ? RSS : u.includes("theverge") ? ATOM : Promise.reject(new Error("down"))));
    expect(list.map((i) => [i.n, i.publisher, i.published])).toEqual([
      [1, "The Verge", "2026-11-18"],
      [2, "NPR", "2026-11-17"],
    ]);
  });

  it("checks every figure, link and publisher against the sources", () => {
    const supplied: SourceText[] = [
      { url: "https://a.example/1", publisher: "NPR", title: "Eggs", published: "2026-11-17", text: "Egg prices rose 3.1% to $4.20 a dozen, the USDA said in 2026." },
      { url: "https://b.example/2", publisher: "BBC News", title: "Eggs", published: "2026-11-18", text: "A dozen now costs $4.20." },
    ];
    expect(figures("In 2026, 3 hens laid 4,200 eggs, up 2.5%")).toEqual([4200, 2.5]);
    expect(sourcedFigure(8.4, [4.2])).toBe(true); // 4.20 + 4.20
    const ok = sourceChecks({ shots: [{ line: "Eggs went up 3.1%.", visual: 'a big "$4.20" counts up' }], sources: [{ url: "https://a.example/1" }, { url: "https://b.example/2" }] }, supplied);
    expect(ok.every((c) => c.passed)).toBe(true);
    const bad = sourceChecks({ shots: [{ line: "Eggs went up 9.7%." }], sources: [{ url: "https://a.example/1" }, { url: "https://made.up/x" }] }, supplied);
    expect(bad.filter((c) => !c.passed).map((c) => c.detail)).toEqual(["not on the list: https://made.up/x", "1: NPR", "not in the sources: 9.7"]);
  });
});

describe("stage 2's new fields", () => {
  const pitches = (extra: (i: number) => Record<string, unknown>) => ({
    pitches: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, sentence: `Idea ${i + 1} is here.`, hook: i < 3 ? 5 : 3, shareable: 4, standalone: 5, different: 4, ...extra(i + 1) })),
    finalists: [1, 2, 3],
  });
  const yes = async () => ({ 1: [true, true, true], 2: [true, true, true], 3: [true, true, true] });
  const news = [
    { n: 1, headline: "a", publisher: "NPR", url: "https://a", published: "2026-11-17", summary: "" },
    { n: 2, headline: "b", publisher: "BBC News", url: "https://b", published: "2026-11-17", summary: "" },
    { n: 3, headline: "c", publisher: "NPR", url: "https://c", published: "2026-11-17", summary: "" },
  ];

  it("a finalist needs its ending", async () => {
    const g = await gateIdeasFormat(pitches(() => ({})), { format: "story", product: null }, [], yes);
    expect(g.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["Finalist 1 says how it ends", "Finalist 2 says how it ends", "Finalist 3 says how it ends"]);
  });

  it("an explainer finalist is built on 2+ items from 2+ publishers", async () => {
    const g = await gateIdeasFormat(pitches((i) => ({ answer: "x", news: i === 1 ? [1, 2] : i === 2 ? [1, 3] : [9, 1] })), { format: "explainer", product: null }, [], yes, news);
    expect(g.checks.filter((c) => !c.passed).map((c) => c.detail)).toEqual(["2 items, 1 publishers", "1 of its news numbers aren't on the list"]);
  });

  it("makes a story instead when no news could be read", async () => {
    const vault = new Vault(createClient({ url: ":memory:" }));
    await vault.ensureTables();
    const logs: string[] = [];
    const seen: string[] = [];
    const r = await runIdeas({ vault, products: [], format: "explainer", news: async () => [], log: (m) => logs.push(m), now: () => NOW, ask: async (p) => (seen.push(p), p.includes("YES or NO") ? "YES" : JSON.stringify(pitches(() => ({ answer: "x" })))) });
    expect(r.choice.format).toBe("story");
    expect(logs.join(" ")).toMatch(/no explainer today/);
  });

  it("hands stage 3 the ending and an explainer's sources", async () => {
    const vault = new Vault(createClient({ url: ":memory:" }));
    await vault.ensureTables();
    const ask = async (p: string) => (p.includes("YES or NO") ? "YES" : JSON.stringify(pitches((i) => ({ answer: `Ending ${i}.`, news: [1, 2] }))));
    await runIdeas({ vault, products: [], format: "explainer", news: async () => news, now: () => NOW, ask });
    const [reel] = await vault.reelsStarted();
    expect(reel!.picks[0]).toEqual({ sentence: "Idea 1 is here.", answer: "Ending 1.", news: [1, 2] });
    expect(reel!.news).toHaveLength(3);
    const seen: string[] = [];
    const fetched: string[] = [];
    await runScript({
      vault,
      products: [],
      now: () => NOW,
      sources: async (items) => items.map((i) => (fetched.push(i.url), { url: i.url, publisher: i.publisher, title: i.headline, published: i.published, text: "Eggs rose 3.1%." })),
      ask: async (p) => (seen.push(p), "{}"),
    });
    expect(fetched.slice(0, 2)).toEqual(["https://a", "https://b"]);
    const s3 = seen.find((p) => p.includes("Stage 3"))!;
    expect(s3).toMatch(/Idea 1 is here\.\nHow it ends \(the viewer doesn't know this yet\): Ending 1\./);
    expect(s3).toContain("Link: https://a");
  });
});
