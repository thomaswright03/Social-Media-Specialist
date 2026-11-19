// Stage 2 of the content pipeline: Ideas (pipeline/stages/2-ideas.md).
//
// Code picks the Reel's format (80% entertainment, 20% ads; formats.ts),
// Claude pitches 20 premises in that format and keeps 3, and the gate checks
// the scores, the one-sentence rule and the format, then has each finalist
// read cold: 3 separate Claude calls that see only that sentence and say
// whether they'd want the next one.
import { randomUUID } from "node:crypto";
import type { Product, Vault } from "../vault.ts";
import { formatBrief, gateFormat, nextFormat, nextProduct, type Choice, type Format, type Made } from "./formats.ts";
import { check, gate, gateIdeas, type ColdReads, type GateResult, type Ideas } from "./gates.ts";
import { NICHE } from "./research.ts";
import { runStage, stagePrompt } from "./stages.ts";

export const COLD_READS = 3;

export const coldPrompt = (sentence: string) =>
  `You're scrolling Instagram Reels. This is the first sentence of a short video:\n\n"${sentence}"\n\nWould you want to hear the next sentence? Answer with only YES or NO.`;

export const isYes = (answer: string) => /^\W*yes\b/i.test(answer.trim());

/** Each finalist read cold by COLD_READS separate calls. */
export async function coldReads(x: Ideas | null, ask: (p: string) => Promise<string>): Promise<ColdReads> {
  const out: ColdReads = {};
  for (const id of new Set(x?.finalists ?? [])) {
    const s = x?.pitches?.find((p) => p.id === id)?.sentence;
    if (!s) continue;
    out[id] = [];
    for (let i = 0; i < COLD_READS; i++) out[id]!.push(isYes(await ask(coldPrompt(s)).catch(() => "")));
  }
  return out;
}

/** Stage 2's gate: gateIdeas plus the format (an ad's finalists name its product; entertainment doesn't sell). */
export async function gateIdeasFormat(x: Ideas | null, choice: Choice, products: Product[], cold: (x: Ideas | null) => Promise<ColdReads>): Promise<GateResult> {
  const base = gateIdeas(x, await cold(x));
  const finalists = (x?.finalists ?? []).map((id) => ({ id, s: x?.pitches?.find((p) => p.id === id)?.sentence ?? "" }));
  const fmt: GateResult["checks"] = [];
  for (const f of finalists) {
    if (choice.format === "ad") {
      fmt.push(check(`Finalist ${f.id} is about ${choice.product?.name ?? "the product"}`, Boolean(choice.product) && f.s.toLowerCase().includes(choice.product!.name.toLowerCase())));
    } else {
      const g = gateFormat({ format: choice.format, product: null }, { caption: f.s, shots: [] }, products).checks.find((c) => c.name === "Entertainment doesn't sell");
      if (g) fmt.push({ ...g, name: `Finalist ${f.id}: ${g.name.toLowerCase()}` });
    }
  }
  return gate([...base.checks, ...fmt]);
}

export type IdeasResult = { subject: string; choice: Choice; passed: boolean; finalists: string[]; gate: GateResult; tries: number };

export async function runIdeas(d: { vault: Vault; products: Product[]; ask: (p: string) => Promise<string>; coldAsk?: (p: string) => Promise<string>; log?: (m: string) => void; now?: () => Date; format?: Format }): Promise<IdeasResult> {
  const started = await d.vault.reelsStarted();
  const made: Made[] = started.map((r) => ({ format: r.format as Format, productId: r.productId, at: r.at }));
  let choice = nextFormat(made, d.products);
  // A run by hand may ask for a format; an ad still takes its product in turn.
  if (d.format) choice = { format: d.format, product: d.format === "ad" ? nextProduct(made, d.products) : null };
  const subject = `reel:${randomUUID()}`;
  d.log?.(`Next Reel: ${choice.format}${choice.product ? ` for ${choice.product.name}` : ""}.`);
  const patterns = (await d.vault.lessons("pattern")).map((l) => `- ${l.text}`).join("\n") || "(none yet)";
  const lessons = (await d.vault.lessons()).filter((l) => l.kind !== "pattern");
  const history = started.flatMap((r) => r.finalists.map((s) => `- (${r.format}) ${s}`)).slice(0, 30).join("\n") || "(nothing yet)";
  const r = await runStage<Ideas>({
    vault: d.vault,
    stage: 2,
    subject,
    ask: d.ask,
    prompt: (failures) =>
      stagePrompt(2, {
        NICHE,
        FORMAT: formatBrief(choice, "ideas"),
        PATTERNS: patterns,
        HISTORY: history,
        LESSONS: lessons.length ? `What earlier stages learned:\n${lessons.map((l) => `- (${l.kind}) ${l.text}`).join("\n")}` : "",
        GATE_FAILURES: failures,
      }),
    gate: (x) => gateIdeasFormat(x, choice, d.products, (y) => coldReads(y, d.coldAsk ?? d.ask)),
    input: { format: choice.format, productId: choice.product?.id ?? null, product: choice.product?.name ?? null },
    log: d.log,
    now: d.now,
  });
  const finalists = (r.output?.finalists ?? []).map((id) => r.output?.pitches?.find((p) => p.id === id)?.sentence ?? "").filter(Boolean);
  return { subject, choice, passed: r.gate.passed, finalists, gate: r.gate, tries: r.tries };
}
