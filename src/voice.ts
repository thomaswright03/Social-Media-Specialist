// The narrator for the story and explainer Reels, on Thomas's ElevenLabs
// account (ELEVENLABS_API_KEY, secret). Thomas, 2026-11-19, after hearing five
// takes: Liam, ElevenLabs' own voice, with audio tags, on v3's most expressive
// setting. ELEVENLABS_NARRATOR_VOICE picks another voice id.
// The with-timestamps endpoint also gives each character's timing, which the
// word-by-word captions are cut from.

export type Spoken = { audio: Buffer; words: { word: string; start: number; end: number }[] };

/** Words with their start and end, from ElevenLabs' character alignment. */
export function wordsFrom(alignment: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] } | undefined) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words: Spoken["words"] = [];
  let cur: Spoken["words"][number] | null = null;
  let tag = 0;
  chars.forEach((c, i) => {
    // Audio tags ("[excited]") direct the read; they aren't words anyone hears.
    if (c === "[") tag++;
    if (tag > 0) {
      if (c === "]") tag--;
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (/\s/.test(c)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { word: "", start: starts[i] ?? 0, end: ends[i] ?? 0 };
    cur.word += c;
    cur.end = ends[i] ?? cur.end;
  });
  if (cur) words.push(cur);
  return words;
}

export type SpeakOpts = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  voiceId?: string;
  /** The lines around this one, so a Reel read line by line still sounds like one read. */
  previousText?: string;
  nextText?: string;
  /** Overrides the stability setting for this call (voice tests compare takes). */
  stability?: number;
};
export type Speak = (text: string, opts?: SpeakOpts) => Promise<Spoken>;

/**
 * The model (Thomas, 2026-11-19: the voice must sound more animated and real).
 * Eleven v3 is ElevenLabs' most expressive model and follows audio tags such
 * as [excited] or [whispers]; ELEVENLABS_MODEL overrides it.
 */
/** Liam, an ElevenLabs premade voice (Thomas picked it over his own, 2026-11-19). */
export const LIAM = "TX3LPaxmHKxFdv7VOQHJ";
export const NARRATOR_VOICE = () => process.env.ELEVENLABS_NARRATOR_VOICE?.trim() || LIAM;

export const VOICE_MODEL = () => process.env.ELEVENLABS_MODEL?.trim() || "eleven_v3";
const isV3 = (model: string) => /^eleven_v3/.test(model);

/** Text without its audio tags: what a listener actually hears. */
export const spokenText = (t: string) => t.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

/** v3's stability is one of 0 (creative, Thomas's pick), 0.5 (natural) or 1 (robust); ELEVENLABS_STABILITY picks another. */
function voiceSettings(model: string, stability?: number) {
  if (stability !== undefined) return isV3(model) ? { stability } : { stability, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true };
  const env = Number(process.env.ELEVENLABS_STABILITY);
  if (isV3(model)) return { stability: Number.isFinite(env) && process.env.ELEVENLABS_STABILITY?.trim() ? env : 0 };
  return { stability: Number.isFinite(env) && process.env.ELEVENLABS_STABILITY?.trim() ? env : 0.35, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true };
}

const said = (d: { message?: string; status?: string } | string | undefined, status: number) => (typeof d === "string" ? d : (d?.message ?? d?.status ?? `HTTP ${status}`));

export async function speak(text: string, opts: SpeakOpts = {}): Promise<Spoken> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = opts.voiceId ?? NARRATOR_VOICE();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY isn't set");
  const model = VOICE_MODEL();
  const f = opts.fetchImpl ?? fetch;
  const res = await f(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: voiceSettings(model, opts.stability),
      // v3 reads the whole script in one take, so it needs no neighbouring lines.
      ...(!isV3(model) && opts.previousText ? { previous_text: opts.previousText } : {}),
      ...(!isV3(model) && opts.nextText ? { next_text: opts.nextText } : {}),
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const json = (await res.json().catch(() => ({}))) as { audio_base64?: string; alignment?: Parameters<typeof wordsFrom>[0]; detail?: { message?: string; status?: string } | string };
  if (!res.ok || !json.audio_base64) throw new Error(`ElevenLabs said: ${said(json.detail, res.status)}`);
  const audio = Buffer.from(json.audio_base64, "base64");
  const words = wordsFrom(json.alignment);
  // Without timings from the speech call, ElevenLabs' forced alignment gives them.
  return { audio, words: words.length ? words : await align(audio, spokenText(text), { fetchImpl: f, apiKey }) };
}

/** Word timings for audio whose text is known (ElevenLabs forced alignment). */
export async function align(audio: Buffer, text: string, opts: { fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<Spoken["words"]> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY isn't set");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "voice.mp3");
  form.append("text", text);
  const res = await (opts.fetchImpl ?? fetch)("https://api.elevenlabs.io/v1/forced-alignment", { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(120_000) });
  const json = (await res.json().catch(() => ({}))) as { words?: { text?: string; start?: number; end?: number }[]; detail?: { message?: string; status?: string } | string };
  if (!res.ok || !json.words) throw new Error(`ElevenLabs alignment said: ${said(json.detail, res.status)}`);
  return json.words.filter((w) => w.text?.trim()).map((w) => ({ word: w.text!.trim(), start: w.start ?? 0, end: w.end ?? 0 }));
}

/**
 * One take, cut back into lines: each line's slice of the read (from just
 * before its first word to just before the next line's), with its words
 * timed from the start of that slice. Null when the words don't line up.
 */
export function splitRead(words: Spoken["words"], lines: string[], pad = 0.06): { from: number; to: number; words: Spoken["words"] }[] | null {
  const counts = lines.map((l) => spokenText(l).split(/\s+/).filter(Boolean).length);
  if (counts.reduce((a, b) => a + b, 0) !== words.length) return null;
  const out: { from: number; to: number; words: Spoken["words"] }[] = [];
  let k = 0;
  for (const n of counts) {
    const ws = words.slice(k, k + n);
    k += n;
    if (!ws.length) return null;
    out.push({ from: Math.max(0, ws[0]!.start - pad), to: 0, words: ws });
  }
  out.forEach((o, i) => {
    o.to = i + 1 < out.length ? out[i + 1]!.from : o.words.at(-1)!.end + 0.25;
    o.words = o.words.map((w) => ({ word: w.word, start: w.start - o.from, end: w.end - o.from }));
  });
  return out;
}

/** How loud a take is, one value per frame of `step` seconds. */
export type Loudness = { step: number; rms: number[] };

/** Longest pause between two lines that's kept whole; longer pauses are shortened. */
export const MAX_PAUSE = 0.35;

/**
 * One take, cut back into lines where the narrator actually pauses (Thomas,
 * 2026-11-20: words were clipped and doubled). The word timestamps only say
 * roughly where a line ends: they can be a few tenths early or late, so a cut
 * placed on them chops a word or lets it play twice. Each cut goes in the
 * quiet stretch between the lines, found in the audio itself; a long pause is
 * shortened to MAX_PAUSE, and each line's words are moved to where its speech
 * really starts. Null when the words don't line up.
 */
export function splitReadAt(words: Spoken["words"], lines: string[], loud: Loudness): { from: number; to: number; words: Spoken["words"] }[] | null {
  const counts = lines.map((l) => spokenText(l).split(/\s+/).filter(Boolean).length);
  if (counts.reduce((a, b) => a + b, 0) !== words.length || counts.some((n) => !n) || !loud.rms.length) return null;
  const groups: Spoken["words"][] = [];
  let k = 0;
  for (const n of counts) groups.push(words.slice(k, (k += n)));
  const { step, rms } = loud;
  const end = rms.length * step;
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const quietBelow = ref * 10 ** (-30 / 20);
  const quiet = (f: number) => (rms[f] ?? 0) <= quietBelow;
  const frame = (t: number) => Math.max(0, Math.min(rms.length - 1, Math.round(t / step)));
  const onset = (from: number, until: number) => {
    for (let f = frame(from); f <= frame(until); f++) if (!quiet(f)) return f * step;
    return null;
  };
  // Where speech starts and ends overall.
  let first = 0;
  while (first < rms.length && quiet(first)) first++;
  let last = rms.length - 1;
  while (last > 0 && quiet(last)) last--;
  const cuts: { prevTo: number; nextFrom: number }[] = [];
  for (let i = 0; i + 1 < groups.length; i++) {
    const a = groups[i]!.at(-1)!.end;
    const b = groups[i + 1]![0]!.start;
    const lo = frame(Math.min(a, b) - 0.35);
    const hi = frame(Math.max(a, b) + 0.35);
    const mid = (a + b) / 2;
    // The longest quiet run in the window (the nearest to the stamps on a tie).
    let best: { s: number; e: number } | null = null;
    for (let f = lo; f <= hi; f++) {
      if (!quiet(f)) continue;
      let e = f;
      while (e + 1 <= hi && quiet(e + 1)) e++;
      const len = e - f;
      const dist = Math.abs(((f + e + 1) / 2) * step - mid);
      if (!best || len > best.e - best.s || (len === best.e - best.s && dist < Math.abs(((best.s + best.e + 1) / 2) * step - mid))) best = { s: f, e };
      f = e;
    }
    if (best) {
      const s = best.s * step;
      const e = (best.e + 1) * step;
      if (e - s > MAX_PAUSE) cuts.push({ prevTo: s + MAX_PAUSE * 0.6, nextFrom: e - MAX_PAUSE * 0.4 });
      else cuts.push({ prevTo: (s + e) / 2, nextFrom: (s + e) / 2 });
    } else {
      // No silence at all: cut at the softest frame.
      let m = lo;
      for (let f = lo; f <= hi; f++) if ((rms[f] ?? 0) < (rms[m] ?? 0)) m = f;
      cuts.push({ prevTo: m * step, nextFrom: m * step });
    }
  }
  return groups.map((ws, i) => {
    const from = i === 0 ? Math.max(0, first * step - 0.05) : cuts[i - 1]!.nextFrom;
    const to = i + 1 < groups.length ? cuts[i]!.prevTo : Math.min(end, (last + 1) * step + 0.2);
    const heard = onset(from, to);
    const drift = heard == null ? 0 : Math.max(-0.5, Math.min(0.5, heard - ws[0]!.start));
    const span = to - from;
    return { from, to, words: ws.map((w) => ({ word: w.word, start: Math.max(0, Math.min(span, w.start + drift - from)), end: Math.max(0, Math.min(span, w.end + drift - from)) })) };
  });
}

/** A take's loudness from raw 16-bit mono samples. */
export function loudness(pcm: Buffer, rate: number, step = 0.01): Loudness {
  const n = Math.floor(pcm.length / 2);
  const per = Math.max(1, Math.round(rate * step));
  const rms: number[] = [];
  for (let i = 0; i + per <= n; i += per) {
    let sum = 0;
    for (let j = i; j < i + per; j++) {
      const v = pcm.readInt16LE(j * 2) / 32768;
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / per));
  }
  return { step: per / rate, rms };
}

/**
 * A sound effect from Thomas's ElevenLabs account (sound generation). Paid
 * plans may use what it makes commercially, so it's listed as ElevenLabs in
 * the Reel's assets.
 */
export async function soundEffect(text: string, seconds: number, opts: { fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<Buffer> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY isn't set");
  const res = await (opts.fetchImpl ?? fetch)("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text, duration_seconds: Math.min(22, Math.max(0.5, Math.round(seconds * 10) / 10)), prompt_influence: 0.5 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { detail?: { message?: string; status?: string } | string };
    const d = j.detail;
    throw new Error(`ElevenLabs sound effects said: ${typeof d === "string" ? d : (d?.message ?? d?.status ?? `HTTP ${res.status}`)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
export type SoundEffect = typeof soundEffect;
