// Stage 1 of the content pipeline: Research what wins (pipeline/stages/1-research.md).
//
// Code gathers and measures: the Reels of the accounts Thomas admires
// (Business Discovery: likes, comments, dates), each Reel's length, how often
// the picture cuts (ffmpeg's scene detection), how much of it has sound, and a
// strip of frames from its first seconds. Claude looks at the frames and fills
// in what can only be seen (the first 2 seconds, the art, the on-screen
// text), then names the winning patterns. The measured numbers always come
// from code: Claude's copies are replaced before the gate, and a Reel that
// wasn't looked up fails it.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAccount, type DiscoveredAccount, type Media } from "../instagram.ts";
import type { Vault } from "../vault.ts";
import { ffprobeSeconds, type Probe } from "./diagnose.ts";
import { check, gate, gateResearch, type GateResult, type Research } from "./gates.ts";
import { runStage, stagePrompt } from "./stages.ts";

export const MIN_REELS = 15;
export const MAX_REELS = 20;

/** What code measured about one Reel. */
export type MeasuredReel = {
  url: string;
  account: string;
  postedAt: string;
  caption: string;
  views: null;
  likes: number | null;
  comments: number | null;
  lengthSeconds: number | null;
  cutsPerTenSeconds: number | null;
  /** Share of the Reel with sound above a whisper, 0 to 1. */
  soundShare: number | null;
  postsPerWeek: number | null;
  /** The frame strip Claude looks at (0 s, 1 s, 2 s, middle), relative to the work folder. */
  frames: string | null;
  /** True when Instagram gave no video file, so `frames` is only the Reel's cover image. */
  framesAreCover?: boolean;
};

/** Saves a Reel's cover image; null when it can't be fetched. */
async function saveCover(fetchImpl: typeof fetch, url: string, dir: string, file: string): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    await writeFile(join(dir, file), Buffer.from(await res.arrayBuffer()));
    return file;
  } catch {
    return null;
  }
}

const isReel = (m: Media) => m.productType === "REELS" || m.mediaType === "VIDEO";

/** Posts a week over the span of what was fetched (at most the last 90 days). */
export function postsPerWeek(media: Media[], now = new Date()): number | null {
  const times = media.map((m) => Date.parse(m.timestamp)).filter((t) => Number.isFinite(t) && now.getTime() - t <= 90 * 86_400_000);
  if (times.length < 2) return null;
  const days = Math.max(7, (now.getTime() - Math.min(...times)) / 86_400_000);
  return Math.round((times.length / days) * 7 * 10) / 10;
}

/**
 * The Reels to study: each account's best by likes plus comments, taken in
 * turns so one account doesn't crowd out the rest, at most MAX_REELS.
 */
export function pickReels(accounts: DiscoveredAccount[], max = MAX_REELS): { account: DiscoveredAccount; media: Media }[] {
  const queues = accounts.map((a) => [...a.media.filter((m) => isReel(m) && m.permalink)].sort((x, y) => (y.likes ?? 0) + (y.comments ?? 0) - ((x.likes ?? 0) + (x.comments ?? 0))).map((media) => ({ account: a, media })));
  const out: { account: DiscoveredAccount; media: Media }[] = [];
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && out.length < max) out.push(next);
    }
  }
  return out;
}

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ code: number | null; out: string; err: string }> {
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

const UA = ["-user_agent", "Mozilla/5.0"];

/** Picture cuts per 10 seconds, from ffmpeg's scene-change score. */
export function cutsFrom(showinfo: string, seconds: number): number {
  const cuts = (showinfo.match(/pts_time:/g) ?? []).length;
  return Math.round((cuts / seconds) * 10 * 10) / 10;
}

/** Share of the Reel that isn't silent, from ffmpeg's silencedetect. */
export function soundShareFrom(silencedetect: string, seconds: number): number {
  const silent = [...silencedetect.matchAll(/silence_duration: ([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  // A Reel that never ends its silence: it's silent from silence_start to the end.
  const open = [...silencedetect.matchAll(/silence_start: ([\d.]+)/g)].length - [...silencedetect.matchAll(/silence_end:/g)].length;
  const lastStart = Number([...silencedetect.matchAll(/silence_start: ([\d.]+)/g)].pop()?.[1] ?? seconds);
  const total = silent + (open > 0 ? Math.max(0, seconds - lastStart) : 0);
  return Math.round(Math.max(0, Math.min(1, 1 - total / seconds)) * 100) / 100;
}

/** Measures one video: cuts, sound, and a strip of 4 frames. Nulls for whatever ffmpeg can't read. */
export async function measureVideo(url: string, seconds: number | null, dir: string, name: string): Promise<{ cutsPerTenSeconds: number | null; soundShare: number | null; frames: string | null }> {
  if (!seconds) return { cutsPerTenSeconds: null, soundShare: null, frames: null };
  const scenes = await run("ffmpeg", ["-hide_banner", ...UA, "-i", url, "-an", "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"], 180_000);
  const cutsPerTenSeconds = scenes.code === 0 ? cutsFrom(scenes.err, seconds) : null;
  const silence = await run("ffmpeg", ["-hide_banner", ...UA, "-i", url, "-vn", "-af", "silencedetect=n=-40dB:d=0.4", "-f", "null", "-"], 180_000);
  const soundShare = silence.code === 0 && !/does not contain any stream|matches no streams/i.test(silence.err) ? soundShareFrom(silence.err, seconds) : null;
  const times = [0.1, 1, 2, Math.max(2.5, seconds / 2)];
  const parts: string[] = [];
  for (const [i, t] of times.entries()) {
    const f = join(dir, `${name}-${i}.jpg`);
    const r = await run("ffmpeg", ["-hide_banner", "-y", ...UA, "-ss", String(t), "-i", url, "-frames:v", "1", "-vf", "scale=360:-2", f], 60_000);
    if (r.code === 0) parts.push(f);
  }
  let frames: string | null = null;
  if (parts.length === times.length) {
    const sheet = join(dir, `${name}.jpg`);
    const r = await run("ffmpeg", ["-hide_banner", "-y", ...parts.flatMap((p) => ["-i", p]), "-filter_complex", `${parts.map((_, i) => `[${i}]`).join("")}hstack=inputs=${parts.length}`, sheet]);
    if (r.code === 0) frames = `${name}.jpg`;
  }
  await Promise.all(parts.map((p) => rm(p, { force: true })));
  return { cutsPerTenSeconds, soundShare, frames };
}

/** Claude's answer with every measured number put back from code, and the measured fields filled where Claude left them out. */
export function withMeasured(r: Research | null, measured: MeasuredReel[]): Research | null {
  if (!r) return r;
  const byUrl = new Map(measured.map((m) => [m.url, m]));
  return {
    ...r,
    reels: (r.reels ?? []).map((x) => {
      const m = x.url ? byUrl.get(x.url) : undefined;
      if (!m) return x;
      return {
        ...x,
        views: null,
        likes: m.likes,
        comments: m.comments,
        lengthSeconds: m.lengthSeconds ?? undefined,
        cutsPerTenSeconds: m.cutsPerTenSeconds ?? undefined,
        postsPerWeek: m.postsPerWeek ?? undefined,
        commentThemes: x.commentThemes?.trim() || `${m.comments ?? "?"} comments (their text isn't readable through Instagram's API)`,
        voice: x.voice?.trim() || (m.soundShare === null ? undefined : `sound for ${Math.round(m.soundShare * 100)}% of it`),
      };
    }),
  };
}

/** Stage 1's gate: gateResearch on the measured numbers, plus every Reel must be one that was looked up. */
export function gateResearchMeasured(r: Research | null, measured: MeasuredReel[]): GateResult {
  const known = new Set(measured.map((m) => m.url));
  const fixed = withMeasured(r, measured);
  const byUrl = new Map(measured.map((m) => [m.url, m]));
  // Only what code measured and couldn't read is excused; Claude can't excuse a field.
  const base = gateResearch(fixed, (url) => {
    const m = byUrl.get(url);
    if (!m) return [];
    return [...(m.lengthSeconds === null ? ["lengthSeconds"] : []), ...(m.cutsPerTenSeconds === null ? ["cutsPerTenSeconds"] : [])];
  });
  const unknown = (fixed?.reels ?? []).filter((x) => !x.url || !known.has(x.url)).map((x) => x.url ?? "(no link)");
  return gate([check("Every Reel is one that was looked up (none invented)", unknown.length === 0, unknown.length ? `not looked up: ${unknown.slice(0, 3).join(", ")}` : undefined), ...base.checks]);
}

/** One Claude turn that may open the frame strips in `dir` (Read only). */
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

export const NICHE = "short story Reels, stick-figure animation and comedy channels; our account is Wright AI Solutions (AI tools for small businesses), and its Reels should bring profile visits that lead to the website";

export type ResearchResult = { passed: boolean; research: Research | null; gate: GateResult; measured: MeasuredReel[]; tries: number; problem: string | null };

/** Stage 1, end to end. `accounts` are the Instagram usernames Thomas admires. */
export async function runResearch(d: {
  vault: Vault;
  token: string;
  igUserId: string;
  accounts: string[];
  ask?: (prompt: string) => Promise<string>;
  probe?: Probe;
  measure?: typeof measureVideo;
  discover?: typeof discoverAccount;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
  now?: () => Date;
}): Promise<ResearchResult> {
  const log = d.log ?? (() => {});
  const now = d.now ?? (() => new Date());
  const empty = (problem: string): ResearchResult => ({ passed: false, research: null, gate: gate([check(problem, false)]), measured: [], tries: 0, problem });
  if (!d.accounts.length) return empty("No accounts to study: give at least one Instagram username");
  const found: DiscoveredAccount[] = [];
  for (const a of d.accounts) {
    try {
      const acc = await (d.discover ?? discoverAccount)(d.fetchImpl ?? fetch, d.token, d.igUserId, a);
      log(`@${acc.username}: ${acc.followers ?? "?"} followers, ${acc.media.filter(isReel).length} Reels among its last ${acc.media.length} posts.`);
      found.push(acc);
    } catch (err) {
      log(`Couldn't read ${a}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const picked = pickReels(found);
  if (picked.length < MIN_REELS) return empty(`Only ${picked.length} Reels found across ${found.length} readable account(s); stage 1 needs ${MIN_REELS}. Add more accounts`);

  const dir = await mkdtemp(join(tmpdir(), "research-"));
  await mkdir(dir, { recursive: true });
  try {
    const measured: MeasuredReel[] = [];
    for (const [i, { account, media }] of picked.entries()) {
      const name = `reel-${String(i + 1).padStart(2, "0")}`;
      const seconds = media.mediaUrl ? await (d.probe ?? ffprobeSeconds)(media.mediaUrl) : null;
      const m = media.mediaUrl ? await (d.measure ?? measureVideo)(media.mediaUrl, seconds, dir, name) : { cutsPerTenSeconds: null, soundShare: null, frames: null };
      // No video to read: the cover image is the one picture there is.
      const cover = !m.frames && media.thumbnailUrl ? await saveCover(d.fetchImpl ?? fetch, media.thumbnailUrl, dir, `${name}-cover.jpg`) : null;
      measured.push({
        url: media.permalink!,
        account: account.username,
        postedAt: media.timestamp.slice(0, 10),
        caption: (media.caption ?? "").split("\n")[0]!.slice(0, 140),
        views: null,
        likes: media.likes,
        comments: media.comments,
        lengthSeconds: seconds,
        ...m,
        frames: m.frames ?? cover,
        framesAreCover: !m.frames && !!cover,
        postsPerWeek: postsPerWeek(account.media, now()),
      });
    }
    const noVideo = picked.filter((p) => !p.media.mediaUrl).length;
    log(`Measured ${measured.length} Reels: ${measured.filter((m) => m.lengthSeconds !== null).length} lengths, ${measured.filter((m) => m.frames && !m.framesAreCover).length} frame strips, ${measured.filter((m) => m.framesAreCover).length} cover images only.${noVideo ? ` Instagram gave no video file for ${noVideo} of them.` : ""}`);

    const lessons = await d.vault.lessons();
    const lessonText = lessons.length ? `What earlier stages learned:\n${lessons.map((l) => `- (${l.kind}) ${l.text}`).join("\n")}` : "";
    const sources = [
      "Code already measured these; copy url, likes, comments, lengthSeconds, cutsPerTenSeconds and postsPerWeek as given (they're checked). Views aren't readable for other accounts; leave views null.",
      "Each Reel's `frames` file is a strip of 4 frames side by side: at 0.1 s, 1 s, 2 s and the middle. Open it with the Read tool to describe first2s, art and onScreenText from what you actually see. When framesAreCover is true, Instagram gave no video, so the file is only the Reel's cover image: describe what the cover shows and say first2s is judged from the cover. soundShare is how much of the Reel has sound (0 to 1); use it for voice, with what the caption says; when it's null, judge voice from the caption and say so.",
      "When lengthSeconds or cutsPerTenSeconds is null, code couldn't read the video: leave it null. Never guess a measured number.",
      "Comment text isn't readable through Instagram's API: for commentThemes write the comment count and leave it at that, never invent what people said.",
      JSON.stringify(measured, null, 1),
      lessonText,
    ].join("\n\n");
    const r = await runStage<Research>({
      vault: d.vault,
      stage: 1,
      subject: d.accounts.join(", ").slice(0, 200),
      ask: d.ask ?? askClaudeWithFiles(dir),
      prompt: (failures) => stagePrompt(1, { NICHE, SOURCES: sources, GATE_FAILURES: failures }),
      gate: (out) => gateResearchMeasured(out, measured),
      input: { accounts: d.accounts, measured: measured.map(({ frames: _f, ...rest }) => rest) },
      log,
      now: d.now,
    });
    const research = withMeasured(r.output, measured);
    if (r.gate.passed) {
      for (const p of research?.patterns ?? []) {
        if (p.pattern) await d.vault.addLesson({ kind: "pattern", stage: 1, text: p.pattern, evidence: JSON.stringify(p.examples ?? []), source: "stage 1" }, now());
      }
    }
    return { passed: r.gate.passed, research, gate: r.gate, measured, tries: r.tries, problem: null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
