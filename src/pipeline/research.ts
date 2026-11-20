// Stage 1 of the content pipeline: Research what wins (pipeline/stages/1-research.md).
//
// One run studies one format. Code reads the accounts, scores every Reel
// against its own account (research-sample.ts), measures the winners and the
// average Reels (research-measure.ts, ../transcribe.ts) and tests our own
// rules on them (research-rules.ts). Claude does three things, and code
// checks each: it labels every Reel from fixed lists without being told how
// the Reel performed; it proposes patterns from half of the Reels; and,
// blind again, it answers each pattern's yes/no question for the other half.
// A pattern is kept only when those answers back it (gates.ts, patternHolds).
//
// Nothing here writes to Instagram. A passed run replaces the format's
// earlier patterns in the Vault and is recorded in the History.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAccount, type DiscoveryState } from "../instagram.ts";
import { STT_USD_PER_HOUR, transcribe as elevenLabs, type Transcribe } from "../transcribe.ts";
import type { Vault } from "../vault.ts";
import type { Format } from "./formats.ts";
import { MIN_ACCOUNTS, MIN_LOOKED_PER_GROUP, UNCLEAR, gateResearch, labelProblems, patternProblem, type GateResult, type Looked, type PatternTally, type ReelLabels } from "./gates.ts";
import { captionFacts, download as downloadFile, hasFfmpeg, measureFile, speechFacts, type MeasureFile, type SpeechFacts, type VideoFacts } from "./research-measure.ts";
import { FOR_THOMAS, NOT_MEASURED, rowText, rulesTable, tableText, type RuleRow, type StudiedReel } from "./research-rules.ts";
import { AVERAGE_LIFT, MAX_AGE_DAYS, MIN_AGE_DAYS, WINDOW, WINNER_LIFT, accountLine, pickSample, readEnough, studyAccount, type AccountStudy, type Candidate } from "./research-sample.ts";
import { parseJson, runStage, stagePrompt } from "./stages.ts";

type Ask = (prompt: string) => Promise<string>;

/**
 * Winners and average Reels looked at for a format, each (RESEARCH_PER_GROUP
 * changes it, 6 to 30). Half of them are held back to check the patterns on,
 * and 10 a group is the least that lets a pattern be told from chance at all.
 */
export const PER_GROUP = 20;
export const PER_GROUP_MAX = 30;
/** Posts read from each account, at most: reading stops sooner once there are enough Reels to score (readEnough). */
export const POSTS_PER_ACCOUNT = 200;
/** Reels in one Claude turn: each has up to two pictures to open. */
export const CHUNK = 8;
export const LABEL_ROUNDS = 3;
export const MAX_PATTERNS = 5;
/** Accounts post other things too. A Reel the reader says isn't the format is replaced by the next in line: at most this many a group. */
export const TOP_UP_MAX = 10;
/** With this many of an account's Reels looked at and under a third of them the format, the report says the account is a poor fit. */
export const OFF_FORMAT_MIN_LOOKED = 5;
/** A transcript with fewer words than this is treated as no speech. */
export const MIN_WORDS_HEARD = 5;

const subjectOf = (format: Format) => `research:${format}`;
/** The `source` of a pattern lesson found by this stage for a format. */
export const patternSource = (format: Format) => `stage 1 (${format})`;
/** Patterns from the first version of this stage: one story account's top Reels, with nothing to compare them with. */
export const LEGACY_SOURCE = "stage 1";

/** What a format means for this stage (the niche-<format> block in 1-research.md). */
export function formatNiche(format: Format): string {
  return stagePrompt(1, {}, `niche-${format}`);
}

/** The niche line stage 2 pitches into: the format's own, then whose account this is. */
export function nicheFor(format: Format): string {
  return `${formatNiche(format)}; ${stagePrompt(1, {}, "account")}`;
}

// --- One Claude turn -------------------------------------------------------------

/** One Claude turn that may open the pictures in `dir` (Read only). */
export function askClaudeWithFiles(dir: string): (prompt: string) => Promise<string> {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const bin = process.env.HITTA_CLAUDE_BIN || "claude";
      const child = spawn(bin, ["-p", "--model", process.env.PIPELINE_CLAUDE_MODEL || "sonnet", "--output-format", "json", "--max-turns", "40", "--allowedTools", "Read", "--no-session-persistence"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`Claude couldn't start: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`Claude stopped with an error (${code}): ${err.slice(0, 200)}`));
        try {
          const json = JSON.parse(out) as { result?: string; is_error?: boolean };
          if (json.is_error) return reject(new Error(`Claude returned an error: ${String(json.result).slice(0, 200)}`));
          resolve(json.result ?? "");
        } catch {
          resolve(out);
        }
      });
      child.stdin.end(prompt);
    });
}

// --- What a run finds ---------------------------------------------------------------

/** A Reel as studied: what code measured, what Claude was shown of it, and its labels. */
export type FoundReel = Omit<StudiedReel, "mediaUrl" | "thumbnailUrl" | "id" | "group"> & {
  id: string;
  group: "winner" | "average";
  /** Instagram gave a video file for it. */
  videoGiven: boolean;
  sight: Looked["sight"];
  shotFrames: number;
  /** The transcript had enough words to label from. */
  heard: boolean;
  /** True for the half of the Reels the patterns were checked on (and not drawn from). */
  heldOut: boolean;
};

export type FoundPattern = PatternTally & { kept: boolean };

export type Findings = {
  format: Format;
  studiedAt: string;
  accounts: Omit<AccountStudy, "candidates">[];
  reels: FoundReel[];
  /** False when Claude wasn't asked to label, because a check that doesn't need it had already failed. */
  asked: boolean;
  labelRounds: number;
  videosGiven: number;
  videosMeasured: number;
  transcripts: number;
  table: RuleRow[];
  patterns: FoundPattern[];
  /** What limited this run, in plain words. */
  notes: string[];
  /** Accounts whose winners and average Reels differ in how often Instagram gives the video, and what that suggests about their sound. */
  soundSigns?: string[];
  /** Reels looked at in place of ones that turned out not to be the format. */
  replaced?: number;
};

export type ResearchResult = { format: Format; passed: boolean; gate: GateResult; findings: Findings; report: string; reportFile: string | null };

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const handles = (accounts: { username: string }[]) => accounts.map((a) => `@${a.username}`).join(", ");

/** Runs `fn` over `items`, `size` at a time, keeping the order. */
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/** A Reel with the picture files Claude can open for it (names in the run's work folder). */
export type ShownReel = FoundReel & { files: { open: string | null; shots: string | null; cover: string | null } };
type Working = ShownReel;

/** What Claude sees of a Reel when it must not know how the Reel performed: no views, likes, lift, group, account or date. */
export function blindView(r: ShownReel): Record<string, unknown> {
  return {
    id: r.id,
    caption: r.caption.slice(0, 700),
    ...(r.video ? { seconds: r.video.seconds } : {}),
    ...(r.sight === "frames" ? { open: r.files.open, shots: r.files.shots, shotFrames: r.shotFrames } : {}),
    ...(r.sight === "cover" ? { cover: r.files.cover } : {}),
    ...(r.heard && r.speech ? { transcript: r.speech.text } : {}),
  };
}

/** What the pattern step sees: the result, the measurements and the blind labels. */
function knownView(r: Working): Record<string, unknown> {
  const { shots, id: _id, ...labels } = r.labels ?? {};
  return {
    id: r.id,
    group: r.group,
    lift: r.lift,
    account: r.account,
    caption: r.caption.slice(0, 300),
    ...(r.video ? { seconds: r.video.seconds, shots: r.video.shots, usualShotSeconds: r.video.medianShot } : {}),
    ...(r.speech ? { firstWordAt: r.speech.firstWordAt, wordsPerSecond: r.speech.wordsPerSecond } : {}),
    described: { ...labels, ...(shots?.length ? { cameras: [...new Set(shots.map((s) => s.camera))].join(", "), places: [...new Set(shots.map((s) => s.place))].join(", ") } : {}) },
    ...(r.heard && r.speech ? { transcript: r.speech.text.slice(0, 700) } : {}),
    ...(r.sight === "frames" ? { open: r.files.open, shots_picture: r.files.shots } : r.sight === "cover" ? { cover: r.files.cover } : {}),
  };
}

const lookedOf = (r: FoundReel): Looked => ({ id: r.id, group: r.group, sight: r.sight, shotFrames: r.shotFrames, heard: r.heard });

/** Counts a blind reader's answers on the Reels the patterns weren't drawn from. */
export function tallyPatterns(patterns: { pattern: string; question: string }[], answers: Map<string, string[]>, heldOut: { id: string; group: "winner" | "average"; account: string }[]): FoundPattern[] {
  return patterns.map((p, i) => {
    const side = (group: "winner" | "average") => {
      const given = heldOut.filter((r) => r.group === group).map((r) => ({ account: r.account, answer: answers.get(r.id)?.[i] }));
      const yes = given.filter((g) => g.answer === "yes");
      return { yes: yes.length, asked: given.filter((g) => g.answer === "yes" || g.answer === "no").length, accounts: new Set(yes.map((g) => g.account)).size };
    };
    const w = side("winner");
    const a = side("average");
    const t: PatternTally = { pattern: p.pattern, question: p.question, winnersYes: w.yes, winnersAsked: w.asked, averageYes: a.yes, averageAsked: a.asked, winnerAccounts: w.accounts };
    return { ...t, kept: patternProblem(t) === null };
  });
}

// --- The report ------------------------------------------------------------------

/** An account needs this many winners and average Reels before their shares with a video file are compared. */
export const SOUND_SIGN_MIN = 5;
/** And the shares must differ by this much (0 to 1). */
export const SOUND_SIGN_GAP = 0.3;

/**
 * Instagram withholds a Reel's video file when the Reel carries copyrighted
 * sound, most often music from its own library (Meta's docs for `media_url`).
 * It refuses to say which kind of sound a Reel has (`media_audio_type`), so
 * whether the file comes is the only sign of it there is. This counts all of
 * an account's winners and average Reels, not just the ones a run looked at.
 */
export function soundSigns(accounts: Omit<AccountStudy, "candidates">[]): string[] {
  return accounts.flatMap((a) => {
    if (a.problem || a.winnersWithVideo === undefined || a.averageWithVideo === undefined || a.winners < SOUND_SIGN_MIN || a.average < SOUND_SIGN_MIN) return [];
    const gap = a.winnersWithVideo / a.winners - a.averageWithVideo / a.average;
    if (Math.abs(gap) < SOUND_SIGN_GAP) return [];
    const counts = `Instagram gives the video file for ${a.winnersWithVideo} of @${a.username}'s ${a.winners} winners and ${a.averageWithVideo} of its ${a.average} average Reels`;
    return [`${counts}. It withholds the file when a Reel carries copyrighted sound, most often music from its library, so this account's winners probably use ${gap < 0 ? "library music more often" : "their own sound more often"} than its average Reels. That is a guess from which files came, not a measurement.`];
  });
}

const tallyText = (p: PatternTally) => `${p.winnersYes} of ${p.winnersAsked} winners${p.winnerAccounts > 1 ? ` (in ${p.winnerAccounts} accounts)` : ""} and ${p.averageYes} of ${p.averageAsked} average Reels it wasn't drawn from`;
const verdictRows = (f: Findings, v: RuleRow["verdict"]) => f.table.filter((r) => r.verdict === v);
/** The Reels compared: those the reader didn't mark as something other than the format. */
const winnersOf = (f: Findings) => f.reels.filter((r) => r.group === "winner" && r.labels?.onFormat !== "no");
const averageOf = (f: Findings) => f.reels.filter((r) => r.group === "average" && r.labels?.onFormat !== "no");
const leftOutOf = (f: Findings) => f.reels.filter((r) => r.labels?.onFormat === "no");
const usableOf = (f: Findings) => f.accounts.filter((a) => !a.problem);

/** A few spoken sentences for Hitta and the log: what was studied and what stood out. */
export function summaryText(f: Findings, passed: boolean): string {
  const against = verdictRows(f, "against");
  const breaks = verdictRows(f, "winners break it");
  const backed = verdictRows(f, "backed");
  const kept = f.patterns.filter((p) => p.kept);
  const studied = `${f.format}: ${count(winnersOf(f).length, "winner")} and ${count(averageOf(f).length, "average Reel")} from ${handles(usableOf(f)) || "no accounts"}`;
  if (!passed) return `${studied}. It didn't pass its gate, so nothing was saved.`;
  const short = (r: RuleRow) => r.rule.replace(/\s*\(.*\)$/, "").toLowerCase();
  return [
    `${studied}.`,
    against.length ? `Winners follow ${count(against.length, "rule")} of ours less often than average Reels: ${against.slice(0, 4).map(short).join("; ")}.` : "",
    breaks.length ? `Most winners don't follow ${count(breaks.length, "rule")} of ours: ${breaks.slice(0, 4).map(short).join("; ")}.` : "",
    !against.length && !breaks.length ? "Winners break none of our rules." : "",
    backed.length ? `${count(backed.length, "rule")} backed: ${backed.slice(0, 4).map(short).join("; ")}.` : "",
    kept.length ? `${count(kept.length, "new pattern")}: ${kept.map((p) => p.pattern).join(" ")}` : "No new pattern held up.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The run's report, as Markdown: the file under research/ and the workflow's artifact. */
export function reportText(f: Findings, gate: GateResult): string {
  const kept = f.patterns.filter((p) => p.kept);
  const dropped = f.patterns.filter((p) => !p.kept);
  const failed = gate.checks.filter((c) => !c.passed);
  const reel = (r: FoundReel) => {
    const result = r.views !== null ? `${r.views} views` : `${r.likes ?? "?"} likes, ${r.comments ?? "?"} comments`;
    const seen = r.sight === "frames" ? `video, ${r.video?.seconds ?? "?"} s, ${r.video ? count(r.video.shots, "shot") : "? shots"}` : r.sight === "cover" ? "cover only" : "caption only";
    return `| ${r.id} | @${r.account} | ${r.group} | ${r.lift}× | ${result} | ${r.postedAt} | ${seen}${r.heard ? ", transcript" : ""} | ${r.labels?.onFormat === "no" ? "not this format, left out" : (r.labels?.premise ?? "").replace(/\|/g, "/").slice(0, 110)} | ${r.url} |`;
  };
  return [
    `# Stage 1 research: ${f.format}`,
    `Studied ${f.studiedAt.slice(0, 10)}. ${gate.passed ? "Passed its gate." : "Did not pass its gate, so nothing was saved for later stages."}`,
    failed.length ? `## Checks that failed\n${failed.map((c) => `- ${c.name}${c.detail ? `: ${c.detail}` : ""}`).join("\n")}` : "",
    `## What was compared\nEach Reel is scored against its own account: its result divided by the median of the ${WINDOW} Reels that account posted nearest to it in time (its lift). A winner is in its account's top quarter by lift, with a lift of at least ${WINNER_LIFT}. It is compared with the same account's average Reels: the middle half, with a lift from ${AVERAGE_LIFT.min} to under ${AVERAGE_LIFT.max}. Reels under ${MIN_AGE_DAYS} days or over ${MAX_AGE_DAYS} days old are left out.\n\n${f.accounts.map((a) => `- ${accountLine(a)}`).join("\n")}${f.soundSigns?.length ? `\n\n${f.soundSigns.join("\n\n")} Our Reels carry their own sound (stages 5 and 6): for Thomas to weigh.` : ""}\n\nCompared: ${count(winnersOf(f).length, "winner")} and ${count(averageOf(f).length, "average Reel")}, those with a video file first.${leftOutOf(f).length ? ` ${count(leftOutOf(f).length, "more Reel")} ${leftOutOf(f).length === 1 ? "wasn't a" : "weren't"} ${f.format} ${leftOutOf(f).length === 1 ? "Reel" : "Reels"} (these accounts post other things too) and ${leftOutOf(f).length === 1 ? "was" : "were"} left out${f.replaced ? `; the next ${f.replaced} in line ${f.replaced === 1 ? "was" : "were"} looked at in their place` : ""}.` : ""} Instagram gave the video for ${f.videosGiven} of the ${f.reels.length} Reels looked at; ${f.videosMeasured} were measured and ${f.transcripts} transcribed.`,
    f.notes.length ? `## What limited this run\n${f.notes.map((n) => `- ${n}`).join("\n")}` : "",
    f.table.length ? `## Our rules, measured on these Reels\nThis table never changes a rule. A rule the winners speak against, or one most of them break, is for Thomas to weigh. About ${f.table.length} rules are tested at once, so one or two can look clear by chance.\n\n${tableText(f.table)}` : "",
    `## Patterns\nProposed from half of the Reels, then checked by a reader who didn't know the results on the other half.\n\n${kept.length ? kept.map((p) => `- Kept: ${p.pattern} (${p.question} Yes for ${tallyText(p)}.)`).join("\n") : "None kept."}${dropped.length ? `\n${dropped.map((p) => `- Dropped: ${p.pattern} (${p.question} Yes for ${tallyText(p)}: ${patternProblem(p)}.)`).join("\n")}` : ""}`,
    `## What can't be measured on someone else's Reel\n${NOT_MEASURED.map((n) => `- ${n.check}: ${n.why}.`).join("\n")}`,
    f.reels.length ? `## The Reels\n| id | account | group | lift | result | posted | studied from | about | link |\n|---|---|---|---|---|---|---|---|---|\n${f.reels.map(reel).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * What stages 2 to 4 are told about what wins in a format: the rules winners
 * follow clearly more often, the patterns kept, and what a few winners were
 * about. Rules winners break stay out of it: those are Thomas's to decide.
 */
export async function researchBrief(vault: Vault, format: Format): Promise<string> {
  const row = await vault.latestStage(1, { subject: subjectOf(format), passedOnly: true });
  const f = row?.output as Findings | null | undefined;
  const lessons = await vault.lessons("pattern");
  if (!f?.reels) {
    // Until this format has been studied: the story patterns from the first version, for stories only.
    const legacy = format === "story" ? lessons.filter((l) => l.source === LEGACY_SOURCE) : [];
    return legacy.map((l) => `- ${l.text}`).join("\n") || "(none yet)";
  }
  const patterns = lessons.filter((l) => l.source === patternSource(format));
  const backed = verdictRows(f, "backed");
  const onFormat = winnersOf(f).filter((r) => r.labels?.onFormat !== "no" && r.labels?.premise?.trim());
  const about = [...onFormat].sort((a, b) => b.lift - a.lift).slice(0, 5);
  const head = `Stage 1 compared ${count(winnersOf(f).length, "winning Reel")} with ${count(averageOf(f).length, "average Reel")} from ${handles(usableOf(f))} (${f.studiedAt.slice(0, 10)}). A winner is in its own account's top quarter, with at least ${WINNER_LIFT} times what that account's Reels were getting at the time.`;
  const parts = [
    head,
    backed.length ? `Rules of ours that winners follow clearly more often than average Reels:\n${backed.map((r) => `- ${rowText(r)}`).join("\n")}` : "",
    patterns.length ? `Leads from a small blind check (winners showed these more often than average Reels; worth trying, not rules):\n${patterns.map((l) => `- ${l.text}${l.evidence ? ` (${l.evidence})` : ""}`).join("\n")}` : "",
    !backed.length && !patterns.length ? "It found no clear difference between winners and average Reels yet, so there is no pattern to lean on." : "",
    about.length ? `What some of the winners were about (to show the kind of thing, never to copy):\n${about.map((r) => `- ${r.labels!.premise!.trim()} (${r.lift} times its account's usual)`).join("\n")}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

// --- The run -----------------------------------------------------------------------

export type ResearchDeps = {
  vault: Vault;
  token: string;
  igUserId: string;
  format: Format;
  /** The accounts to study for this format (research-accounts.ts). */
  accounts: string[];
  ask?: Ask;
  discover?: typeof discoverAccount;
  /** What earlier formats of the same run learned about Instagram's fields and its hourly allowance (left out: starts fresh). */
  discovery?: DiscoveryState;
  fetchImpl?: typeof fetch;
  download?: typeof downloadFile;
  measure?: MeasureFile;
  /** Speech to text; null turns it off. Left out: ElevenLabs when its key is set and RESEARCH_TRANSCRIBE isn't "off". */
  transcribe?: Transcribe | null;
  /** Whether ffmpeg is installed (left out: checked). */
  ffmpeg?: boolean;
  perGroup?: number;
  /** Where the report goes ("research"); null writes none. */
  outDir?: string | null;
  log?: (m: string) => void;
  now?: () => Date;
};

function perGroupFrom(d: ResearchDeps): number {
  const asked = d.perGroup ?? Number(process.env.RESEARCH_PER_GROUP);
  return Number.isFinite(asked) && asked > 0 ? Math.max(MIN_LOOKED_PER_GROUP, Math.min(PER_GROUP_MAX, Math.round(asked))) : PER_GROUP;
}

/**
 * Reads each account and scores every Reel against its own account. An
 * account that can't be read is kept, with why. Also used by `social
 * accounts-test`, which stops here.
 */
export async function studyAccounts(d: Pick<ResearchDeps, "token" | "igUserId" | "accounts" | "discover" | "discovery" | "fetchImpl" | "log" | "now">): Promise<{ studies: AccountStudy[]; noSoundKind: string[] }> {
  const log = d.log ?? (() => {});
  const studies: AccountStudy[] = [];
  const noSoundKind: string[] = [];
  // A field Instagram refuses for one account is refused for all of them, and
  // the hourly allowance for reading other accounts is one for the whole run.
  const state: DiscoveryState = d.discovery ?? { set: 0 };
  const clock = d.now ?? (() => new Date());
  state.enough = (media) => readEnough(media, clock());
  for (const a of d.accounts) {
    try {
      const acc = await (d.discover ?? discoverAccount)(d.fetchImpl ?? fetch, d.token, d.igUserId, a, POSTS_PER_ACCOUNT, state);
      const s = studyAccount(acc, clock());
      if (acc.gave && !acc.gave.audioType) noSoundKind.push(s.username);
      log(accountLine(s));
      studies.push(s);
    } catch (err) {
      const problem = (err instanceof Error ? err.message : String(err)).replace(/\.$/, "");
      const s: AccountStudy = { username: a, followers: null, reels: 0, settled: 0, scoredBy: null, median: null, postsPerWeek: null, winners: 0, average: 0, problem, candidates: [] };
      log(accountLine(s));
      studies.push(s);
    }
  }
  if (typeof state.usage === "number") log(`Instagram's hourly allowance for reading other accounts is ${Math.round(state.usage)}% used.`);
  return { studies, noSoundKind };
}

/** Stage 1 for one format, end to end. */
export async function runResearch(d: ResearchDeps): Promise<ResearchResult> {
  const log = d.log ?? (() => {});
  const now = d.now ?? (() => new Date());
  const fetchImpl = d.fetchImpl ?? fetch;
  const format = d.format;
  const notes: string[] = [];

  // 1. Read the accounts and score every Reel against its own account.
  const { studies, noSoundKind } = await studyAccounts(d);
  if (noSoundKind.length) notes.push(`Instagram wouldn't say what kind of sound ${handles(noSoundKind.map((username) => ({ username })))} used, so "its own sound" couldn't be measured for them.`);
  if (studies.some((s) => s.scoredBy === "likes and comments")) notes.push(`Instagram gave no views for ${handles(studies.filter((s) => s.scoredBy === "likes and comments"))}, so those Reels are scored by likes plus comments.`);

  // 2. The winners and the average Reels to look at, in an order that doesn't give the groups away.
  // More are lined up than are looked at: a Reel the reader says isn't the format is replaced by the next in line.
  const perGroup = perGroupFrom(d);
  const line = pickSample(studies, perGroup + TOP_UP_MAX);
  const sample = { winners: line.winners.slice(0, perGroup), average: line.average.slice(0, perGroup) };
  const heldOut = new Set([...line.winners.filter((_, i) => i % 2 === 1), ...line.average.filter((_, i) => i % 2 === 1)].map((c) => c.url));
  const mixed = (url: string) => createHash("sha1").update(url).digest("hex");
  const shuffled = (cs: Candidate[]) => [...cs].sort((a, b) => (mixed(a.url) < mixed(b.url) ? -1 : 1));
  const picked = shuffled([...sample.winners, ...sample.average]);
  const enough = sample.winners.length >= MIN_LOOKED_PER_GROUP && sample.average.length >= MIN_LOOKED_PER_GROUP;

  const dir = await mkdtemp(join(tmpdir(), "research-"));
  try {
    // 3. Measure each Reel: the caption always, the video and the transcript when they can be had.
    const ffmpeg = picked.some((c) => c.mediaUrl) ? (d.ffmpeg ?? (await hasFfmpeg())) : true;
    if (!ffmpeg) {
      notes.push("ffmpeg isn't installed here, so no video could be measured.");
      log("ffmpeg isn't installed, so no video can be measured. The workflow's \"Check ffmpeg\" step installs it.");
    }
    const sttOff = process.env.RESEARCH_TRANSCRIBE?.trim().toLowerCase() === "off";
    const stt: Transcribe | null = d.transcribe !== undefined ? d.transcribe : !sttOff && process.env.ELEVENLABS_API_KEY?.trim() ? elevenLabs : null;
    if (!stt) notes.push(sttOff ? "Transcripts were turned off (RESEARCH_TRANSCRIBE=off), so the rules about the voice couldn't be measured." : "No ElevenLabs key, so there are no transcripts and the rules about the voice couldn't be measured.");
    let sttDown: string | null = null;
    let heardSeconds = 0;
    const save = d.download ?? downloadFile;
    const measure = d.measure ?? measureFile;

    const idOf = (i: number) => `r${String(i + 1).padStart(2, "0")}`;
    const measureOne = async (c: Candidate, id: string): Promise<Working> => {
      let video: VideoFacts | null = null;
      let speech: SpeechFacts | null = null;
      const files: Working["files"] = { open: null, shots: null, cover: null };
      let shotFrames = 0;
      if (c.mediaUrl && ffmpeg) {
        const file = join(dir, `${id}.mp4`);
        if (await save(fetchImpl, c.mediaUrl, file)) {
          const m = await measure(file, dir, id, { sheets: true, audio: Boolean(stt) && !sttDown });
          video = m.video;
          if (m.open && m.shotsSheet && m.shotFrames > 0) {
            files.open = m.open;
            files.shots = m.shotsSheet;
            shotFrames = m.shotFrames;
          }
          if (m.audio && video && stt && !sttDown) {
            try {
              speech = speechFacts(await stt(m.audio), video.seconds, video.cuts);
              heardSeconds += video.seconds;
            } catch (err) {
              // One refusal (a key without Speech to Text, no credit left) would repeat for every Reel.
              sttDown = err instanceof Error ? err.message : String(err);
              log(`No transcripts from here on: ${sttDown}`);
            }
          }
          await rm(file, { force: true });
        }
      }
      if (!files.open && c.thumbnailUrl && (await save(fetchImpl, c.thumbnailUrl, join(dir, `${id}-cover.jpg`)))) files.cover = `${id}-cover.jpg`;
      const { mediaUrl, thumbnailUrl: _t, ...rest } = c;
      return {
        ...rest,
        id,
        group: c.group as "winner" | "average",
        caption: c.caption.slice(0, 1200),
        facts: captionFacts(c.caption),
        video,
        speech,
        labels: null,
        videoGiven: Boolean(mediaUrl),
        sight: files.open ? "frames" : files.cover ? "cover" : "none",
        shotFrames,
        heard: (speech?.words ?? 0) >= MIN_WORDS_HEARD,
        heldOut: heldOut.has(c.url),
        files,
      };
    };
    const given = (rs: Working[]) => rs.filter((r) => r.videoGiven).length;
    const measured = (rs: Working[]) => rs.filter((r) => r.video).length;
    const heard = (rs: Working[]) => rs.filter((r) => r.speech).length;
    const measuredLine = (rs: Working[], more = false) =>
      `Measured ${rs.length}${more ? " more" : ""} Reels: ${measured(rs)} of ${given(rs)} videos, ${count(heard(rs), "transcript")}${heard(rs) ? ` (${Math.round(heardSeconds / 60)} min of sound${more ? " in all" : ""}, about $${((heardSeconds / 3600) * STT_USD_PER_HOUR).toFixed(2)} at ElevenLabs' $${STT_USD_PER_HOUR} an hour)` : ""}, ${rs.filter((r) => r.sight === "cover").length} from the cover only.`;
    const working = await pool(picked, 3, (c: Candidate, i) => measureOne(c, idOf(i)));
    log(measuredLine(working));

    // 4. Claude labels each Reel, blind. Labels that break the lists go back to it with what was wrong.
    const ask = d.ask ?? askClaudeWithFiles(dir);
    const niche = formatNiche(format);
    const labels = new Map<string, ReelLabels>();
    const problemsOf = (r: Working) => (labels.has(r.id) ? labelProblems(labels.get(r.id)!, lookedOf(r)) : ["not labelled yet"]);
    // Claude is asked only when the checks that don't need it would pass.
    const ready = studies.filter((x) => !x.problem).length >= MIN_ACCOUNTS && enough && (given(working) === 0 || measured(working) * 2 >= given(working));
    const labelAll = async (reels: Working[]): Promise<number> => {
      let rounds = 0;
      for (; rounds < LABEL_ROUNDS; rounds++) {
        const todo = reels.filter((r) => problemsOf(r).length);
        if (!todo.length) break;
        await pool(chunks(todo, CHUNK), 2, async (chunk) => {
          const wrong = chunk.filter((r) => labels.has(r.id)).map((r) => `- ${r.id}: ${problemsOf(r).join("; ")}`);
          const answer = await ask(
            stagePrompt(1, {
              FORMAT: format,
              NICHE: niche,
              REELS: JSON.stringify(chunk.map(blindView), null, 1),
              GATE_FAILURES: wrong.length ? `Your last answers for these Reels failed the check. Answer for every Reel above again, and fix these:\n${wrong.join("\n")}` : "",
            }),
          ).catch((err) => {
            log(`A labelling turn failed: ${err instanceof Error ? err.message : String(err)}`);
            return "";
          });
          const ids = new Set(chunk.map((r) => r.id));
          for (const l of parseJson<{ reels?: ReelLabels[] }>(answer)?.reels ?? []) if (l?.id && ids.has(l.id)) labels.set(l.id, l);
        });
      }
      return rounds;
    };
    let labelRounds = ready ? await labelAll(working) : 0;

    // Accounts post other things too (a skit, a repost, an announcement). Each
    // Reel the reader says isn't the format is replaced, once, by the next in
    // line from the same group; the first real explainer run lost 12 of its
    // 40 Reels this way and had nothing left to say about the video.
    let replaced = 0;
    if (ready && working.every((r) => problemsOf(r).length === 0)) {
      const off = (group: "winner" | "average") => working.filter((r) => r.group === group && labels.get(r.id)?.onFormat === "no").length;
      const next = shuffled([...line.winners.slice(perGroup, perGroup + off("winner")), ...line.average.slice(perGroup, perGroup + off("average"))]);
      if (next.length) {
        const from = working.length;
        const more = await pool(next, 3, (c: Candidate, i) => measureOne(c, idOf(from + i)));
        working.push(...more);
        replaced = more.length;
        log(`${count(off("winner") + off("average"), "Reel")} ${off("winner") + off("average") === 1 ? "wasn't a" : "weren't"} ${format} ${off("winner") + off("average") === 1 ? "Reel" : "Reels"}, so the next ${more.length} in line ${more.length === 1 ? "is" : "are"} looked at too. ${measuredLine(more, true)}`);
        labelRounds = Math.max(labelRounds, await labelAll(more));
      }
    }
    if (sttDown) notes.push(`ElevenLabs stopped transcribing part of the way: ${sttDown}`);
    const videosGiven = given(working);
    const videosMeasured = measured(working);
    const transcripts = heard(working);
    if (working.length && videosGiven < working.length) notes.push(`Instagram gave no video for ${working.length - videosGiven} of the ${working.length} Reels (their sound is from its music library, or the owner turned downloads off). Those were studied from the cover and the caption.`);
    for (const r of working) r.labels = labels.get(r.id) ?? null;
    const labelled = ready && working.every((r) => problemsOf(r).length === 0);
    // An account that mostly posts other things tells little about the format: the first real ad run
    // looked at 20 of Duolingo's Reels and the reader marked none of them as an ad.
    for (const s of studies.filter((x) => !x.problem)) {
      const mine = working.filter((r) => r.account === s.username && r.labels);
      const on = mine.filter((r) => r.labels!.onFormat !== "no").length;
      if (mine.length >= OFF_FORMAT_MIN_LOOKED && on * 3 < mine.length) notes.push(`Only ${on} of the ${mine.length} Reels looked at from @${s.username} ${on === 1 ? "was a" : "were"} ${format} ${on === 1 ? "Reel" : "Reels"}. It mostly posts other things, so another account would tell more about this format.`);
    }
    if (ready) log(`Labelled ${labels.size} of ${working.length} Reels in ${count(labelRounds, "round")}${labelled ? "" : "; some labels are still wrong"}.`);

    // 5. Our own rules, counted on the winners and on the average Reels.
    const table = ready ? rulesTable(format, working.map((r) => ({ ...r, mediaUrl: null, thumbnailUrl: null }))) : [];

    // 6. Patterns: proposed from half of the Reels, then checked blind on the other half.
    let patterns: FoundPattern[] = [];
    if (labelled) {
      const onFormat = working.filter((r) => r.labels?.onFormat !== "no");
      const shown = onFormat.filter((r) => !r.heldOut);
      const held = onFormat.filter((r) => r.heldOut);
      const answer = await ask(stagePrompt(1, { COUNT: String(shown.length), FORMAT: format, NICHE: niche, WINNER_LIFT: String(WINNER_LIFT), AVERAGE_FROM: String(AVERAGE_LIFT.min), REELS: JSON.stringify(shown.map(knownView), null, 1), TABLE: tableText(table) }, "patterns")).catch((err) => {
        log(`The pattern turn failed: ${err instanceof Error ? err.message : String(err)}`);
        return "";
      });
      const proposed = (parseJson<{ patterns?: { pattern?: string; question?: string }[] }>(answer)?.patterns ?? [])
        .map((p) => ({ pattern: (p?.pattern ?? "").trim().slice(0, 300), question: (p?.question ?? "").trim().slice(0, 300) }))
        .filter((p) => p.pattern && p.question.endsWith("?"))
        .slice(0, MAX_PATTERNS);
      if (proposed.length && held.length) {
        const answers = new Map<string, string[]>();
        await pool(chunks(held, CHUNK), 2, async (chunk) => {
          const reply = await ask(stagePrompt(1, { QUESTIONS: proposed.map((p, i) => `${i + 1}. ${p.question}`).join("\n"), REELS: JSON.stringify(chunk.map(blindView), null, 1) }, "check")).catch((err) => {
            log(`A checking turn failed: ${err instanceof Error ? err.message : String(err)}`);
            return "";
          });
          const ids = new Set(chunk.map((r) => r.id));
          for (const r of parseJson<{ reels?: { id?: string; answers?: unknown[] }[] }>(reply)?.reels ?? []) {
            if (r?.id && ids.has(r.id) && Array.isArray(r.answers)) answers.set(r.id, r.answers.map((a) => (a === "yes" || a === "no" ? a : UNCLEAR)));
          }
        });
        patterns = tallyPatterns(proposed, answers, held);
      }
      log(`Patterns: ${proposed.length} proposed, ${patterns.filter((p) => p.kept).length} held up on the Reels they weren't drawn from.`);
    }

    // 7. The gate, the record, and what later stages get.
    const reels: FoundReel[] = working.map(({ files: _files, ...r }) => r);
    const accounts = studies.map(({ candidates: _c, ...a }) => a);
    const findings: Findings = { format, studiedAt: now().toISOString(), accounts, reels, asked: ready, labelRounds, videosGiven, videosMeasured, transcripts, table, patterns, notes, soundSigns: soundSigns(accounts), ...(replaced ? { replaced } : {}) };
    const kept = patterns.filter((p) => p.kept);
    const r = await runStage<Findings>({
      vault: d.vault,
      stage: 1,
      subject: subjectOf(format),
      // Everything Claude was asked is above; this stage's answer is what code found.
      ask: async () => JSON.stringify(findings),
      prompt: () => "",
      gate: () =>
        gateResearch({
          format,
          accounts: studies.map((s) => ({ username: s.username, problem: s.problem })),
          looked: reels.map(lookedOf),
          labels: ready ? [...labels.values()] : null,
          videosGiven,
          videosMeasured,
          verdicts: table.filter((row) => row.verdict !== "not enough data").length,
          patterns: kept,
        }),
      input: { format, accounts: d.accounts },
      tries: 1,
      log,
      now: d.now,
    });

    if (r.gate.passed) {
      const sources = [patternSource(format), ...(format === "story" ? [LEGACY_SOURCE] : [])];
      const retired = await d.vault.retireLessons("pattern", sources);
      for (const p of kept) await d.vault.addLesson({ kind: "pattern", stage: 1, text: p.pattern, evidence: `${p.question} Yes for ${tallyText(p)}`, source: patternSource(format) }, now());
      const against = verdictRows(findings, "against");
      const breaks = verdictRows(findings, "winners break it");
      await d.vault.logAction(
        {
          kind: "lesson",
          summary: `Research, ${format}: ${count(winnersOf(findings).length, "winner")} compared with ${count(averageOf(findings).length, "average Reel")} from ${handles(usableOf(findings))}. Of our rules, ${verdictRows(findings, "backed").length} backed, ${against.length} the winners follow less often than average Reels, ${breaks.length} most winners break. ${count(kept.length, "pattern")} kept${retired ? `, ${count(retired, "earlier pattern")} retired` : ""}.`,
          detail: [tableText(table, [...FOR_THOMAS, "backed"]), kept.length ? `Patterns kept:\n${kept.map((p) => `- ${p.pattern} (${tallyText(p)})`).join("\n")}` : "", (findings.soundSigns ?? []).join("\n"), notes.join("\n")].filter(Boolean).join("\n\n"),
          target: r.recordId,
        },
        now(),
      );
    }

    const report = reportText(findings, r.gate);
    let reportFile: string | null = null;
    if (d.outDir !== null) {
      const out = d.outDir ?? "research";
      try {
        await mkdir(out, { recursive: true });
        reportFile = join(out, `${format}.md`);
        await writeFile(reportFile, `${report}\n`);
      } catch (err) {
        reportFile = null;
        log(`The report couldn't be saved: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { format, passed: r.gate.passed, gate: r.gate, findings, report, reportFile };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
