// Stage 1: our own rules, measured on other creators' Reels.
//
// Every row here is a rule a later stage's prompt asks for or its gate
// checks. For each, code counts how many winners follow it and how many of
// the same accounts' average Reels do, and gives one of four verdicts:
//
//   backed            most winners follow it, and clearly more than average Reels
//   no difference     most winners follow it, and so do average Reels
//   winners break it  fewer than half of the winners follow it
//   not enough data   too few Reels could be measured for this rule
//
// The table never changes a rule. A rule winners break is shown to Thomas
// (the Hitta report, the History, the run's report file); he decides.
//
// Where a gate holds the number, the rule reads it from the gate, so the two
// can't drift apart. A new check in gates.ts for stages 3 to 6 belongs here
// too, with how it's measured, or among NOT_MEASURED with the reason.
import { NARRATED, type Format } from "./formats.ts";
import { CAMERAS, MAX_SHOTS, MAX_SPOKEN_WPS, MIN_SHOTS, REFERS_TO_OTHER_EPISODES, SLICE_SECONDS, UNCLEAR, type ReelLabels } from "./gates.ts";
import { median } from "./diagnose.ts";
import type { CaptionFacts, SpeechFacts, VideoFacts } from "./research-measure.ts";
import type { Candidate } from "./research-sample.ts";

/** A Reel with everything code measured and, when Claude looked at it, its labels. */
export type StudiedReel = Candidate & {
  /** r01, r02 … for the Reels Claude labelled; null for the rest. */
  id: string | null;
  facts: CaptionFacts;
  video: VideoFacts | null;
  speech: SpeechFacts | null;
  labels: ReelLabels | null;
};

type Needs = "the caption" | "Instagram's sound label" | "the cover or frames" | "the video" | "frames from the video" | "the transcript";

export type Rule = {
  id: string;
  /** The stage whose prompt or gate holds the rule. */
  stage: number;
  rule: string;
  /** The formats it applies to; left out, all of them. */
  formats?: readonly Format[];
  needs: Needs;
  unit?: string;
  /** The number behind the rule, for the medians in the table. */
  value?: (r: StudiedReel) => number | null;
  /** Does this Reel follow our rule? null when it can't be told for this Reel. */
  follows: (r: StudiedReel) => boolean | null;
};

// Numbers the prompts ask for that no gate holds (pipeline/stages/3-first-3-seconds.md, 4-script.md).
export const HOOK_MAX_WORDS = 5;
export const SHOT_SECONDS = { min: 2, max: 3 } as const;
export const TARGET_SECONDS = { min: 30, max: 42 } as const;
// The gates' own (gateScript, gatePrepublish).
export const GATE_SECONDS = { min: 30, max: 60 } as const;
export const LUFS = { min: -16, max: -12 } as const;
export const FIRST_LINE_CHARS = 125;
export const HASHTAGS = { min: 3, max: 5 } as const;
export const VOICED_SHOTS = 0.75;

const NARRATED_FORMATS = (Object.keys(NARRATED) as Format[]).filter((f) => NARRATED[f]);
const ENTERTAINMENT_FORMATS: readonly Format[] = ["story", "satisfying", "explainer"];

const wordsIn = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const within = (v: number | null | undefined, lo: number, hi: number) => (typeof v === "number" ? v >= lo && v <= hi : null);
/** A label, or null when Claude didn't give one or couldn't tell. */
const label = (v: string | undefined) => (v && v !== UNCLEAR ? v : null);
const is = (v: string | undefined, ...yes: string[]) => (label(v) === null ? null : yes.includes(v!));
const shotLabels = (r: StudiedReel, key: "camera" | "people" | "place") => (r.labels?.shots ?? []).map((s) => label(s[key])).filter((v): v is string => v !== null);

export const RULES: readonly Rule[] = [
  // Stage 3: the first 3 seconds.
  { id: "no-title-card", stage: 3, rule: "Doesn't open on a title card or a black or blank frame", needs: "frames from the video", follows: (r) => (label(r.labels?.opening) === null ? null : !["title-card", "blank"].includes(r.labels!.opening!)) },
  { id: "mid-action", stage: 3, rule: "Opens mid-action", needs: "frames from the video", follows: (r) => is(r.labels?.opening, "action") },
  { id: "hook-on-screen", stage: 3, rule: "Hook text on screen by 0.5 s", needs: "frames from the video", follows: (r) => (typeof r.labels?.hookText === "string" ? wordsIn(r.labels.hookText) > 0 : null) },
  {
    id: "hook-short",
    stage: 3,
    rule: `The hook is ${HOOK_MAX_WORDS} words or fewer`,
    needs: "frames from the video",
    unit: "words",
    value: (r) => (r.labels?.hookText?.trim() ? wordsIn(r.labels.hookText) : null),
    follows: (r) => (r.labels?.hookText?.trim() ? wordsIn(r.labels.hookText) <= HOOK_MAX_WORDS : null),
  },
  { id: "opening-shots", stage: 3, rule: "One or two shots in the first 3 seconds", needs: "the video", follows: (r) => (r.video ? r.video.cuts.filter((t) => t < 3).length <= 1 : null) },

  // Stage 4: the script.
  { id: "length", stage: 4, rule: `${GATE_SECONDS.min} to ${GATE_SECONDS.max} seconds long`, needs: "the video", unit: "s", value: (r) => r.video?.seconds ?? null, follows: (r) => within(r.video?.seconds, GATE_SECONDS.min, GATE_SECONDS.max) },
  { id: "length-target", stage: 4, rule: `${TARGET_SECONDS.min} to ${TARGET_SECONDS.max} seconds long (what the script prompt asks for)`, needs: "the video", follows: (r) => within(r.video?.seconds, TARGET_SECONDS.min, TARGET_SECONDS.max) },
  { id: "shots", stage: 4, rule: `${MIN_SHOTS} to ${MAX_SHOTS} shots`, needs: "the video", unit: "shots", value: (r) => r.video?.shots ?? null, follows: (r) => within(r.video?.shots, MIN_SHOTS, MAX_SHOTS) },
  { id: "shot-length", stage: 4, rule: `The usual shot is ${SHOT_SECONDS.min} to ${SHOT_SECONDS.max} seconds`, needs: "the video", unit: "s", value: (r) => r.video?.medianShot ?? null, follows: (r) => within(r.video?.medianShot, SHOT_SECONDS.min, SHOT_SECONDS.max) },
  { id: "no-long-shot", stage: 4, rule: `No shot longer than ${SHOT_SECONDS.max} seconds`, needs: "the video", unit: "s", value: (r) => r.video?.longestShot ?? null, follows: (r) => (r.video ? r.video.longestShot <= SHOT_SECONDS.max : null) },
  { id: "something-new", stage: 4, rule: `Something new every ${SLICE_SECONDS} seconds (a cut or a new word)`, needs: "the transcript", unit: "s", value: (r) => r.speech?.longestStill ?? null, follows: (r) => (r.speech ? r.speech.longestStill <= SLICE_SECONDS : null) },
  {
    id: "voice-first-shot",
    stage: 4,
    rule: "The voice starts in the first shot",
    formats: NARRATED_FORMATS,
    needs: "the transcript",
    unit: "s",
    value: (r) => r.speech?.firstWordAt ?? null,
    follows: (r) => (r.speech && r.video ? r.speech.firstWordAt !== null && r.speech.firstWordAt < (r.video.firstCutAt ?? r.video.seconds) : null),
  },
  { id: "voice-most-shots", stage: 4, rule: "The voice speaks in at least 3 of every 4 shots", formats: NARRATED_FORMATS, needs: "the transcript", follows: (r) => (r.speech ? r.speech.speechShotShare >= VOICED_SHOTS : null) },
  { id: "pace", stage: 4, rule: `At most ${MAX_SPOKEN_WPS} words a second`, formats: NARRATED_FORMATS, needs: "the transcript", unit: "words a second", value: (r) => r.speech?.wordsPerSecond ?? null, follows: (r) => (typeof r.speech?.wordsPerSecond === "number" ? r.speech.wordsPerSecond <= MAX_SPOKEN_WPS : null) },
  { id: "narrator", stage: 4, rule: "Told in first person or about a named character", formats: ["story"], needs: "the transcript", follows: (r) => is(r.labels?.narrator, "first-person", "named-character") },
  { id: "who-and-where", stage: 4, rule: "The first line says who this is and where", formats: ["story"], needs: "the transcript", follows: (r) => is(r.labels?.firstLineSaysWhoAndWhere, "yes") },
  { id: "question-answered", stage: 4, rule: "One question, answered at the end", formats: ["story"], needs: "the transcript", follows: (r) => is(r.labels?.answered, "at-the-end") },
  {
    id: "two-people",
    stage: 4,
    rule: "At most two characters on screen",
    formats: ["story", "ad"],
    needs: "frames from the video",
    follows: (r) => (shotLabels(r, "people").length ? !shotLabels(r, "people").includes("3+") : null),
  },
  {
    id: "two-places",
    stage: 4,
    rule: "One or two places",
    needs: "frames from the video",
    unit: "places",
    value: (r) => (shotLabels(r, "place").length ? new Set(shotLabels(r, "place").map((p) => p.toLowerCase().replace(/^(the|a|an)\s+/, "").trim())).size : null),
    follows: (r) => (shotLabels(r, "place").length ? new Set(shotLabels(r, "place").map((p) => p.toLowerCase().replace(/^(the|a|an)\s+/, "").trim())).size <= 2 : null),
  },
  {
    id: "cameras",
    stage: 4,
    rule: "Three or more kinds of camera",
    needs: "frames from the video",
    unit: "kinds",
    // With fewer than 3 shots labelled the rule can't be followed or broken.
    value: (r) => (shotLabels(r, "camera").length >= 3 ? new Set(shotLabels(r, "camera")).size : null),
    follows: (r) => (shotLabels(r, "camera").length >= 3 ? new Set(shotLabels(r, "camera")).size >= 3 : null),
  },
  {
    id: "standalone",
    stage: 4,
    rule: `Stands alone: no "part 2", "episode" or "to be continued"`,
    needs: "the caption",
    follows: (r) => !r.facts.leansOnEpisodes && !REFERS_TO_OTHER_EPISODES.test(`${r.labels?.hookText ?? ""} ${r.labels?.coverText ?? ""}`),
  },
  { id: "no-selling", stage: 4, rule: "Entertainment doesn't sell", formats: ENTERTAINMENT_FORMATS, needs: "the caption", follows: (r) => !r.facts.sells },
  { id: "made-with-ai", stage: 4, rule: "The caption says it was made with AI", formats: ["satisfying"], needs: "the caption", follows: (r) => r.facts.saysAI },
  { id: "caption-question", stage: 4, rule: "The caption asks the viewer a question", formats: ENTERTAINMENT_FORMATS, needs: "the caption", follows: (r) => (r.facts.chars ? r.facts.hasQuestion : null) },
  { id: "hashtags", stage: 4, rule: `${HASHTAGS.min} to ${HASHTAGS.max} hashtags`, needs: "the caption", unit: "hashtags", value: (r) => r.facts.hashtags, follows: (r) => r.facts.hashtags >= HASHTAGS.min && r.facts.hashtags <= HASHTAGS.max },

  // Stage 5: production.
  { id: "stick-figures", stage: 5, rule: "Drawn with stick figures", formats: ["story", "ad"], needs: "the cover or frames", follows: (r) => is(r.labels?.art, "stick-figures") },
  { id: "dark-art", stage: 5, rule: "Dark art, lit from inside the scene", formats: ["story", "explainer"], needs: "the cover or frames", follows: (r) => is(r.labels?.lighting, "dark") },
  { id: "word-captions", stage: 5, rule: "Captions word by word", formats: NARRATED_FORMATS, needs: "frames from the video", follows: (r) => is(r.labels?.captions, "word-by-word") },
  {
    id: "caption-band",
    stage: 5,
    rule: "Captions in one band in the lower part of the frame",
    formats: NARRATED_FORMATS,
    needs: "frames from the video",
    follows: (r) => (label(r.labels?.captions) === null || r.labels!.captions === "none" ? null : is(r.labels?.captionPosition, "lower")),
  },

  // Stage 6: pre-publish.
  { id: "own-sound", stage: 6, rule: "Its own sound, none from Instagram's music library", needs: "Instagram's sound label", follows: (r) => (r.audioType === "ORIGINAL_SOUND" ? true : r.audioType === "MUSIC" ? false : null) },
  { id: "loudness", stage: 6, rule: `Loudness about -14 LUFS (${LUFS.min} to ${LUFS.max})`, needs: "the video", unit: "LUFS", value: (r) => r.video?.lufs ?? null, follows: (r) => within(r.video?.lufs, LUFS.min, LUFS.max) },
  { id: "caption-first-line", stage: 6, rule: `The caption's first line is ${FIRST_LINE_CHARS} characters or less`, needs: "the caption", unit: "characters", value: (r) => (r.facts.chars ? r.facts.firstLineChars : null), follows: (r) => (r.facts.chars ? r.facts.firstLineChars <= FIRST_LINE_CHARS : null) },
  { id: "call-to-action", stage: 6, rule: "A call to action in the caption", needs: "the caption", follows: (r) => (r.facts.chars ? r.facts.callToAction : null) },
];

/** Checks of stages 3 to 6 that can't be measured on someone else's Reel, and why. */
export const NOT_MEASURED: readonly { check: string; why: string }[] = [
  { check: "Cold sound-off viewers know why to keep watching (stage 3)", why: "it compares a viewer's answer with the hook we intended, and another creator's intent isn't known" },
  { check: "Cold viewers retell the story right (stages 4 and 5)", why: "it compares a retelling with the script's own story, which other creators don't publish" },
  { check: "Every spoken claim is visible on screen (stage 4)", why: "it needs the script's line-by-line plan" },
  { check: "The review finds no grammar, physics or timing problems (stage 4)", why: "it is a judgement of our script, not something to count on a finished video" },
  { check: "The camera never repeats twice in a row (stage 4)", why: "only up to 12 shots a Reel are looked at, so neighbours can't be compared; the kinds of camera are counted" },
  { check: "A music bed under the voice (stage 5)", why: "the transcriber's music tag misses quiet music under speech too often to count" },
  { check: "Ours isn't worse than the benchmark (stage 5)", why: "that judgement runs in stage 5 itself, on our own frames" },
  { check: "Text stays out of Instagram's button zones, the codec, frame rate and true peak (stage 6)", why: "Instagram re-encodes what it serves, so these describe its copy, not the creator's upload" },
  { check: "Every sound and picture is licensed (stage 6)", why: "another creator's licences aren't visible" },
];

export type Side = { n: number; follow: number; median: number | null };
export type Verdict = "backed" | "no difference" | "winners break it" | "not enough data";
export type RuleRow = { id: string; stage: number; rule: string; needs: string; unit: string | null; winners: Side; average: Side; verdict: Verdict; /** Fisher's exact test on the two shares; under 0.05 the gap is unlikely to be chance. */ p: number | null; clear: boolean };

/** Each side needs this many Reels the rule could be told for. */
export const MIN_N = 5;
/** Winners must follow a rule this much more often (as a share) to call it backed. */
export const GAP = 0.2;

const lnFact = (() => {
  const memo = [0];
  return (n: number) => {
    for (let i = memo.length; i <= n; i++) memo.push(memo[i - 1]! + Math.log(i));
    return memo[n]!;
  };
})();

/** Fisher's exact test, two-sided, for the table [[a, b], [c, d]]. */
export function fisher(a: number, b: number, c: number, d: number): number {
  const p = (x: number) => Math.exp(lnFact(a + b) + lnFact(c + d) + lnFact(a + c) + lnFact(b + d) - lnFact(a + b + c + d) - lnFact(x) - lnFact(a + b - x) - lnFact(a + c - x) - lnFact(d - a + x));
  const observed = p(a);
  let total = 0;
  for (let x = Math.max(0, a - d); x <= Math.min(a + b, a + c); x++) if (p(x) <= observed * (1 + 1e-9)) total += p(x);
  return Math.min(1, total);
}

export function verdictOf(winners: Side, average: Side): Verdict {
  if (winners.n < MIN_N || average.n < MIN_N) return "not enough data";
  const w = winners.follow / winners.n;
  if (w < 0.5) return "winners break it";
  return w - average.follow / average.n >= GAP ? "backed" : "no difference";
}

/** The rules of a format, each measured on the winners and on the average Reels. Reels Claude marked as not this format are left out. */
export function rulesTable(format: Format, reels: StudiedReel[]): RuleRow[] {
  const onFormat = reels.filter((r) => r.labels?.onFormat !== "no");
  const side = (rule: Rule, group: "winner" | "average"): Side => {
    const told = onFormat.filter((r) => r.group === group).map((r) => ({ r, f: rule.follows(r) })).filter((x) => x.f !== null);
    return { n: told.length, follow: told.filter((x) => x.f).length, median: rule.value ? median(told.map((x) => rule.value!(x.r))) : null };
  };
  return RULES.filter((rule) => !rule.formats || rule.formats.includes(format)).map((rule) => {
    const winners = side(rule, "winner");
    const average = side(rule, "average");
    const verdict = verdictOf(winners, average);
    const p = verdict === "not enough data" ? null : Math.round(fisher(winners.follow, winners.n - winners.follow, average.follow, average.n - average.follow) * 1000) / 1000;
    return { id: rule.id, stage: rule.stage, rule: rule.rule, needs: rule.needs, unit: rule.unit ?? null, winners, average, verdict, p, clear: p !== null && p < 0.05 };
  });
}

const HEADINGS: Record<Verdict, string> = {
  backed: "Backed: most winners follow our rule, and clearly more often than average Reels",
  "no difference": "No difference: winners follow our rule about as often as average Reels",
  "winners break it": "Winners break our rule: fewer than half of the winners follow it",
  "not enough data": "Not enough Reels to tell",
};

/** One row in plain words: "10 to 14 shots (stage 4): 9 of 12 winners, 4 of 11 average Reels. Winners' median 12 shots, average 19." */
export function rowText(r: RuleRow): string {
  if (r.verdict === "not enough data") return `${r.rule} (stage ${r.stage}): needs ${r.needs}, which was there for ${r.winners.n} winners and ${r.average.n} average Reels.`;
  const medians = r.winners.median !== null && r.average.median !== null ? ` Winners' median ${r.winners.median}${r.unit ? ` ${r.unit}` : ""}, average ${r.average.median}.` : "";
  return `${r.rule} (stage ${r.stage}): ${r.winners.follow} of ${r.winners.n} winners, ${r.average.follow} of ${r.average.n} average Reels.${medians}${r.clear ? " A gap this size is unlikely to be chance." : ""}`;
}

/** The whole table, grouped by verdict. */
export function tableText(rows: RuleRow[], verdicts: readonly Verdict[] = ["winners break it", "backed", "no difference", "not enough data"]): string {
  return verdicts
    .map((v) => ({ v, rows: rows.filter((r) => r.verdict === v) }))
    .filter((g) => g.rows.length)
    .map((g) => `${HEADINGS[g.v]}:\n${g.rows.map((r) => `- ${rowText(r)}`).join("\n")}`)
    .join("\n\n");
}

export { CAMERAS };
