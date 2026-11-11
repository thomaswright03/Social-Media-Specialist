// The gates of the content pipeline (pipeline/README.md). Each stage's output
// must pass its gate before the next stage starts. These are plain checks on
// the stage's JSON (and on numbers measured by code), so a stage can't pass
// by saying it did: a number it cites has to be in the data, a slice with
// nothing new is found by counting, and so on.
//
// Every gate returns the list of checks with which ones failed; the runner
// (run.ts) feeds the failed ones back to Claude for the next try.

export type Check = { name: string; passed: boolean; detail?: string };
export type GateResult = { passed: boolean; checks: Check[] };

export function gate(checks: Check[]): GateResult {
  return { passed: checks.length > 0 && checks.every((c) => c.passed), checks };
}

export const check = (name: string, passed: boolean, detail?: string): Check => (detail === undefined ? { name, passed } : { name, passed, detail });

/** The failed checks as lines for the next prompt. */
export function failuresText(g: GateResult | null): string {
  if (!g || g.passed) return "";
  const failed = g.checks.filter((c) => !c.passed);
  return ["Your last answer failed these checks. Fix every one:", ...failed.map((c) => `- ${c.name}${c.detail ? `: ${c.detail}` : ""}`)].join("\n");
}

const REFERS_TO_OTHER_EPISODES = /\b(part\s*(\d+|one|two|three|four|five|six|i{1,3}|iv|v)\b|episode|last time|previously|as we saw|in the last (video|one|reel)|continued from|to be continued|see part)/i;

// --- Stage 0: Diagnose --------------------------------------------------------

/** One post's numbers, as stage 0 gathers them (diagnose.ts). */
export type PostNumbers = { id: string; [metric: string]: number | string | null };
export type DiagnosisData = { posts: PostNumbers[]; median: Record<string, number | null> };
export type Diagnosis = {
  summary?: string;
  reasons?: { reason?: string; evidence?: { metric?: string; value?: number; post?: string }[]; fix?: string }[];
};

/** True when `cited` is `actual` give or take rounding (and the same number as a share or a percentage). */
export function sameNumber(cited: number, actual: number): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.02);
  return close(cited, actual) || close(cited / 100, actual) || close(cited, actual * 100);
}

export function gateDiagnose(d: Diagnosis | null, data: DiagnosisData): GateResult {
  const reels = data.posts.filter((p) => p.views !== null && p.views !== undefined);
  const reasons = d?.reasons ?? [];
  const checks: Check[] = [
    check("There are posts with Insights to diagnose", reels.length > 0, reels.length ? undefined : "no post has Insights yet"),
    check("Exactly three reasons", reasons.length === 3, `got ${reasons.length}`),
  ];
  reasons.forEach((r, i) => {
    const n = i + 1;
    checks.push(check(`Reason ${n} says its number out loud`, /\d/.test(r.reason ?? ""), r.reason ? undefined : "no reason text"));
    const ev = r.evidence ?? [];
    checks.push(check(`Reason ${n} cites at least one number from the data`, ev.length > 0));
    for (const e of ev) {
      const metric = String(e.metric ?? "");
      const where = String(e.post ?? "");
      const row = where === "median" ? data.median : data.posts.find((p) => p.id === where);
      const actual = row ? row[metric] : undefined;
      const ok = typeof e.value === "number" && typeof actual === "number" && sameNumber(e.value, actual);
      checks.push(check(`Reason ${n}: ${metric} = ${e.value} (${where || "no post named"}) matches the data`, ok, ok ? undefined : row ? `the data says ${actual ?? "nothing"} for ${metric}` : `there's no post "${where}" in the data`));
    }
    checks.push(check(`Reason ${n} names the fix`, Boolean(r.fix?.trim())));
  });
  return gate(checks);
}

// --- Stage 1: Research --------------------------------------------------------

export type Research = {
  reels?: { url?: string; views?: number | null; likes?: number | null; comments?: number | null; lengthSeconds?: number; first2s?: string; cutsPerTenSeconds?: number; voice?: string; art?: string; onScreenText?: string; postsPerWeek?: number; commentThemes?: string }[];
  patterns?: { pattern?: string; examples?: string[] }[];
};

const RESEARCH_FIELDS = ["lengthSeconds", "first2s", "cutsPerTenSeconds", "voice", "art", "onScreenText", "postsPerWeek", "commentThemes"] as const;

/**
 * `notReadable` names, per Reel link, the fields code tried and couldn't
 * measure (Instagram gives no video file for some Reels); those may stay
 * empty, and nothing else may.
 */
export function gateResearch(r: Research | null, notReadable: (url: string) => readonly string[] = () => []): GateResult {
  const reels = r?.reels ?? [];
  const byUrl = new Map(reels.filter((x) => x.url).map((x) => [x.url!, x]));
  const hasNumbers = (x: (typeof reels)[number]) => [x.views, x.likes, x.comments].some((v) => typeof v === "number");
  const checks: Check[] = [check("15 to 20 Reels studied", reels.length >= 15 && reels.length <= 20, `got ${reels.length}`), check("Every Reel has a link", reels.every((x) => /^https?:\/\//.test(x.url ?? "")))];
  reels.forEach((x, i) => {
    const excused = notReadable(x.url ?? "");
    const missing = RESEARCH_FIELDS.filter((f) => !excused.includes(f) && (x[f] === undefined || x[f] === null || x[f] === ""));
    checks.push(check(`Reel ${i + 1} has its numbers and every field`, hasNumbers(x) && missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : hasNumbers(x) ? undefined : "no views, likes or comments"));
  });
  const patterns = r?.patterns ?? [];
  checks.push(check("At least one winning pattern", patterns.length > 0));
  patterns.forEach((p, i) => {
    const good = [...new Set(p.examples ?? [])].filter((u) => byUrl.has(u) && hasNumbers(byUrl.get(u)!));
    checks.push(check(`Pattern ${i + 1} ("${(p.pattern ?? "").slice(0, 60)}") has 3+ studied examples with numbers`, good.length >= 3, `has ${good.length}`));
  });
  return gate(checks);
}

// --- Stage 2: Ideas -----------------------------------------------------------

export type Ideas = { pitches?: { id?: number; sentence?: string; hook?: number; shareable?: number; standalone?: number; different?: number }[]; finalists?: number[] };
/** For each finalist id, what the cold readers said: true = they want the next sentence. */
export type ColdReads = Record<number, boolean[]>;

export const isOneSentence = (s: string) => s.trim().length > 0 && s.trim().split(/(?<=[.!?])\s+(?=[A-Z"'])/).length === 1;

export function gateIdeas(x: Ideas | null, cold: ColdReads): GateResult {
  const pitches = x?.pitches ?? [];
  const score = (p: (typeof pitches)[number]) => (["hook", "shareable", "standalone", "different"] as const).map((k) => p[k]);
  const total = (p: (typeof pitches)[number]) => score(p).reduce<number>((a, b) => a + (b ?? 0), 0);
  const finalists = x?.finalists ?? [];
  const top = [...pitches].sort((a, b) => total(b) - total(a)).slice(0, 3);
  const cutoff = top.length ? total(top[top.length - 1]!) : Infinity;
  const checks: Check[] = [
    check("Exactly 20 pitches", pitches.length === 20, `got ${pitches.length}`),
    check("Every pitch scored 1 to 5 on hook, shareable, standalone and different", pitches.every((p) => score(p).every((v) => Number.isInteger(v) && v! >= 1 && v! <= 5))),
    check("Three finalists kept", new Set(finalists).size === 3, `got ${finalists.length}`),
  ];
  for (const id of finalists) {
    const p = pitches.find((q) => q.id === id);
    const s = p?.sentence ?? "";
    checks.push(check(`Finalist ${id} is one of the top 3 scores`, Boolean(p) && total(p!) >= cutoff, p ? `total ${total(p)}, the top 3 need ${cutoff}` : "no pitch with that id"));
    checks.push(check(`Finalist ${id} is one sentence`, isOneSentence(s)));
    checks.push(check(`Finalist ${id} doesn't lean on another episode`, !REFERS_TO_OTHER_EPISODES.test(s)));
    const reads = cold[id] ?? [];
    const yes = reads.filter(Boolean).length;
    checks.push(check(`Finalist ${id} passes the cold one-sentence test`, reads.length >= 3 && yes >= 2, `${yes} of ${reads.length} cold readers wanted the next sentence`));
  }
  return gate(checks);
}

// --- Stage 3: The first 3 seconds ---------------------------------------------

export type Shot = { start?: number; end?: number; visual?: string; kind?: string; onScreenText?: string; textAt?: number; audio?: string; line?: string; onScreen?: string; sound?: string };
export type Opening = { intendedHook?: string; shots?: Shot[] };
/** Cold sound-off viewers: did each give a reason to keep watching that matches the intended hook? */
export type SoundOffReads = boolean[];

/** Reading speed for on-screen text, words a second. */
export const READ_WPS = 4;
const TITLE_LIKE = /\b(title|black|blank|logo|intro card|fade in from black|empty)\b/i;

export function gateOpening(o: Opening | null, soundOff: SoundOffReads, learned: Check[] = []): GateResult {
  const shots = o?.shots ?? [];
  const first = shots[0];
  const words = (first?.onScreenText ?? "").trim().split(/\s+/).filter(Boolean).length;
  const textAt = typeof first?.textAt === "number" ? first.textAt : first?.onScreenText ? (first.start ?? 0) : Infinity;
  const readBy = textAt + words / READ_WPS;
  const yes = soundOff.filter(Boolean).length;
  return gate([
    check("The opening has shots", shots.length > 0),
    check("The first shot starts at 0 s", first?.start === 0),
    check("No title card, black or blank frame first", Boolean(first) && first!.kind !== "title" && !TITLE_LIKE.test(first!.visual ?? ""), first?.visual),
    check("Starts mid-action", first?.kind === "action" && Boolean(first.visual?.trim())),
    check("The hook is on screen by 0.5 s", textAt <= 0.5, Number.isFinite(textAt) ? `appears at ${textAt} s` : "no on-screen text in the first shot"),
    check("The hook can be read by 1.5 s", words > 0 && readBy <= 1.5, `${words} words, read by ${Number.isFinite(readBy) ? readBy.toFixed(2) : "never"} s`),
    check("The opening covers the first 3 seconds", shots.length > 0 && Math.max(...shots.map((s) => s.end ?? 0)) >= 3),
    check("Sound-off viewers know why to keep watching", soundOff.length >= 3 && yes >= 2, `${yes} of ${soundOff.length}`),
    ...learned,
  ]);
}

// --- Stage 4: Script ----------------------------------------------------------

export type Script = { shots?: Shot[]; payoff?: string; nextHook?: string };
/** Problems the separate review found (grammar, physics, timing, contradictions). */
export type ScriptReview = { problems: string[] };

export const SLICE_SECONDS = 3;

/** The 3-second slices with nothing new to see or hear (start times). */
export function emptySlices(shots: Shot[], length: number): number[] {
  const events: number[] = [];
  let lastText = "";
  for (const s of shots) {
    const t = s.start ?? 0;
    events.push(t); // a new shot is something new to see
    if (s.line?.trim()) events.push(t);
    if (s.onScreenText?.trim() && s.onScreenText !== lastText) events.push(typeof s.textAt === "number" ? s.textAt : t);
    if (s.sound?.trim()) events.push(t);
    lastText = s.onScreenText ?? "";
  }
  const empty: number[] = [];
  for (let a = 0; a < length - 0.01; a += SLICE_SECONDS) {
    const b = Math.min(a + SLICE_SECONDS, length);
    // A last sliver under 1.5 s is the end card's tail, not a slice to fill.
    if (b - a < 1.5 && a > 0) break;
    if (!events.some((e) => e >= a && e < b)) empty.push(a);
  }
  return empty;
}

export function gateScript(s: Script | null, opening: Opening | null, review: ScriptReview | null, learned: Check[] = []): GateResult {
  const shots = [...(s?.shots ?? [])].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const length = shots.length ? Math.max(...shots.map((x) => x.end ?? 0)) : 0;
  const gaps = shots.slice(1).filter((x, i) => Math.abs((x.start ?? 0) - (shots[i]!.end ?? 0)) > 0.05).length;
  const empty = emptySlices(shots, length);
  const unshown = shots.filter((x) => x.line?.trim() && !x.onScreen?.trim());
  const text = [...shots.flatMap((x) => [x.line, x.onScreenText, x.visual]), s?.payoff, s?.nextHook].filter(Boolean).join(" \n");
  const openingFirst = opening?.shots?.[0];
  return gate([
    check("30 to 60 seconds long", length >= 30 && length <= 60, `${length.toFixed(1)} s`),
    check("Shots run in order with no gaps", shots.length > 0 && (shots[0]!.start ?? 0) === 0 && gaps === 0, gaps ? `${gaps} gaps` : undefined),
    check("Opens with the opening that passed stage 3", Boolean(openingFirst) && shots[0]?.visual === openingFirst!.visual && shots[0]?.onScreenText === openingFirst!.onScreenText),
    check("Something new in every 3-second slice", empty.length === 0, empty.length ? `nothing new at ${empty.map((t) => `${t}-${t + SLICE_SECONDS} s`).join(", ")}` : undefined),
    check("Every spoken claim is visible on screen", unshown.length === 0, unshown.length ? unshown.map((x) => `"${(x.line ?? "").slice(0, 50)}" at ${x.start} s`).join("; ") : undefined),
    check("Stands alone (no other episodes)", !REFERS_TO_OTHER_EPISODES.test(text)),
    check("Has its own payoff", Boolean(s?.payoff?.trim())),
    check("Leaves a reason to watch the next", Boolean(s?.nextHook?.trim())),
    check("Review: grammar, physics, timing and consistency", review !== null && review.problems.length === 0, review ? review.problems.join("; ") || undefined : "not reviewed"),
    ...learned,
  ]);
}

// --- Stage 5: Production ------------------------------------------------------

export const PRODUCTION_AXES = ["art", "readability", "voice", "sound"] as const;
export type ProductionJudgement = { ours?: Partial<Record<(typeof PRODUCTION_AXES)[number], number>>; benchmark?: Partial<Record<(typeof PRODUCTION_AXES)[number], number>>; fixFirst?: string };

export function gateProduction(j: ProductionJudgement | null, frames: { ours: number; benchmarks: number }, learned: Check[] = []): GateResult {
  return gate([
    check("Our key frames are there", frames.ours >= 3, `${frames.ours} frames`),
    check("Frames from at least 2 benchmark Reels", frames.benchmarks >= 2, `${frames.benchmarks} benchmarks`),
    ...PRODUCTION_AXES.map((a) => {
      const o = j?.ours?.[a];
      const b = j?.benchmark?.[a];
      return check(`Ours isn't worse on ${a}`, typeof o === "number" && typeof b === "number" && o >= b, `ours ${o ?? "?"}, benchmark ${b ?? "?"}`);
    }),
    ...learned,
  ]);
}

// --- Stage 6: Pre-publish -----------------------------------------------------

export type MediaFacts = { width: number; height: number; videoCodec: string; audioCodec: string | null; fps: number; seconds: number; lufs: number | null; truePeak: number | null };
export type TextBox = { text: string; x: number; y: number; w: number; h: number };
export type Packaging = {
  coverAt: number | null;
  coverText: string | null;
  caption: string;
  keywords: string[];
  /**
   * Every sound and picture in the video and where it's from. Reels posted
   * through the API can't use Instagram's music library, so music must be
   * our own or royalty-free with a license that allows commercial use.
   */
  assets?: { name: string; kind: "music" | "sfx" | "voice" | "art" | "footage"; source: string; license: string }[];
};

/** Where Instagram's buttons, caption and header cover a 1080x1920 Reel. */
export const SAFE = { top: 220, bottom: 420, right: 140, left: 60 } as const;
const CTA = /\b(follow|link in (the )?bio|comment|save this|share this|send this|tap|visit|try it|watch (the )?next)\b/i;

export function gatePrepublish(m: MediaFacts, boxes: TextBox[], p: Packaging, learned: Check[] = []): GateResult {
  const outside = boxes.filter((b) => b.y < SAFE.top || b.y + b.h > m.height - SAFE.bottom || b.x < SAFE.left || b.x + b.w > m.width - SAFE.right);
  const firstLine = p.caption.split("\n")[0]!.trim();
  const caption = p.caption.toLowerCase();
  const kw = p.keywords.filter((k) => caption.includes(k.toLowerCase().replace(/^#/, "")));
  return gate([
    check("1080x1920 (9:16)", m.width === 1080 && m.height === 1920, `${m.width}x${m.height}`),
    check("H.264 video with AAC audio", m.videoCodec === "h264" && m.audioCodec === "aac", `${m.videoCodec} / ${m.audioCodec ?? "no audio"}`),
    check("24 to 60 fps", m.fps >= 23.9 && m.fps <= 60, `${m.fps} fps`),
    check("30 to 60 seconds", m.seconds >= 30 && m.seconds <= 60, `${m.seconds.toFixed(1)} s`),
    check("Loudness about -14 LUFS (-16 to -12)", m.lufs !== null && m.lufs >= -16 && m.lufs <= -12, m.lufs === null ? "not measured" : `${m.lufs.toFixed(1)} LUFS`),
    check("True peak at or below -1 dBTP", m.truePeak !== null && m.truePeak <= -1, m.truePeak === null ? "not measured" : `${m.truePeak.toFixed(1)} dBTP`),
    check("No text where Instagram's buttons and caption sit", outside.length === 0, outside.length ? outside.map((b) => `"${b.text.slice(0, 30)}"`).join(", ") : undefined),
    check("A cover frame with readable text", p.coverAt !== null && Boolean(p.coverText?.trim())),
    check("The caption's first line is the hook, 125 characters or less", firstLine.length > 0 && firstLine.length <= 125, `${firstLine.length} characters`),
    check("3 to 5 keywords in the caption", kw.length >= 3 && kw.length <= 5, `${kw.length} found`),
    check("A call to action", CTA.test(p.caption)),
    check(
      "Every sound and picture has a source and a license we can use commercially",
      (p.assets ?? []).length > 0 && (p.assets ?? []).every((a) => a.source.trim() && a.license.trim() && !/\b(unknown|instagram (music|library|audio)|copyright(ed)?|all rights reserved)\b/i.test(a.license)),
      (p.assets ?? []).length === 0 ? "no asset list" : (p.assets ?? []).filter((a) => !a.source.trim() || !a.license.trim() || /unknown|instagram|copyright|all rights/i.test(a.license)).map((a) => a.name).join(", ") || undefined,
    ),
    ...learned,
  ]);
}

// --- Stage 7: Test small ------------------------------------------------------

export type Variant = { id: string; postedAt: string; durationSeconds: number; reach: number | null; skipRate: number | null; avgWatchSeconds: number | null; shares: number | null };
export type VariantScore = { id: string; hold3s: number; watchPct: number; sharesPerReach: number; rank: number };

export const TEST_HOURS = 48;
export const MIN_REACH = 100;

export function scoreVariants(vs: Variant[]): VariantScore[] {
  const base = vs.map((v) => ({
    id: v.id,
    hold3s: 1 - (v.skipRate ?? 1),
    watchPct: v.avgWatchSeconds && v.durationSeconds ? v.avgWatchSeconds / v.durationSeconds : 0,
    sharesPerReach: v.reach ? (v.shares ?? 0) / v.reach : 0,
  }));
  // Rank on each of the three (1 = best), the winner has the lowest sum; ties go to 3-second hold.
  const rankBy = (k: "hold3s" | "watchPct" | "sharesPerReach") => {
    const sorted = [...base].sort((a, b) => b[k] - a[k]);
    return new Map(base.map((x) => [x.id, sorted.findIndex((y) => y[k] === x[k]) + 1]));
  };
  const r = [rankBy("hold3s"), rankBy("watchPct"), rankBy("sharesPerReach")];
  return base
    .map((x) => ({ ...x, rank: r.reduce((s, m) => s + m.get(x.id)!, 0) }))
    .sort((a, b) => a.rank - b.rank || b.hold3s - a.hold3s);
}

/** How long a test may wait for enough reach before it's called too small. */
export const MAX_TEST_DAYS = 7;

export function gateTest(vs: Variant[], now: Date): GateResult & { winner: VariantScore | null; tooSmall: boolean } {
  const old = vs.filter((v) => now.getTime() - Date.parse(v.postedAt) >= TEST_HOURS * 3_600_000);
  const reached = vs.filter((v) => (v.reach ?? 0) >= MIN_REACH);
  const measured = vs.filter((v) => v.skipRate !== null && v.avgWatchSeconds !== null);
  const g = gate([
    check("2 or 3 versions", vs.length >= 2 && vs.length <= 3, `${vs.length}`),
    check(`Every version has been up ${TEST_HOURS} hours`, old.length === vs.length, `${old.length} of ${vs.length}`),
    check(`Every version reached at least ${MIN_REACH} accounts`, reached.length === vs.length, vs.map((v) => `${v.id}: ${v.reach ?? 0}`).join(", ")),
    check("3-second hold and watch time are in for every version", measured.length === vs.length),
  ]);
  // The stop rule: a week on, still under the minimum reach, the test is over
  // and too small to pick from; stage 8 logs that instead of waiting forever.
  const allWeekOld = vs.length > 0 && vs.every((v) => now.getTime() - Date.parse(v.postedAt) >= MAX_TEST_DAYS * 86_400_000);
  return { ...g, winner: g.passed ? scoreVariants(vs)[0]! : null, tooSmall: !g.passed && allWeekOld && reached.length < vs.length };
}

/**
 * Double down only when the winner beats where we started (stage 0's
 * medians) on at least two of 3-second hold, watch % and shares per reach;
 * otherwise drop the idea. Stage 8's decision must agree.
 */
export function decideNext(winner: VariantScore | null, baseline: { hold3s: number | null; watchPct: number | null; sharesPerReach: number | null }): "double_down" | "drop" {
  if (!winner) return "drop";
  const beats = [
    baseline.hold3s === null || winner.hold3s > baseline.hold3s,
    baseline.watchPct === null || winner.watchPct > baseline.watchPct,
    baseline.sharesPerReach === null || winner.sharesPerReach > baseline.sharesPerReach,
  ].filter(Boolean).length;
  return beats >= 2 ? "double_down" : "drop";
}

// --- Stage 8: Learn -----------------------------------------------------------

export type Learning = { lessons?: { lesson?: string; stage?: number; check?: string }[]; patterns?: { pattern?: string; change?: string; numbers?: string }[]; decision?: string; why?: string };

export function gateLearn(l: Learning | null, resultsLogged: boolean, expected?: "double_down" | "drop"): GateResult {
  const lessons = l?.lessons ?? [];
  return gate([
    ...(expected ? [check("The decision follows the numbers (beat where we started on 2 of 3, or drop)", l?.decision === expected, `the numbers say ${expected.replace("_", " ")}`)] : []),
    check("The test results are logged", resultsLogged),
    check("At least one lesson", lessons.length > 0),
    ...lessons.map((x, i) => check(`Lesson ${i + 1} becomes a check for stage 3, 4, 5 or 6`, [3, 4, 5, 6].includes(x.stage ?? 0) && Boolean(x.check?.trim()) && Boolean(x.lesson?.trim()))),
    check("The patterns list is updated", (l?.patterns ?? []).some((p) => ["added", "confirmed", "dropped"].includes(p.change ?? "") && Boolean(p.pattern?.trim()))),
    check("Double down or drop, with why", ["double_down", "drop"].includes(l?.decision ?? "") && Boolean(l?.why?.trim())),
  ]);
}

// --- Posting -------------------------------------------------------------------

/**
 * Thomas chose automatic Trial Reels only (2026-11-10): a pipeline video may
 * go out without his OK only as a Trial Reel (non-followers), and only when
 * every stage-6 check passed. Anything else waits for him on the Vault page.
 */
export function mayAutoPost(v: { trial: boolean; prepublish: GateResult | null; paused: boolean }): { ok: boolean; why: string } {
  if (v.paused) return { ok: false, why: "the specialist is paused" };
  if (!v.trial) return { ok: false, why: "only Trial Reels go out on their own; this one waits for Thomas" };
  if (!v.prepublish) return { ok: false, why: "the pre-publish checks haven't run" };
  if (!v.prepublish.passed) return { ok: false, why: `pre-publish checks failed: ${v.prepublish.checks.filter((c) => !c.passed).map((c) => c.name).join("; ")}` };
  return { ok: true, why: "every pre-publish check passed" };
}
