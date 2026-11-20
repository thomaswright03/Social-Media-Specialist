// Stage 1: what code measures on each Reel. Claude never supplies a number.
//
//   from the caption   length, first line, question, call to action, hashtags,
//                      "made with AI", leaning on another episode, selling.
//                      The tests are the very patterns the gates use on our own
//                      captions (gates.ts, formats.ts).
//   from the video     length, every cut (so: shots, the median and longest
//                      shot, the first cut), loudness, how much has sound,
//                      and the frames Claude looks at.
//   from the sound     with a transcript (transcribe.ts): when the first word
//                      is said, words a second, how many shots have speech,
//                      and the longest stretch with no cut and no new word.
//
// Instagram gives the video only for some Reels (not when the sound is from
// its music library, or the owner turned downloads off). Whatever can't be
// read stays null, and the rules that need it don't count that Reel.
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Heard } from "../transcribe.ts";
import { median } from "./diagnose.ts";
import { MADE_WITH_AI, SELLING } from "./formats.ts";
import { CTA, REFERS_TO_OTHER_EPISODES } from "./gates.ts";

// --- The caption -----------------------------------------------------------------

export type CaptionFacts = {
  chars: number;
  firstLine: string;
  firstLineChars: number;
  hasQuestion: boolean;
  callToAction: boolean;
  hashtags: number;
  saysAI: boolean;
  /** "part 2", "episode", "to be continued": the Reel leans on another one. */
  leansOnEpisodes: boolean;
  sells: boolean;
};

export function captionFacts(caption: string): CaptionFacts {
  const text = caption.trim();
  const firstLine = text.split("\n")[0]!.trim();
  // Hashtags aren't part of what the caption says. "#12" is a number in a series, not a hashtag.
  const HASHTAG = /#[\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu;
  const words = text.replace(HASHTAG, " ");
  return {
    chars: text.length,
    firstLine: firstLine.slice(0, 200),
    firstLineChars: firstLine.length,
    hasQuestion: words.includes("?"),
    callToAction: CTA.test(words),
    hashtags: (text.match(HASHTAG) ?? []).length,
    saysAI: MADE_WITH_AI.test(text),
    leansOnEpisodes: REFERS_TO_OTHER_EPISODES.test(words),
    sells: SELLING.test(words),
  };
}

// --- The video ------------------------------------------------------------------

export type VideoFacts = {
  seconds: number;
  /** The second of every cut. */
  cuts: number[];
  shots: number;
  medianShot: number;
  longestShot: number;
  firstCutAt: number | null;
  /** Integrated loudness, LUFS. */
  lufs: number | null;
  /** Share of the Reel with sound above a whisper, 0 to 1. */
  soundShare: number | null;
};

/** Two cuts closer than this are one cut (a flash or a fast transition). */
export const MIN_SHOT_SECONDS = 0.3;
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The seconds of the picture's cuts, from ffmpeg's scene-change output. */
export function cutTimes(showinfo: string, seconds: number): number[] {
  const all = [...showinfo.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => Number.isFinite(t) && t >= MIN_SHOT_SECONDS && t <= seconds - MIN_SHOT_SECONDS).sort((a, b) => a - b);
  const cuts: number[] = [];
  for (const t of all) if (!cuts.length || t - cuts.at(-1)! >= MIN_SHOT_SECONDS) cuts.push(r2(t));
  return cuts;
}

/** Each shot's start and end. */
export function shotBounds(cuts: number[], seconds: number): { start: number; end: number }[] {
  const edges = [0, ...cuts, seconds];
  return edges.slice(1).map((end, i) => ({ start: edges[i]!, end }));
}

export function shotStats(cuts: number[], seconds: number): Pick<VideoFacts, "shots" | "medianShot" | "longestShot" | "firstCutAt"> {
  const lengths = shotBounds(cuts, seconds).map((s) => s.end - s.start);
  return { shots: lengths.length, medianShot: r1(median(lengths) ?? seconds), longestShot: r1(Math.max(...lengths)), firstCutAt: cuts[0] ?? null };
}

/** Integrated loudness from ffmpeg's ebur128 summary. */
export function lufsFrom(ebur: string): number | null {
  const m = ebur.slice(ebur.lastIndexOf("Summary:")).match(/I:\s+(-?[\d.]+) LUFS/);
  const v = m ? Number(m[1]) : NaN;
  // -70 is ebur128's floor: nothing was loud enough to measure.
  return Number.isFinite(v) && v > -69 ? v : null;
}

/** Share of the Reel that isn't silent, from ffmpeg's silencedetect. */
export function soundShareFrom(silencedetect: string, seconds: number): number {
  const silent = [...silencedetect.matchAll(/silence_duration: ([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  // A Reel that never ends its silence: it's silent from silence_start to the end.
  const open = [...silencedetect.matchAll(/silence_start: ([\d.]+)/g)].length - [...silencedetect.matchAll(/silence_end:/g)].length;
  const lastStart = Number([...silencedetect.matchAll(/silence_start: ([\d.]+)/g)].pop()?.[1] ?? seconds);
  const total = silent + (open > 0 ? Math.max(0, seconds - lastStart) : 0);
  return r2(Math.max(0, Math.min(1, 1 - total / seconds)));
}

// --- The sound -------------------------------------------------------------------

export type SpeechFacts = {
  words: number;
  firstWordAt: number | null;
  /** Words a second while someone is speaking (pauses left out). */
  wordsPerSecond: number | null;
  /** Share of shots in which a word is said, 0 to 1. */
  speechShotShare: number;
  /** The longest stretch with no cut and no new word, seconds. */
  longestStill: number;
  /** The transcriber tagged music. */
  music: boolean;
  /** Other sounds it tagged ("laughter", "footsteps"). */
  sounds: string[];
  /** What is said, a line a sentence, each with the second it starts. */
  text: string;
};

/** A pause this long ends a run of speech. */
const PAUSE = 0.7;

export function speechFacts(heard: Heard, seconds: number, cuts: number[]): SpeechFacts {
  const words = [...heard.words].sort((a, b) => a.start - b.start);
  let speaking = 0;
  let runStart: number | null = null;
  let runEnd = 0;
  const lines: string[] = [];
  let line: string[] = [];
  let lineAt = 0;
  const endLine = () => {
    if (line.length) lines.push(`${r1(lineAt)} s: ${line.join(" ")}`);
    line = [];
  };
  for (const w of words) {
    if (runStart === null || w.start - runEnd > PAUSE) {
      if (runStart !== null) speaking += runEnd - runStart;
      runStart = w.start;
      endLine();
    }
    runEnd = Math.max(runEnd, w.end);
    if (!line.length) lineAt = w.start;
    line.push(w.word);
    if (/[.!?]["')\]]?$/.test(w.word)) endLine();
  }
  if (runStart !== null) speaking += runEnd - runStart;
  endLine();
  const bounds = shotBounds(cuts, seconds);
  const voiced = bounds.filter((s) => words.some((w) => w.start >= s.start && w.start < s.end)).length;
  const events = [...new Set([0, ...cuts, ...words.map((w) => w.start)])].filter((t) => t <= seconds).sort((a, b) => a - b);
  const still = Math.max(...events.map((t, i) => (events[i + 1] ?? seconds) - t));
  const tags = [...new Set(heard.events.map((e) => e.what))];
  return {
    words: words.length,
    firstWordAt: words.length ? r2(words[0]!.start) : null,
    wordsPerSecond: words.length >= 5 && speaking > 0 ? r1(words.length / speaking) : null,
    speechShotShare: bounds.length ? r2(voiced / bounds.length) : 0,
    longestStill: r1(still),
    music: tags.some((t) => /music|singing|song/.test(t)),
    sounds: tags.filter((t) => !/music|singing|song/.test(t)).slice(0, 8),
    text: lines.join("\n").slice(0, 1800),
  };
}

// --- Reading a video file ----------------------------------------------------------

export function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

/** True when ffmpeg and ffprobe are installed. The first stage 1 run had neither, and measured nothing. */
export async function hasFfmpeg(): Promise<boolean> {
  const [a, b] = await Promise.all([run("ffmpeg", ["-version"], 15_000), run("ffprobe", ["-version"], 15_000)]);
  return a.code === 0 && b.code === 0;
}

/** Saves a file from a URL (a Reel's video or cover). False when it can't be fetched or is over 200 MB. */
export async function download(fetchImpl: typeof fetch, url: string, file: string): Promise<boolean> {
  try {
    // Instagram's CDN refuses some clients without a browser-like user agent.
    const res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 200_000_000) return false;
    await writeFile(file, bytes);
    return true;
  } catch {
    return false;
  }
}

/** How many shots get a frame in the picture Claude looks at. */
export const SHOT_FRAMES = 12;
/** The opening frames Claude looks at, in seconds. */
export const OPEN_FRAMES = [0.1, 0.5, 1.5] as const;

/** Up to `max` shots spread evenly over the Reel, the first and the last always among them. */
export function sampleShots<T>(shots: T[], max = SHOT_FRAMES): T[] {
  if (shots.length <= max) return shots;
  const picks = new Set<number>();
  for (let k = 0; k < max; k++) picks.add(Math.round((k * (shots.length - 1)) / (max - 1)));
  return [...picks].sort((a, b) => a - b).map((i) => shots[i]!);
}

export type MeasuredFile = {
  video: VideoFacts | null;
  /** The opening frames side by side (file name in `dir`), when asked for. */
  open: string | null;
  /** One frame from the middle of each sampled shot, four to a row. */
  shotsSheet: string | null;
  shotFrames: number;
  /** The sound as a small mp3, for the transcript, when asked for and the Reel has sound. */
  audio: Buffer | null;
};
export type MeasureFile = (file: string, dir: string, name: string, want: { sheets: boolean; audio: boolean }) => Promise<MeasuredFile>;

const FRAME = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;

async function sheet(file: string, times: number[], dir: string, name: string, size: [number, number], columns: number): Promise<string | null> {
  const parts: string[] = [];
  for (const [i, t] of times.entries()) {
    const f = join(dir, `${name}-${String(i + 1).padStart(2, "0")}.jpg`);
    const r = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(Math.max(0, t)), "-i", file, "-frames:v", "1", "-vf", FRAME(...size), f], 60_000);
    if (r.code === 0) parts.push(f);
  }
  let out: string | null = null;
  if (parts.length === times.length && parts.length) {
    const rows = Math.ceil(parts.length / columns);
    const r = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i", join(dir, `${name}-%02d.jpg`), "-vf", `tile=${Math.min(columns, parts.length)}x${rows}:padding=8:margin=8:color=white`, "-frames:v", "1", join(dir, `${name}.jpg`)]);
    if (r.code === 0) out = `${name}.jpg`;
  }
  await Promise.all(parts.map((p) => rm(p, { force: true })));
  return out;
}

/** Measures one saved video. Nulls for whatever ffmpeg can't read. */
export const measureFile: MeasureFile = async (file, dir, name, want) => {
  const none: MeasuredFile = { video: null, open: null, shotsSheet: null, shotFrames: 0, audio: null };
  const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 60_000);
  const seconds = Number(probe.out.trim());
  if (probe.code !== 0 || !Number.isFinite(seconds) || seconds <= 0) return none;
  const scenes = await run("ffmpeg", ["-hide_banner", "-i", file, "-an", "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"], 180_000);
  if (scenes.code !== 0) return none;
  const cuts = cutTimes(scenes.err, seconds);
  const sound = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=n=-40dB:d=0.4,ebur128=peak=true", "-f", "null", "-"], 180_000);
  const hasSound = sound.code === 0 && !/does not contain any stream|matches no streams/i.test(sound.err);
  const video: VideoFacts = { seconds: r1(seconds), cuts, ...shotStats(cuts, seconds), lufs: hasSound ? lufsFrom(sound.err) : null, soundShare: hasSound ? soundShareFrom(sound.err, seconds) : null };
  const out: MeasuredFile = { ...none, video };
  if (want.sheets) {
    out.open = await sheet(file, OPEN_FRAMES.map((t) => Math.min(t, Math.max(0, seconds - 0.1))), dir, `${name}-open`, [360, 640], 3);
    const shots = sampleShots(shotBounds(cuts, seconds));
    out.shotsSheet = await sheet(file, shots.map((s) => (s.start + s.end) / 2), dir, `${name}-shots`, [270, 480], 4);
    out.shotFrames = out.shotsSheet ? shots.length : 0;
  }
  if (want.audio && hasSound && (video.soundShare ?? 0) > 0) {
    const mp3 = join(dir, `${name}.mp3`);
    const a = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3], 120_000);
    if (a.code === 0) out.audio = await readFile(mp3).catch(() => null);
    await rm(mp3, { force: true });
  }
  return out;
};
