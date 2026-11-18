// Stages 3 and 4 of the content pipeline: the first 3 seconds, then the
// full script (pipeline/stages/3-first-3-seconds.md, 4-script.md), for one
// Reel that passed stage 2.
//
// Stage 3's sound-off test: 3 separate Claude calls see only the shot list
// and the on-screen text (no audio, no premise) and say what they want to find
// out; a 4th call, which sees the intended hook, judges each answer. Stage 4's
// review is a separate call that hunts for grammar, physics, timing and
// contradictions (Thomas's Low Tide checks); the format's own checks
// (formats.ts) run with it. Lessons of kind "check" for a stage are put to a
// separate call each and become checks too.
import type { Product, Vault } from "../vault.ts";
import { formatBrief, gateFormat, type Choice, type FormatDraft } from "./formats.ts";
import { check, gate, gateOpening, gateScript, type Check, type GateResult, type Opening, type Script, type ScriptReview, type SoundOffReads } from "./gates.ts";
import { isYes } from "./ideas.ts";
import { parseJson, runStage, stagePrompt } from "./stages.ts";

type Ask = (p: string) => Promise<string>;
export const SOUND_OFF_READS = 3;

const shotList = (o: Opening | null) =>
  (o?.shots ?? []).map((s) => `${s.start ?? "?"}-${s.end ?? "?"} s: ${s.visual ?? ""}${s.onScreenText ? ` | text on screen: "${s.onScreenText}"` : ""}`).join("\n");

export const soundOffPrompt = (o: Opening | null) =>
  `You're scrolling Instagram Reels with the sound OFF. These are the first 3 seconds of a video, shot by shot, with the text on screen:\n\n${shotList(o)}\n\nIn one sentence: what do you want to find out by watching on? If nothing, say NOTHING.`;

export const matchPrompt = (hook: string, answer: string) =>
  `A video's maker wants viewers to keep watching because: "${hook}"\nA viewer who saw only the first 3 seconds, sound off, said they want to find out: "${answer}"\n\nIs that the same reason, close enough that the opening did its job? Answer with only YES or NO.`;

/** Stage 3's sound-off test. */
export async function soundOffReads(o: Opening | null, ask: Ask): Promise<SoundOffReads> {
  if (!o?.shots?.length) return [];
  const out: boolean[] = [];
  for (let i = 0; i < SOUND_OFF_READS; i++) {
    const a = (await ask(soundOffPrompt(o)).catch(() => "")).trim();
    out.push(Boolean(a) && !/^\W*nothing\b/i.test(a) && isYes(await ask(matchPrompt(o.intendedHook ?? "", a)).catch(() => "")));
  }
  return out;
}

export const reviewPrompt = (s: Script & { caption?: string }) =>
  `Review this Reel script like a strict editor. Find the real errors: grammar and spelling mistakes, physics or timing that couldn't happen even in the story's own world (someone in two places at once, a 10-minute task in 2 seconds, talking through glass as if it weren't there), and anything the script contradicts later. A mystery the story means to leave open (a note that appears, a figure that vanishes) is not an error; don't ask for it to be explained. Ignore style and taste, and leave out minor nitpicks a viewer would never notice in a 40-second video.\n\n${JSON.stringify({ shots: s.shots, payoff: s.payoff, caption: s.caption }, null, 1)}\n\nReply with only JSON: {"problems": ["shot N: the error, in one sentence"]} (an empty list when there are none).`;

/** Stage 4's separate review; null when it couldn't be read. */
export async function reviewScript(s: Script | null, ask: Ask): Promise<ScriptReview | null> {
  if (!s?.shots?.length) return null;
  const r = parseJson<{ problems?: unknown }>(await ask(reviewPrompt(s)).catch(() => ""));
  return r && Array.isArray(r.problems) ? { problems: r.problems.map(String).filter((p) => p.trim()) } : null;
}

/** Lessons of kind "check" for this stage, each put to a separate call. */
export async function learnedChecks(vault: Vault, stage: number, output: unknown, ask: Ask): Promise<Check[]> {
  const rules = (await vault.lessons("check")).filter((l) => l.stage === stage);
  const out: Check[] = [];
  for (const l of rules) {
    const a = await ask(`Rule: ${l.text}\n\nDoes this pass the rule?\n${JSON.stringify(output).slice(0, 6000)}\n\nAnswer with only YES or NO.`).catch(() => "");
    out.push(check(`Learned: ${l.text.slice(0, 80)}`, isYes(a)));
  }
  return out;
}

type ScriptOut = Script & { caption?: string; sources?: FormatDraft["sources"] };
export type ScriptResult = { subject: string; premise: string | null; opening: Opening | null; script: ScriptOut | null; passed: boolean; stage: 3 | 4; gate: GateResult; problem: string | null };

/** The Reel to script next: the newest one that passed stage 2 and has no passed stage 4. */
export async function nextToScript(vault: Vault) {
  for (const r of await vault.reelsStarted()) {
    if (await vault.latestStage(4, { subject: r.subject, passedOnly: true })) continue;
    return r;
  }
  return null;
}

export async function runScript(d: { vault: Vault; products: Product[]; ask: Ask; coldAsk?: Ask; subject?: string; log?: (m: string) => void; now?: () => Date }): Promise<ScriptResult> {
  const cold = d.coldAsk ?? d.ask;
  const reel = d.subject ? (await d.vault.reelsStarted()).find((r) => r.subject === d.subject) : await nextToScript(d.vault);
  const empty = (problem: string): ScriptResult => ({ subject: d.subject ?? "", premise: null, opening: null, script: null, passed: false, stage: 3, gate: gate([check(problem, false)]), problem });
  if (!reel) return empty("No Reel waiting for a script: run ideas (stage 2) first");
  const product = reel.format === "ad" ? (d.products.find((p) => p.id === reel.productId) ?? null) : null;
  if (reel.format === "ad" && !product) return { ...empty(`The ad's product (${reel.productId}) isn't on the website anymore`), subject: reel.subject };
  const choice = { format: reel.format, product } as Choice;
  const patterns = (await d.vault.lessons("pattern")).map((l) => `- ${l.text}`).join("\n") || "(none yet)";
  const lessons = (await d.vault.lessons()).filter((l) => l.kind !== "pattern");
  const lessonText = lessons.length ? `What earlier stages learned:\n${lessons.map((l) => `- (${l.kind}) ${l.text}`).join("\n")}` : "";

  // Stage 3, on each finalist in turn until one opening passes.
  let opening: Opening | null = null;
  let premise: string | null = null;
  let last3: GateResult | null = null;
  for (const p of reel.finalists) {
    const r = await runStage<Opening>({
      vault: d.vault,
      stage: 3,
      subject: reel.subject,
      ask: d.ask,
      prompt: (failures) => stagePrompt(3, { PREMISE: `${p}\n${formatBrief(choice)}`, PATTERNS: patterns, LESSONS: lessonText, GATE_FAILURES: failures }),
      gate: async (o) => gateOpening(o, await soundOffReads(o, cold), await learnedChecks(d.vault, 3, o, cold)),
      input: { premise: p, format: reel.format },
      log: d.log,
      now: d.now,
    });
    last3 = r.gate;
    if (r.gate.passed) {
      opening = r.output;
      premise = p;
      break;
    }
    d.log?.(`The opening for "${p.slice(0, 60)}" didn't pass; trying the next idea.`);
  }
  if (!opening || !premise) return { subject: reel.subject, premise: null, opening: null, script: null, passed: false, stage: 3, gate: last3 ?? gate([check("An idea to open", false)]), problem: null };

  // Stage 4. A retry revises the last draft (fix the failures, keep the rest),
  // since a full rewrite brings new mistakes of its own.
  let lastDraft: ScriptOut | null = null;
  const r4 = await runStage<ScriptOut>({
    vault: d.vault,
    stage: 4,
    subject: reel.subject,
    ask: d.ask,
    prompt: (failures) =>
      stagePrompt(4, {
        PREMISE: premise!,
        FORMAT: formatBrief(choice),
        OPENING: JSON.stringify(opening),
        PATTERNS: patterns,
        LESSONS: lessonText,
        GATE_FAILURES: failures && lastDraft ? `${failures}\n\nRevise your last script below: change only what fixes these, keep everything else as it is.\n${JSON.stringify(lastDraft)}` : failures,
      }),
    gate: async (s) => {
      if (s) lastDraft = s;
      const base = gateScript(s, opening, await reviewScript(s, cold), await learnedChecks(d.vault, 4, s, cold));
      const fmt = gateFormat(choice, { caption: s?.caption ?? "", shots: s?.shots ?? [], sources: s?.sources }, d.products, d.now?.() ?? new Date());
      return gate([...base.checks, check("Has a caption", Boolean(s?.caption?.trim())), ...fmt.checks]);
    },
    input: { premise, format: reel.format, product: product?.name ?? null },
    log: d.log,
    now: d.now,
  });
  return { subject: reel.subject, premise, opening, script: r4.output, passed: r4.gate.passed, stage: 4, gate: r4.gate, problem: null };
}
