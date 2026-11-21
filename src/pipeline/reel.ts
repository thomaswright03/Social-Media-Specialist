// One Reel from idea to Instagram, with no one in the loop. Thomas,
// 2026-11-21: "I want the AI to post 5 times a day with variety of content.
// It can start doing so without my approval. I am lifting that gate." Five
// slots a day (DAILY_SLOTS), each its own format. Stages 2 to 6 run in a row,
// each behind its own gate; a stage that doesn't pass stops that slot's Reel.
// It posts as a normal Reel, then the same video to the Facebook Page (and to
// YouTube once that's on), only when mayAutoPost says yes (CLAUDE.md). A failed
// post is logged, never retried. Every step goes on the History, with the
// Claude tokens the Reel used.
import { readFile } from "node:fs/promises";
import { usageMark, usageSince, usageText, type ClaudeUsage } from "../claude-usage.ts";
import { pageText, type FacebookPageClient } from "../facebook.ts";
import type { InstagramClient } from "../instagram.ts";
import { SITE_URL } from "../site.ts";
import type { YouTubeClient } from "../youtube.ts";
import type { Product, Vault } from "../vault.ts";
import type { Format } from "./formats.ts";
import { CTA, captionLines, check, contentChecks, gate, gatePrepublish, mayAutoPost, type GateResult, type Packaging } from "./gates.ts";
import { runIdeas, type IdeasResult } from "./ideas.ts";
import type { ProduceResult } from "./produce.ts";
import { learnedChecks, runScript, type ScriptResult } from "./script.ts";

type Ask = (prompt: string) => Promise<string>;

/** The formats the daily runs make. */
export const DAILY_FORMATS = ["explainer", "satisfying", "ad"] as const satisfies readonly Format[];

/**
 * The five posts a day (Thomas, 2026-11-21), at these Arizona hours, mixed so
 * no two in a row are the same and one in five is an ad (the 80/20 mix in
 * formats.ts). reels.yml starts one run a few minutes after each hour.
 */
export const DAILY_SLOTS = [
  { hour: 7, format: "explainer" },
  { hour: 10, format: "satisfying" },
  { hour: 13, format: "ad" },
  { hour: 16, format: "explainer" },
  { hour: 19, format: "satisfying" },
] as const satisfies readonly { hour: number; format: Format }[];

/**
 * The slot a scheduled run is for: the latest one that has started in Arizona
 * (UTC-7 all year), so a run GitHub starts late still makes its own slot's
 * format. Before the first slot it's the evening one from the day before.
 */
export function slotFormat(now: Date): Format {
  const hour = new Date(now.getTime() - 7 * 3600_000).getUTCHours();
  const started = DAILY_SLOTS.filter((s) => s.hour <= hour);
  return (started.at(-1) ?? DAILY_SLOTS.at(-1)!).format;
}

/** A call to action for captions that have none (Instagram's gate wants one). */
export const CTA_LINE: Record<Format, string> = {
  explainer: "Follow for the AI news that matters, explained in under a minute.",
  satisfying: "Follow for a new one every day.",
  story: "Follow for a new one every day.",
  ad: "Link in bio.",
};

const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/**
 * Stage 6's packaging, made by code from the script and the render: the
 * caption (the hook alone on the first line, a call to action if it had
 * none), its hashtags as the keywords, and the cover (the first shot with
 * text on screen). Nothing is invented here; the gate then checks it.
 */
export function packageReel(r: { format: Format; caption: string; shots: { at: number; dur: number; onScreenText?: string }[]; assets: Packaging["assets"] }): Packaging & { thumbOffsetMs: number | null } {
  let lines = captionLines(r.caption);
  let caption = lines.join("\n");
  if (!CTA.test(caption)) {
    // Before the hashtags, which close the caption.
    const at = lines.findIndex((l) => /^\s*#/.test(l));
    const cta = CTA_LINE[r.format];
    lines = at > 0 ? [...lines.slice(0, at), cta, ...lines.slice(at)] : [...lines, cta];
    caption = lines.join("\n");
  }
  const keywords = [...new Set(caption.match(HASHTAG) ?? [])];
  const cover = r.shots.find((s) => s.onScreenText?.trim());
  const coverAt = cover ? Math.round((cover.at + Math.min(1, cover.dur / 2)) * 10) / 10 : null;
  return { caption, keywords, coverAt, coverText: cover?.onScreenText?.trim() ?? null, assets: r.assets, thumbOffsetMs: coverAt === null ? null : Math.round(coverAt * 1000) };
}

/** Stage 6: packages the finished Reel and runs every pre-publish check. Saved and logged. */
export async function runPrepublish(d: { vault: Vault; ask: Ask; produced: ProduceResult; log?: (m: string) => void; now?: () => Date }): Promise<{ gate: GateResult; packaging: ReturnType<typeof packageReel> | null }> {
  const now = d.now ?? (() => new Date());
  const p = d.produced;
  if (!p.subject || !p.video || !p.facts || !p.format || !p.shots) {
    return { gate: gate([check("A finished video to check", false)]), packaging: null };
  }
  const packaging = packageReel({ format: p.format, caption: p.script?.caption ?? "", shots: p.shots, assets: p.assets });
  const learned = await learnedChecks(d.vault, 6, { caption: packaging.caption, coverText: packaging.coverText, keywords: packaging.keywords }, d.ask);
  // Every word that goes out, checked by code: no person reads it first (contentChecks).
  const words = [packaging.caption, packaging.coverText, p.script?.caption, ...(p.script?.shots ?? []).flatMap((s) => [s.line, s.onScreenText, s.onScreen]), ...p.shots.map((s) => s.onScreenText), ...p.boxes.map((b) => b.text)];
  const g = gatePrepublish(p.facts, p.boxes, packaging, [...learned, ...contentChecks(words)]);
  const recordId = await d.vault.saveStage({ stage: 6, subject: p.subject, attempt: 1, passed: g.passed, output: packaging, gate: g, input: { facts: p.facts, boxes: p.boxes.length } }, now());
  const failed = g.checks.filter((c) => !c.passed);
  d.log?.(`Stage 6 (Pre-publish): ${g.passed ? "every check passed" : `${failed.length} checks failed (${failed.map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`).join("; ")})`}.`);
  await d.vault.logAction(
    {
      kind: "stage",
      summary: g.passed ? "Stage 6, Pre-publish checks: every check passed." : `Stage 6, Pre-publish checks: ${failed.length} failed.`,
      detail: failed.length ? failed.map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`).join("\n") : null,
      target: recordId,
      ok: g.passed,
    },
    now(),
  );
  return { gate: g, packaging };
}

export type ReelRun = {
  format: Format;
  subject: string | null;
  /** The last stage that ran. */
  stage: number;
  posted: { mediaId: string; permalink: string | null } | null;
  /** Why it stopped or didn't post; null when it posted. */
  problem: string | null;
  usage: ClaudeUsage;
};

const failures = (g: GateResult) =>
  g.checks
    .filter((c) => !c.passed)
    .map((c) => `${c.name}${c.detail ? `: ${c.detail.slice(0, 160)}` : ""}`)
    .join("; ");

export async function runReel(d: {
  vault: Vault;
  format: Format;
  products: Product[];
  ask: Ask;
  /** Stage 5 for the Reel `subject`: the video and its judgement. */
  produce: (subject: string) => Promise<ProduceResult>;
  /** Null: nothing can post (no token); the Reel is still made and checked. */
  client: InstagramClient | null;
  /** The Facebook Page the same Reel goes to after Instagram (null: off or no Page). */
  page?: FacebookPageClient | null;
  /** YouTube, once it's on (null until then). */
  youtube?: YouTubeClient | null;
  /** False: make and check the Reel but post nothing (a test run). */
  post: boolean;
  ideas?: typeof runIdeas;
  script?: typeof runScript;
  readVideo?: (file: string) => Promise<Uint8Array>;
  log?: (m: string) => void;
  now?: () => Date;
}): Promise<ReelRun> {
  const log = d.log ?? (() => {});
  const now = d.now ?? (() => new Date());
  const mark = usageMark();
  const name = d.format === "ad" ? "ad" : d.format;
  const done = async (r: Omit<ReelRun, "usage" | "format">): Promise<ReelRun> => {
    const usage = usageSince(mark);
    const outcome = r.posted ? `posted${r.posted.permalink ? ` (${r.posted.permalink})` : ""}` : `not posted: ${r.problem}`;
    log(`Daily ${name}: ${outcome}. Used ${usageText(usage)}.`);
    await d.vault
      .logAction({ kind: "stage", summary: `Daily ${name} Reel: ${r.posted ? "posted" : `stopped at stage ${r.stage}`}. Used ${usageText(usage)}.`, detail: r.problem, target: r.subject, ok: Boolean(r.posted) || !d.post }, now())
      .catch(() => {});
    return { ...r, format: d.format, usage };
  };

  if ((await d.vault.settings()).paused) return done({ subject: null, stage: 0, posted: null, problem: "the specialist is paused" });

  // Stage 2: the idea.
  const ideas: IdeasResult = await (d.ideas ?? runIdeas)({ vault: d.vault, products: d.products, ask: d.ask, log, now, format: d.format });
  if (!ideas.passed) return done({ subject: ideas.subject, stage: 2, posted: null, problem: `the ideas didn't pass their gate: ${failures(ideas.gate)}` });
  if (ideas.choice.format !== d.format) log(`Made a ${ideas.choice.format} instead of a ${d.format} today (see the log above).`);

  // Stages 3 and 4: the opening and the script.
  const script: ScriptResult = await (d.script ?? runScript)({ vault: d.vault, products: d.products, ask: d.ask, log, now, subject: ideas.subject });
  if (!script.passed) return done({ subject: ideas.subject, stage: script.stage, posted: null, problem: script.problem ?? `stage ${script.stage} didn't pass its gate: ${failures(script.gate)}` });

  // Stage 5: the video.
  const produced = await d.produce(ideas.subject);
  if (!produced.video || !produced.passed) return done({ subject: ideas.subject, stage: 5, posted: null, problem: produced.problem ?? `stage 5 didn't pass its gate: ${failures(produced.gate)}` });

  // Stage 6: the pre-publish checks.
  const pre = await runPrepublish({ vault: d.vault, ask: d.ask, produced, log, now });
  const paused = (await d.vault.settings()).paused;
  const may = mayAutoPost({ prepublish: pre.gate, paused });
  if (!may.ok || !pre.packaging) return done({ subject: ideas.subject, stage: 6, posted: null, problem: may.why });
  if (!d.post) return done({ subject: ideas.subject, stage: 6, posted: null, problem: "a test run: every check passed, nothing was posted" });
  if (!d.client?.publishReelFile) return done({ subject: ideas.subject, stage: 6, posted: null, problem: "no Instagram token to post with" });

  // Post once, as a normal Reel. A failure is logged and never retried.
  let video: Uint8Array;
  let posted: { mediaId: string; permalink: string | null };
  try {
    video = await (d.readVideo ?? ((f) => readFile(f)))(produced.video);
    const r = await d.client.publishReelFile(video, pre.packaging.caption, pre.packaging.thumbOffsetMs !== null ? { thumbOffsetMs: pre.packaging.thumbOffsetMs } : {});
    posted = { mediaId: r.mediaId, permalink: r.permalink };
    await d.vault.logAction({ kind: "posted", summary: `Posted a ${name} Reel to Instagram (it passed every check; you lifted the approval step on Nov 21).`, detail: r.permalink ?? r.mediaId, target: ideas.subject, onInstagram: true }, now());
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await d.vault.logAction({ kind: "post_failed", summary: `Tried to post a ${name} Reel; Instagram refused it. It won't be tried again.`, detail: error.slice(0, 500), target: ideas.subject, onInstagram: true, ok: false }, now());
    return done({ subject: ideas.subject, stage: 6, posted: null, problem: `Instagram refused it: ${error}` });
  }

  // The same video on the Facebook Page and YouTube. A refusal there is logged, never retried, and never undoes Instagram.
  const text = pageText(pre.packaging.caption, SITE_URL());
  const title = pre.packaging.caption.split("\n")[0]!.replace(/#[\p{L}\p{N}_]+/gu, "").trim() || "Wright AI Solutions";
  const elsewhere: [string, () => Promise<string | null>][] = [];
  if (d.page?.publishReelFile) {
    const page = d.page;
    elsewhere.push(["the Facebook Page", async () => {
      const fb = await page.publishReelFile!(video, text);
      return fb.permalink ?? fb.videoId;
    }]);
  }
  if (d.youtube) {
    const yt = d.youtube;
    elsewhere.push(["YouTube as a Short", async () => (await yt.uploadShort(video, { title, description: text, tags: pre.packaging!.keywords })).url]);
  }
  for (const [where, send] of elsewhere) {
    try {
      const at = await send();
      log(`Posted the ${name} Reel to ${where}${at ? `: ${at}` : ""}.`);
      await d.vault.logAction({ kind: "posted", summary: `Posted the ${name} Reel to ${where}.`, detail: at, target: ideas.subject, onInstagram: true }, now());
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`Posted the ${name} Reel to Instagram, but ${where.replace(/ as a Short$/, "")} refused it: ${error}`);
      await d.vault.logAction({ kind: "post_failed", summary: `Posted the ${name} Reel to Instagram, but ${where.replace(/ as a Short$/, "")} refused it.`, detail: error.slice(0, 500), target: ideas.subject, onInstagram: true, ok: false }, now());
    }
  }
  return done({ subject: ideas.subject, stage: 6, posted, problem: null });
}
