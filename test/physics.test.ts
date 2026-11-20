import { describe, expect, it } from "vitest";
import { collisionAudio, counterText, FINISH_WINDOW, physicsPlan, physicsProblems, physicsRuntime, PHYSICS_KINDS, simulate, tuneRun, type PhysicsPlan } from "../src/pipeline/physics.ts";
import { composeHtml, timeline } from "../src/pipeline/compose.ts";

describe("satisfying videos as physics (Thomas, 2026-11-20)", () => {
  it("refuses plans it can't run", () => {
    expect(physicsProblems(null)).toHaveLength(1);
    expect(physicsProblems({ kind: "lava" as never })[0]).toMatch(/isn't a scene/);
    expect(physicsProblems({ kind: "escape-rings", rings: 40 })[0]).toMatch(/rings is a number from 3 to 14/);
    expect(physicsProblems({ kind: "multiply", balls: 5 })[0]).toMatch(/balls is a number from 60 to 250/);
    expect(physicsProblems({ kind: "galton" as never })[0]).toMatch(/isn't a scene/);
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
    const plan: PhysicsPlan = { kind, ...(kind === "multiply" ? { balls: 80 } : {}) };
    const { run, problem } = tuneRun(plan, 24);
    expect(problem).toBeNull();
    expect(run!.doneAt! / 24).toBeGreaterThanOrEqual(FINISH_WINDOW[0]);
    expect(run!.doneAt! / 24).toBeLessThanOrEqual(FINISH_WINDOW[1]);
  }, 60_000);

  it.each(PHYSICS_KINDS)("never leaves a ball stuck in %s (Thomas, 2026-11-20)", (kind) => {
    for (const seed of [1, 2, 3]) {
      const run = simulate({ kind, ...(kind === "multiply" ? { balls: 80 } : {}) }, 24, seed);
      const still = new Map<number, number>();
      run.frames.forEach((f, k) => {
        if (k === 0) return;
        const prev = run.frames[k - 1]!.b;
        for (let i = 0; i < Math.min(prev.length, f.b.length); i += 4) {
          // Finished race balls rest below the hole on purpose.
          if (f.b[i + 1]! >= 1590) continue;
          const moved = Math.hypot(f.b[i]! - prev[i]!, f.b[i + 1]! - prev[i + 1]!);
          still.set(i, moved < 1 ? (still.get(i) ?? 0) + 1 : 0);
          expect(still.get(i)!, `${kind} seed ${seed}: ball ${i / 4} still at ${f.b[i]},${f.b[i + 1]} at ${(k / 30).toFixed(1)} s`).toBeLessThan(30);
        }
      });
    }
  }, 60_000);

  it("doubles in multiply: each ball makes another, so the count grows faster and faster", () => {
    const run = simulate({ kind: "multiply", balls: 120 }, 30);
    const count = (s: number) => run.frames[Math.round(s * 30)]!.b.length / 4;
    const firstHalf = count(run.doneAt! / 2) - 1;
    const secondHalf = count(run.doneAt!) - count(run.doneAt! / 2);
    expect(secondHalf).toBeGreaterThan(firstHalf * 3);
    expect(counterText({ kind: "multiply" }, 50, null, false)).toBe("50% FULL");
  });

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
    expect(counterText({ kind: "multiply", counter: "{n}% filled" }, 12, null, false)).toBe("12% FILLED");
  });

  it("never lets a counter call {n} something the scene doesn't count (test run 3 showed \"GEN 42 OF 10\")", () => {
    // multiply counts percent full, not balls or generations.
    expect(counterText({ kind: "multiply", counter: "GEN {n} OF 10" }, 42, null, false)).toBe("42% FULL");
    expect(counterText({ kind: "multiply", counter: "{n} balls" }, 12, null, false)).toBe("12% FULL");
    expect(counterText({ kind: "growing-ball", counter: "{n} BOUNCES SO FAR" }, 7, null, false)).toBe("7 BOUNCES SO FAR");
    expect(physicsProblems({ kind: "multiply", counter: "GEN {n} OF 10" })[0]).toMatch(/percent|% FULL/);
    expect(physicsProblems({ kind: "escape-rings", counter: "{n} RINGS LEFT" })).toEqual([]);
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
