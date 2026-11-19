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
import { formatBrief, gateFormat, NARRATED, type Choice, type FormatDraft } from "./formats.ts";
import { check, clarityChecks, gate, gateOpening, gateScript, type Check, type GateResult, type Opening, type RetellReads, type Script, type ScriptReview, type Shot, type SoundOffReads } from "./gates.ts";
import { isYes } from "./ideas.ts";
import { sourceChecks, sourcesText, sourceTexts, type NewsItem, type SourceText } from "./news.ts";
import { parseJson, runStage, stagePrompt, testerPrompt } from "./stages.ts";
import { spokenText } from "../voice.ts";

type Ask = (p: string) => Promise<string>;
export const SOUND_OFF_READS = 3;
export const RETELL_READS = 3;
export const SCRIPT_TRIES = 5;

const shotList = (o: Opening | null) =>
  (o?.shots ?? []).map((s) => `${s.start ?? "?"}-${s.end ?? "?"} s: ${s.visual ?? ""}${s.onScreenText ? ` | text on screen: "${s.onScreenText}"` : ""}`).join("\n");

export const soundOffPrompt = (o: Opening | null) => testerPrompt("sound-off", { SHOTS: shotList(o) });

export const matchPrompt = (hook: string, answer: string) => testerPrompt("sound-off-match", { HOOK: hook, ANSWER: answer });

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

/** What a viewer gets from each shot: what they see, read and hear. */
export const viewerShots = (shots: Shot[]) =>
  shots.map((s, i) => `Shot ${i + 1} (${s.start ?? "?"}-${s.end ?? "?"} s). You see: ${s.visual ?? ""}${s.onScreenText ? ` Text on screen: "${s.onScreenText}".` : ""}${s.line ? ` You hear: "${spokenText(s.line)}"` : ""}`).join("\n");

export const retellPrompt = (shots: Shot[]) => testerPrompt("retell", { SHOTS: viewerShots(shots) });

export const retellMatchPrompt = (intended: string, retelling: string) => testerPrompt("retell-match", { INTENDED: intended, RETELLING: retelling });

/** The verdict at the end of a retelling match (YES when it says so). */
export const verdictYes = (answer: string) => {
  const all = [...answer.matchAll(/VERDICT:\W*(YES|NO)\b/gi)];
  return all.length ? all.at(-1)![1]!.toUpperCase() === "YES" : isYes(answer);
};

/** Separate cold viewers retell the story; a separate call checks each against what was meant. */
export async function retellReads(shots: Shot[], intended: string, ask: Ask, reads = RETELL_READS): Promise<RetellReads & { notes?: string[] }> {
  if (!shots.length) return [];
  const out: boolean[] & { notes?: string[] } = [];
  out.notes = [];
  for (let i = 0; i < reads; i++) {
    const a = (await ask(retellPrompt(shots)).catch(() => "")).trim();
    // The match call weighs the whole answer, confusion included: a viewer
    // unsure of a detail that doesn't matter still got the story.
    const ok = Boolean(a) && verdictYes(await ask(retellMatchPrompt(intended, a)).catch(() => ""));
    out.push(ok);
    // What a viewer who didn't get it said (what confused them first), so the next revision knows what to fix.
    if (!ok) {
      const confused = a.match(/CONFUSED:\s*([\s\S]*)$/i)?.[1]?.trim() ?? "";
      const story = a.replace(/CONFUSED:[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
      out.notes.push(a ? `${confused ? `Confused by: ${confused.replace(/\s+/g, " ").slice(0, 200)}. ` : ""}Retold it as: ${story.slice(0, 220)}` : "no answer");
    }
  }
  return out;
}

export const reviewPrompt = (s: Script & { caption?: string }) =>
  testerPrompt("review", { SCRIPT: JSON.stringify({ shots: s.shots, payoff: s.payoff, caption: s.caption }, null, 1) });

/** Stage 4's separate review; null when it couldn't be read. */
export async function reviewScript(s: Script | null, ask: Ask): Promise<ScriptReview | null> {
  if (!s?.shots?.length) return null;
  const r = parseJson<{ problems?: unknown }>(await ask(reviewPrompt(s)).catch(() => ""));
  return r && Array.isArray(r.problems) ? { problems: r.problems.map(String).filter((p) => p.trim()) } : null;
}

export const learnedCheckPrompt = (rule: string, output: unknown) => testerPrompt("learned-check", { RULE: rule, OUTPUT: JSON.stringify(output).slice(0, 6000) });

/** Lessons of kind "check" for this stage, each put to a separate call. */
export async function learnedChecks(vault: Vault, stage: number, output: unknown, ask: Ask): Promise<Check[]> {
  const rules = (await vault.lessons("check")).filter((l) => l.stage === stage);
  const out: Check[] = [];
  for (const l of rules) {
    const a = await ask(learnedCheckPrompt(l.text, output)).catch(() => "");
    // "NO: the part that breaks it" tells the retry what to fix.
    const why = a.match(/^\W*no\b\W*([\s\S]*)$/i)?.[1]?.replace(/\s+/g, " ").trim();
    out.push(check(`Learned: ${l.text.slice(0, 80)}`, isYes(a), isYes(a) ? undefined : why?.slice(0, 200) || undefined));
  }
  return out;
}

type ScriptOut = Script & { caption?: string; story?: string; sources?: FormatDraft["sources"] };
export type ScriptResult = { subject: string; premise: string | null; opening: Opening | null; script: ScriptOut | null; passed: boolean; stage: 3 | 4; gate: GateResult; problem: string | null };

/** The Reel to script next: the newest one that passed stage 2 and has no passed stage 4. */
export async function nextToScript(vault: Vault) {
  for (const r of await vault.reelsStarted()) {
    if (await vault.latestStage(4, { subject: r.subject, passedOnly: true })) continue;
    return r;
  }
  return null;
}

export async function runScript(d: { vault: Vault; products: Product[]; ask: Ask; coldAsk?: Ask; subject?: string; log?: (m: string) => void; now?: () => Date; sources?: (items: NewsItem[]) => Promise<SourceText[]> }): Promise<ScriptResult> {
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

  const writeScript = async (opening: Opening, premise: string, brief: string, supplied: SourceText[]): Promise<ScriptResult> => {
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
          PREMISE: premise,
          FORMAT: brief,
          OPENING: JSON.stringify(opening),
          PATTERNS: patterns,
          LESSONS: lessonText,
          GATE_FAILURES: failures && lastDraft ? `${failures}\n\nRevise your last script below: change only what fixes these, keep everything else as it is.\n${JSON.stringify(lastDraft)}` : failures,
        }),
      gate: async (s) => {
        if (s) lastDraft = s;
        const base = gateScript(s, opening, await reviewScript(s, cold), await learnedChecks(d.vault, 4, s, cold));
        const shots = [...(s?.shots ?? [])].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
        const intended = s?.story?.trim() || `${premise}\nHow it ends: ${s?.payoff ?? ""}`;
        const reads = shots.length ? await retellReads(shots, intended, cold) : null;
        const clarity = clarityChecks(shots, reads, reads?.notes ?? [], NARRATED[choice.format]);
        const fmt = gateFormat(choice, { caption: s?.caption ?? "", shots: s?.shots ?? [], sources: s?.sources }, d.products, d.now?.() ?? new Date());
        const sourced = choice.format === "explainer" ? sourceChecks(s ?? {}, supplied) : [];
        return gate([...base.checks, ...clarity, check("Has a caption", Boolean(s?.caption?.trim())), ...fmt.checks, ...sourced]);
      },
      input: { premise, format: reel.format, product: product?.name ?? null },
      // Each revision fixes what the review found, so the script gets more rounds.
      tries: SCRIPT_TRIES,
      log: d.log,
      now: d.now,
    });
    return { subject: reel.subject, premise, opening, script: r4.output, passed: r4.gate.passed, stage: 4, gate: r4.gate, problem: null };
  };

  // Stages 3 and 4, on each finalist in turn until one passes both. A script
  // that can't pass with its opening moves on to the next idea, once.
  let lastScript: ScriptResult | null = null;
  let scriptFailures = 0;
  let last3: GateResult | null = null;
  const picks = reel.picks?.length ? reel.picks : reel.finalists.map((sentence) => ({ sentence, answer: "", news: [] as number[] }));
  for (const pick of picks) {
    // The premise is the finalist with the ending stage 2 chose for it.
    const p = pick.answer?.trim() ? `${pick.sentence}\nHow it ends (the viewer doesn't know this yet): ${pick.answer.trim()}` : pick.sentence;
    // An explainer is written from the text of the news items it's built on, and nothing else.
    let sources: SourceText[] = [];
    if (choice.format === "explainer") {
      const items = (pick.news ?? []).map((n) => (reel.news ?? []).find((i) => i.n === n)).filter((i): i is NewsItem => Boolean(i));
      sources = items.length ? await (d.sources ?? ((xs) => sourceTexts(xs)))(items).catch(() => []) : [];
      if (!sources.length) {
        d.log?.(`No sources could be read for "${pick.sentence.slice(0, 60)}"; trying the next idea.`);
        continue;
      }
    }
    const thisBrief = formatBrief(choice, "script", { SOURCES: sourcesText(sources) });
    const r = await runStage<Opening>({
      vault: d.vault,
      stage: 3,
      subject: reel.subject,
      ask: d.ask,
      prompt: (failures) => stagePrompt(3, { PREMISE: `${p}\n\n${thisBrief}`, PATTERNS: patterns, LESSONS: lessonText, GATE_FAILURES: failures }),
      gate: async (o) => gateOpening(o, await soundOffReads(o, cold), await learnedChecks(d.vault, 3, o, cold), NARRATED[choice.format]),
      input: { premise: p, format: reel.format },
      log: d.log,
      now: d.now,
    });
    last3 = r.gate;
    if (r.gate.passed && r.output) {
      lastScript = await writeScript(r.output, p, thisBrief, sources);
      if (lastScript.passed || ++scriptFailures >= 2) return lastScript;
      d.log?.(`The script for "${p.slice(0, 60)}" didn't pass; trying the next idea.`);
      continue;
    }
    d.log?.(`The opening for "${p.slice(0, 60)}" didn't pass; trying the next idea.`);
  }
  return lastScript ?? { subject: reel.subject, premise: null, opening: null, script: null, passed: false, stage: 3, gate: last3 ?? gate([check("An idea to open", false)]), problem: null };
}
