// The content pipeline's stages (pipeline/README.md): their names, their
// prompts (pipeline/stages/*.md, between <!-- prompt --> markers), and the
// loop that runs a stage until its gate passes (up to 3 tries, each with the
// failed checks in front of Claude), saving every try in the Vault.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { failuresText, type GateResult } from "./gates.ts";
import type { Vault } from "../vault.ts";

export const STAGES = [
  { n: 0, file: "0-diagnose.md", name: "Diagnose", gate: "Three reasons it underperformed, each backed by a number from Insights" },
  { n: 1, file: "1-research.md", name: "Research what wins", gate: "Winners are compared with the same accounts' average Reels, and a pattern is kept only when a blind check backs it" },
  { n: 2, file: "2-ideas.md", name: "Ideas", gate: "Each of the 3 finalists passes the cold one-sentence test" },
  { n: 3, file: "3-first-3-seconds.md", name: "The first 3 seconds", gate: "A sound-off viewer knows why to keep watching by 1.5 s" },
  { n: 4, file: "4-script.md", name: "Script", gate: "No 3-second slice without something new; Low Tide checks clean" },
  { n: 5, file: "5-production.md", name: "Production", gate: "Every axis of our rubric scores at least 3 of 5, a stranger follows it, and every picture shows what the voice says" },
  { n: 6, file: "6-prepublish.md", name: "Pre-publish checks", gate: "Every checklist item passes" },
  { n: 7, file: "7-test.md", name: "Test small", gate: "After 48 h, the winner by 3-second hold, watch % and shares per reach" },
  { n: 8, file: "8-learn.md", name: "Learn", gate: "Every lesson becomes a check for stages 3 to 6" },
] as const;

const PIPELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "pipeline");

/** A file's path in pipeline/, for a tool that reads it itself. */
export const pipelinePath = (name: string) => join(PIPELINE_DIR, name);

export function pipelineFile(name: string): string {
  return readFileSync(join(PIPELINE_DIR, name), "utf8");
}

/**
 * A stage's prompt with its {{PLACEHOLDERS}} filled (missing ones become
 * empty). `block` picks another prompt in the same file (<!-- art --> …).
 */
export function stagePrompt(n: number, fill: Record<string, string>, block = "prompt"): string {
  const stage = STAGES.find((s) => s.n === n);
  if (!stage) throw new Error(`No stage ${n}`);
  const md = pipelineFile(join("stages", stage.file));
  const m = md.match(new RegExp(`<!-- ${block} -->\\n([\\s\\S]*?)<!-- \\/${block} -->`));
  if (!m) throw new Error(`Stage ${n} has no ${block} prompt`);
  return fillPrompt(m[1]!, fill);
}

/** Fill {{PLACEHOLDERS}} (missing ones become empty) and drop wrapper tags left empty (<last_refusal></last_refusal>). */
export function fillPrompt(template: string, fill: Record<string, string>): string {
  return template
    .replace(/<([a-z_]+)>\s*\{\{([A-Z_]+)\}\}\s*<\/\1>\n?/g, (all, _t: string, k: string) => (fill[k]?.trim() ? all : ""))
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => fill[k] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A tester's prompt (pipeline/testers/<name>.md): the cold reads, matches, the editor and learned checks. */
export function testerPrompt(name: string, fill: Record<string, string>): string {
  return fillPrompt(pipelineFile(join("testers", `${name}.md`)), fill);
}

/** The JSON object in Claude's answer (it may wrap it in a code fence or a sentence). */
export function parseJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export const MAX_TRIES = 3;

export type StageRun<T> = { output: T | null; gate: GateResult; tries: number; recordId: string };

/**
 * Runs one stage: prompt, parse, gate; on a failed gate, again with the
 * failures (at most MAX_TRIES). Every try is saved (SocialStage) and the
 * outcome goes into the History.
 */
export async function runStage<T>(opts: {
  vault: Vault;
  stage: number;
  subject?: string;
  ask: (prompt: string) => Promise<string>;
  prompt: (failures: string) => string;
  gate: (output: T | null) => Promise<GateResult> | GateResult;
  input?: unknown;
  log?: (m: string) => void;
  now?: () => Date;
  /** Tries before it stops (MAX_TRIES unless a stage needs more). */
  tries?: number;
}): Promise<StageRun<T>> {
  const now = opts.now ?? (() => new Date());
  const name = STAGES.find((s) => s.n === opts.stage)?.name ?? `Stage ${opts.stage}`;
  let last: StageRun<T> | null = null;
  for (let attempt = 1; attempt <= (opts.tries ?? MAX_TRIES); attempt++) {
    // A call that fails or runs out of time (a series part's long script, test run 45282934098) is a failed try, not the end of the run.
    const answer: string = await opts.ask(opts.prompt(failuresText(last?.gate ?? null))).catch((err: unknown) => {
      opts.log?.(`${name}, try ${attempt}: Claude didn't answer (${err instanceof Error ? err.message : err}).`);
      return "";
    });
    const output = parseJson<T>(answer);
    const g = await opts.gate(output);
    const recordId = await opts.vault.saveStage({ stage: opts.stage, subject: opts.subject, attempt, passed: g.passed, output: output ?? { unparsed: answer.slice(0, 2000) }, gate: g, input: attempt === 1 ? opts.input : undefined }, now());
    last = { output, gate: g, tries: attempt, recordId };
    opts.log?.(`Stage ${opts.stage} (${name}), try ${attempt}: ${g.passed ? "gate passed" : `${g.checks.filter((c) => !c.passed).length} checks failed (${g.checks.filter((c) => !c.passed).map((c) => `${c.name}${c.detail ? `: ${c.detail.slice(0, 120)}` : ""}`).join("; ")})`}.`);
    if (g.passed) break;
  }
  const failed = last!.gate.checks.filter((c) => !c.passed);
  await opts.vault.logAction(
    {
      kind: "stage",
      summary: last!.gate.passed ? `Stage ${opts.stage}, ${name}: passed its gate${last!.tries > 1 ? ` on try ${last!.tries}` : ""}.` : `Stage ${opts.stage}, ${name}: stopped at the gate after ${last!.tries} tries.`,
      detail: failed.length ? failed.map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`).join("\n") : null,
      target: last!.recordId,
      ok: last!.gate.passed,
    },
    now(),
  );
  return last!;
}
