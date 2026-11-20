// ElevenLabs speech to text (Scribe), with Thomas's ElevenLabs key. Stage 1
// uses it to hear other creators' Reels: every word with the second it starts
// and ends, plus tags for sounds that aren't speech ("(music)", "(laughter)").
// That is what lets code measure when the voice starts, how fast it talks and
// how long nothing new happens. It costs about $0.20 an hour of audio
// (elevenlabs.io/pricing/api, read 2026-11-19), so a 40 s Reel is a fraction
// of a cent. A key limited to some features needs Speech to Text turned on;
// without it the call fails and stage 1 carries on with no transcript.

export type HeardWord = { word: string; start: number; end: number };
export type Heard = {
  text: string;
  words: HeardWord[];
  /** Sounds that aren't speech, as the model tags them, with the second each starts. */
  events: { what: string; at: number }[];
  language: string | null;
};
export type Transcribe = (audio: Buffer, opts?: { fetchImpl?: typeof fetch; apiKey?: string }) => Promise<Heard>;

/** What ElevenLabs charges for an hour of audio, in dollars (elevenlabs.io/pricing/api, read 2026-11-19). */
export const STT_USD_PER_HOUR = 0.2;

/** scribe_v2 is the model in ElevenLabs' own examples; ELEVENLABS_STT_MODEL picks another. */
export const STT_MODEL = () => process.env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2";

type SttWord = { text?: string; type?: string; start?: number | null; end?: number | null };

/** ElevenLabs' answer as words and sound tags (spacing entries dropped). */
export function heardFrom(json: { text?: string; language_code?: string; words?: SttWord[] } | null | undefined): Heard {
  const words: HeardWord[] = [];
  const events: Heard["events"] = [];
  for (const w of json?.words ?? []) {
    const text = (w.text ?? "").trim();
    if (!text || typeof w.start !== "number") continue;
    if (w.type === "audio_event") events.push({ what: text.replace(/^[([]\s*|\s*[)\]]$/g, "").toLowerCase(), at: w.start });
    else if (w.type === "word" || w.type === undefined) words.push({ word: text, start: w.start, end: typeof w.end === "number" ? w.end : w.start });
  }
  return { text: (json?.text ?? "").trim(), words, events, language: json?.language_code ?? null };
}

/** Transcribes an audio file (mp3). Throws with ElevenLabs' own words when it refuses. */
export const transcribe: Transcribe = async (audio, opts = {}) => {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY isn't set");
  const form = new FormData();
  form.append("model_id", STT_MODEL());
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), "reel.mp3");
  form.append("tag_audio_events", "true");
  form.append("timestamps_granularity", "word");
  form.append("diarize", "false");
  const res = await (opts.fetchImpl ?? fetch)("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(180_000) });
  const json = (await res.json().catch(() => ({}))) as Parameters<typeof heardFrom>[0] & { detail?: { message?: string; status?: string } | string | { msg?: string }[] };
  if (!res.ok || !Array.isArray(json?.words)) {
    const d = json?.detail;
    const said = typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).filter(Boolean).join("; ") : (d?.message ?? d?.status);
    throw new Error(`ElevenLabs speech to text said: ${said || `HTTP ${res.status}`}`);
  }
  return heardFrom(json);
};
