// Satisfying videos as real physics (Thomas, 2026-11-20: "let's use all of
// these"). Accounts like @CodeCraftedPhysics show simulated balls and rings,
// one continuous shot, where every bounce plays a note. Claude picks one of a
// few ready-made scenes and fills in its settings as JSON; Matter.js runs it
// here, frame by frame and the same way every time; the browser only draws
// what was recorded, and the notes are made here from the collisions, so the
// music is ours. Code checks the plan and measures the run: the finish has to
// land late in the video, not in the first seconds or after it ends.
import Matter from "matter-js";
import type { Shot } from "./gates.ts";
import { parseJson, stagePrompt } from "./stages.ts";

type Ask = (p: string) => Promise<string>;

// Every scene has an end the viewer roots for (Thomas, 2026-11-20): getting free, winning, filling it up.
// The bell curve (galton) was dropped: the balls just fall and there is nothing to hope for.
export const PHYSICS_KINDS = ["escape-rings", "growing-ball", "multiply", "race"] as const;
export type PhysicsKind = (typeof PHYSICS_KINDS)[number];
export const PALETTES = {
  neon: { bg: ["#07070f", "#141432"], colors: ["#39ff88", "#ff3df2", "#33d6ff", "#ffe23d", "#ff6a3d"] },
  sunset: { bg: ["#140812", "#3a1426"], colors: ["#ff8a3d", "#ff3d6e", "#ffd23d", "#c23dff", "#3dffd8"] },
  ocean: { bg: ["#03101a", "#0a2a40"], colors: ["#3dd8ff", "#3dffb0", "#ffffff", "#7a8cff", "#ffd23d"] },
  candy: { bg: ["#120a1c", "#2c1240"], colors: ["#ff9ad5", "#9ad5ff", "#c4ff9a", "#ffe49a", "#d59aff"] },
} as const;
export type Palette = keyof typeof PALETTES;
export const PHYSICS_TRIES = 3;
/** Formats made as physics rather than drawings. */
export const USES_PHYSICS = { satisfying: true, story: false, explainer: false, ad: false } as const;

export type PhysicsPlan = {
  kind: PhysicsKind;
  palette?: Palette;
  /** escape-rings: how many rings (3 to 14). */
  rings?: number;
  /** escape-rings, race: balls (1 to 4); multiply: how many balls fill the circle (60 to 250). */
  balls?: number;
  /** escape-rings: the gap in each ring, in degrees (18 to 70). */
  gap?: number;
  /** How the counter reads; {n} is the number, e.g. "{n} RINGS LEFT". */
  counter?: string;
  /** race: the colours' names, in order, shown when one wins. */
  names?: string[];
};

export type SimEvent = { t: number; kind: "hit" | "break" | "spawn" | "win" | "done"; strength: number };
/** One recorded frame: balls as [x, y, r, colour], ring angles, which rings are still there, the counter. */
export type SimFrame = { b: number[]; a: number[]; on: number[]; n: number };
export type SimResult = {
  plan: PhysicsPlan;
  seconds: number;
  fps: number;
  frames: SimFrame[];
  /** Fixed scenery: rings [radius, gapStart, gapSize, colour], pegs [x, y, r], walls [x, y, w, h]. */
  scene: { rings: number[][]; pegs: number[][]; walls: number[][]; arena: [number, number, number] | null };
  events: SimEvent[];
  doneAt: number | null;
  winner: number | null;
  tempo: number;
  /** How many times a ball had to be kicked loose. */
  kicks: number;
};

const W = 1080;
const CX = 540;
// Low enough to leave room for the brand header, the hook and the counter above it.
const CY = 940;
const R = 440;
const STEPS = 8;
/** Seconds a ball may sit still before it's kicked loose. */
export const STUCK_AFTER = 0.5;
const RACE_BALL = 20;
/** multiply: balls sized so `balls` of them fill the circle. */
const multiplyRadius = (plan: PhysicsPlan) => Math.max(14, Math.min(40, Math.sqrt((0.5 * (R - 15) ** 2) / int(plan.balls, 150, 60, 250))));
/** Laps in a race. */
export const RACE_LAPS = 3;

/** A small seeded random, so every run of a plan is the same video. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const int = (v: unknown, d: number, lo: number, hi: number) => clamp(Math.round(Number.isFinite(Number(v)) ? Number(v) : d), lo, hi);

/** A ring of short wall pieces around the centre, open where the gap is. */
function ringBody(radius: number, gapStart: number, gap: number, thick = 16): Matter.Body {
  const parts: Matter.Body[] = [];
  const n = Math.max(24, Math.round((2 * Math.PI * radius) / 26));
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) * ((2 * Math.PI) / n);
    const rel = (((a - gapStart) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (rel < gap) continue;
    const len = ((2 * Math.PI * radius) / n) * 1.15;
    parts.push(Matter.Bodies.rectangle(CX + Math.cos(a) * radius, CY + Math.sin(a) * radius, thick, len, { angle: a, isStatic: true }));
  }
  const body = Matter.Body.create({ parts, isStatic: true, restitution: 1, friction: 0 });
  // A compound body's centre is its parts' average; put the pivot back on the centre.
  Matter.Body.setCentre(body, { x: CX, y: CY }, false);
  return body;
}

function ball(x: number, y: number, r: number, colour: number, bounce = 1): Ball {
  const b = Matter.Bodies.circle(x, y, r, { restitution: bounce, friction: 0, frictionAir: 0, frictionStatic: 0, inertia: Infinity, slop: 0.01 });
  (b as Matter.Body & { colour: number; r: number }).colour = colour;
  (b as Matter.Body & { colour: number; r: number }).r = r;
  return b as Ball;
}
type Ball = Matter.Body & { colour: number; r: number; landed?: boolean; stillSince?: number; readyAt?: number };

/** Runs a plan for `seconds` and records every frame, collision and the finish. */
export function simulate(plan: PhysicsPlan, seconds: number, seed = 1, tempo = 1, fps = 30): SimResult {
  const rand = rng(seed * 7919 + 13);
  const engine = Matter.Engine.create({ positionIterations: 10, velocityIterations: 10 });
  engine.gravity.y = 1;
  const world = engine.world;
  const balls: Ball[] = [];
  const scene: SimResult["scene"] = { rings: [], pegs: [], walls: [], arena: null };
  const events: SimEvent[] = [];
  const frames: SimFrame[] = [];
  const rings: { body: Matter.Body; radius: number; spin: number; on: boolean }[] = [];
  let doneAt: number | null = null;
  let winner: number | null = null;
  let counter = 0;
  let kicks = 0;
  let t = 0;
  const steps = plan.kind === "multiply" ? 4 : STEPS;
  const dt = 1000 / fps / steps;
  const add = (b: Ball) => {
    balls.push(b);
    Matter.Composite.add(world, b);
  };
  // Speed limits in Matter's units (px per 16.7 ms).
  let minSpeed = 0;
  let maxSpeed = 30;
  let arena: Matter.Body | null = null;
  const kind = plan.kind;

  if (kind === "escape-rings") {
    const n = int(plan.rings, 8, 3, 14);
    const gap = (clamp(Number(plan.gap) || 34, 18, 70) * Math.PI) / 180;
    const inner = 120;
    const step = (R - inner) / Math.max(1, n - 1);
    for (let i = 0; i < n; i++) {
      const radius = inner + i * step;
      const start = rand() * Math.PI * 2;
      const body = ringBody(radius, start, gap * (1 + i * 0.03));
      Matter.Composite.add(world, body);
      rings.push({ body, radius, spin: (i % 2 ? -1 : 1) * (0.55 + 0.12 * i) * tempo, on: true });
      scene.rings.push([radius, start, gap * (1 + i * 0.03), i]);
    }
    const nb = int(plan.balls, 1, 1, 4);
    for (let k = 0; k < nb; k++) {
      const b = ball(CX + (k - (nb - 1) / 2) * 30, CY, 16, k);
      Matter.Body.setVelocity(b, { x: (rand() - 0.5) * 14, y: -6 - rand() * 6 });
      add(b);
    }
    engine.gravity.y = 0.5;
    minSpeed = 10;
    maxSpeed = 18;
    counter = n;
  } else if (kind === "growing-ball" || kind === "multiply") {
    arena = ringBody(R, 0, 0, 30);
    Matter.Composite.add(world, arena);
    scene.arena = [CX, CY, R];
    const b = ball(CX + (rand() - 0.5) * 80, CY - 150, kind === "multiply" ? multiplyRadius(plan) : 22, 0);
    Matter.Body.setVelocity(b, { x: (rand() - 0.5) * 16, y: 0 });
    add(b);
    minSpeed = 6;
    maxSpeed = 18;
    counter = kind === "multiply" ? 1 : 0;
    if (kind === "multiply") engine.gravity.y = 0.35;
  } else if (kind === "race") {
    const left = 120;
    const right = W - 120;
    const top = 520;
    const rows = 13;
    const gapX = (right - left) / 10;
    for (let r = 0; r < rows; r++) {
      const y = top + r * 52;
      const off = r % 2 ? gapX / 2 : 0;
      for (let x = left + off; x <= right + 1; x += gapX) {
        // No peg close enough to a wall to trap a ball between them.
        if (x - 8 - (left - 40) < RACE_BALL * 2 + 14 || right + 40 - (x + 8) < RACE_BALL * 2 + 14) continue;
        const p = Matter.Bodies.circle(x, y, 8, { isStatic: true, restitution: 0.5, friction: 0 });
        Matter.Composite.add(world, p);
        scene.pegs.push([x, y, 8]);
      }
    }
    const wall = (x: number, y: number, w: number, h: number) => {
      Matter.Composite.add(world, Matter.Bodies.rectangle(x + w / 2, y + h / 2, w, h, { isStatic: true, friction: 0, restitution: 0.3 }));
      scene.walls.push([x, y, w, h]);
    };
    wall(left - 60, 380, 20, 1060);
    wall(right + 40, 380, 20, 1060);
    wall(left - 60, 1440, right - left + 120, 20);
    {
      // A funnel to one hole at the bottom.
      Matter.Composite.add(world, Matter.Bodies.rectangle(CX - 250, 1270, 420, 18, { isStatic: true, angle: 0.32, friction: 0, restitution: 0.3 }));
      Matter.Composite.add(world, Matter.Bodies.rectangle(CX + 250, 1270, 420, 18, { isStatic: true, angle: -0.32, friction: 0, restitution: 0.3 }));
      scene.walls.push([CX - 460, 1261, 420, 18, 0.32], [CX + 40, 1261, 420, 18, -0.32]);
      const nb = int(plan.balls, 4, 2, 4);
      for (let k = 0; k < nb; k++) add(ball(CX + (k - (nb - 1) / 2) * 70 + (rand() - 0.5) * 10, 430, RACE_BALL, k, 0.55));
      counter = 0;
      engine.gravity.y = 0.45 * tempo;
    }
  }

  const laps = new Map<number, number>();
  // multiply: each ball makes a new one on its next wall hit once it's ready, so the count doubles again and again.
  const most = int(plan.balls, 150, 60, 250);
  const cooldown = (0.7 * seconds * Math.LN2) / Math.log(most) / tempo;
  const lastHit = new Map<number, number>();
  Matter.Events.on(engine, "collisionStart", (e) => {
    for (const pair of e.pairs) {
      const a = pair.bodyA.parent as Ball;
      const b = pair.bodyB.parent as Ball;
      const mover = balls.includes(a) ? a : balls.includes(b) ? b : null;
      if (!mover) continue;
      const other = mover === a ? b : a;
      const speed = Matter.Body.getSpeed(mover);
      if (speed < 1.2) continue;
      if ((lastHit.get(mover.id) ?? -1) > t - 0.04) continue;
      lastHit.set(mover.id, t);
      events.push({ t, kind: "hit", strength: clamp(speed / 14, 0.15, 1) });
      if (kind === "growing-ball" && other === arena && doneAt == null) {
        // Sized so it fills the circle after about the bounces it makes in 70% of the video.
        const grow = Math.exp((Math.log((R * 0.92) / 22) / (1.6 * 0.7 * seconds)) * tempo);
        const target = Math.min(mover.r * grow, R * 0.93);
        Matter.Body.scale(mover, target / mover.r, target / mover.r);
        mover.r = target;
        counter++;
        if (mover.r >= R * 0.92) {
          doneAt = t;
          events.push({ t, kind: "done", strength: 1 });
        }
      }
      if (kind === "multiply" && other === arena && doneAt == null) {
        const max = most;
        if (t >= (mover.readyAt ?? 0) && balls.length < max) {
          mover.readyAt = t + cooldown;
          const nb = ball(mover.position.x, mover.position.y, multiplyRadius(plan), balls.length % 5);
          nb.readyAt = t + cooldown;
          Matter.Body.setVelocity(nb, { x: -mover.velocity.x * 0.9 + (rand() - 0.5) * 3, y: -mover.velocity.y * 0.9 });
          // Spawn just inside the wall.
          const dx = CX - mover.position.x;
          const dy = CY - mover.position.y;
          const d = Math.hypot(dx, dy) || 1;
          Matter.Body.setPosition(nb, { x: mover.position.x + (dx / d) * 30, y: mover.position.y + (dy / d) * 30 });
          add(nb);
          counter = Math.round((100 * balls.length) / max);
          events.push({ t, kind: "spawn", strength: 0.6 });
          if (balls.length >= max) {
            doneAt = t;
            events.push({ t, kind: "done", strength: 1 });
          }
        }
      }
    }
  });

  const total = Math.round(seconds * fps);
  for (let f = 0; f < total; f++) {
    for (let s = 0; s < steps; s++) {
      t += dt / 1000;
      for (const r of rings) if (r.on) Matter.Body.setAngle(r.body, r.body.angle + (r.spin * dt) / 1000);
      Matter.Engine.update(engine, dt);
      for (const b of balls) {
        const sp = Matter.Body.getSpeed(b);
        if (minSpeed && sp < minSpeed && sp > 0.001) Matter.Body.setSpeed(b, minSpeed);
        else if (sp > maxSpeed) Matter.Body.setSpeed(b, maxSpeed);
        // Nothing gets stuck (Thomas, 2026-11-20): a ball that has barely moved
        // for STUCK_AFTER seconds, and isn't finished, gets a kick up and inward.
        if (b.landed || Matter.Body.getSpeed(b) > 0.8) b.stillSince = undefined;
        else if (b.stillSince == null) b.stillSince = t;
        else if (t - b.stillSince > STUCK_AFTER) {
          const dx = CX - b.position.x;
          Matter.Body.setVelocity(b, { x: Math.sign(dx || (rand() - 0.5)) * (2 + rand() * 2), y: -3 - rand() * 2 });
          b.stillSince = undefined;
          kicks++;
        }
      }
      if (kind === "escape-rings") {
        for (const b of balls) {
          const d = Math.hypot(b.position.x - CX, b.position.y - CY);
          const next = rings.find((r) => r.on);
          if (next && d > next.radius + 14) {
            next.on = false;
            Matter.Composite.remove(world, next.body);
            counter--;
            events.push({ t, kind: "break", strength: 1 - counter / Math.max(1, rings.length) });
            if (!rings.some((r) => r.on) && doneAt == null) {
              doneAt = t;
              events.push({ t, kind: "done", strength: 1 });
            }
          }
          // Keep balls on screen once they're out.
          if (d > R + 60) {
            const nx = (b.position.x - CX) / d;
            const ny = (b.position.y - CY) / d;
            const vn = b.velocity.x * nx + b.velocity.y * ny;
            if (vn > 0) Matter.Body.setVelocity(b, { x: b.velocity.x - 2 * vn * nx, y: b.velocity.y - 2 * vn * ny });
          }
        }
      }
      if (kind === "race") {
        for (const b of balls) {
          if (b.landed) continue;
          if (kind === "race" && b.position.y > 1420) {
            const lap = (laps.get(b.colour) ?? 0) + 1;
            laps.set(b.colour, lap);
            counter = Math.max(counter, lap);
            if (lap >= RACE_LAPS) {
              b.landed = true;
              if (winner == null) {
                winner = b.colour;
                doneAt = t;
                events.push({ t, kind: "win", strength: 1 });
              }
            } else {
              // Back to the top for the next lap.
              Matter.Body.setPosition(b, { x: CX + (rand() - 0.5) * 240, y: 430 });
              Matter.Body.setVelocity(b, { x: (rand() - 0.5) * 2, y: 0 });
              events.push({ t, kind: "break", strength: lap / RACE_LAPS });
            }
          }
        }
        {
          // Finished balls rest below the hole.
          for (const b of balls) if (b.landed && b.position.y > 1600) Matter.Body.setPosition(b, { x: CX + (b.colour - 1.5) * 50, y: 1600 }), Matter.Body.setVelocity(b, { x: 0, y: 0 });
        }
      }
    }
    frames.push({
      b: balls.flatMap((b) => [Math.round(b.position.x), Math.round(b.position.y), Math.round(b.r), b.colour]),
      a: rings.map((r) => Math.round(r.body.angle * 1000) / 1000),
      on: rings.map((r) => (r.on ? 1 : 0)),
      n: counter,
    });
  }
  Matter.Engine.clear(engine);
  return { plan, seconds, fps, frames, scene, events, doneAt, winner, tempo, kicks };
}

/** What's wrong with a plan before it's run; an empty list when it can run. */
export function physicsProblems(plan: PhysicsPlan | null): string[] {
  if (!plan) return ['There was no JSON with "kind" in the answer.'];
  const p: string[] = [];
  if (!(PHYSICS_KINDS as readonly string[]).includes(plan.kind)) p.push(`"${plan.kind}" isn't a scene; use one of ${PHYSICS_KINDS.join(", ")}.`);
  if (plan.palette != null && !(plan.palette in PALETTES)) p.push(`palette is one of ${Object.keys(PALETTES).join(", ")}.`);
  const range = (v: unknown, lo: number, hi: number, what: string) => {
    if (v != null && !(Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi)) p.push(`${what} is a number from ${lo} to ${hi}.`);
  };
  range(plan.rings, 3, 14, "rings");
  range(plan.gap, 18, 70, "gap");
  if (plan.kind === "multiply") range(plan.balls, 60, 250, "balls");
  else range(plan.balls, 1, 4, "balls");
  if (plan.counter != null && (typeof plan.counter !== "string" || !plan.counter.includes("{n}") || plan.counter.length > 24)) p.push('counter is short text with {n} in it, like "{n} RINGS LEFT" (at most 24 characters).');
  if (plan.kind === "race" && plan.names != null && (!Array.isArray(plan.names) || plan.names.some((n) => typeof n !== "string" || n.length > 10))) p.push("names are short colour names, at most 10 characters each.");
  return p;
}

/** The finish has to land in this part of the video: late enough to build, early enough to be seen. */
export const FINISH_WINDOW = [0.55, 0.9] as const;

/** Runs the plan with different seeds and tempos until the finish lands in FINISH_WINDOW. */
export function tuneRun(plan: PhysicsPlan, seconds: number, tries = 24): { run: SimResult | null; problem: string | null } {
  const tempos = [1, 0.8, 1.25, 0.65, 1.5, 1.9];
  let closest: SimResult | null = null;
  const off = (r: SimResult) => {
    if (r.doneAt == null) return Infinity;
    const at = r.doneAt / seconds;
    return at < FINISH_WINDOW[0] ? FINISH_WINDOW[0] - at : at > FINISH_WINDOW[1] ? at - FINISH_WINDOW[1] : 0;
  };
  for (let k = 0; k < tries; k++) {
    const r = simulate(plan, seconds, k + 1, tempos[k % tempos.length]!);
    if (off(r) === 0) return { run: r, problem: null };
    if (!closest || off(r) < off(closest)) closest = r;
  }
  const at = closest?.doneAt;
  return { run: null, problem: at == null ? `the ${plan.kind} never finished in ${seconds.toFixed(0)} s` : `the ${plan.kind} finished at ${at.toFixed(1)} s of ${seconds.toFixed(0)} s at best` };
}

/** Claude's plan, asked again with what was wrong, then tuned by running it. */
export async function physicsPlan(shots: Shot[], story: string, seconds: number, ask: Ask, log?: (m: string) => void): Promise<{ plan: PhysicsPlan | null; run: SimResult | null; problems: string[] }> {
  let problems: string[] = [];
  let best: { plan: PhysicsPlan | null; run: SimResult | null; problems: string[] } = { plan: null, run: null, problems: ["no answer"] };
  for (let t = 1; t <= PHYSICS_TRIES; t++) {
    const prompt = stagePrompt(5, { STORY: story, SHOTS: shots.map((s, i) => `${i + 1}. ${s.visual ?? ""}${s.onScreenText ? ` (on screen: ${s.onScreenText})` : ""}`).join("\n"), SECONDS: seconds.toFixed(0), PROBLEMS: problems.length ? `Your last plan was refused: ${problems.join(" ")} Fix that.` : "" }, "physics");
    const plan = parseJson<PhysicsPlan>(await ask(prompt).catch(() => ""));
    problems = physicsProblems(plan);
    if (!problems.length) {
      const tuned = tuneRun(plan!, seconds);
      if (tuned.run) {
        log?.(`Physics: ${plan!.kind}, finishing at ${tuned.run.doneAt!.toFixed(1)} s of ${seconds.toFixed(0)} s (seed tuned, tempo ${tuned.run.tempo}).`);
        return { plan, run: tuned.run, problems: [] };
      }
      problems = [`When run, ${tuned.problem}; pick settings that take longer or shorter, or another scene.`];
    }
    if (!best.plan || problems.length <= best.problems.length) best = { plan, run: null, problems };
  }
  log?.(`The physics plan still has problems after ${PHYSICS_TRIES} tries: ${best.problems.join(" ")}`);
  return best;
}

// --- Sound: our own notes, one per collision -------------------------------

/** An original chord loop (I, V, vi, IV in C), played one note per hit, rising as it goes. */
const CHORDS = [
  [60, 64, 67, 72],
  [55, 59, 62, 67],
  [57, 60, 64, 69],
  [53, 57, 60, 65],
];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The collisions as music: a 44.1 kHz mono WAV. */
export function collisionAudio(run: SimResult, rate = 44100): Buffer {
  const n = Math.ceil(run.seconds * rate);
  const out = new Float32Array(n);
  const tone = (at: number, f: number, amp: number, decay: number, bright = 0.3) => {
    const start = Math.floor(at * rate);
    const len = Math.min(n - start, Math.floor(rate * decay * 5));
    for (let i = 0; i < len; i++) {
      const s = i / rate;
      const env = Math.exp(-s / decay) * Math.min(1, s / 0.003);
      out[start + i]! += amp * env * (Math.sin(2 * Math.PI * f * s) + bright * Math.sin(4 * Math.PI * f * s) + bright * 0.4 * Math.sin(6 * Math.PI * f * s));
    }
  };
  const noise = rng(99);
  const burst = (at: number, amp: number) => {
    const start = Math.floor(at * rate);
    let lp = 0;
    for (let i = 0; i < Math.min(n - start, rate * 0.5); i++) {
      lp += 0.2 * (noise() * 2 - 1 - lp);
      out[start + i]! += amp * lp * Math.exp(-i / (rate * 0.12));
    }
  };
  let k = 0;
  let lastAt = -1;
  for (const e of run.events) {
    if (e.kind === "hit" || e.kind === "spawn") {
      if (e.t - lastAt < 0.035) continue;
      lastAt = e.t;
      const chord = CHORDS[Math.floor(k / 8) % CHORDS.length]!;
      const lift = 12 * Math.min(1, Math.floor(k / 32) / 2);
      const note = chord[k % chord.length]! + Math.round(lift);
      tone(e.t, hz(note), 0.16 + 0.14 * e.strength, 0.22);
      k++;
    } else if (e.kind === "break") {
      const chord = CHORDS[Math.floor(k / 8) % CHORDS.length]!;
      for (const m of chord) tone(e.t, hz(m - 12), 0.09, 0.5, 0.2);
      burst(e.t, 0.35);
    } else {
      // The finish: a full, bright chord with a low root.
      for (const m of [48, 60, 64, 67, 72, 76]) tone(e.t, hz(m), 0.11, 1.1, 0.25);
      burst(e.t, 0.5);
    }
  }
  // Soft limit, then 16-bit.
  const pcm = Buffer.alloc(44 + n * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.tanh(out[i]!) * 32000), 44 + i * 2);
  return pcm;
}

/** The counter's words for a frame. */
export function counterText(plan: PhysicsPlan, n: number, winner: number | null, done: boolean): string {
  if (plan.kind === "race") {
    if (winner == null) return n ? `LAP ${Math.min(n + 1, RACE_LAPS)} OF ${RACE_LAPS}` : "WHICH COLOUR WINS?";
    const names = plan.names?.length ? plan.names : ["GREEN", "PINK", "BLUE", "YELLOW"];
    return `${(names[winner] ?? "?").toUpperCase()} WINS!`;
  }
  if (done) return plan.kind === "escape-rings" ? "FREE!" : plan.kind === "growing-ball" ? `FULL IN ${n} BOUNCES!` : "FULL!";
  const fallback = { "escape-rings": "{n} RINGS LEFT", "growing-ball": "{n} BOUNCES", multiply: "{n}% FULL", race: "" }[plan.kind];
  return (plan.counter?.includes("{n}") ? plan.counter : fallback).replace("{n}", String(n)).toUpperCase();
}

/** The browser code that draws a recorded run (data in window.PHYS); it draws into canvas#phys. */
export function physicsRuntime(run: SimResult): string {
  const pal = PALETTES[run.plan.palette ?? "neon"] ?? PALETTES.neon;
  const doneFrame = run.doneAt == null ? Infinity : Math.floor(run.doneAt * run.fps);
  const counters = run.frames.map((f, i) => counterText(run.plan, f.n, i >= doneFrame ? run.winner : null, i >= doneFrame));
  const data = { fps: run.fps, frames: run.frames.map((f) => [f.b, f.a, f.on]), scene: run.scene, pal, counters, kind: run.plan.kind, doneFrame: Number.isFinite(doneFrame) ? doneFrame : -1 };
  return `window.PHYS=${JSON.stringify(data).replace(/</g, "\\u003c")};
(function(){
const P=window.PHYS, c=document.getElementById('phys'), g=c.getContext('2d');
const CX=${CX}, CY=${CY};
const col=(i)=>P.pal.colors[i%P.pal.colors.length];
function frame(k){ return P.frames[Math.max(0,Math.min(P.frames.length-1,k))]; }
function draw(k, alpha){
  const [b,a,on]=frame(k);
  g.globalAlpha=alpha;
  // Rings: thick neon arcs with their gap.
  P.scene.rings.forEach((r,i)=>{ if(!on[i]) return; const [rad,start,gap]=r; const ang=a[i]||0;
    g.save(); g.shadowColor=col(i); g.shadowBlur=24; g.strokeStyle=col(i); g.lineWidth=12; g.lineCap='round';
    g.beginPath(); g.arc(CX,CY,rad,start+ang+gap,start+ang+Math.PI*2); g.stroke(); g.restore(); });
  if(P.scene.arena){ const [x,y,r]=P.scene.arena; g.save(); g.shadowColor=P.pal.colors[2]; g.shadowBlur=30; g.strokeStyle='rgba(255,255,255,.9)'; g.lineWidth=10; g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.stroke(); g.restore(); }
  g.fillStyle='rgba(255,255,255,.85)'; for(const [x,y,r] of P.scene.pegs){ g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fill(); }
  g.fillStyle='rgba(255,255,255,.75)'; for(const w of P.scene.walls){ g.save(); if(w[4]){ g.translate(w[0]+w[2]/2,w[1]+w[3]/2); g.rotate(w[4]); g.fillRect(-w[2]/2,-w[3]/2,w[2],w[3]); } else g.fillRect(w[0],w[1],w[2],w[3]); g.restore(); }
  // Trails, then balls.
  g.lineCap='round'; g.lineJoin='round';
  for(let i=0;i<b.length;i+=4){ g.strokeStyle=col(b[i+3]);
    for(let back=1;back<=8;back++){ const [p0]=frame(k-back+1), [p1]=frame(k-back); if(p1[i]===undefined||p0[i]===undefined) break;
      if(Math.hypot(p0[i]-p1[i],p0[i+1]-p1[i+1])>120) break;
      g.globalAlpha=alpha*0.32*(1-back/9); g.lineWidth=b[i+2]*1.5*(1-back/12); g.beginPath(); g.moveTo(p0[i],p0[i+1]); g.lineTo(p1[i],p1[i+1]); g.stroke(); } }
  g.globalAlpha=alpha;
  for(let i=0;i<b.length;i+=4){ g.save(); g.shadowColor=col(b[i+3]); g.shadowBlur=26; g.fillStyle=col(b[i+3]); g.beginPath(); g.arc(b[i],b[i+1],b[i+2],0,Math.PI*2); g.fill();
    g.shadowBlur=0; const hr=Math.min(b[i+2]*.28,14); g.fillStyle='rgba(255,255,255,.55)'; g.beginPath(); g.arc(b[i]-b[i+2]*.3,b[i+1]-b[i+2]*.3,hr,0,Math.PI*2); g.fill(); g.restore(); }
  g.globalAlpha=1;
}
window.physRender=(t)=>{
  const k=Math.floor(t*P.fps), n=P.frames.length;
  const bg=g.createLinearGradient(0,0,0,1920); bg.addColorStop(0,P.pal.bg[0]); bg.addColorStop(1,P.pal.bg[1]); g.fillStyle=bg; g.fillRect(0,0,1080,1920);
  // A flash on the finish, and the last half second fades back to the start so it loops.
  const tail=Math.max(0,(k-(n-15))/15);
  draw(k,1-tail); if(tail>0) draw(0,tail);
  if(P.doneFrame>=0&&k>=P.doneFrame&&k<P.doneFrame+8){ g.fillStyle='rgba(255,255,255,'+(0.35*(1-(k-P.doneFrame)/8))+')'; g.fillRect(0,0,1080,1920); }
  return P.counters[Math.max(0,Math.min(n-1,k))]||'';
};
})();`;
}
