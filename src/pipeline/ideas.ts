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
import { newsList, newsText, type NewsItem } from "./news.ts";
import { nicheFor, researchBrief } from "./research.ts";
import { runStage, stagePrompt, testerPrompt } from "./stages.ts";

export const COLD_READS = 3;
export const IDEAS_TRIES = 5;

export const coldPrompt = (sentence: string) => testerPrompt("cold-read", { SENTENCE: sentence });

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
export async function gateIdeasFormat(x: Ideas | null, choice: Choice, products: Product[], cold: (x: Ideas | null) => Promise<ColdReads>, news: NewsItem[] = []): Promise<GateResult> {
  const base = gateIdeas(x, await cold(x));
  const finalists = (x?.finalists ?? []).map((id) => {
    const p = x?.pitches?.find((q) => q.id === id);
    return { id, s: p?.sentence ?? "", answer: p?.answer ?? "", news: p?.news ?? [] };
  });
  const fmt: GateResult["checks"] = [];
  for (const f of finalists) {
    fmt.push(check(`Finalist ${f.id} says how it ends`, Boolean(f.answer.trim())));
    if (choice.format === "explainer") {
      const items = [...new Set(f.news)].map((n) => news.find((i) => i.n === n));
      const publishers = new Set(items.map((i) => i?.publisher).filter(Boolean));
      const missing = items.filter((i) => !i).length;
      fmt.push(check(`Finalist ${f.id} is built on 2+ news items from 2+ publishers`, missing === 0 && items.length >= 2 && publishers.size >= 2, missing ? `${missing} of its news numbers aren't on the list` : `${items.length} items, ${publishers.size} publishers`));
    }
    if (choice.format === "ad") {
      const named = Boolean(choice.product) && f.s.toLowerCase().includes(choice.product!.name.toLowerCase());
      fmt.push(check(`Finalist ${f.id} is about ${choice.product?.name ?? "the product"}: its sentence names "${choice.product?.name ?? "the product"}" word for word`, named, named ? undefined : `"${f.s.slice(0, 160)}"`));
    } else {
      const g = gateFormat({ format: choice.format, product: null }, { caption: f.s, shots: [] }, products).checks.find((c) => c.name === "Entertainment doesn't sell");
      if (g) fmt.push({ ...g, name: `Finalist ${f.id}: ${g.name.toLowerCase()}` });
    }
  }
  return gate([...base.checks, ...fmt]);
}

export type IdeasResult = { subject: string; choice: Choice; passed: boolean; finalists: string[]; gate: GateResult; tries: number };

export async function runIdeas(d: { vault: Vault; products: Product[]; ask: (p: string) => Promise<string>; coldAsk?: (p: string) => Promise<string>; log?: (m: string) => void; now?: () => Date; format?: Format; news?: (now: Date) => Promise<NewsItem[]> }): Promise<IdeasResult> {
  const started = await d.vault.reelsStarted();
  const made: Made[] = started.map((r) => ({ format: r.format as Format, productId: r.productId, at: r.at }));
  let choice = nextFormat(made, d.products);
  // A run by hand may ask for a format; an ad still takes its product in turn.
  if (d.format) choice = { format: d.format, product: d.format === "ad" ? nextProduct(made, d.products) : null };
  // The explainer picks only from the news code gathered; with none, it doesn't run today.
  let news: NewsItem[] = [];
  if (choice.format === "explainer") {
    news = await (d.news ?? ((now) => newsList(now, undefined, d.log)))(d.now?.() ?? new Date()).catch(() => []);
    if (!news.length) {
      d.log?.("No news in the last 14 days could be read, so no explainer today: making a story instead.");
      choice = { format: "story", product: null };
    }
  }
  const subject = `reel:${randomUUID()}`;
  d.log?.(`Next Reel: ${choice.format}${choice.product ? ` for ${choice.product.name}` : ""}.`);
  // What stage 1 found for this format (not one list for every format).
  const patterns = await researchBrief(d.vault, choice.format);
  const lessons = (await d.vault.lessons()).filter((l) => l.kind !== "pattern");
  const history = started.flatMap((r) => r.finalists.map((s) => `- (${r.format}) ${s}`)).slice(0, 30).join("\n") || "(nothing yet)";
  const r = await runStage<Ideas>({
    vault: d.vault,
    stage: 2,
    subject,
    ask: d.ask,
    prompt: (failures) =>
      stagePrompt(2, {
        NICHE: nicheFor(choice.format),
        FORMAT: formatBrief(choice, "ideas", { NEWS: newsText(news) }),
        PATTERNS: patterns,
        HISTORY: history,
        LESSONS: lessons.length ? `What earlier stages learned:\n${lessons.map((l) => `- (${l.kind}) ${l.text}`).join("\n")}` : "",
        GATE_FAILURES: failures,
      }),
    gate: (x) => gateIdeasFormat(x, choice, d.products, (y) => coldReads(y, d.coldAsk ?? d.ask), news),
    input: { format: choice.format, productId: choice.product?.id ?? null, product: choice.product?.name ?? null, ...(news.length ? { news } : {}) },
    // A try is cheap (one call and 9 cold reads) next to a lost day, so 5.
    tries: IDEAS_TRIES,
    log: d.log,
    now: d.now,
  });
  const finalists = (r.output?.finalists ?? []).map((id) => r.output?.pitches?.find((p) => p.id === id)?.sentence ?? "").filter(Boolean);
  return { subject, choice, passed: r.gate.passed, finalists, gate: r.gate, tries: r.tries };
}
