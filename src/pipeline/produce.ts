// Stage 5 of the content pipeline: Production (pipeline/stages/5-production.md).
// Turns the newest script that passed stage 4 into a 1080x1920 mp4: the
// ElevenLabs voice line by line, a drawing per shot (scenes.ts), captions and
// our own sound (compose.ts). The gate puts our key frames in front of a
// separate judge who grades them on our rubric, not against other accounts.
// Nothing is posted here.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";
import type { Vault } from "../vault.ts";
import { loudness, mergeAligned, splitRead, splitReadAt, spokenText, type SoundEffect, type Speak } from "../voice.ts";
import { audioSeconds, composeHtml, FPS, MIN_SHOTS_SECONDS, mixAudio, mux, renderFrames, run, runOut, timeline, totalSeconds, writeSvgs, type TimedShot } from "./compose.ts";
import { check, END_CARD, gate, gateProduction, soundCues, type GateResult, type MediaFacts, type Packaging, type ProductionJudgement, type Shot, type TextBox } from "./gates.ts";
import { castSheet, drawScene, drawScenes, lookSheet, NO_CAST, type Cast } from "./scenes.ts";
import { motionPlan, replanShots, shotMotion, USES_MOTION, type MotionPlan, type ShotMotion } from "./motion.ts";
import { collisionAudio, physicsPlan, physicsRuntime, physicsStory, USES_PHYSICS } from "./physics.ts";
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

type ScriptOut = { shots?: Shot[]; story?: string; payoff?: string; nextHook?: string; caption?: string };

/** The follow check's PICTURES: line: the frames whose picture doesn't show what the voice says ("fine" passes; no line can't fail it). */
export function picturesLine(answer: string): { ok: boolean; detail?: string } {
  const m = answer.match(/PICTURES:\s*([^\n]*)/i);
  if (!m) return { ok: true, detail: "the viewer gave no PICTURES line" };
  const v = m[1]!.trim();
  return /^\W*(fine|none|nothing)\b/i.test(v) || !v ? { ok: true } : { ok: false, detail: `doesn't match the voice: ${v.slice(0, 200)}` };
}

/**
 * Cold viewers of the finished frames. One viewer was a coin toss: test run
 * 44837502299's explainer failed on shots 3, 4, 8 and 9, whose pictures did
 * show their lines. Like stage 4's testers, 2 of 3 must agree.
 */
export const FOLLOW_VIEWERS = 3;

/** The viewers' PICTURES lines together: a shot is wrong when 2 or more viewers say so. */
export function picturesVote(answers: string[], total: number): { ok: boolean; detail?: string; shots: number[] } {
  const lines = answers.map(picturesLine);
  const count = new Map<number, number>();
  for (const l of lines) if (!l.ok) for (const n of mismatchedShots(l.detail, total)) count.set(n, (count.get(n) ?? 0) + 1);
  const shots = [...count].filter(([, c]) => c >= 2).map(([n]) => n).sort((a, b) => a - b);
  const fine = lines.filter((l) => l.ok).length;
  // A viewer who says pictures don't fit without naming a shot counts against all of them.
  const vague = lines.filter((l) => !l.ok && mismatchedShots(l.detail, total).length === 0).length;
  const ok = shots.length === 0 && vague < 2;
  if (ok) return { ok, shots, ...(fine < lines.length ? { detail: `${fine} of ${lines.length} viewers said every picture fits; no shot was flagged by 2` } : {}) };
  return { ok, shots, detail: shots.length ? `doesn't match the voice: ${shots.join(", ")} (each flagged by 2+ of ${lines.length} viewers)` : `${lines.length - fine} of ${lines.length} viewers said pictures don't fit: ${lines.filter((l) => !l.ok).map((l) => l.detail).join("; ").slice(0, 200)}` };
}

/**
 * Rounds of redrawing the shots a viewer said don't show what the voice says, before stage 5 gives up.
 * Two: fresh viewers of the redrawn video can flag a different shot (test run 44859311055: shot 1, then 12).
 */
export const REDRAW_ROUNDS = 2;

/** The shot numbers in a PICTURES detail ("doesn't match the voice: 02, 05" or "shot-02.jpg"), within 1..total. */
export function mismatchedShots(detail: string | undefined, total: number): number[] {
  const nums = [...(detail ?? "").matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= total);
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** A closing line as the end card shows it: without the voice's audio tags like "[curious]". */
export const endQuestionText = (line: string | undefined) => (line ?? "").replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

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
  /** The Reel's format and script (stage 6 packages its caption). */
  format?: Format;
  script?: ScriptOut;
  /** When each shot starts and what it shows in text (stage 6 picks the cover). */
  shots?: { at: number; dur: number; onScreenText?: string }[];
  /** Every sound and picture in the video and where it's from (stage 6's rights check). */
  assets?: Packaging["assets"];
};

/** Where this pipeline's sounds and pictures come from, for stage 6's rights check. */
export function reelAssets(r: { voiced: number; sfx: number; physics: boolean; motion: boolean }): NonNullable<Packaging["assets"]> {
  const ours = "ours, made in code for this Reel";
  const eleven = "ElevenLabs paid plan (commercial use allowed)";
  return [
    ...(r.voiced ? [{ name: "Narration", kind: "voice" as const, source: "ElevenLabs text to speech, made for this Reel", license: eleven }] : []),
    ...(r.sfx ? [{ name: `${r.sfx} sound effects`, kind: "sfx" as const, source: "ElevenLabs sound effects, made for this Reel", license: eleven }] : []),
    ...(r.physics ? [{ name: "Collision notes and chord loop", kind: "music" as const, source: "synthesized from the simulation (src/pipeline/physics.ts)", license: ours }] : []),
    { name: "Pad, room tone and whooshes", kind: "music", source: "synthesized (src/pipeline/compose.ts)", license: ours },
    r.physics
      ? { name: "Physics simulation", kind: "art", source: "Matter.js, run for this Reel", license: "MIT (Matter.js); the picture is ours" }
      : { name: r.motion ? "Motion graphics" : "Drawings", kind: "art", source: r.motion ? "our motion kit (pipeline/motion)" : "SVG drawn for this Reel", license: ours },
    { name: "Logo and end card", kind: "art", source: "Wright AI Solutions' own logo", license: "ours" },
    { name: "Montserrat font", kind: "art", source: "Google Fonts", license: "SIL Open Font License (commercial use allowed)" },
  ];
}

export async function runProduce(d: {
  vault: Vault;
  ask: Ask;
  /** The judge: a Claude call that can read the images in a folder. */
  judge: (dir: string) => Ask;
  speak: Speak;
  /** Sound effects for the script's cues; left out, the Reel gets only our own bed. */
  sfx?: SoundEffect;
  browser: () => Promise<Browser>;
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
  const t = timeline(shots, voices, { oneTake, minSeconds: MIN_SHOTS_SECONDS });
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
  let motionPlanned: MotionPlan | null = null;
  let physics = "";
  let physicsWhat = "";
  let cast: Cast = NO_CAST;
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
    // The run, not the script, decides when it finishes, so a label scripted for
    // after that moment ("SO CLOSE" under "FREE!", test run 44853965768) is dropped:
    // the counter says how it ended.
    for (const s of t) if (s.at >= ph.run.doneAt!) s.onScreenText = "";
    physics = physicsRuntime(ph.run);
    physicsWhat = physicsStory(ph.run);
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
    motionPlanned = m.plan;
    log(`Motion plan: ${look}.`);
  } else {
    look = await lookSheet(timed, d.ask, style, log);
    await writeFile(join(d.outDir, "look.txt"), look);
    cast = HAS_CAST[format] ? await castSheet(timed, look, d.ask) : NO_CAST;
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
  // Only the cues soundCues allows: MAX_SFX at most, never two shots running, nothing banned.
  if (d.sfx && !physics) {
    const played = new Set(soundCues(t));
    for (const [i, s] of t.entries()) {
      const cue = s.sound?.trim();
      if (!cue || !played.has(i)) continue;
      try {
        const audio = await d.sfx(`${cue}. Cinematic, clean, no music, no voice.`, Math.min(2, Math.max(0.5, s.dur)));
        const file = join(work, `sfx-${String(i + 1).padStart(2, "0")}.mp3`);
        await writeFile(file, audio);
        effects.push({ file, at: s.at, cue });
      } catch (err) {
        log(`Shot ${i + 1}'s sound effect wasn't made: ${(err as Error).message}`);
      }
    }
    log(`Made ${effects.length} sound effects from the script's cues.`);
  }

  // Render, judge, and if a viewer says some drawn pictures don't show what the
  // voice says (and nothing else failed), redraw just those shots and judge the
  // new video again with fresh viewers, REDRAW_ROUNDS times at most.
  const video = join(d.outDir, "reel.mp4");
  let boxes: TextBox[] = [];
  let facts!: MediaFacts;
  let r!: Awaited<ReturnType<typeof runStage<ProductionJudgement>>>;
  const redrawable = (!physics && !motions.some(Boolean) && svgs.some(Boolean)) || Boolean(motionPlanned);
  const voiced = voiceFiles.some(Boolean);
  for (let round = 0; ; round++) {
    // Render, mix, mux.
    const browser = await d.browser();
    const framesDir = join(work, "frames");
    try {
      // Explainers ask their closing question over the end card (Thomas, 2026-11-20).
      // Without the voice's audio tags ("[curious]"), which are for the voice, not the screen.
      const lastLine = endQuestionText(t.at(-1)?.line);
      const html = composeHtml(t, svgs, motions, physics, { endQuestion: format === "explainer" && /\?["'”’)]*$/.test(lastLine) ? lastLine : undefined });
      await writeFile(join(work, "compose.html"), html);
      // Every Reel ends on the end card (logo, name, website) after its last shot.
      boxes = (await renderFrames(browser, html, seconds + END_CARD, framesDir, log)).boxes;
    } finally {
      await browser.close().catch(() => {});
    }
    const audio = await mixAudio(t, voiceFiles, work, effects, { continuous: Boolean(physics) });
    await mux(framesDir, audio, video);
    facts = await mediaFacts(video);
    log(`Made ${video}: ${facts.width}x${facts.height}, ${facts.seconds.toFixed(1)} s, ${facts.lufs ?? "?"} LUFS, true peak ${facts.truePeak ?? "?"} dB.`);
    await writeFile(join(d.outDir, "timeline.json"), JSON.stringify({ subject: reel.subject, shots: t.map(({ at, dur, visual, onScreenText, line }) => ({ at, dur, visual, onScreenText, line })), boxes }, null, 1));

    // The gate: our key frames in front of a separate judge, scored on our rubric.
    const judgeDir = join(d.outDir, "judge");
    await mkdir(judgeDir, { recursive: true });
    const ours: string[] = [];
    for (const [k, f] of keyFrameNumbers(t).entries()) {
      const name = `ours-${k + 1}.jpg`;
      await copyFile(join(framesDir, `${String(f).padStart(5, "0")}.jpg`), join(judgeDir, name)).then(() => ours.push(name)).catch(() => {});
    }

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
    // A physics run is matched against what it really shows; the run, not the script, decides what happens.
    const intended = physicsWhat || reel.script.story?.trim() || `${shots.map((s) => s.line).filter(Boolean).join(" ")}\nHow it ends: ${reel.script.payoff ?? ""}`;
    const views = await Promise.all(
      Array.from({ length: FOLLOW_VIEWERS }, async () => {
        const retold = (await d.judge(followDir)(stagePrompt(5, { WATCHED: watched.join("\n") }, "follow")).catch(() => "")).trim();
        // Like stage 4: the match call weighs the whole answer, confusion included.
        const verdict = retold ? await d.ask(retellMatchPrompt(intended, retold)).catch(() => "") : "";
        return { retold, verdict, yes: Boolean(retold) && verdictYes(verdict) };
      }),
    );
    const got = views.filter((v) => v.yes).length;
    const followed = got >= 2;
    for (const v of views.filter((v) => !v.yes)) log(`The match said: ${v.verdict.replace(/\s+/g, " ").slice(0, 300)}`);
    const retold = views.find((v) => !v.yes && v.retold)?.retold ?? views.find((v) => v.retold)?.retold ?? "";
    log(`Cold viewers of the frames who got it: ${got} of ${views.length}. One said: ${retold.replace(/\s+/g, " ").slice(0, 300)}`);
    const pictures = picturesVote(views.map((v) => v.retold).filter(Boolean), t.length);
    const cuts = t.length - 1;
    const notes = [
      voiced
        ? `Ours: an upbeat ElevenLabs narrator (Liam, v3 with audio tags, Thomas's pick) reads ${voiceFiles.filter(Boolean).length} lines, each read with the lines around it; captions word by word with the current word in lime.`
        : "Ours has no narrator by design: no voice and no spoken captions, only the on-screen text. Don't score VOICE: write null for it.",
      physics
        ? `Our sound: ${effects[0]?.cue ?? "our own notes"}, an original chord loop that climbs as it goes, a chord and a burst on each big moment, over our own low pad and room tone, ${facts.lufs ?? "?"} LUFS, true peak ${facts.truePeak ?? "?"} dB. No music anyone else owns. Our picture: ${look}, one continuous simulated shot like the leading satisfying physics accounts.`
        : `Our sound: ${effects.length} sound effects made for this Reel by ElevenLabs from the script's cues (${effects.map((e) => e.cue).slice(0, 8).join("; ") || "none"}), our own low pad, room tone and a slow heartbeat pulse, a whoosh on each of the ${cuts} cuts, all ducked under the voice, ${facts.lufs ?? "?"} LUFS, true peak ${facts.truePeak ?? "?"} dB. No music anyone else owns.`,
    ].join(" ");
    const learned = await learnedChecks(d.vault, 5, { look, shots: t.map((s) => s.visual), notes }, d.ask);
    r = await runStage<ProductionJudgement>({
      vault: d.vault,
      stage: 5,
      subject: reel.subject,
      ask: d.judge(judgeDir),
      prompt: () => stagePrompt(5, { FRAMES: `${ours.join(", ")} (all in this folder; read every one)`, AUDIO_NOTES: notes }),
      gate: (j) => {
        if (j?.seen) log(`The judge saw: ${j.seen.ours ?? "?"}`);
        const g = gateProduction(j, { ours: ours.length }, learned, undefined, { voiced });
        return gate([
          check("Every shot has a drawing and every line was voiced", true, `${t.length} shots, ${voiceFiles.filter(Boolean).length} lines`),
          check("Cold viewers of the frames and voice get the story (2 of 3)", followed, `${got} of ${views.length}${retold ? `. One said: ${retold.replace(/\s+/g, " ").slice(0, 220)}` : ""}`),
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

    const failing = r.gate.checks.filter((c) => !c.passed).map((c) => c.name);
    const bad = pictures.shots;
    const onlyPictures = failing.every((n) => n === "Every picture shows what the voice says" || n === "Cold viewers of the frames and voice get the story (2 of 3)");
    if (r.gate.passed || !redrawable || round >= REDRAW_ROUNDS || !bad.length || !onlyPictures) break;
    log(`Redrawing shot${bad.length > 1 ? "s" : ""} ${bad.join(", ")}: a viewer said ${bad.length > 1 ? "their pictures don't" : "its picture doesn't"} show what the voice says.`);
    await d.vault.logAction({ kind: "stage", summary: `Stage 5, Production: redrawing shot${bad.length > 1 ? "s" : ""} ${bad.join(", ")}, whose pictures didn't show what the voice says.`, target: reel.subject }, now());
    if (motionPlanned) {
      // Graphics: new pieces for just those shots, from the motion kit.
      const next = await replanShots(motionPlanned, bad, timed, d.ask, style, log);
      if (!next) break;
      motionPlanned = next;
      motions = t.map((_, i) => shotMotion(next, i));
      await writeFile(join(d.outDir, "motion.json"), JSON.stringify(next, null, 1));
      continue;
    }
    for (const n of bad) {
      const said = timed[n - 1]!.line?.trim() || timed[n - 1]!.onScreenText?.trim() || "";
      const scene = await drawScene(timed, n - 1, look, d.ask, cast, style, `A viewer watching the finished video said this shot's picture doesn't show what is said over it${said ? ` ("${said}")` : ""}. Draw it so the picture shows exactly that, plainly, at a glance.`);
      if (scene.svg) svgs[n - 1] = scene.svg;
    }
    await writeSvgs(join(d.outDir, "scenes"), svgs.filter(Boolean));
  }
  return {
    subject: reel.subject,
    video,
    seconds,
    passed: r.gate.passed,
    gate: r.gate,
    facts,
    boxes,
    fixFirst: r.output?.fixFirst ?? null,
    problem: null,
    format,
    script: reel.script,
    shots: t.map((s) => ({ at: s.at, dur: s.dur, onScreenText: s.onScreenText })),
    assets: reelAssets({ voiced: voiceFiles.filter(Boolean).length, sfx: physics ? 0 : effects.length, physics: Boolean(physics), motion: !physics && motions.some(Boolean) }),
  };
}
