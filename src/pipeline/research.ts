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
import { discoverAccount } from "../instagram.ts";
import { STT_USD_PER_HOUR, transcribe as elevenLabs, type Transcribe } from "../transcribe.ts";
import type { Vault } from "../vault.ts";
import type { Format } from "./formats.ts";
import { MIN_ACCOUNTS, MIN_LOOKED_PER_GROUP, UNCLEAR, gateResearch, labelProblems, patternHolds, type GateResult, type Looked, type PatternTally, type ReelLabels } from "./gates.ts";
import { captionFacts, download as downloadFile, hasFfmpeg, measureFile, speechFacts, type MeasureFile, type SpeechFacts, type VideoFacts } from "./research-measure.ts";
import { NOT_MEASURED, rowText, rulesTable, tableText, type RuleRow, type StudiedReel } from "./research-rules.ts";
import { MAX_AGE_DAYS, MIN_AGE_DAYS, WINNER_LIFT, pickSample, studyAccount, type AccountStudy, type Candidate } from "./research-sample.ts";
import { parseJson, runStage, stagePrompt } from "./stages.ts";

type Ask = (prompt: string) => Promise<string>;

/** Winners and average Reels looked at for a format, each (RESEARCH_PER_GROUP changes it, 6 to 20). */
export const PER_GROUP = 12;
/** Posts read from each account. */
export const POSTS_PER_ACCOUNT = 200;
/** Reels in one Claude turn: each has up to two pictures to open. */
export const CHUNK = 8;
export const LABEL_ROUNDS = 3;
export const MAX_PATTERNS = 5;
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
export function tallyPatterns(patterns: { pattern: string; question: string }[], answers: Map<string, string[]>, heldOut: { id: string; group: "winner" | "average" }[]): FoundPattern[] {
  return patterns.map((p, i) => {
    const side = (group: "winner" | "average") => {
      const given = heldOut.filter((r) => r.group === group).map((r) => answers.get(r.id)?.[i]);
      return { yes: given.filter((a) => a === "yes").length, asked: given.filter((a) => a === "yes" || a === "no").length };
    };
    const w = side("winner");
    const a = side("average");
    const t: PatternTally = { pattern: p.pattern, question: p.question, winnersYes: w.yes, winnersAsked: w.asked, averageYes: a.yes, averageAsked: a.asked };
    return { ...t, kept: patternHolds(t) };
  });
}

// --- The report ------------------------------------------------------------------

const tallyText = (p: PatternTally) => `${p.winnersYes} of ${p.winnersAsked} winners and ${p.averageYes} of ${p.averageAsked} average Reels it wasn't drawn from`;
const verdictRows = (f: Findings, v: RuleRow["verdict"]) => f.table.filter((r) => r.verdict === v);
const winnersOf = (f: Findings) => f.reels.filter((r) => r.group === "winner");
const averageOf = (f: Findings) => f.reels.filter((r) => r.group === "average");
const usableOf = (f: Findings) => f.accounts.filter((a) => !a.problem);

/** A few spoken sentences for Hitta and the log: what was studied and what stood out. */
export function summaryText(f: Findings, passed: boolean): string {
  const breaks = verdictRows(f, "winners break it");
  const backed = verdictRows(f, "backed");
  const kept = f.patterns.filter((p) => p.kept);
  const studied = `${f.format}: ${count(winnersOf(f).length, "winner")} and ${count(averageOf(f).length, "average Reel")} from ${handles(usableOf(f)) || "no accounts"}`;
  if (!passed) return `${studied}. It didn't pass its gate, so nothing was saved.`;
  const short = (r: RuleRow) => r.rule.replace(/\s*\(.*\)$/, "").toLowerCase();
  return [
    `${studied}.`,
    breaks.length ? `Winners break ${count(breaks.length, "rule")} of ours: ${breaks.slice(0, 4).map(short).join("; ")}.` : "Winners break none of our rules.",
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
    const seen = r.sight === "frames" ? `video, ${r.video?.seconds ?? "?"} s, ${r.video?.shots ?? "?"} shots` : r.sight === "cover" ? "cover only" : "caption only";
    return `| ${r.id} | @${r.account} | ${r.group} | ${r.lift}× | ${result} | ${r.postedAt} | ${seen}${r.heard ? ", transcript" : ""} | ${r.labels?.onFormat === "no" ? "not this format, left out" : (r.labels?.premise ?? "").replace(/\|/g, "/").slice(0, 110)} | ${r.url} |`;
  };
  return [
    `# Stage 1 research: ${f.format}`,
    `Studied ${f.studiedAt.slice(0, 10)}. ${gate.passed ? "Passed its gate." : "Did not pass its gate, so nothing was saved for later stages."}`,
    failed.length ? `## Checks that failed\n${failed.map((c) => `- ${c.name}${c.detail ? `: ${c.detail}` : ""}`).join("\n")}` : "",
    `## What was compared\nA winner is a Reel in its own account's top quarter with at least ${WINNER_LIFT} times that account's median. It is compared with the same account's average Reels (the middle half). Reels under ${MIN_AGE_DAYS} days or over ${MAX_AGE_DAYS} days old are left out.\n\n${f.accounts
      .map((a) => (a.problem ? `- @${a.username}: not used. ${a.problem}.` : `- @${a.username}: ${a.followers ?? "?"} followers, ${a.settled} Reels scored by ${a.scoredBy}, median ${a.median}, ${a.postsPerWeek ?? "?"} posts a week. ${count(a.winners, "winner")}, ${a.average} average.`))
      .join("\n")}\n\nLooked at: ${count(winnersOf(f).length, "winner")} and ${count(averageOf(f).length, "average Reel")}. Instagram gave the video for ${f.videosGiven} of them; ${f.videosMeasured} were measured and ${f.transcripts} transcribed.`,
    f.notes.length ? `## What limited this run\n${f.notes.map((n) => `- ${n}`).join("\n")}` : "",
    f.table.length ? `## Our rules, measured on these Reels\nThis table never changes a rule. A rule winners break is for Thomas to weigh. About ${f.table.length} rules are tested at once, so one or two can look clear by chance.\n\n${tableText(f.table)}` : "",
    `## Patterns\n${kept.length ? kept.map((p) => `- Kept: ${p.pattern} (${p.question} Yes for ${tallyText(p)}.)`).join("\n") : "None kept."}${dropped.length ? `\n${dropped.map((p) => `- Dropped: ${p.pattern} (${p.question} Yes for ${tallyText(p)}.)`).join("\n")}` : ""}`,
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
  const head = `Stage 1 compared ${count(winnersOf(f).length, "winning Reel")} with ${count(averageOf(f).length, "average Reel")} from ${handles(usableOf(f))} (${f.studiedAt.slice(0, 10)}). A winner is in its own account's top quarter, with at least ${WINNER_LIFT} times that account's median.`;
  const parts = [
    head,
    backed.length ? `Rules of ours that winners follow clearly more often than average Reels:\n${backed.map((r) => `- ${rowText(r)}`).join("\n")}` : "",
    patterns.length ? `What else winners do more often than average Reels:\n${patterns.map((l) => `- ${l.text}${l.evidence ? ` (${l.evidence})` : ""}`).join("\n")}` : "",
    !backed.length && !patterns.length ? "It found no clear difference between winners and average Reels yet, so there is no pattern to lean on." : "",
    about.length ? `What some of the winners were about (to show the kind of thing, never to copy):\n${about.map((r) => `- ${r.labels!.premise!.trim()} (${r.lift} times its account's median)`).join("\n")}` : "",
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
  return Number.isFinite(asked) && asked > 0 ? Math.max(MIN_LOOKED_PER_GROUP, Math.min(20, Math.round(asked))) : PER_GROUP;
}

/** Stage 1 for one format, end to end. */
export async function runResearch(d: ResearchDeps): Promise<ResearchResult> {
  const log = d.log ?? (() => {});
  const now = d.now ?? (() => new Date());
  const fetchImpl = d.fetchImpl ?? fetch;
  const format = d.format;
  const notes: string[] = [];

  // 1. Read the accounts and score every Reel against its own account.
  const studies: AccountStudy[] = [];
  const noSoundKind: string[] = [];
  for (const a of d.accounts) {
    try {
      const acc = await (d.discover ?? discoverAccount)(fetchImpl, d.token, d.igUserId, a, POSTS_PER_ACCOUNT);
      const s = studyAccount(acc, now());
      if (acc.gave && !acc.gave.audioType) noSoundKind.push(s.username);
      log(s.problem ? `@${s.username}: can't be used, ${s.problem}.` : `@${s.username}: ${s.followers ?? "?"} followers, ${s.settled} Reels scored by ${s.scoredBy} (median ${s.median}): ${count(s.winners, "winner")}, ${s.average} average.`);
      studies.push(s);
    } catch (err) {
      const problem = (err instanceof Error ? err.message : String(err)).replace(/\.$/, "");
      log(`@${a}: couldn't be read. ${problem}.`);
      studies.push({ username: a, followers: null, reels: 0, settled: 0, scoredBy: null, median: null, postsPerWeek: null, winners: 0, average: 0, problem, candidates: [] });
    }
  }
  if (noSoundKind.length) notes.push(`Instagram wouldn't say what kind of sound ${handles(noSoundKind.map((username) => ({ username })))} used, so "its own sound" couldn't be measured for them.`);
  if (studies.some((s) => s.scoredBy === "likes and comments")) notes.push(`Instagram gave no views for ${handles(studies.filter((s) => s.scoredBy === "likes and comments"))}, so those Reels are scored by likes plus comments.`);

  // 2. The winners and the average Reels to look at, in an order that doesn't give the groups away.
  const sample = pickSample(studies, perGroupFrom(d));
  const heldOut = new Set([...sample.winners.filter((_, i) => i % 2 === 1), ...sample.average.filter((_, i) => i % 2 === 1)].map((c) => c.url));
  const mixed = (url: string) => createHash("sha1").update(url).digest("hex");
  const picked = [...sample.winners, ...sample.average].sort((a, b) => (mixed(a.url) < mixed(b.url) ? -1 : 1));
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

    const working = await pool(picked, 3, async (c: Candidate, i): Promise<Working> => {
      const id = `r${String(i + 1).padStart(2, "0")}`;
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
    });
    if (sttDown) notes.push(`ElevenLabs stopped transcribing part of the way: ${sttDown}`);
    const videosGiven = working.filter((r) => r.videoGiven).length;
    const videosMeasured = working.filter((r) => r.video).length;
    const transcripts = working.filter((r) => r.speech).length;
    if (working.length && videosGiven < working.length) notes.push(`Instagram gave no video for ${working.length - videosGiven} of the ${working.length} Reels (their sound is from its music library, or the owner turned downloads off). Those were studied from the cover and the caption.`);
    log(`Measured ${working.length} Reels: ${videosMeasured} of ${videosGiven} videos, ${count(transcripts, "transcript")}${transcripts ? ` (${Math.round(heardSeconds / 60)} min of sound, about $${((heardSeconds / 3600) * STT_USD_PER_HOUR).toFixed(2)} at ElevenLabs' $${STT_USD_PER_HOUR} an hour)` : ""}, ${working.filter((r) => r.sight === "cover").length} from the cover only.`);

    // 4. Claude labels each Reel, blind. Labels that break the lists go back to it with what was wrong.
    const ask = d.ask ?? askClaudeWithFiles(dir);
    const niche = formatNiche(format);
    const labels = new Map<string, ReelLabels>();
    const problemsOf = (r: Working) => (labels.has(r.id) ? labelProblems(labels.get(r.id)!, lookedOf(r)) : ["not labelled yet"]);
    // Claude is asked only when the checks that don't need it would pass.
    const ready = studies.filter((x) => !x.problem).length >= MIN_ACCOUNTS && enough && (videosGiven === 0 || videosMeasured * 2 >= videosGiven);
    let labelRounds = 0;
    for (; ready && labelRounds < LABEL_ROUNDS; labelRounds++) {
      const todo = working.filter((r) => problemsOf(r).length);
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
    for (const r of working) r.labels = labels.get(r.id) ?? null;
    const labelled = ready && working.every((r) => problemsOf(r).length === 0);
    if (ready) log(`Labelled ${labels.size} of ${working.length} Reels in ${count(labelRounds, "round")}${labelled ? "" : "; some labels are still wrong"}.`);

    // 5. Our own rules, counted on the winners and on the average Reels.
    const table = ready ? rulesTable(format, working.map((r) => ({ ...r, mediaUrl: null, thumbnailUrl: null }))) : [];

    // 6. Patterns: proposed from half of the Reels, then checked blind on the other half.
    let patterns: FoundPattern[] = [];
    if (labelled) {
      const onFormat = working.filter((r) => r.labels?.onFormat !== "no");
      const shown = onFormat.filter((r) => !r.heldOut);
      const held = onFormat.filter((r) => r.heldOut);
      const answer = await ask(stagePrompt(1, { COUNT: String(shown.length), FORMAT: format, NICHE: niche, WINNER_LIFT: String(WINNER_LIFT), REELS: JSON.stringify(shown.map(knownView), null, 1), TABLE: tableText(table) }, "patterns")).catch((err) => {
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
    const findings: Findings = { format, studiedAt: now().toISOString(), accounts: studies.map(({ candidates: _c, ...a }) => a), reels, asked: ready, labelRounds, videosGiven, videosMeasured, transcripts, table, patterns, notes };
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
      const breaks = verdictRows(findings, "winners break it");
      await d.vault.logAction(
        {
          kind: "lesson",
          summary: `Research, ${format}: ${count(winnersOf(findings).length, "winner")} compared with ${count(averageOf(findings).length, "average Reel")} from ${handles(usableOf(findings))}. Winners break ${count(breaks.length, "rule")} of ours, ${verdictRows(findings, "backed").length} backed, ${count(kept.length, "pattern")} kept${retired ? `, ${count(retired, "earlier pattern")} retired` : ""}.`,
          detail: [tableText(table, ["winners break it", "backed"]), kept.length ? `Patterns kept:\n${kept.map((p) => `- ${p.pattern} (${tallyText(p)})`).join("\n")}` : "", notes.join("\n")].filter(Boolean).join("\n\n"),
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
