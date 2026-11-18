import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { runIdeas } from "../src/pipeline/ideas.ts";
import { runScript, soundOffPrompt } from "../src/pipeline/script.ts";
import { Vault, type Product } from "../src/vault.ts";

const P: Product[] = [{ id: "site:ai-waste-bot", name: "AI Waste Bot", description: null, url: "https://hauler.example/" }];
const NOW = new Date("2026-11-18T19:00:00Z");

const opening = { intendedHook: "why the dog is typing", shots: [{ start: 0, end: 1.5, visual: "a dog types at a desk at night", kind: "action", onScreenText: "WHY IS HE TYPING", textAt: 0.2 }, { start: 1.5, end: 3, visual: "the dog stares into the camera", kind: "action", onScreenText: "WHY IS HE TYPING" }] };
const script = (over: Record<string, unknown> = {}) => ({
  shots: [opening.shots[0], ...Array.from({ length: 13 }, (_, i) => ({ start: 1.5 + i * 2.5, end: 4 + i * 2.5, visual: `shot ${i}`, onScreenText: `beat ${i}`, line: `Line ${i}.`, onScreen: `beat ${i}` }))],
  payoff: "He was ordering treats.",
  nextHook: "Tomorrow: the cat.",
  caption: "MOST OF YOU SAID he was hacking. #stickman #story",
  ...over,
});

function fakeClaude(over: { review?: string; script?: unknown; soundOff?: string } = {}) {
  const seen: string[] = [];
  const ask = async (p: string) => {
    seen.push(p);
    if (p.includes("Stage 2")) return JSON.stringify({ pitches: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, sentence: `A dog types at night, version ${i + 1}.`, hook: i < 3 ? 5 : 2, shareable: 4, standalone: 5, different: 4 })), finalists: [1, 2, 3] });
    if (p.includes("Stage 3")) return JSON.stringify(opening);
    if (p.includes("Stage 4")) return JSON.stringify(over.script ?? script());
    if (p.includes("sound OFF")) return over.soundOff ?? "Why the dog is typing.";
    if (p.includes("strict editor")) return over.review ?? '{"problems": []}';
    return "YES";
  };
  return { ask, seen };
}

async function vaultWithIdeas(ask: (p: string) => Promise<string>) {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  await runIdeas({ vault, products: P, ask, now: () => NOW });
  return vault;
}

describe("stages 3 and 4", () => {
  it("shows sound-off viewers only the shots and on-screen text", () => {
    const p = soundOffPrompt(opening);
    expect(p).toContain("WHY IS HE TYPING");
    expect(p).not.toContain("why the dog is typing");
  });

  it("writes the opening and the script for the newest Reel and passes both gates", async () => {
    const c = fakeClaude();
    const vault = await vaultWithIdeas(c.ask);
    const r = await runScript({ vault, products: P, ask: c.ask, now: () => NOW });
    expect(r.gate.checks.filter((x) => !x.passed)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.stage).toBe(4);
    expect(c.seen.filter((p) => p.includes("sound OFF"))).toHaveLength(3);
    expect(c.seen.some((p) => p.includes("Format: story"))).toBe(true);
    // Done: there's nothing left to script.
    expect((await runScript({ vault, products: P, ask: c.ask, now: () => NOW })).problem).toContain("No Reel waiting");
  });

  it("stops at stage 3 when sound-off viewers want nothing", async () => {
    const c = fakeClaude({ soundOff: "NOTHING" });
    const vault = await vaultWithIdeas(c.ask);
    const r = await runScript({ vault, products: P, ask: c.ask, now: () => NOW });
    expect(r.passed).toBe(false);
    expect(r.stage).toBe(3);
    expect(r.gate.checks.find((x) => x.name.includes("Sound-off"))?.passed).toBe(false);
  });

  it("fails a script the review finds problems in, or that sells in entertainment", async () => {
    const c = fakeClaude({ review: '{"problems": ["the dog is in two rooms at once"]}', script: script({ caption: "Get AI Waste Bot, link in bio" }) });
    const vault = await vaultWithIdeas(c.ask);
    const r = await runScript({ vault, products: P, ask: c.ask, now: () => NOW });
    expect(r.passed).toBe(false);
    const failed = r.gate.checks.filter((x) => !x.passed).map((x) => x.name);
    expect(failed).toContain("Review: grammar, physics, timing and consistency");
    expect(failed).toContain("Entertainment doesn't sell");
  });
});

describe("the title-card check", () => {
  it("isn't fooled by a shot that says what it isn't", async () => {
    const { withoutNegations, gateOpening } = await import("../src/pipeline/gates.ts");
    expect(withoutNegations("Mid-action, no title card. A dark shop")).not.toMatch(/title/);
    const o = (visual: string) => ({ intendedHook: "x", shots: [{ start: 0, end: 3, visual, kind: "action", onScreenText: "WHY", textAt: 0.1 }] });
    expect(gateOpening(o("Mid-action, no title card, not black: a dog types"), [true, true, true]).checks.find((c) => c.name.startsWith("No title"))?.passed).toBe(true);
    expect(gateOpening(o("A black screen, then a dog"), [true, true, true]).checks.find((c) => c.name.startsWith("No title"))?.passed).toBe(false);
  });
});
