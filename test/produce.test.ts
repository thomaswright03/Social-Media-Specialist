import { describe, expect, it } from "vitest";
import { cameraFor, captionChunks, captionWords, composeHtml, repeatsLine, LEAD, MIN_SHOT, TAIL, timeline, totalSeconds } from "../src/pipeline/compose.ts";
import { endQuestionText, keyFrameNumbers, mismatchedShots, picturesLine, picturesVote } from "../src/pipeline/produce.ts";
import { castFrom, castProblems, castSheet, drawScene, missingRefs, NO_CAST, safeSvg, svgFrom, svgProblems, withCast } from "../src/pipeline/scenes.ts";
import { stagePrompt } from "../src/pipeline/stages.ts";

const shapes = '<rect width="1080" height="1920" fill="#0b0d12"/><circle cx="540" cy="900" r="40"/><line x1="0" y1="0" x2="1" y2="1"/><path d="M0 0"/><rect x="1" y="1" width="2" height="2"/><ellipse cx="1" cy="1" rx="1" ry="1"/>';
const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">${shapes}</svg>`;

describe("drawings", () => {
  it("takes the SVG out of a fenced answer", () => {
    expect(svgFrom("Here you go:\n```svg\n" + good + "\n```")).toBe(good);
    expect(svgFrom("no drawing")).toBeNull();
  });

  it("accepts a proper drawing", () => {
    expect(svgProblems(good)).toEqual([]);
  });

  it("refuses the wrong canvas, scripts, outside links, images and near-empty drawings", () => {
    expect(svgProblems(good.replace("0 0 1080 1920", "0 0 100 100")).join()).toMatch(/viewBox/);
    expect(svgProblems(good.replace("</svg>", "<script>alert(1)</script></svg>")).join()).toMatch(/script/);
    expect(svgProblems(good.replace("</svg>", '<use href="https://x.test/a.svg#b"/></svg>')).join()).toMatch(/outside/);
    expect(svgProblems(good.replace("</svg>", '<image href="a.png"/></svg>')).join()).toMatch(/image/);
    expect(svgProblems(good.replace("</svg>", '<style>@import url("https://fonts.x/a.css");</style></svg>')).join()).toMatch(/outside/);
    expect(svgProblems(good.replace("<circle", '<circle onclick="x()"')).join()).toMatch(/event handler/);
    expect(svgProblems('<svg viewBox="0 0 1080 1920"><rect/></svg>').join()).toMatch(/empty/);
    expect(svgProblems(null).length).toBe(1);
  });

  it("strips scripts and handlers as a last guard", () => {
    expect(safeSvg('<svg><script>x</script><rect onload="y()"/></svg>')).toBe("<svg><rect/></svg>");
  });

  it("asks again with what was wrong, and gives up after 3 tries", async () => {
    const prompts: string[] = [];
    const shots = [{ start: 0, end: 2, visual: "A dog types", onScreenText: "DOG TYPES" }];
    const answers = ['<svg viewBox="0 0 10 10"></svg>', good];
    const r = await drawScene(shots, 0, "look", async (p) => (prompts.push(p), answers.shift()!));
    expect(r.svg).toBe(good);
    expect(r.tries).toBe(2);
    expect(prompts[1]).toMatch(/refused: .*viewBox/);
    expect(prompts[0]).toContain('"DOG TYPES"');
    const bad = await drawScene(shots, 0, "look", async () => "nothing");
    expect(bad.svg).toBeNull();
    expect(bad.tries).toBe(3);
  });

  it("draws the cast once and every shot places it", async () => {
    const sheet = '<svg viewBox="0 0 1080 1920"><defs><g id="c-mia" data-note="Mia, 8: pigtails, lime bow"><circle r="70"/></g><g id="p-stand" data-note="the stand"><rect width="2" height="2"/></g></defs></svg>';
    const cast = castFrom("```svg\n" + sheet + "\n```")!;
    expect(cast.parts.map((x) => x.id)).toEqual(["c-mia", "p-stand"]);
    expect(castProblems(cast)).toEqual([]);
    expect(castProblems(castFrom(sheet.replace(/c-mia/, "p-mia"))).join()).toMatch(/no character/);
    expect(castProblems(castFrom(sheet.replace("</defs>", "<script>x</script></defs>"))).join()).toMatch(/script/);
    expect(castProblems(null).length).toBe(1);

    const prompts: string[] = [];
    const answers = ["no", sheet];
    expect((await castSheet([{ visual: "Mia sells" }], "look", async (p) => (prompts.push(p), answers.shift()!))).parts.length).toBe(2);
    expect(prompts[1]).toMatch(/refused/);
    expect(await castSheet([{ visual: "x" }], "look", async () => "nothing")).toEqual(NO_CAST);

    const placed = good.replace("</svg>", '<use href="#c-mia" transform="translate(500 600)"/></svg>');
    expect(missingRefs(placed, cast)).toEqual([]);
    expect(missingRefs(placed, NO_CAST)).toEqual(["c-mia"]);
    expect(withCast(placed, cast)).toContain('height="1920"><defs><g id="c-mia"');

    const shots = [{ start: 0, end: 2, camera: "close-up", place: "the stand", visual: "Mia grins" }];
    const drawn: string[] = [];
    const tries = [good.replace("</svg>", '<use href="#c-bob"/></svg>'), placed];
    const r = await drawScene(shots, 0, "look", async (p) => (drawn.push(p), tries.shift()!), cast);
    expect(r.tries).toBe(2);
    expect(drawn[0]).toMatch(/#c-mia: Mia, 8/);
    expect(drawn[0]).toMatch(/Camera: close-up/);
    expect(drawn[1]).toMatch(/#c-bob, which isn't defined/);
    expect(r.svg).toContain('<g id="c-mia"');
  });

  it("draws in the format's own style", async () => {
    const { formatPrompt } = await import("../src/pipeline/formats.ts");
    const { lookSheet } = await import("../src/pipeline/scenes.ts");
    const seen: string[] = [];
    await lookSheet([{ visual: "marbles drop" }], async (p) => (seen.push(p), "PALETTE\nLIGHT\nCHARACTERS none\nOBJECTS\nPLACES\nSHOT BY SHOT\n1. close-up"), formatPrompt("story", "style"));
    await drawScene([{ start: 0, end: 2, visual: "marbles drop" }], 0, "look", async (p) => (seen.push(p), good), NO_CAST, formatPrompt("explainer", "style"));
    expect(seen[0]).toMatch(/stick figures/);
    expect(seen[1]).toMatch(/editorial motion graphics/);
    expect(seen[1]).not.toMatch(/white stick figures \(stroke #f5f5f5, stroke-width 12 to 18/);
    expect(seen[1]).toMatch(/<cast>\n\(none/);
  });

  it("the art and look prompts exist and fill in", () => {
    expect(stagePrompt(5, { VISUAL: "A dog types", LOOK: "the dog: lime collar" }, "art")).toMatch(/A dog types[\s\S]*Reply with only the SVG/);
    expect(stagePrompt(5, { LOOK: "the dog" }, "art")).toContain("the dog");
    expect(stagePrompt(5, { SHOTS: "1. 0-2 s: x" }, "look")).toContain("1. 0-2 s: x");
    expect(stagePrompt(5, {})).toMatch(/judging stage 5/);
  });
});

describe("timeline", () => {
  const shots = [
    { start: 0, end: 1.5, visual: "a" },
    { start: 1.5, end: 3, visual: "b", line: "short" },
    { start: 3, end: 4, visual: "c", line: "a long line that needs time" },
  ];
  const words = (n: number) => Array.from({ length: n }, (_, i) => ({ word: `w${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));

  it("keeps the scripted length unless the line needs longer, and moves words to where they're heard", () => {
    const t = timeline(shots, [null, { seconds: 0.5, words: words(1) }, { seconds: 3, words: words(6) }]);
    expect(t.map((s) => s.at)).toEqual([0, 1.5, 3]);
    expect(t[1]!.dur).toBe(1.5);
    expect(t[2]!.dur).toBeCloseTo(LEAD + 3 + TAIL);
    expect(t[2]!.voiceAt).toBeCloseTo(3 + LEAD);
    expect(t[2]!.words[1]!.start).toBeCloseTo(3 + LEAD + 0.4);
    expect(totalSeconds(t)).toBeCloseTo(3 + LEAD + 3 + TAIL);
  });

  it("never makes a shot shorter than 1.5 s", () => {
    expect(timeline([{ start: 0, end: 0.4 }], [null])[0]!.dur).toBe(MIN_SHOT);
  });

  it("cuts captions into chunks of up to 3 words, broken at punctuation, each shown until the next", () => {
    const t = timeline([{ start: 0, end: 6, line: "x" }], [
      { seconds: 3, words: ["Go", "home.", "Sleep", "now", "please", "friend"].map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.4 })) },
    ]);
    const c = captionChunks(t);
    expect(c.map((x) => x.words.map((w) => w.word).join(" "))).toEqual(["Go home.", "Sleep now please", "friend"]);
    expect(c[0]!.to).toBeCloseTo(c[1]!.from);
    expect(c[2]!.to).toBeLessThanOrEqual(t[0]!.at + t[0]!.dur);
  });

  it("shows on-screen text as the caption when nobody speaks, and shows it as a small label when it adds something", async () => {
    const [quiet, said, extra] = timeline(
      [
        { start: 0, end: 2, onScreenText: "2:31 AM" },
        { start: 2, end: 4, onScreenText: "IMAGINE YOU OWN THAT SHOP", line: "Imagine you own that shop." },
        { start: 4, end: 6, onScreenText: "DAY 3", line: "He did it again." },
      ],
      [null, { seconds: 1, words: [{ word: "Imagine", start: 0, end: 0.3 }] }, { seconds: 1, words: [{ word: "He", start: 0, end: 0.2 }] }],
    );
    expect(captionWords(quiet!).map((w) => w.word)).toEqual(["2:31", "AM"]);
    expect(repeatsLine(said!.onScreenText, said!.line)).toBe(true);
    const prompts: string[] = [];
    for (const i of [1, 2]) await drawScene([said!, extra!], i - 1, "look", async (p) => (prompts.push(p), good));
    expect(prompts[0]).not.toMatch(/small label/);
    expect(prompts[1]).toMatch(/small label "DAY 3"/);
    const { labelFor } = await import("../src/pipeline/compose.ts");
    expect([labelFor(quiet!), labelFor(said!), labelFor(extra!)]).toEqual(["", "", "DAY 3"]);
    expect(composeHtml([extra!], [good])).toContain('"label":"DAY 3"');
    expect(prompts[1]).toMatch(/caption adds them: "He did it again."/);
    expect(composeHtml([said!], [good])).not.toContain('id="title"');
  });

  it("reads the camera move from the shot", () => {
    expect(cameraFor("Hard push-in on the dog").to).toBeGreaterThan(1.1);
    expect(cameraFor("Hard push-in on the dog").flash).toBe(true);
    expect(cameraFor("Grainy night security-cam view").grain).toBe(true);
    expect(cameraFor("Wide shot: a car").from).toBeGreaterThan(cameraFor("Wide shot: a car").to);
  });

  it("puts every drawing, the text and the caption words on the page, escaped", () => {
    const t = timeline([{ start: 0, end: 2, onScreenText: "<WHO'S THERE?>", line: "x" }], [{ seconds: 1, words: [{ word: "Who's", start: 0, end: 0.3 }] }]);
    const html = composeHtml(t, [good]);
    expect(html).toContain(good);
    expect(html).not.toContain("<WHO'S");
    expect(html).toContain("window.render");
  });

  it("takes key frames from the first shot and spread through the rest", () => {
    const t = timeline(Array.from({ length: 10 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 })), Array(10).fill(null));
    const f = keyFrameNumbers(t);
    expect(f.length).toBe(4);
    expect(f[0]).toBeLessThan(60);
    expect(f.at(-1)).toBeGreaterThan(540);
  });
});

describe("the end card's question", () => {
  it("drops the voice's audio tags (Reel 12 showed \"[CURIOUS]\")", () => {
    expect(endQuestionText("[curious] Who should decide where it goes?")).toBe("Who should decide where it goes?");
    expect(endQuestionText("So [whispers] would you?")).toBe("So would you?");
    expect(endQuestionText(undefined)).toBe("");
  });
});

describe("redrawing the shots a viewer says don't match the voice", () => {
  it("reads the shot numbers from the PICTURES line, within the video", () => {
    const p = picturesLine("Story...\nPICTURES: 02, 05");
    expect(p.ok).toBe(false);
    expect(mismatchedShots(p.detail, 13)).toEqual([2, 5]);
    expect(mismatchedShots("doesn't match the voice: shot-03.jpg and shot-3.jpg, 40", 13)).toEqual([3]);
    expect(mismatchedShots(picturesLine("PICTURES: fine").detail, 13)).toEqual([]);
  });

  it("calls a picture wrong only when 2 of 3 viewers say so (one viewer flagged 4 good shots in test run 44837502299)", () => {
    expect(picturesVote(["PICTURES: 03, 04, 08, 09", "PICTURES: fine", "PICTURES: none"], 13)).toMatchObject({ ok: true, shots: [] });
    expect(picturesVote(["PICTURES: 03, 08", "PICTURES: 08", "PICTURES: fine"], 13)).toMatchObject({ ok: false, shots: [8] });
    expect(picturesVote(["PICTURES: 03, 08", "PICTURES: 08", "PICTURES: fine"], 13).detail).toMatch(/8 \(each flagged by 2\+ of 3 viewers\)/);
    expect(picturesVote(["PICTURES: they don't fit", "PICTURES: the art is off", "PICTURES: fine"], 13)).toMatchObject({ ok: false });
    expect(picturesVote(["PICTURES: fine", "PICTURES: fine", "PICTURES: fine"], 13)).toEqual({ ok: true, shots: [] });
  });
});
