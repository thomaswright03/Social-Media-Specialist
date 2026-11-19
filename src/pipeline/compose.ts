// Stage 5's compositor: puts the drawings, the voice, the captions and the
// sound together into a 1080x1920 mp4. Each frame is drawn by headless
// Chromium from one HTML page (window.render(t) seeks every animation to the
// frame's time, so nothing depends on how fast the machine is), then ffmpeg
// joins the frames with the mixed audio.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";
import type { Shot, TextBox } from "./gates.ts";
import { motionRuntime, type ShotMotion } from "./motion.ts";

export const W = 1080;
export const H = 1920;
export const FPS = 30;
/** Silence before a shot's line starts, and after it ends. */
export const LEAD = 0.15;
export const TAIL = 0.3;
export const MIN_SHOT = 1.5;
export const LIME = "#a3e635";
/** The one caption band: below the action, above Instagram's bottom UI (the art keeps faces and the action out of it). */
export const CAPTION_TOP = 1290;
/** The small label for on-screen text that adds something the voice doesn't say (a name, a time). */
export const LABEL_TOP = 240;

/** The label's text: the shot's on-screen text, when it isn't just the spoken line again. */
export const labelFor = (s: TimedShot) => (s.words.length && s.onScreenText?.trim() && !repeatsLine(s.onScreenText, s.line) ? s.onScreenText.trim() : "");

export type Word = { word: string; start: number; end: number };
export type TimedShot = Shot & { at: number; dur: number; voiceAt: number | null; words: Word[] };

/**
 * Where each shot starts and how long it lasts. A shot keeps its scripted
 * length unless its line needs longer; its words move to where they're heard.
 */
export function timeline(shots: Shot[], voices: ({ seconds: number; words: Word[] } | null)[]): TimedShot[] {
  let at = 0;
  return shots.map((s, i) => {
    const v = voices[i] ?? null;
    const scripted = Math.max(MIN_SHOT, (s.end ?? 0) - (s.start ?? 0));
    const dur = Math.max(scripted, v ? LEAD + v.seconds + TAIL : 0);
    const voiceAt = v ? at + LEAD : null;
    const t: TimedShot = { ...s, at, dur, voiceAt, words: v ? v.words.map((w) => ({ word: w.word, start: w.start + voiceAt!, end: w.end + voiceAt! })) : [] };
    at += dur;
    return t;
  });
}

export const totalSeconds = (t: TimedShot[]) => (t.length ? t.at(-1)!.at + t.at(-1)!.dur : 0);

export type Chunk = { words: Word[]; from: number; to: number };

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

/** True when a shot's on-screen text mostly repeats its spoken line. */
export function repeatsLine(text: string | undefined, line: string | undefined): boolean {
  const a = norm(text ?? "");
  const b = new Set(norm(line ?? ""));
  if (!a.length || !b.size) return false;
  return a.filter((w) => b.has(w)).length / a.length >= 0.6;
}

/**
 * The words the big caption shows: the spoken words where there are any,
 * otherwise the shot's on-screen text, popping in one word after another.
 */
export function captionWords(s: TimedShot): Word[] {
  if (s.words.length) return s.words;
  const words = (s.onScreenText ?? "").split(/\s+/).filter(Boolean);
  return words.map((w, k) => ({ word: w, start: s.at + 0.05 + k * 0.16, end: s.at + 0.05 + k * 0.16 + 0.15 }));
}

/** Caption chunks: up to 3 words, broken after a full stop, comma or question mark. */
export function captionChunks(t: TimedShot[], max = 3): Chunk[] {
  const out: Chunk[] = [];
  for (const s of t) {
    let cur: Word[] = [];
    const end = s.at + s.dur;
    const flush = () => {
      if (cur.length) out.push({ words: cur, from: Math.max(s.at, cur[0]!.start - 0.08), to: end });
      cur = [];
    };
    for (const w of captionWords(s)) {
      cur.push(w);
      if (cur.length >= max || /[.,?!;:]$/.test(w.word)) flush();
    }
    flush();
  }
  // A chunk stays until the next one starts (or a moment after its last word).
  return out.map((c, i) => ({ ...c, to: Math.min(c.to, out[i + 1]?.from ?? Infinity, c.words.at(-1)!.end + 0.6) }));
}

/** How the camera moves in a shot, read from its description. */
export function cameraFor(visual: string): { from: number; to: number; grain: boolean; flash: boolean } {
  const v = visual.toLowerCase();
  const grain = /security|cctv|cam\b|camera feed|grainy|footage|monitor view/.test(v);
  const flash = /\b(hard (cut|push)|snaps?|slams?|flash|bang)\b/.test(v);
  if (/push[- ]?in|zoom|extreme close|close-up|closer/.test(v)) return { from: 1.0, to: 1.16, grain, flash };
  if (/\bwide\b|establishing/.test(v)) return { from: 1.04, to: 1.0, grain, flash };
  return { from: 1.0, to: 1.06, grain, flash };
}

/** JSON that can't end the <script> it sits in. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Seconds a whip or zoom into a shot takes. */
export const TRANSITION = 0.22;

/** How a shot comes in: its motion plan's pick, a flash for a hard cut, a whip between graphics, otherwise a cut. */
export function transitionFor(i: number, motion: ShotMotion | null, flash: boolean): string {
  if (i === 0) return "cut";
  if (motion?.transition) return motion.transition;
  if (flash) return "flash";
  return motion ? "whip" : "cut";
}

/**
 * The page every frame is drawn from. A shot shows its drawing, or, when the
 * motion kit plans it, its animated pieces (pipeline/motion/runtime.js).
 */
export function composeHtml(t: TimedShot[], svgs: string[], motions: (ShotMotion | null)[] = []): string {
  const shots = t.map((s, i) => {
    const cam = cameraFor(`${s.camera ?? ""} ${s.visual ?? ""}`);
    const m = motions[i] ?? null;
    const move = m ? { from: 1, to: 1.035 } : {};
    return { at: s.at, dur: s.dur, label: labelFor(s), ...cam, ...move, i, tr: transitionFor(i, m, cam.flash), motion: m };
  });
  const chunks = captionChunks(t).map((c) => ({ from: c.from, to: c.to, words: c.words.map((w) => ({ w: w.word, s: w.start })) }));
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&display=block">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#0b0d12}
.scene{position:absolute;inset:0;display:none;transform-origin:50% 50%;overflow:hidden}
.scene>svg{width:${W}px;height:${H}px;display:block}
#grain{position:absolute;inset:-20px;opacity:0;pointer-events:none;mix-blend-mode:screen}
#vignette{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 48%,transparent 55%,rgba(0,0,0,.55) 100%)}
#flash{position:absolute;inset:0;background:#fff;opacity:0}
#label{position:absolute;left:0;right:0;top:${LABEL_TOP}px;text-align:center;opacity:0}
#label span{display:inline-block;max-width:820px;font-family:Montserrat,sans-serif;font-weight:800;font-size:46px;line-height:1.15;letter-spacing:.05em;text-transform:uppercase;color:#fff;background:rgba(10,12,18,.72);padding:10px 26px;border-radius:14px}
#cap{position:absolute;left:80px;right:160px;top:${CAPTION_TOP}px;text-align:center;font-family:Montserrat,sans-serif;font-weight:900;font-size:88px;line-height:1.08;color:#fff;text-transform:uppercase;letter-spacing:-.01em;-webkit-text-stroke:2px rgba(0,0,0,.6);paint-order:stroke fill;text-shadow:0 4px 14px rgba(0,0,0,.85),0 2px 0 rgba(0,0,0,.5)}
#cap b{color:${LIME};font-weight:900}
#cap span{display:inline-block;transform-origin:50% 70%}
</style></head><body>
${t.map((_, i) => `<div class="scene" id="s${i}">${motions[i] ? "" : (svgs[i] ?? "")}</div>`).join("\n")}
<svg id="grain" width="${W + 40}" height="${H + 40}"><filter id="n"><feTurbulence id="turb" type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="1"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
<div id="vignette"></div><div id="flash"></div>
<div id="label"></div><div id="cap"></div>
<script>${motions.some(Boolean) ? motionRuntime() : ""}</script>
<script>
const SHOTS=${scriptJson(shots)};
const MOUNTED=SHOTS.map(s=>s.motion&&window.MK?window.MK.mount(s.motion,document.getElementById('s'+s.i)):null);
const TR=${TRANSITION};
const CHUNKS=${scriptJson(chunks)};
const ease=(x)=>x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;
const esc=(s)=>s.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
let shown=-1, capKey=null, labelText=null;
window.render=(t)=>{
  let i=SHOTS.findIndex(s=>t>=s.at&&t<s.at+s.dur); if(i<0) i=SHOTS.length-1;
  const s=SHOTS[i], local=t-s.at, p=Math.min(1,local/s.dur);
  const tp=(s.tr==='whip'||s.tr==='zoom')&&i>0&&local<TR?local/TR:1;
  for(let k=0;k<SHOTS.length;k++){ const on=k===i||(k===i-1&&tp<1); const e=document.getElementById('s'+k); const want=on?'block':'none'; if(e.style.display!==want) e.style.display=want; }
  shown=i;
  const el=document.getElementById('s'+i);
  const zoom=s.from+(s.to-s.from)*ease(p);
  const te=ease(tp);
  if(s.tr==='whip'&&tp<1){ el.style.transform='translateX('+((1-te)*1080)+'px) scale('+zoom+')'; el.style.filter='blur('+((1-te)*18)+'px)'; }
  else if(s.tr==='zoom'&&tp<1){ el.style.transform='scale('+(zoom*(1.3-0.3*te))+')'; el.style.filter='blur('+((1-te)*10)+'px)'; el.style.opacity=String(te); }
  else { el.style.transform='scale('+zoom+')'; el.style.filter=''; el.style.opacity=''; }
  el.style.zIndex='2';
  if(i>0&&tp<1){ const pv=SHOTS[i-1], pe=document.getElementById('s'+(i-1)); pe.style.zIndex='1'; const pz=pv.to;
    if(s.tr==='whip'){ pe.style.transform='translateX('+(-te*1080)+'px) scale('+pz+')'; pe.style.filter='blur('+(te*18)+'px)'; pe.style.opacity=''; }
    else { pe.style.transform='scale('+(pz*(1-0.1*te))+')'; pe.style.filter=''; pe.style.opacity=String(1-te); }
    const pl=t-pv.at; if(MOUNTED[i-1]) MOUNTED[i-1].update(pl,pv.dur,t); for(const a of pe.getAnimations({subtree:true})){ a.pause(); a.currentTime=pl*1000; } }
  getComputedStyle(el).transform;
  if(MOUNTED[i]) MOUNTED[i].update(local,s.dur,t);
  for(const a of el.getAnimations({subtree:true})){ a.pause(); a.currentTime=local*1000; }
  const g=document.getElementById('grain'); g.style.opacity=s.grain?'.18':'0';
  if(s.grain){ document.getElementById('turb').setAttribute('seed',String(Math.floor(t*30)%97+1)); g.style.transform='translate('+(Math.floor(t*30)%7-3)+'px,'+(Math.floor(t*30*3)%7-3)+'px)'; }
  document.getElementById('flash').style.opacity=(s.tr==='flash'||s.flash)&&local<.1?String(.55*(1-local/.1)):'0';
  const label=document.getElementById('label');
  if(labelText!==s.label){ label.innerHTML=s.label?'<span>'+esc(s.label)+'</span>':''; labelText=s.label; }
  label.style.opacity=s.label?String(i===0?1:Math.min(1,local/.18)):'0';
  const cap=document.getElementById('cap');
  const c=CHUNKS.find(c=>t>=c.from&&t<c.to);
  if(!c){ if(capKey!==null){ cap.innerHTML=''; capKey=null; } }
  else { let cur=-1; c.words.forEach((w,k)=>{ if(t>=w.s) cur=k; }); const key=c.from+':'+cur; if(key!==capKey){ cap.innerHTML=c.words.map((w,k)=>k===cur?'<b>'+esc(w.w)+'</b>':esc(w.w)).join(' '); capKey=key; }
    const cp=Math.min(1,(t-c.from)/.12); cap.style.transform='scale('+(0.9+0.1*ease(cp))+')'; }
  const boxes=[]; for(const e of [s.label?label.firstElementChild:null, cap.textContent.trim()?cap:null]){ if(!e) continue; for(const r of e.getClientRects()) boxes.push({text:e.textContent.trim(),x:r.x,y:r.y,w:r.width,h:r.height}); }
  return boxes;
};
</script></body></html>`;
}

/** Draws every frame into `dir` (00001.jpg …) and returns the text boxes seen. */
export async function renderFrames(browser: Browser, html: string, seconds: number, dir: string, log?: (m: string) => void): Promise<{ frames: number; boxes: TextBox[] }> {
  await mkdir(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const seen = new Map<string, TextBox>();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const frames = Math.round(seconds * FPS);
    for (let f = 0; f < frames; f++) {
      const boxes = (await page.evaluate((t) => (window as unknown as { render(t: number): TextBox[] }).render(t), f / FPS)) as TextBox[];
      for (const b of boxes) {
        const k = `${b.text}|${Math.round(b.x)}|${Math.round(b.y)}|${Math.round(b.w)}|${Math.round(b.h)}`;
        if (!seen.has(k)) seen.set(k, b);
      }
      await page.screenshot({ path: join(dir, `${String(f + 1).padStart(5, "0")}.jpg`), type: "jpeg", quality: 90 });
      if (f % (FPS * 10) === 0 && f) log?.(`Rendered ${f / FPS} s of ${seconds.toFixed(1)} s.`);
    }
    return { frames, boxes: [...seen.values()] };
  } finally {
    await page.close();
  }
}

export function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`${cmd} couldn't start: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(out + err) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-800)}`))));
  });
}

/** Seconds of audio in a file, by ffprobe. */
export async function audioSeconds(file: string): Promise<number> {
  const out = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  const n = Number(out.trim().split("\n")[0]);
  if (!Number.isFinite(n)) throw new Error(`ffprobe couldn't read the length of ${file}`);
  return n;
}

/**
 * Our own sound: a low pad and room tone (made here, so nobody else owns it),
 * a soft whoosh on every cut, all ducked under the voice, then loudness
 * normalised to -14 LUFS with true peak under -1.5 dBTP (two passes).
 */
export async function mixAudio(t: TimedShot[], voiceFiles: (string | null)[], dir: string, sfx: { file: string; at: number }[] = []): Promise<string> {
  const total = totalSeconds(t);
  const inputs: string[] = [];
  const filters: string[] = [];
  const pad = `0.05*sin(2*PI*55*t)+0.035*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.13*t))+0.02*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*0.21*t))`;
  inputs.push("-f", "lavfi", "-i", `aevalsrc='${pad}|${pad}':s=44100:d=${total.toFixed(3)}`);
  inputs.push("-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.03:d=${total.toFixed(3)}:r=44100`);
  filters.push(`[0:a]lowpass=f=400,afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(3)}:d=1.5[pad]`);
  filters.push(`[1:a]lowpass=f=300,aformat=channel_layouts=stereo[room]`);
  // A soft low pulse, like a slow heartbeat, from the second shot on.
  const beatFrom = t[1]?.at ?? 0;
  inputs.push("-f", "lavfi", "-i", `aevalsrc='if(gte(t,${beatFrom.toFixed(3)}),0.5*sin(2*PI*52*t)*exp(-9*mod(t-${beatFrom.toFixed(3)},0.82)),0)':s=44100:d=${total.toFixed(3)}`);
  filters.push(`[2:a]lowpass=f=160,volume=0.55,aformat=channel_layouts=stereo[beat]`);
  const cuts = t.slice(1).map((s) => s.at);
  const whooshes: string[] = [];
  cuts.forEach((c, i) => {
    const idx = 3 + i;
    inputs.push("-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.25:d=0.4:r=44100`);
    const ms = Math.max(0, Math.round((c - 0.18) * 1000));
    filters.push(`[${idx}:a]highpass=f=900,lowpass=f=5000,afade=t=in:d=0.18,afade=t=out:st=0.18:d=0.22,volume=0.35,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[w${i}]`);
    whooshes.push(`[w${i}]`);
  });
  const voices: string[] = [];
  voiceFiles.forEach((f, i) => {
    if (!f || t[i]?.voiceAt == null) return;
    const idx = 3 + cuts.length + voices.length;
    inputs.push("-i", f);
    const ms = Math.round(t[i]!.voiceAt! * 1000);
    filters.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${voices.length}]`);
    voices.push(`[v${voices.length}]`);
  });
  // Sound effects (from the script's cues) sit under the voice like the bed.
  const effects: string[] = [];
  sfx.forEach((e, k) => {
    const idx = 3 + cuts.length + voices.length + k;
    inputs.push("-i", e.file);
    const ms = Math.max(0, Math.round(e.at * 1000));
    filters.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.6,adelay=${ms}|${ms}[e${k}]`);
    effects.push(`[e${k}]`);
  });
  filters.push(`[pad][room][beat]${whooshes.join("")}${effects.join("")}amix=inputs=${3 + whooshes.length + effects.length}:normalize=0:duration=first[bed]`);
  if (voices.length) {
    filters.push(`${voices.join("")}amix=inputs=${voices.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(3)},asplit=2[voice][key]`);
    filters.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[duck]`);
    filters.push(`[voice][duck]amix=inputs=2:normalize=0:duration=first,atrim=0:${total.toFixed(3)}[mix]`);
  } else {
    filters.push(`[bed]anull[mix]`);
  }
  const raw = join(dir, "mix-raw.wav");
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[mix]", "-ac", "2", "-ar", "44100", raw]);
  const m = await measureLoudness(raw);
  const out = join(dir, "mix.wav");
  const ln = m
    ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    : "loudnorm=I=-14:TP=-1.5:LRA=11";
  await run("ffmpeg", ["-y", "-v", "error", "-i", raw, "-af", `${ln},aresample=44100`, "-ar", "44100", out]);
  return out;
}

async function measureLoudness(file: string): Promise<Record<string, string> | null> {
  const out = await run("ffmpeg", ["-hide_banner", "-i", file, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).catch(() => "");
  const j = out.slice(out.lastIndexOf("{"), out.lastIndexOf("}") + 1);
  try {
    return JSON.parse(j) as Record<string, string>;
  } catch {
    return null;
  }
}

/** Joins the frames and the audio into an mp4 Instagram takes. */
export async function mux(framesDir: string, audio: string, out: string): Promise<void> {
  await run("ffmpeg", [
    "-y", "-v", "error",
    "-framerate", String(FPS), "-i", join(framesDir, "%05d.jpg"),
    "-i", audio,
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
    "-shortest", "-movflags", "+faststart", out,
  ]);
}

export async function writeSvgs(dir: string, svgs: string[]) {
  await mkdir(dir, { recursive: true });
  await Promise.all(svgs.map((s, i) => writeFile(join(dir, `shot-${String(i + 1).padStart(2, "0")}.svg`), s)));
}

export { esc as escapeHtml };
