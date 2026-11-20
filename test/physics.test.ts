import { describe, expect, it } from "vitest";
import { collisionAudio, counterText, FINISH_WINDOW, physicsPlan, physicsProblems, physicsRuntime, PHYSICS_KINDS, simulate, tuneRun, type PhysicsPlan } from "../src/pipeline/physics.ts";
import { composeHtml, timeline } from "../src/pipeline/compose.ts";

describe("satisfying videos as physics (Thomas, 2026-11-20)", () => {
  it("refuses plans it can't run", () => {
    expect(physicsProblems(null)).toHaveLength(1);
    expect(physicsProblems({ kind: "lava" as never })[0]).toMatch(/isn't a scene/);
    expect(physicsProblems({ kind: "escape-rings", rings: 40 })[0]).toMatch(/rings is a number from 3 to 14/);
    expect(physicsProblems({ kind: "galton", balls: 5 })[0]).toMatch(/balls is a number from 30 to 160/);
    expect(physicsProblems({ kind: "race", counter: "LAPS" })[0]).toMatch(/\{n\}/);
    expect(physicsProblems({ kind: "escape-rings", rings: 8, gap: 30, balls: 1, palette: "neon", counter: "{n} RINGS LEFT" })).toEqual([]);
  });

  it("runs the same way every time", () => {
    const a = simulate({ kind: "escape-rings", rings: 5 }, 4, 3);
    const b = simulate({ kind: "escape-rings", rings: 5 }, 4, 3);
    expect(a.frames).toEqual(b.frames);
    expect(a.frames).toHaveLength(120);
    expect(a.events.length).toBeGreaterThan(0);
  });

  it.each(PHYSICS_KINDS)("tunes %s so its finish lands late in the video", (kind) => {
    const plan: PhysicsPlan = { kind, ...(kind === "galton" ? { balls: 50 } : kind === "multiply" ? { balls: 40 } : {}) };
    const { run, problem } = tuneRun(plan, 24);
    expect(problem).toBeNull();
    expect(run!.doneAt! / 24).toBeGreaterThanOrEqual(FINISH_WINDOW[0]);
    expect(run!.doneAt! / 24).toBeLessThanOrEqual(FINISH_WINDOW[1]);
  }, 60_000);

  it("asks again when the plan is refused, then runs it", async () => {
    const asks: string[] = [];
    const answers = ['{"kind":"escape-rings","rings":99}', '{"kind":"escape-rings","rings":6,"gap":40}'];
    const r = await physicsPlan([{ visual: "a ball in rings", onScreenText: "WILL IT ESCAPE?" }], "A ball breaks out of 6 rings.", 20, async (p) => (asks.push(p), answers.shift()!));
    expect(asks).toHaveLength(2);
    expect(asks[0]).toMatch(/escape-rings/);
    expect(asks[1]).toMatch(/rings is a number from 3 to 14/);
    expect(r.problems).toEqual([]);
    expect(r.run!.doneAt).toBeGreaterThan(20 * FINISH_WINDOW[0]);
  }, 60_000);

  it("makes its own music from the collisions", () => {
    const run = simulate({ kind: "escape-rings", rings: 4 }, 3);
    const wav = collisionAudio(run);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.length).toBe(44 + 3 * 44100 * 2);
    let loud = 0;
    for (let i = 44; i < wav.length; i += 2) loud = Math.max(loud, Math.abs(wav.readInt16LE(i)));
    expect(loud).toBeGreaterThan(1000);
  });

  it("counts toward the finish, then names it", () => {
    expect(counterText({ kind: "escape-rings" }, 5, null, false)).toBe("5 RINGS LEFT");
    expect(counterText({ kind: "escape-rings" }, 0, null, true)).toBe("FREE!");
    expect(counterText({ kind: "race", names: ["Lime", "Rose"] }, 0, null, false)).toBe("WHICH COLOUR WINS?");
    expect(counterText({ kind: "race", names: ["Lime", "Rose"] }, 1, null, false)).toBe("LAP 2 OF 3");
    expect(counterText({ kind: "race", names: ["Lime", "Rose"] }, 3, 1, true)).toBe("ROSE WINS!");
    expect(counterText({ kind: "multiply", counter: "{n} balls" }, 12, null, false)).toBe("12 BALLS");
  });

  it("draws the run behind the words, with the hook and the counter", () => {
    const t = timeline([{ start: 0, end: 2, onScreenText: "WILL IT ESCAPE?" }, { start: 2, end: 4, onScreenText: "" }], [null, null]);
    const html = composeHtml(t, ["", ""], [], physicsRuntime(simulate({ kind: "escape-rings", rings: 4 }, 4)));
    expect(html).toContain('<canvas id="phys"');
    expect(html).toContain("window.PHYS=");
    expect(html).toContain('"label":"WILL IT ESCAPE?"');
    expect(html).not.toContain('"tr":"whip"');
  });
});
