// The motion kit (Thomas, 2026-11-19: "the animations are terrible").
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BACKDROPS, ICONS, KINDS, motionFrom, motionPlan, motionProblems, pieceFigures, repeatedShots, replanShots, shotMotion, THEMES, type MotionPlan } from "../src/pipeline/motion.ts";
import { BEAT, composeHtml, timeline, totalSeconds, transitionFor } from "../src/pipeline/compose.ts";
import { END_CARD } from "../src/pipeline/gates.ts";

const shots = [
  { start: 0, end: 2, line: "Egg prices jumped 3.1% in one month.", visual: "a counter to 3.1%" },
  { start: 2, end: 4, line: "A dozen went from $3.20 to $4.20.", visual: "two bars" },
];
const good: MotionPlan = {
  shots: [
    { shot: 1, bg: "red", pieces: [{ kind: "counter", to: 3.1, suffix: "%", label: "eggs in one month" }] },
    { shot: 2, transition: "whip", pieces: [{ kind: "bars", prefix: "$", items: [{ name: "Before", value: 3.2 }, { name: "Now", value: 4.2 }] }] },
  ],
};

describe("motion plan", () => {
  it("passes a plan whose figures the script says", () => {
    expect(motionProblems(good, shots)).toEqual([]);
  });

  it("keeps a ticker to a price or a market move (test run 44859311055)", () => {
    const feel: MotionPlan = { shots: [good.shots[0]!, { shot: 2, pieces: [{ kind: "ticker", name: "CLAUDE", value: "Doubt", change: "-August" }] }] };
    expect(motionProblems(feel, shots).join(" ")).toMatch(/only for a price or a market move/);
  });

  it("refuses an invented figure, a missing shot and a broken piece", () => {
    const bad: MotionPlan = { shots: [{ shot: 1, bg: "pink", pieces: [{ kind: "counter", to: 9.7, label: "x" }, { kind: "icon", name: "unicorn" }, { kind: "title", text: "a" }] }] };
    const p = motionProblems(bad, shots).join(" ");
    expect(p).toMatch(/Shot 1 has 3 pieces/);
    expect(p).toMatch(/bg is one of/);
    expect(p).toMatch(/shows 9\.7, which the script never says/);
    expect(p).toMatch(/the icon is one of/);
    expect(p).toMatch(/Shot 2 has no entry/);
    expect(motionProblems(null, shots)).toEqual(['There was no JSON with "shots" in the answer.']);
  });

  it("reads figures from values and words", () => {
    expect(pieceFigures({ kind: "compare", left: { value: "$59" }, right: { value: 80 } })).toEqual(["59", "80"]);
    expect(pieceFigures({ kind: "title", text: "UP 40% SINCE 2024" })).toEqual(["40", "2024"]);
  });

  it("asks again with what was wrong", async () => {
    const seen: string[] = [];
    const answers = [JSON.stringify({ shots: [good.shots[0]] }), "```json\n" + JSON.stringify(good) + "\n```"];
    const r = await motionPlan(shots, async (p) => (seen.push(p), answers.shift() ?? ""));
    expect(r.problems).toEqual([]);
    expect(seen[1]).toMatch(/Your last plan was refused: Shot 2 has no entry/);
    expect(motionFrom("no json")).toBeNull();
  });

  it("lists the same pieces, icons and themes as the runtime draws", () => {
    const js = readFileSync(new URL("../pipeline/motion/runtime.js", import.meta.url), "utf8");
    const block = (name: string) => js.slice(js.indexOf(`const ${name} = {`), js.indexOf("\n  };", js.indexOf(`const ${name} = {`)));
    const keys = (b: string) => [...b.matchAll(/^\s{4}([a-z]+)[:(]/gm)].map((m) => m[1]);
    expect(keys(block("ICONS")).sort()).toEqual([...ICONS].sort());
    expect(keys(block("THEMES")).sort()).toEqual([...THEMES].sort());
    expect([...block("PIECES").matchAll(/^\s{4}([a-z]+)\(p\)/gm)].map((m) => m[1]).sort()).toEqual([...KINDS].sort());
  });
});

describe("repeated pieces", () => {
  it("keeps the plan and swaps only the repeated shots when repeats are all that's wrong (test run 44856457525)", async () => {
    const three = [...shots, { start: 4, end: 6, line: "Eggs cost more now.", visual: "an egg" }];
    const twice: MotionPlan = { shots: [good.shots[0]!, { shot: 2, pieces: [{ kind: "icon", name: "heart", label: "" }] }, { shot: 3, pieces: [{ kind: "icon", name: "fire", label: "" }] }] };
    expect(repeatedShots(twice)).toEqual([3]);
    const swapped: MotionPlan = { shots: [{ shot: 1, pieces: [{ kind: "title", text: "IGNORED" }] }, twice.shots[1]!, { shot: 3, pieces: [{ kind: "title", text: "EGGS COST MORE" }] }] };
    const answers = [twice, twice, twice, swapped].map((x) => JSON.stringify(x));
    const seen: string[] = [];
    const r = await motionPlan(three, async (p) => (seen.push(p), answers.shift() ?? ""));
    expect(r.problems).toEqual([]);
    expect(r.plan!.shots[0]).toEqual(good.shots[0]);
    expect(r.plan!.shots[2]!.pieces[0]!.kind).toBe("title");
    expect(seen[3]).toMatch(/shot 3 repeats a kind of piece/);
  });
});

describe("re-planning flagged shots", () => {
  it("changes only the shots viewers flagged, and keeps the rest exactly (test run 44843234773)", async () => {
    const seen: string[] = [];
    const answer: MotionPlan = { shots: [
      { shot: 1, pieces: [{ kind: "title", text: "SOMETHING ELSE" }] },
      { shot: 2, pieces: [{ kind: "compare", left: { name: "Before", value: 3.2 }, right: { name: "Now", value: 4.2 } }] },
    ] };
    const next = await replanShots(good, [2], shots, async (p) => (seen.push(p), JSON.stringify(answer)));
    expect(next!.shots[0]).toEqual(good.shots[0]);
    expect(next!.shots[1]!.pieces[0]!.kind).toBe("compare");
    expect(seen[0]).toContain("shot 2 (\"A dozen went from $3.20 to $4.20.\")");
    // A new plan that breaks the checks (a number the script never says) gives up.
    const wrong: MotionPlan = { shots: [good.shots[0]!, { shot: 2, pieces: [{ kind: "counter", to: 99 }] }] };
    expect(await replanShots(good, [2], shots, async () => JSON.stringify(wrong))).toBeNull();
  });
});

describe("compositor with motion", () => {
  it("mounts the kit for planned shots and whips between graphics", () => {
    const t = timeline(shots, [null, null]);
    const html = composeHtml(t, ["<svg></svg>", "<svg></svg>"], good.shots);
    expect(html).toContain("window.MK = {");
    expect(html).not.toContain('<div class="scene" id="s0"><svg>');
    expect(transitionFor(0, good.shots[1]!, false)).toBe("cut");
    expect(transitionFor(1, { shot: 2, pieces: [] }, false)).toBe("whip");
    expect(transitionFor(1, null, true)).toBe("flash");
    expect(composeHtml(t, ["<svg></svg>", "<svg></svg>"])).not.toContain("window.MK = {");
  });
});

describe("variety", () => {
  it("refuses any kind of piece used twice in a Reel (Thomas, 2026-11-20)", () => {
    const s3 = [0, 1, 2].map((i) => ({ start: i, end: i + 1, line: "x", visual: "y" }));
    const icons: MotionPlan = { shots: [1, 2, 3].map((n) => ({ shot: n, pieces: [{ kind: "icon", name: ["heart", "fire", "globe"][n - 1], label: "" }] })) };
    expect(motionProblems(icons, s3).join(" ")).toMatch(/The icon piece is used 3 times \(shots 1, 2, 3\)/);
    expect(motionProblems(icons, s3).join(" ")).toMatch(/Keep it in shot 1 and give shots 2, 3 one of the kinds not used yet: title, headline, counter/);
    expect(motionProblems(icons, s3).join(" ")).not.toMatch(/not used yet:[^.]*\bicon\b/);
    const mixed: MotionPlan = { shots: [
      { shot: 1, pieces: [{ kind: "title", text: "WAIT" }] },
      { shot: 2, pieces: [{ kind: "icon", name: "heart", label: "" }, { kind: "title", text: "WHAT" }] },
      { shot: 3, pieces: [{ kind: "stamp", text: "DENIED" }] },
    ] };
    expect(motionProblems(mixed, s3).join(" ")).toMatch(/The title piece is used 2 times \(shots 1, 2\)/);
    const fine: MotionPlan = { shots: [
      { shot: 1, pieces: [{ kind: "title", text: "WAIT" }] },
      { shot: 2, pieces: [{ kind: "chat", messages: ["How much?"] }] },
      { shot: 3, pieces: [{ kind: "stamp", text: "DENIED" }] },
    ] };
    expect(motionProblems(fine, s3)).toEqual([]);
  });

  it("checks the new pieces and their figures", () => {
    const one = [{ start: 0, end: 2, line: "A fund gets 5% of shares, the rest 95%, about $80 billion, 1 in 10 of $156 billion, on Nov 20, up 12%.", visual: "" }];
    const plan = (piece: Record<string, unknown>): MotionPlan => ({ shots: [{ shot: 1, pieces: [piece as never] }] });
    const ok = [
      { kind: "waffle", percent: 5, label: "of shares" },
      { kind: "people", count: 1, of: 10, label: "" },
      { kind: "stack", to: 80, prefix: "$", suffix: "B" },
      { kind: "flow", from: "Staff", to: "Charity", value: "$80B" },
      { kind: "split", parts: [{ name: "Fund", value: 5 }, { name: "Rest", value: 95 }], unit: "%" },
      { kind: "calendar", month: "Nov", day: "20" },
      { kind: "ticker", name: "ANTHROPIC", value: "$156B", change: "+12%" },
      { kind: "meter", value: 80, of: 156, prefix: "$", unit: "B" },
      { kind: "chat", messages: ["How much?"] },
      { kind: "stamp", text: "IPO", color: "green" },
    ];
    for (const piece of ok) expect(motionProblems(plan(piece), one), piece.kind).toEqual([]);
    expect(motionProblems(plan({ kind: "waffle", percent: 140 }), one).join(" ")).toMatch(/at most 100/);
    expect(motionProblems(plan({ kind: "people", count: 30, of: 10 }), one).join(" ")).toMatch(/no bigger than of/);
    expect(motionProblems(plan({ kind: "stack", to: 99, prefix: "$" }), one).join(" ")).toMatch(/shows 99, which the script never says/);
    expect(motionProblems(plan({ kind: "calendar", month: "Nov" }), one).join(" ")).toMatch(/a day or a weekday/);
    expect(motionProblems(plan({ kind: "stamp", text: "ABSOLUTELY DENIED" }), one).join(" ")).toMatch(/at most 12/);
    expect(pieceFigures({ kind: "split", parts: [{ name: "a", value: 5 }, { name: "b", value: 95 }] })).toEqual(["5", "95"]);
    expect(pieceFigures({ kind: "meter", value: 81.3, of: 156 })).toEqual(["81.3", "156"]);
  });

  it("shows an ad's app screen up to 3 times, never the same screen twice (Thomas, 2026-11-20)", () => {
    const s4 = [0, 1, 2, 3].map((i) => ({ start: i, end: i + 1, line: "x", visual: 'Today: "1,240 of 1,800 cal", "Oatmeal: 320 cal", "Salad: 450 cal"' }));
    const screen = (n: number, extra: Record<string, unknown> = {}) => ({ shot: n, pieces: [{ kind: "app", name: "Free Calorie Counter", screen: "Today", ...extra }] });
    const three: MotionPlan = { shots: [
      screen(1, { button: "+ Add food" }),
      screen(2, { rows: [{ label: "Oatmeal", value: "320 cal" }] }),
      screen(3, { ring: { value: 1240, of: 1800, unit: "cal" }, rows: [{ label: "Oatmeal", value: "320 cal" }, { label: "Salad", value: "450 cal" }], highlight: 1 }),
      { shot: 4, pieces: [{ kind: "title", text: "LINK IN BIO" }] },
    ] };
    expect(motionProblems(three, s4)).toEqual([]);
    const four: MotionPlan = { shots: [three.shots[0]!, three.shots[1]!, three.shots[2]!, screen(4, { button: "Start" })] };
    expect(motionProblems(four, s4).join(" ")).toMatch(/at most 3 times/);
    const same: MotionPlan = { shots: [three.shots[0]!, screen(2, { button: "+ Add food" }), three.shots[3]!] };
    expect(motionProblems(same, s4.slice(0, 3)).join(" ")).toMatch(/Shots 1 and 2 show the same app screen/);
    expect(motionProblems({ shots: [screen(1, { rows: [{ label: "Pizza", value: "999 cal" }] })] }, s4.slice(0, 1)).join(" ")).toMatch(/shows 999, which the script never says/);
    expect(motionProblems({ shots: [screen(1)] }, s4.slice(0, 1)).join(" ")).toMatch(/a ring, rows or a button/);
    expect(pieceFigures({ kind: "app", ring: { value: 1240, of: 1800 }, rows: [{ label: "Oatmeal", value: "320 cal" }] })).toEqual(["1240", "1800", "320"]);
  });
});

describe("one take", () => {
  it("times a voiced shot by its words, not the script's guess", () => {
    const w = [{ word: "hi", start: 0.06, end: 1.4 }];
    const [a, b] = timeline([{ start: 0, end: 5, line: "hi" }, { start: 5, end: 10, line: "hi" }], [{ seconds: 1.4, words: w }, { seconds: 0.5, words: w }], { oneTake: true });
    expect(a!.dur).toBeCloseTo(1.58);
    expect(a!.voiceAt).toBe(0);
    expect(b!.dur).toBe(1.2);
    expect(timeline([{ start: 0, end: 5, line: "hi" }], [{ seconds: 1.4, words: w }])[0]!.dur).toBe(5);
    // A line marked pause gets a beat of silence after it.
    const beat = timeline([{ start: 0, end: 5, line: "hi" }, { start: 5, end: 10, line: "hi", pause: true }], [{ seconds: 1.4, words: w }, { seconds: 0.5, words: w }], { oneTake: true });
    expect(beat[1]!.dur - b!.dur).toBeCloseTo(BEAT, 5);
    // A Reel the voice made too short gets an even pause after each shot, up to 1 s (test run 44850757174).
    const short = timeline([{ start: 0, end: 5, line: "hi" }, { start: 5, end: 10, line: "hi" }], [{ seconds: 1.4, words: w }, { seconds: 0.5, words: w }], { oneTake: true, minSeconds: 4 });
    expect(totalSeconds(short)).toBeCloseTo(4, 5);
    expect(short[1]!.voiceAt).toBeCloseTo(short[1]!.at, 5);
    expect(totalSeconds(timeline([{ start: 0, end: 2, line: "hi" }], [{ seconds: 1, words: w }], { oneTake: true, minSeconds: 28 }))).toBeLessThan(4);
  });

  it("puts no label over a motion shot", () => {
    const t = timeline([{ start: 0, end: 2, line: "Prices rose", onScreenText: "WHO PAYS?" }], [{ seconds: 1, words: [{ word: "Prices", start: 0, end: 0.4 }] }]);
    expect(composeHtml(t, [""], [{ shot: 1, pieces: [{ kind: "title", text: "x" }] }])).toContain('"label":""');
    expect(composeHtml(t, [""])).toContain('"label":"WHO PAYS?"');
  });
});

describe("voice speed", () => {
  it("plays 12% faster unless VOICE_SPEED says otherwise", async () => {
    const { voiceSpeed } = await import("../src/pipeline/produce.ts");
    expect(voiceSpeed()).toBe(1.12);
    process.env.VOICE_SPEED = "1.2";
    expect(voiceSpeed()).toBe(1.2);
    process.env.VOICE_SPEED = "9";
    expect(voiceSpeed()).toBe(1.12);
    delete process.env.VOICE_SPEED;
  });
});

describe("one world the camera flies through (Thomas, 2026-11-20)", async () => {
  const { worldPath, composeHtml, timeline, BRAND, PIECE_Y } = await import("../src/pipeline/compose.ts");
  it("pans beside, slides below, and zooms into the piece", () => {
    const w = worldPath(["cut", "whip", "cut", "zoom", "flash"]);
    expect(w[0]).toEqual({ x: 0, y: 0, z: 1 });
    expect(w[1]!.x).toBe(1180);
    expect(w[2]).toEqual({ x: 1180, y: w[1]!.y + 1560, z: 1 });
    // The zoom's next shot waits inside the current piece, an eighth of its size.
    expect(w[3]!.z).toBe(1 / 8);
    expect(w[3]!.x).toBe(w[2]!.x);
    expect(w[3]!.y + (PIECE_Y - 960) * w[3]!.z).toBeCloseTo(w[2]!.y + (PIECE_Y - 960) * w[2]!.z);
    expect(w[4]!.x - w[3]!.x).toBeCloseTo(1180 / 8);
  });

  it("draws an all-graphics Reel as one world with links, and keeps shot backgrounds for mixed Reels", () => {
    const t = timeline([{ start: 0, end: 2, line: "a" }, { start: 2, end: 4, line: "b" }], [null, null]);
    const m = [{ shot: 1, pieces: [{ kind: "title", text: "A" }] }, { shot: 2, transition: "zoom", pieces: [{ kind: "title", text: "B" }] }];
    const html = composeHtml(t, ["", ""], m);
    expect(html).toContain('<div id="world">');
    expect(html).toContain('<svg id="links"');
    expect(html).toMatch(/const WORLD=\[\{"x":0/);
    const mixed = composeHtml(t, ["", "<svg></svg>"], [m[0]!, null]);
    expect(mixed).not.toContain('<div id="world">');
    expect(mixed).toContain("const WORLD=null");
  });

  it("puts the brand header on every Reel", () => {
    const t = timeline([{ start: 0, end: 2 }], [null]);
    const html = composeHtml(t, ["<svg></svg>"]);
    expect(BRAND).toEqual({ name: "Wright AI Solutions", site: "wright-ai-solutions.com" });
    expect(html).toContain("<b>Wright AI Solutions</b><i>wright-ai-solutions.com</i>");
  });

  it("ends every Reel on the logo and the website (Thomas, 2026-11-20)", () => {
    const t = timeline([{ start: 0, end: 2 }], [null]);
    for (const html of [composeHtml(t, ["<svg></svg>"]), composeHtml(t, [""], [{ shot: 1, pieces: [{ kind: "title", text: "x" }] }]), composeHtml(t, [""], [], "window.physRender=()=>''")]) {
      expect(html).toContain('<div id="endcard"><svg class="mark"');
      expect(html).toContain('M36 8 12 38.7h16.5L25.3 56 49.3 25.3H32.8z');
      expect(html).toContain("<b>Wright AI Solutions</b><i>wright-ai-solutions.com</i></div>");
      expect(html).toContain("if(t>=END_AT)");
    }
    expect(END_CARD).toBeGreaterThanOrEqual(2);
  });

  it("asks an explainer's closing question over the end card (Thomas, 2026-11-20)", () => {
    const t = timeline([{ start: 0, end: 2 }, { start: 2, end: 4, line: "Would you?" }], [null, null]);
    const asked = composeHtml(t, ["", ""], [], "", { endQuestion: "Would you give 5% away?" });
    expect(asked).toContain('<div id="endcard" class="q"><p>Would you give 5% away<em>?</em></p><svg class="mark"');
    expect(asked).toContain("SHOTS[SHOTS.length-1].at+(0)");
    const plain = composeHtml(t, ["", ""]);
    expect(plain).toContain('<div id="endcard"><svg class="mark"');
    expect(plain).toContain("SHOTS[SHOTS.length-1].at+(SHOTS[SHOTS.length-1].dur)");
  });
});

// Fresh graphics (Thomas, 2026-11-21: "I don't want the same eight cards getting used over and over for every
// video. I want it to be creative with every new info graphic").
describe("drawn graphics", () => {
  const chips = (n: number) =>
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 820 900'><g data-a='grow-up'>${Array.from({ length: n }, (_, k) => `<ellipse cx='260' cy='${700 - k * 40}' rx='110' ry='34' fill='#16a34a' stroke='#fff' stroke-width='8'/>`).join("")}</g><rect x='480' y='300' width='220' height='440' rx='20' fill='#facc15' data-a='grow-up' data-t='0.2'/><path d='M120 780 H700' stroke='#fff' stroke-width='10' data-a='draw'/><text x='410' y='200' font-size='120' font-family='Montserrat' font-weight='900' fill='#fff' text-anchor='middle' data-a='count' data-to='35' data-suffix='%'>35%</text><text x='410' y='860' font-size='40' fill='#fff' text-anchor='middle'>MORE PLAYERS</text></svg>`;
  const s1 = [{ start: 0, end: 2, line: "Fenland pubs have 35% more players.", visual: "chips" }];
  const one = (svg: string): MotionPlan => ({ shots: [{ shot: 1, pieces: [{ kind: "draw", svg }] }] });

  it("passes a drawing made of the story's things, and reads its figures", () => {
    expect(motionProblems(one(chips(5)), s1)).toEqual([]);
    expect(pieceFigures({ kind: "draw", svg: chips(5) })).toContain("35");
  });

  it("refuses an unsafe, unreadable or invented drawing", () => {
    const bad = (svg: string) => motionProblems(one(svg), s1).join(" ");
    expect(bad(chips(5).replace("</svg>", "<script>alert(1)</script></svg>"))).toMatch(/not <script>/);
    expect(bad(chips(5).replace("</svg>", "<image href='https://x.test/a.png'/></svg>"))).toMatch(/not <image>|outside itself/);
    expect(bad(chips(5).replace("<rect", "<rect onclick='x()'"))).toMatch(/event handlers/);
    expect(bad(chips(5).replace("font-size='40'", "font-size='20'"))).toMatch(/font-size of at least 34/);
    expect(bad(chips(5).replace("viewBox='0 0 820 900'", "viewBox='0 0 1080 1920'"))).toMatch(/viewBox="0 0 820 900"/);
    expect(bad(chips(5).replace(/data-to='35'/, "data-to='40'").replace(">35%<", ">40%<"))).toMatch(/shows 40, which the script never says/);
    expect(bad(chips(5).replace(/ data-a='[^']*'/g, ""))).toMatch(/at least 2 of its parts/);
    expect(bad(chips(5).replace("data-a='draw'", "data-a='wiggle'"))).toMatch(/isn't one of/);
    expect(bad(chips(5).replace("data-t='0.2'", "data-t='2'"))).toMatch(/0 to 0.6 seconds/);
    expect(bad(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 820 900'><text font-size='60' data-a='pop'>35%</text><text font-size='60' data-a='pop'>MORE</text></svg>`)).toMatch(/nearly empty/);
    expect(motionProblems({ shots: [{ shot: 1, pieces: [{ kind: "draw", svg: chips(5) }, { kind: "title", text: "WOW" }] }] }, s1).join(" ")).toMatch(/a drawing fills the shot on its own/);
  });

  it("lets at most 3 shots use ready-made pieces, the app's screens aside, and no two drawings be the same", () => {
    const sN = Array.from({ length: 5 }, (_, k) => ({ start: k * 2, end: k * 2 + 2, line: "Fenland pubs have 35% more players.", visual: "x" }));
    const kit = ["title", "list", "icon", "quote"].map((kind, k) => ({ shot: k + 1, pieces: [kind === "title" ? { kind, text: "WAIT" } : kind === "list" ? { kind, items: ["a", "b"] } : kind === "icon" ? { kind, name: "phone", label: "x" } : { kind, text: "Fenland pubs have 35% more players.", who: "x" }] }));
    const four = { shots: [...kit, { shot: 5, pieces: [{ kind: "draw", svg: chips(5) }] }] };
    expect(motionProblems(four, sN).join(" ")).toMatch(/4 shots use ready-made pieces \(shots 1, 2, 3, 4\); at most 3/);
    const fresh = { shots: [...kit.slice(0, 3), { shot: 4, pieces: [{ kind: "draw", svg: chips(4) }] }, { shot: 5, pieces: [{ kind: "draw", svg: chips(5) }] }] };
    expect(motionProblems(fresh, sN)).toEqual([]);
    const twins = { shots: [...kit.slice(0, 3), { shot: 4, pieces: [{ kind: "draw", svg: chips(5) }] }, { shot: 5, pieces: [{ kind: "draw", svg: chips(5) }] }] };
    expect(motionProblems(twins, sN).join(" ")).toMatch(/Shots 4 and 5 have the same drawing/);
    expect(repeatedShots(twins)).toEqual([]);
  });

  it("gives every Reel a backdrop, the plan's own or one at random", async () => {
    expect(motionProblems({ ...one(chips(5)), backdrop: "stripes" }, s1).join(" ")).toMatch(/backdrop is one of/);
    const r = await motionPlan(s1, async () => JSON.stringify(one(chips(5))));
    expect(BACKDROPS).toContain(r.plan?.backdrop);
    const own = await motionPlan(s1, async () => JSON.stringify({ ...one(chips(5)), backdrop: "rings" }));
    expect(own.plan?.backdrop).toBe("rings");
    expect(shotMotion(own.plan, 0)?.backdrop).toBe("rings");
    const js = readFileSync(new URL("../pipeline/motion/runtime.js", import.meta.url), "utf8");
    const block = js.slice(js.indexOf("const BACKDROPS = {"), js.indexOf("\n  };", js.indexOf("const BACKDROPS = {")));
    expect([...block.matchAll(/^\s{4}([a-z]+):/gm)].map((m) => m[1]).sort()).toEqual([...BACKDROPS].sort());
  });
});
