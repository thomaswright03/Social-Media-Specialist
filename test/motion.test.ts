// The motion kit (Thomas, 2026-11-19: "the animations are terrible").
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ICONS, KINDS, motionFrom, motionPlan, motionProblems, pieceFigures, THEMES, type MotionPlan } from "../src/pipeline/motion.ts";
import { composeHtml, timeline, transitionFor } from "../src/pipeline/compose.ts";

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
  it("refuses three of a kind running and an icon used twice", () => {
    const s3 = [0, 1, 2].map((i) => ({ start: i, end: i + 1, line: "x", visual: "y" }));
    const icons: MotionPlan = { shots: [1, 2, 3].map((n) => ({ shot: n, pieces: [{ kind: "icon", name: "heart", label: "" }] })) };
    const p = motionProblems(icons, s3).join(" ");
    expect(p).toMatch(/Shots 1 to 3 are all icon/);
    expect(p).toMatch(/The heart icon is used more than once \(shot 2, 3\)/);
  });
});
