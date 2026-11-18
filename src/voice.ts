// Thomas's ElevenLabs voice (he chose it 2026-11-18) for the story and
// explainer Reels. ELEVENLABS_API_KEY (secret) and ELEVENLABS_VOICE_ID.
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
  chars.forEach((c, i) => {
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
};
export type Speak = (text: string, opts?: SpeakOpts) => Promise<Spoken>;

export async function speak(text: string, opts: SpeakOpts = {}): Promise<Spoken> {
  const apiKey = opts.apiKey ?? process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY isn't set");
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID isn't set");
  const res = await (opts.fetchImpl ?? fetch)(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2",
      ...(opts.previousText ? { previous_text: opts.previousText } : {}),
      ...(opts.nextText ? { next_text: opts.nextText } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => ({}))) as { audio_base64?: string; alignment?: Parameters<typeof wordsFrom>[0]; detail?: { message?: string; status?: string } | string };
  if (!res.ok || !json.audio_base64) {
    const d = json.detail;
    throw new Error(`ElevenLabs said: ${typeof d === "string" ? d : (d?.message ?? d?.status ?? `HTTP ${res.status}`)}`);
  }
  return { audio: Buffer.from(json.audio_base64, "base64"), words: wordsFrom(json.alignment) };
}
