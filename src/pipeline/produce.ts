// Stage 5 of the content pipeline: Production (pipeline/stages/5-production.md).
// Turns the newest script that passed stage 4 into a 1080x1920 mp4: the
// ElevenLabs voice line by line, a drawing per shot (scenes.ts), captions and
// our own sound (compose.ts). The gate puts key frames of ours next to the
// covers of the benchmark accounts' best Reels in front of a separate judge.
// Nothing is posted here.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";
import { discoverAccount } from "../instagram.ts";
import type { Vault } from "../vault.ts";
import { loudness, mergeAligned, splitRead, splitReadAt, spokenText, type SoundEffect, type Speak } from "../voice.ts";
import { audioSeconds, composeHtml, FPS, mixAudio, mux, renderFrames, run, runOut, timeline, totalSeconds, writeSvgs, type TimedShot } from "./compose.ts";
import { check, END_CARD, gate, gateProduction, type GateResult, type MediaFacts, type ProductionJudgement, type Shot, type TextBox } from "./gates.ts";
import { castSheet, drawScenes, lookSheet, NO_CAST } from "./scenes.ts";
import { motionPlan, shotMotion, USES_MOTION, type ShotMotion } from "./motion.ts";
import { collisionAudio, physicsPlan, physicsRuntime, USES_PHYSICS } from "./physics.ts";
import { formatPrompt, HAS_CAST, isFormat, type Format } from "./formats.ts";
import { learnedChecks, retellMatchPrompt, verdictYes } from "./script.ts";
import { pipelinePath, runStage, stagePrompt } from "./stages.ts";

type Ask = (p: string) => Promise<string>;
export const KEY_FRAMES = 4;
/** How much faster than ElevenLabs' read the narrator plays (VOICE_SPEED overrides, 0.8 to 1.5). */
export const VOICE_SPEED = 1.12;
export function voiceSpeed(): number {
  const v = Number(process.env.VOICE_SPEED);
  return process.env.VOICE_SPEED?.trim() && Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : VOICE_SPEED;
}
export const BENCHMARKS = 3;

type ScriptOut = { shots?: Shot[]; story?: string; payoff?: string; nextHook?: string; caption?: string };

/** The follow check's PICTURES: line: the frames whose picture doesn't show what the voice says ("fine" passes; no line can't fail it). */
export function picturesLine(answer: string): { ok: boolean; detail?: string } {
  const m = answer.match(/PICTURES:\s*([^\n]*)/i);
  if (!m) return { ok: true, detail: "the viewer gave no PICTURES line" };
  const v = m[1]!.trim();
  return /^\W*(fine|none|nothing)\b/i.test(v) || !v ? { ok: true } : { ok: false, detail: `doesn't match the voice: ${v.slice(0, 200)}` };
}

/** The newest Reel whose script passed stage 4 and that has no passed stage 5. */
export async function nextToProduce(vault: Vault, subject?: string): Promise<{ subject: string; format: string; script: ScriptOut } | null> {
  for (const r of await vault.reelsStarted()) {
    if (subject && r.subject !== subject) continue;
    const s = await vault.latestStage(4, { subject: r.subject, passedOnly: true });
    if (!s) continue;
    if (!subject && (await vault.latestStage(5, { subject: r.subject, passedOnly: true }))) continue;
    return { subject: r.subject, format: r.format, script: s.output as ScriptOut };
  }
  return null;
}

/** Width, height, codecs, fps, length and loudness of the finished video. */
export async function mediaFacts(file: string): Promise<MediaFacts> {
  const j = JSON.parse(await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file])) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string }[];
    format: { duration?: string };
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const [n, d] = (v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  const loud = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]).catch(() => "");
  const summary = loud.slice(loud.lastIndexOf("Summary:"));
  const num = (re: RegExp) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    videoCodec: v?.codec_name ?? "none",
    audioCodec: a?.codec_name ?? null,
    fps: d ? Math.round((n! / d) * 100) / 100 : 0,
    seconds: Number(j.format.duration ?? 0),
    lufs: num(/I:\s+(-?[\d.]+) LUFS/),
    truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/),
  };
}

/** Covers of the benchmark accounts' most liked Reels, saved into `dir`. */
export async function benchmarkCovers(d: { fetchImpl?: typeof fetch; token: string; igUserId: string; accounts: string[]; dir: string; discover?: typeof discoverAccount; max?: number }): Promise<string[]> {
  const f = d.fetchImpl ?? fetch;
  const reels: { url: string; likes: number }[] = [];
  for (const a of d.accounts) {
    const acc = await (d.discover ?? discoverAccount)(f, d.token, d.igUserId, a, 50).catch(() => null);
    for (const m of acc?.media ?? []) if ((m.productType === "REELS" || m.mediaType === "VIDEO") && m.thumbnailUrl) reels.push({ url: m.thumbnailUrl, likes: m.likes ?? 0 });
  }
  reels.sort((a, b) => b.likes - a.likes);
  const out: string[] = [];
  for (const r of reels) {
    if (out.length >= (d.max ?? BENCHMARKS)) break;
    try {
      const res = await f(r.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const name = `benchmark-${out.length + 1}.jpg`;
      await writeFile(join(d.dir, name), Buffer.from(await res.arrayBuffer()));
      out.push(name);
    } catch {}
  }
  return out;
}

/** Frame numbers (1-based) in the middle of evenly spread shots, the first shot always included. */
export function keyFrameNumbers(t: TimedShot[], n = KEY_FRAMES): number[] {
  if (!t.length) return [];
  const picks = new Set<number>();
  for (let k = 0; k < n; k++) picks.add(Math.round((k * (t.length - 1)) / Math.max(1, n - 1)));
  return [...picks].map((i) => Math.max(1, Math.round((t[i]!.at + Math.min(t[i]!.dur * 0.6, t[i]!.dur - 0.1)) * FPS)));
}

/** Each word's time in a take by WhisperX forced alignment (pipeline/align/align.py), or null when it isn't installed or fails. */
export async function alignWords(take: string, words: string[], work: string, log?: (m: string) => void): Promise<{ start: number | null; end: number | null }[] | null> {
  if (process.env.WHISPERX === "off") return null;
  try {
    const wav = join(work, "align-16k.wav");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", take, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", wav]);
    const list = join(work, "align-words.json");
    await writeFile(list, JSON.stringify(words));
    const answer = join(work, "align-out.json");
    await run(process.env.PYTHON ?? "python3", [pipelinePath("align/align.py"), wav, list, answer]);
    const j = JSON.parse(await readFile(answer, "utf8")) as { start: number | null; end: number | null }[];
    if (Array.isArray(j) && j.length === words.length) return j;
    log?.(`WhisperX gave ${Array.isArray(j) ? j.length : "no"} words for ${words.length}; using the speech service's stamps.`);
    return null;
  } catch (err) {
    log?.(`WhisperX didn't run (${(err as Error).message.slice(-300)}); using the speech service's stamps.`);
    return null;
  }
}

export type ProduceResult = {
  subject: string | null;
  video: string | null;
  seconds: number;
  passed: boolean;
  gate: GateResult;
  facts: MediaFacts | null;
  boxes: TextBox[];
  fixFirst: string | null;
  problem: string | null;
};

export async function runProduce(d: {
  vault: Vault;
  ask: Ask;
  /** The judge: a Claude call that can read the images in a folder. */
  judge: (dir: string) => Ask;
  speak: Speak;
  /** Sound effects for the script's cues; left out, the Reel gets only our own bed. */
  sfx?: SoundEffect;
  browser: () => Promise<Browser>;
  /** Saves benchmark frames into the folder and returns their file names. */
  benchmarks: (dir: string, format: Format) => Promise<string[]>;
  outDir: string;
  subject?: string;
  log?: (m: string) => void;
  now?: () => Date;
}): Promise<ProduceResult> {
  const log = d.log ?? (() => {});
  const now = d.now ?? (() => new Date());
  const stop = (problem: string, subject: string | null = null): ProduceResult => ({ subject, video: null, seconds: 0, passed: false, gate: gate([check(problem, false)]), facts: null, boxes: [], fixFirst: null, problem });
  const reel = await nextToProduce(d.vault, d.subject);
  if (!reel) return stop("No script waiting for production: run script (stages 3 and 4) first");
  const shots = (reel.script.shots ?? []).slice().sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  if (!shots.length) return stop("The script has no shots", reel.subject);
  await mkdir(d.outDir, { recursive: true });
  const work = join(d.outDir, "work");
  await mkdir(work, { recursive: true });

  // Voice: the whole script in one take, so it sounds like one person telling
  // it, then cut back into each shot's line. Line by line if that fails.
  const lines = shots.map((s) => s.line?.trim() || null);
  const voices: ({ seconds: number; words: { word: string; start: number; end: number }[]; length?: number } | null)[] = [];
  const voiceFiles: (string | null)[] = [];
  let voiceProblem: string | null = null;
  let oneTake = false;
  const spokenLines = lines.filter((l): l is string => Boolean(l));
  if (spokenLines.length) {
    try {
      const take = await d.speak(spokenLines.join(" "));
      const raw = join(work, "voice-take-raw.mp3");
      await writeFile(raw, take.audio);
      // Faster, same pitch (Thomas, 2026-11-19: a voice talking a little faster keeps people from scrolling).
      const speed = voiceSpeed();
      const whole = join(work, "voice-take.wav");
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-af", `atempo=${speed}`, whole]);
      const stamps = take.words.map((w) => ({ word: w.word, start: w.start / speed, end: w.end / speed }));
      // When each word is really heard, by forced alignment (WhisperX); the speech service's stamps run a few tenths off.
      const aligned = await alignWords(whole, stamps.map((w) => w.word), work, log);
      if (aligned) log(`WhisperX placed ${aligned.filter((a) => a.start != null).length} of ${stamps.length} words from the audio.`);
      const words = mergeAligned(stamps, aligned);
      // Cut where the narrator really pauses, found in the audio; the stamps alone clip words.
      const pcm = await runOut("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", whole, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]).catch(() => null);
      const parts = (pcm && splitReadAt(words, spokenLines, loudness(pcm, 16000))) || splitRead(words, spokenLines);
      if (!parts) throw new Error(`the take's ${take.words.length} timed words don't match the script's lines`);
      let k = 0;
      for (let i = 0; i < shots.length; i++) {
        if (!lines[i]) {
          voices.push(null);
          voiceFiles.push(null);
          continue;
        }
        const p = parts[k++]!;
        const file = join(work, `voice-${String(i + 1).padStart(2, "0")}.wav`);
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", whole, "-af", `atrim=start=${p.from.toFixed(3)}:end=${p.to.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, p.to - p.from - 0.03).toFixed(3)}:d=0.03`, file]);
        voices.push({ seconds: p.words.at(-1)!.end, words: p.words, length: p.to - p.from });
        voiceFiles.push(file);
      }
      oneTake = true;
      log(`Voiced the script in one take (${take.words.length} words) and played it ${Math.round((speed - 1) * 100)}% faster, and cut it into ${spokenLines.length} lines.`);
    } catch (err) {
      log(`One take didn't work (${(err as Error).message}); voicing line by line.`);
      voices.length = 0;
      voiceFiles.length = 0;
    }
  }
  for (let i = voices.length ? shots.length : 0; i < shots.length; i++) {
    const line = lines[i];
    if (!line) {
      voices.push(null);
      voiceFiles.push(null);
      continue;
    }
    try {
      const prev = lines.slice(0, i).filter(Boolean).at(-1) ?? undefined;
      const next = lines.slice(i + 1).find(Boolean) ?? undefined;
      const s = await d.speak(line, { previousText: prev, nextText: next });
      const file = join(work, `voice-${String(i + 1).padStart(2, "0")}.mp3`);
      await writeFile(file, s.audio);
      const seconds = s.words.length ? s.words.at(-1)!.end : await audioSeconds(file);
      voices.push({ seconds, words: s.words });
      voiceFiles.push(file);
    } catch (err) {
      voiceProblem = `Shot ${i + 1}'s line couldn't be voiced: ${(err as Error).message}`;
      break;
    }
  }
  if (voiceProblem) return stop(voiceProblem, reel.subject);
  const t = timeline(shots, voices, { oneTake: oneTake });
  const seconds = totalSeconds(t);
  log(`Voiced ${voiceFiles.filter(Boolean).length} lines; the Reel runs ${seconds.toFixed(1)} s over ${t.length} shots.`);

  // Art. Formats made of graphics (the explainer) use the motion kit: Claude
  // picks and fills a ready-made animated piece per shot. The others get a
  // look sheet, the cast drawn once, then every shot drawn in that style.
  const timed = t.map((s) => ({ ...s, start: Math.round(s.at * 10) / 10, end: Math.round((s.at + s.dur) * 10) / 10 }));
  const format: Format = isFormat(reel.format) ? reel.format : "story";
  const style = formatPrompt(format, "style");
  let look = "";
  let svgs: string[] = t.map(() => "");
  let motions: (ShotMotion | null)[] = [];
  let physics = "";
  const effects: { file: string; at: number; cue: string }[] = [];
  if (USES_PHYSICS[format]) {
    // Satisfying videos are one continuous physics run with its own notes.
    const ph = await physicsPlan(timed, reel.script.story ?? "", seconds, d.ask, log);
    await writeFile(join(d.outDir, "physics.json"), JSON.stringify({ plan: ph.plan, problems: ph.problems, doneAt: ph.run?.doneAt ?? null, tempo: ph.run?.tempo ?? null }, null, 1));
    if (!ph.run) {
      const g = gate([check("The physics plan passed its checks and finishes late in the video", false, ph.problems.slice(0, 4).join(" "))]);
      await d.vault.saveStage({ stage: 5, subject: reel.subject, attempt: 1, passed: false, output: { physics: ph.plan, problems: ph.problems }, gate: g }, now());
      await d.vault.logAction({ kind: "stage", summary: "Stage 5, Production: stopped, the physics plan didn't pass its checks.", detail: g.checks[0]!.detail ?? null, target: reel.subject, ok: false }, now());
      return { ...stop(g.checks[0]!.name, reel.subject), gate: g };
    }
    physics = physicsRuntime(ph.run);
    const notes = join(work, "collisions.wav");
    await writeFile(notes, collisionAudio(ph.run));
    effects.push({ file: notes, at: 0, cue: `our own notes, one per collision (${ph.run.events.length} events)` });
    look = `physics: ${ph.plan!.kind} (${ph.plan!.palette ?? "neon"}), finish at ${ph.run.doneAt!.toFixed(1)} s`;
  } else if (USES_MOTION[format]) {
    const m = await motionPlan(timed, d.ask, log, style);
    await writeFile(join(d.outDir, "motion.json"), JSON.stringify(m.plan, null, 1));
    look = `motion kit: ${(m.plan?.shots ?? []).map((s) => `${s.shot}. ${s.pieces.map((p) => p.kind).join(" + ")}`).join("; ")}`;
    if (m.problems.length) {
      const g = gate([check("Every shot has a motion plan that passed the checks", false, m.problems.slice(0, 6).join(" "))]);
      await d.vault.saveStage({ stage: 5, subject: reel.subject, attempt: 1, passed: false, output: { motion: m.plan, problems: m.problems }, gate: g }, now());
      await d.vault.logAction({ kind: "stage", summary: "Stage 5, Production: stopped, the motion plan didn't pass its checks.", detail: g.checks[0]!.detail ?? null, target: reel.subject, ok: false }, now());
      return { ...stop(g.checks[0]!.name, reel.subject), gate: g };
    }
    motions = t.map((_, i) => shotMotion(m.plan, i));
    log(`Motion plan: ${look}.`);
  } else {
    look = await lookSheet(timed, d.ask, style, log);
    await writeFile(join(d.outDir, "look.txt"), look);
    const cast = HAS_CAST[format] ? await castSheet(timed, look, d.ask) : NO_CAST;
    await writeFile(join(d.outDir, "cast.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><defs>${cast.defs}</defs>${cast.parts.map((x, i) => `<use href="#${x.id}" transform="translate(${200 + (i % 3) * 340} ${300 + Math.floor(i / 3) * 420})"/>`).join("")}</svg>`);
    log(cast.parts.length ? `Cast drawn once: ${cast.parts.map((x) => x.id).join(", ")}.` : "No cast sheet; each shot draws its own characters.");
    const scenes = await drawScenes(timed, look, d.ask, log, cast, style);
    const missing = scenes.map((s, i) => (s.svg ? null : i + 1)).filter((x): x is number => x !== null);
    svgs = scenes.map((s) => s.svg ?? "");
    await writeSvgs(join(d.outDir, "scenes"), svgs.filter(Boolean));
    if (missing.length) {
      const g = gate([check("Every shot has a drawing that passed the checks", false, `shots ${missing.join(", ")}: ${scenes[missing[0]! - 1]!.problems.join(" ")}`)]);
      await d.vault.saveStage({ stage: 5, subject: reel.subject, attempt: 1, passed: false, output: { look, missing }, gate: g }, now());
      await d.vault.logAction({ kind: "stage", summary: `Stage 5, Production: stopped, ${missing.length} shots couldn't be drawn.`, detail: g.checks[0]!.detail ?? null, target: reel.subject, ok: false }, now());
      return { ...stop(g.checks[0]!.name, reel.subject), gate: g };
    }
  }

  // Sound effects for each shot's cue (a failed one is left out, not fatal).
  if (d.sfx && !physics) {
    for (const [i, s] of t.entries()) {
      const cue = s.sound?.trim();
      if (!cue || /^(none|silence|no sound)\b/i.test(cue)) continue;
      try {
        const audio = await d.sfx(`${cue}. Cinematic, clean, no music, no voice.`, Math.min(4, Math.max(1, s.dur)));
        const file = join(work, `sfx-${String(i + 1).padStart(2, "0")}.mp3`);
        await writeFile(file, audio);
        effects.push({ file, at: s.at, cue });
      } catch (err) {
        log(`Shot ${i + 1}'s sound effect wasn't made: ${(err as Error).message}`);
      }
    }
    log(`Made ${effects.length} sound effects from the script's cues.`);
  }

  // Render, mix, mux.
  const browser = await d.browser();
  let boxes: TextBox[] = [];
  const framesDir = join(work, "frames");
  try {
    // Explainers ask their closing question over the end card (Thomas, 2026-11-20).
    const lastLine = t.at(-1)?.line?.trim() ?? "";
    const html = composeHtml(t, svgs, motions, physics, { endQuestion: format === "explainer" && /\?["'”’)]*$/.test(lastLine) ? lastLine : undefined });
    await writeFile(join(work, "compose.html"), html);
    // Every Reel ends on the end card (logo, name, website) after its last shot.
    boxes = (await renderFrames(browser, html, seconds + END_CARD, framesDir, log)).boxes;
  } finally {
    await browser.close().catch(() => {});
  }
  const audio = await mixAudio(t, voiceFiles, work, effects, { continuous: Boolean(physics) });
  const video = join(d.outDir, "reel.mp4");
  await mux(framesDir, audio, video);
  const facts = await mediaFacts(video);
  log(`Made ${video}: ${facts.width}x${facts.height}, ${facts.seconds.toFixed(1)} s, ${facts.lufs ?? "?"} LUFS, true peak ${facts.truePeak ?? "?"} dB.`);
  await writeFile(join(d.outDir, "timeline.json"), JSON.stringify({ subject: reel.subject, shots: t.map(({ at, dur, visual, onScreenText, line }) => ({ at, dur, visual, onScreenText, line })), boxes }, null, 1));

  // The gate: our key frames next to the benchmark covers, in front of a separate judge.
  const judgeDir = join(d.outDir, "judge");
  await mkdir(judgeDir, { recursive: true });
  const ours: string[] = [];
  for (const [k, f] of keyFrameNumbers(t).entries()) {
    const name = `ours-${k + 1}.jpg`;
    await copyFile(join(framesDir, `${String(f).padStart(5, "0")}.jpg`), join(judgeDir, name)).then(() => ours.push(name)).catch(() => {});
  }
  const bench = await d.benchmarks(judgeDir, format).catch(() => [] as string[]);

  // Can a stranger follow the finished video? A separate viewer sees one
  // frame of every shot with what's said over it, and retells it.
  const followDir = join(d.outDir, "follow");
  await mkdir(followDir, { recursive: true });
  const watched: string[] = [];
  for (const [i, s] of t.entries()) {
    const f = Math.max(1, Math.round((s.at + Math.min(s.dur * 0.6, s.dur - 0.1)) * FPS));
    const name = `shot-${String(i + 1).padStart(2, "0")}.jpg`;
    await copyFile(join(framesDir, `${String(f).padStart(5, "0")}.jpg`), join(followDir, name)).catch(() => {});
    watched.push(`${name}${s.line ? ` (you hear: "${spokenText(s.line)}")` : " (no voice)"}`);
  }
  const retold = (
    await d
      .judge(followDir)(
        stagePrompt(5, { WATCHED: watched.join("\n") }, "follow"),
      )
      .catch(() => "")
  ).trim();
  const intended = reel.script.story?.trim() || `${shots.map((s) => s.line).filter(Boolean).join(" ")}\nHow it ends: ${reel.script.payoff ?? ""}`;
  // Like stage 4: the match call weighs the whole answer, confusion included.
  const verdict = retold ? await d.ask(retellMatchPrompt(intended, retold)).catch(() => "") : "";
  const followed = Boolean(retold) && verdictYes(verdict);
  if (!followed) log(`The match said: ${verdict.replace(/\s+/g, " ").slice(0, 300)}`);
  log(`A cold viewer of the frames said: ${retold.replace(/\s+/g, " ").slice(0, 300)}`);
  const pictures = picturesLine(retold);
  const cuts = t.length - 1;
  const notes = [
    `Ours: an upbeat ElevenLabs narrator (Liam, v3 with audio tags, Thomas's pick) reads ${voiceFiles.filter(Boolean).length} lines, each read with the lines around it; captions word by word with the current word in lime.`,
    physics
      ? `Our sound: ${effects[0]?.cue ?? "our own notes"}, an original chord loop that climbs as it goes, a chord and a burst on each big moment, over our own low pad and room tone, ${facts.lufs ?? "?"} LUFS, true peak ${facts.truePeak ?? "?"} dB. No music anyone else owns. Our picture: ${look}, one continuous simulated shot like the leading satisfying physics accounts.`
      : `Our sound: ${effects.length} sound effects made for this Reel by ElevenLabs from the script's cues (${effects.map((e) => e.cue).slice(0, 8).join("; ") || "none"}), our own low pad, room tone and a slow heartbeat pulse, a whoosh on each of the ${cuts} cuts, all ducked under the voice, ${facts.lufs ?? "?"} LUFS, true peak ${facts.truePeak ?? "?"} dB. No music anyone else owns.`,
    `Benchmark: the most liked Reels of the leading ${format} accounts from stage 1's list (${format === "explainer" ? "motion-graphics news explainers" : format === "story" ? "stick-figure stories" : format === "satisfying" ? "satisfying loops" : "brand ads"}; cover images only, Instagram gives no audio for other accounts). Judge their voice and sound as what top accounts of that kind use: a clear narrator over trending music with sound effects.`,
  ].join(" ");
  const learned = await learnedChecks(d.vault, 5, { look, shots: t.map((s) => s.visual), notes }, d.ask);
  const r = await runStage<ProductionJudgement>({
    vault: d.vault,
    stage: 5,
    subject: reel.subject,
    ask: d.judge(judgeDir),
    prompt: () => stagePrompt(5, { FRAMES: `ours: ${ours.join(", ")}; benchmark: ${bench.join(", ") || "none"} (all in this folder; read every one)`, AUDIO_NOTES: notes }),
    gate: (j) => {
      if (j?.seen) log(`The judge saw: ours: ${j.seen.ours ?? "?"} Benchmark: ${j.seen.benchmark ?? "?"}`);
      const g = gateProduction(j, { ours: ours.length, benchmarks: bench.length }, learned);
      return gate([
        check("Every shot has a drawing and every line was voiced", true, `${t.length} shots, ${voiceFiles.filter(Boolean).length} lines`),
        check("A cold viewer of the frames and voice gets the story", followed, retold ? retold.replace(/\s+/g, " ").slice(0, 240) : "no answer"),
        check("Every picture shows what the voice says", pictures.ok, pictures.detail),
        ...g.checks,
      ]);
    },
    input: { look, seconds, shots: t.length, facts },
    // The video doesn't change between tries, so one judgement is the answer.
    tries: 1,
    log,
    now: d.now,
  });
  return { subject: reel.subject, video, seconds, passed: r.gate.passed, gate: r.gate, facts, boxes, fixFirst: r.output?.fixFirst ?? null, problem: null };
}
