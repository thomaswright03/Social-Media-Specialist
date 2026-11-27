import { describe, expect, it } from "vitest";
import { adOpeningChecks, adWordingChecks, ENTERTAINMENT, formatBrief, formatPrompt, gateFormat, HAS_CAST, NARRATED, nextFormat, readingGrade, sentences, type Format, type Made } from "../src/pipeline/formats.ts";
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
    expect([HAS_CAST.story, HAS_CAST.ad, HAS_CAST.satisfying, HAS_CAST.explainer]).toEqual([true, false, false, false]);
    expect(formatPrompt("ad", "style")).toMatch(/No characters and no stick figures/);
    expect(formatPrompt("ad", "style")).not.toMatch(/White stick figures/);
    expect(NARRATED.satisfying).toBe(false);
  });

  it("puts the product in an ad's brief", () => {
    const b = formatBrief({ format: "ad", product: P[0]! });
    expect(b).toContain("AI Waste Bot");
    expect(b).toMatch(/Never offer to build/);
  });
});

describe("gateFormat", () => {
  const ad = { format: "ad" as const, product: P[0]! };
  // The template (Thomas, 2026-11-27: "make the scripts muuuch simpler for the ads").
  const plain = [
    ["Leads waiting?", "[curious] Are you losing leads because nobody texts them back fast?"],
    ["AI Waste Bot", "[excited] Good! We made AI Waste Bot."],
    ["Texts every lead", "It texts every new lead back for you."],
    ["How it works", "Here's how it works."],
    ["A lead texts in", "A new lead texts your number."],
    ["It answers", "It answers with your prices and rules."],
    ["Your team takes over", "Your team can jump in anytime."],
    ["No lead waits", "[excited] Now no lead has to wait for a reply."],
    ["Every lead answered", "You answer every lead, even at night."],
    ["Link in bio", "[cheerfully] Try AI Waste Bot. Link in bio."],
  ].map(([onScreenText, line], i) => ({ start: i === 0 ? 0 : 1 + i * 3, onScreenText, line }));
  const failing = (shots: { line?: string; onScreenText?: string; start?: number }[], c: typeof ad = ad) => adWordingChecks(c, shots).filter((x) => !x.passed).map((x) => x.name);

  it("passes a plain ad for one product that asks for the click", () => {
    const g = gateFormat(ad, { caption: "Are you losing leads because nobody texts them back fast?\nAI Waste Bot texts new leads back for you.\nLink in bio", shots: plain }, P);
    expect(g.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("fails the wording of the ads it wrote before 2026-11-27", () => {
    // reels run 46022673347's AI Waste Bot ad
    const hands = [
      ["Who gets answered first?", "[curious] Junk removal, hands full."],
      ["All waiting. All hot.", "Three new leads texted."],
      ["Pick one.", "[curious] Which one do you answer first?"],
      ["AI Waste Bot", "[excited] Good! We made AI Waste Bot."],
      ["For waste and recycling businesses", "Answer none. It texts them back itself."],
      ["Lead texts, bot answers", "Here's how: a lead texts, it answers."],
      ["Still carrying", "Meanwhile, you keep carrying that couch!"],
      ["Link in bio", "Try AI Waste Bot. Link in bio."],
    ].map(([onScreenText, line], i) => ({ start: i * 3, onScreenText, line }));
    expect(failing(hands)).toEqual(
      expect.arrayContaining(["The ad opens with this product's question, word for word", 'Says "Good! We made AI Waste Bot." right after the question', 'Says "Here\'s how it works."', "On-screen words are the words you hear in that shot"]),
    );
    // The Room Designer ad split its question over two shots.
    const room = { format: "ad" as const, product: P[1]! };
    const split = adWordingChecks(room, [{ start: 0, line: "[curious] Ever finish a bathroom?" }, { start: 1.5, line: "and hear \"different\"" }]).find((x) => x.name.startsWith("Every line is a whole sentence"))!;
    expect(split.passed).toBe(false);
    expect(split.detail).toContain('shot 2: "and hear');
  });

  it("keeps sentences short and words plain", () => {
    const wordy = plain.map((s, i) => (i === 6 ? { ...s, line: "Your team can jump in anytime and the bot will politely step aside immediately." } : s));
    expect(failing(wordy)).toEqual(["Short sentences (10 words at most; the opening question 12)"]);
    expect(readingGrade("It texts every new lead back for you. Here's how it works.")).toBeLessThan(3);
    expect(readingGrade("Comprehensive automated communication infrastructure revolutionizes operational responsiveness.")).toBeGreaterThan(6);
    expect(sentences("[excited] Good! We made AI Waste Bot.")).toEqual(["Good!", "We made AI Waste Bot."]);
  });

  it("opens an ad on one shot with its whole question, word for word", () => {
    const fcc = { id: "site:fcc", name: "Free Calorie Counter", description: "A free calorie tracker.", url: "https://fcc.example/" };
    const c = { format: "ad" as const, product: fcc };
    expect(formatBrief(c, "ideas")).toContain("Every pitch's `sentence` is exactly: \"Trying to be healthy, but don't want to pay for an app?\"");
    expect(formatBrief(c, "script")).toContain("Good! We made Free Calorie Counter.");
    const open = (shots: { start: number; end: number; audio: string }[]) => adOpeningChecks(c, { shots }).filter((x) => !x.passed).map((x) => x.name);
    expect(open([{ start: 0, end: 4.2, audio: "[curious] Trying to be healthy, but don't want to pay for an app?" }])).toEqual([]);
    expect(open([
      { start: 0, end: 1.5, audio: "Trying to be healthy?" },
      { start: 1.5, end: 3, audio: "But don't want to pay?" },
    ])).toEqual(["The ad opens on one shot of 3 to 4.5 s", "The opening asks this product's question, word for word"]);
    // A product with no question set still opens on one whole question.
    const other = { format: "ad" as const, product: { id: "x", name: "Lead Finder", description: null, url: "https://x.example/" } };
    expect(adOpeningChecks(other, { shots: [{ start: 0, end: 3, audio: "Lead Finder, hands full." }] }).filter((x) => !x.passed).map((x) => x.name)).toEqual(["The opening says one whole question of 12 words or fewer"]);
  });

  it("fails an ad that names two products or offers to build software (Thomas, 2026-11-20)", () => {
    const g = gateFormat(ad, { caption: "Try AI Waste Bot and Room Designer 3D. Link in bio.", shots: [{ onScreenText: "We build custom AI agents for your business too" }] }, P);
    expect(g.checks.filter((c) => !c.passed).map((c) => c.name)).toEqual(["The ad markets only one product", "The ad sells the product itself, not custom software"]);
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
    // 110 words of narration: an explainer runs about 45 s (Thomas, 2026-11-21).
    const middle = Array.from({ length: 10 }, (_, k) => ({ start: 3 + k * 3, line: "The bridge crosses the river and saves drivers ten minutes." }));
    const ask = [{ start: 0, line: "A $2 billion bridge just opened." }, ...middle, { start: 33, line: "Would you pay the toll?" }];
    expect(gateFormat(news, { caption: "The $2 billion bridge, explained", shots: ask, sources }, P, now).passed).toBe(true);
    const short = gateFormat(news, { caption: "The $2 billion bridge, explained", shots: [ask[0]!, ask.at(-1)!], sources }, P, now);
    expect(short.checks.find((c) => c.name.startsWith("The narration is"))).toMatchObject({ passed: false, detail: "11 words" });
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

  it("keeps a race's script off the order and to 2-4 balls, since the run decides (test run 44841594624)", () => {
    const sat = { format: "satisfying" as const, product: null };
    const race = (story: string, visual = "Balls race down the pegs, lap 1 of 3.") => {
      const cs = gateFormat(sat, { caption: "Made with AI", story, shots: [{ start: 0, onScreenText: "PICK A COLOUR", visual }] }, P).checks;
      return { order: cs.find((c) => c.name.startsWith("A race's script promises no order"))!, count: cs.find((c) => c.name === "A race has 2 to 4 balls")! };
    };
    const ok = race("Four balls race down the pegs for three laps. One colour wins and the counter names it.");
    expect([ok.order.passed, ok.count.passed]).toEqual([true, true]);
    const bad = race("Seven balls in rainbow order race for three laps. They finish fully reversed, violet first and red last.");
    expect(bad.order.passed).toBe(false);
    expect(bad.count).toMatchObject({ passed: false, detail: 'says "Seven balls"' });
    expect(race("Four balls race.", "The blue ball pulls ahead on lap 2.").order.passed).toBe(false);
    // Not a race: no race checks.
    expect(gateFormat(sat, { caption: "Made with AI", story: "A ball escapes the last ring.", shots: [] }, P).checks.some((c) => c.name === "A race has 2 to 4 balls")).toBe(false);
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

  it("keeps a narrated Reel's sound effects few, apart and fitting, and its pauses few (Thomas, 2026-11-20)", () => {
    const news = { format: "explainer" as const, product: null };
    const g = (shots: { start: number; sound?: string; pause?: boolean }[]) => gateFormat(news, { caption: "x", shots }, P).checks;
    const named = (cs: ReturnType<typeof g>, n: string) => cs.find((c) => c.name.startsWith(n))!;
    // The YouTube explainer: an effect on every shot, music and a wobbly sting.
    const every = g(["Quick whoosh, upbeat music starts", "Wobbly sting", "Soft pop", "Stamp thunk", "Ding", "Tick"].map((sound, i) => ({ start: i * 3, sound })));
    expect(named(every, "Sound effects:")).toMatchObject({ passed: false, detail: "6 shots have one" });
    expect(named(every, "Sound effects fit")).toMatchObject({ passed: false, detail: 'says "music"' });
    const fine = g([{ start: 0, sound: "none" }, { start: 3, sound: "soft ding", pause: true }, { start: 6, sound: "" }, { start: 9, sound: "paper stamp thud" }]);
    expect(fine.filter((c) => /Sound|pauses/.test(c.name)).every((c) => c.passed)).toBe(true);
    expect(named(g([{ start: 0, sound: "ding" }, { start: 3, sound: "tick" }]), "Sound effects:")).toMatchObject({ passed: false, detail: "shots 1 and 2 both have one" });
    expect(named(g([{ start: 0, pause: true }]), "3 pauses")).toMatchObject({ passed: false });
    // A physics Reel makes its own notes: no checks on its cues.
    expect(gateFormat({ format: "satisfying", product: null }, { caption: "Made with AI", shots: [{ start: 0, sound: "music" }] }, P).checks.some((c) => c.name.startsWith("Sound effects"))).toBe(false);
  });

  it("needs satisfying videos labelled as made with AI", () => {
    const s = { format: "satisfying" as const, product: null };
    expect(gateFormat(s, { caption: "Wait for the last one", shots: [] }, P).passed).toBe(false);
    expect(gateFormat(s, { caption: "Wait for the last one. Made with AI.", shots: [] }, P).passed).toBe(true);
  });
});

describe("soundCues", () => {
  it("plays real cues only, never two shots running, banned kinds dropped, 4 at most", async () => {
    const { soundCues } = await import("../src/pipeline/gates.ts");
    expect(soundCues([{ sound: "ding" }, { sound: "tick" }, { sound: "none" }, { sound: "upbeat music" }, { sound: "thud" }, { sound: "" }, { sound: "pop" }, { sound: "" }, { sound: "click" }, { sound: "" }, { sound: "rise" }])).toEqual([0, 4, 6, 8]);
  });
});
