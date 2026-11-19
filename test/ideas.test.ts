import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { coldPrompt, isYes, runIdeas } from "../src/pipeline/ideas.ts";
import { Vault, type Product } from "../src/vault.ts";

const P: Product[] = [{ id: "site:ai-waste-bot", name: "AI Waste Bot", description: null, url: "https://hauler.example/" }];
const NOW = new Date("2026-11-18T19:00:00Z");

async function memoryVault() {
  const v = new Vault(createClient({ url: ":memory:" }));
  await v.ensureTables();
  return v;
}

const pitches = (sentence: (i: number) => string) =>
  JSON.stringify({ pitches: Array.from({ length: 20 }, (_, i) => ({ id: i + 1, sentence: sentence(i + 1), hook: i < 3 ? 5 : 3, shareable: i < 3 ? 5 : 3, standalone: 5, different: 4 })), finalists: [1, 2, 3] });

describe("stage 2: ideas", () => {
  it("reads yes and no", () => {
    expect(isYes("YES")).toBe(true);
    expect(isYes("Yes, definitely")).toBe(true);
    expect(isYes("No")).toBe(false);
    expect(coldPrompt("A man wakes up as a stick figure.")).toContain("A man wakes up");
  });

  it("starts with a story, keeps 3 that pass the cold reads, and records the format", async () => {
    const vault = await memoryVault();
    const prompts: string[] = [];
    const ask = async (p: string) => (prompts.push(p), p.includes("Answer with only YES") ? "YES" : pitches((i) => `A stick figure finds door number ${i} glowing in an empty mall.`));
    const r = await runIdeas({ vault, products: P, ask, now: () => NOW });
    expect(r.choice.format).toBe("story");
    expect(r.passed).toBe(true);
    expect(r.finalists).toHaveLength(3);
    expect(prompts[0]).toContain("Format: a stick-figure story");
    expect(prompts.filter((p) => p.includes("Answer with only YES"))).toHaveLength(9);
    const started = await vault.reelsStarted();
    expect(started[0]).toMatchObject({ format: "story", finalists: r.finalists });
    // The next Reel is a different entertainment format.
    const next = await runIdeas({ vault, products: P, ask, now: () => new Date(NOW.getTime() + 1000) });
    expect(next.choice.format).toBe("satisfying");
  });

  it("fails when cold readers don't want more, or an ad forgets its product", async () => {
    const vault = await memoryVault();
    const no = await runIdeas({ vault, products: P, ask: async (p) => (p.includes("Answer with only YES") ? "NO" : pitches((i) => `Idea ${i} is here.`)), now: () => NOW });
    expect(no.passed).toBe(false);
    expect(no.gate.checks.some((c) => c.name.includes("cold one-sentence test") && !c.passed)).toBe(true);
    const ad = await runIdeas({ vault, products: P, format: "ad", ask: async (p) => (p.includes("Answer with only YES") ? "YES" : pitches((i) => `Haulers lose leads at night, idea ${i}.`)), now: () => NOW });
    expect(ad.choice.product?.name).toBe("AI Waste Bot");
    expect(ad.gate.checks.find((c) => c.name.includes("is about AI Waste Bot"))?.passed).toBe(false);
  });

  it("fails entertainment ideas that sell", async () => {
    const vault = await memoryVault();
    const r = await runIdeas({ vault, products: P, ask: async (p) => (p.includes("Answer with only YES") ? "YES" : pitches((i) => `A stick figure tries AI Waste Bot, link in bio, take ${i}.`)), now: () => NOW });
    expect(r.passed).toBe(false);
    expect(r.gate.checks.some((c) => c.name.includes("entertainment doesn't sell") && !c.passed)).toBe(true);
  });
});
