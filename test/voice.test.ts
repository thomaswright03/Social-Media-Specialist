import { describe, expect, it } from "vitest";
import { speak, wordsFrom } from "../src/voice.ts";

describe("ElevenLabs voice", () => {
  it("turns character timings into word timings", () => {
    const text = "Hi you";
    const words = wordsFrom({ characters: [...text], character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5], character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] });
    expect(words).toEqual([
      { word: "Hi", start: 0, end: 0.2 },
      { word: "you", start: 0.3, end: 0.6 },
    ]);
  });

  it("returns the audio and words, and ElevenLabs' own error when it refuses", async () => {
    let sent: { url: string; key: string | null } | null = null;
    const ok = (async (url: string, init: RequestInit) => {
      sent = { url, key: new Headers(init.headers).get("xi-api-key") };
      return new Response(JSON.stringify({ audio_base64: Buffer.from("mp3").toString("base64"), alignment: { characters: ["A"], character_start_times_seconds: [0], character_end_times_seconds: [0.3] } }));
    }) as unknown as typeof fetch;
    const s = await speak("A", { fetchImpl: ok, apiKey: "k", voiceId: "v1" });
    expect(s.audio.toString()).toBe("mp3");
    expect(s.words).toEqual([{ word: "A", start: 0, end: 0.3 }]);
    expect(sent).toMatchObject({ key: "k" });
    expect(sent!.url).toContain("/text-to-speech/v1/with-timestamps");
    const bad = (async () => new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), { status: 401 })) as unknown as typeof fetch;
    await expect(speak("A", { fetchImpl: bad, apiKey: "k", voiceId: "v1" })).rejects.toThrow("Invalid API key");
    await expect(speak("A", { fetchImpl: ok, apiKey: "", voiceId: "v1" })).rejects.toThrow("ELEVENLABS_API_KEY");
  });
});

describe("one expressive take (Thomas, 2026-11-19)", async () => {
  const { splitRead, splitReadAt, loudness, MAX_PAUSE, spokenText, align } = await import("../src/voice.ts");
  it("drops audio tags from the timed words and the counted text", () => {
    const text = "[excited] Hi you";
    const n = [...text].length;
    const words = wordsFrom({ characters: [...text], character_start_times_seconds: Array.from({ length: n }, (_, i) => i / 10), character_end_times_seconds: Array.from({ length: n }, (_, i) => (i + 1) / 10) });
    expect(words.map((w) => w.word)).toEqual(["Hi", "you"]);
    expect(spokenText("[sighs] Well, [whispers] fine.")).toBe("Well, fine.");
  });

  it("cuts one take back into its lines", () => {
    const w = (word: string, start: number) => ({ word, start, end: start + 0.3 });
    const parts = splitRead([w("Critics", 0.1), w("love", 0.4), w("it.", 0.7), w("One", 1.5), w("says", 1.8), w("no.", 2.1)], ["[excited] Critics love it.", "One says no."])!;
    expect(parts.map((p) => [p.from, p.to].map((x) => Math.round(x * 100) / 100))).toEqual([[0.04, 1.44], [1.44, 2.65]]);
    expect(parts[1]!.words[0]!.start).toBeCloseTo(0.06);
    expect(splitRead([w("a", 0)], ["a b"])).toBeNull();
  });

  it("cuts in the narrator's real pause even when the word stamps are off (Thomas, 2026-11-20)", () => {
    // Speech 0.10-1.00 and 1.30-2.30, silence elsewhere; the stamps run 0.3 s late.
    const step = 0.01;
    const rms = Array.from({ length: 260 }, (_, f) => ((f >= 10 && f < 100) || (f >= 130 && f < 230) ? 0.3 : 0.001));
    const w = (word: string, start: number) => ({ word, start, end: start + 0.25 });
    const words = [w("Critics", 0.4), w("love", 0.7), w("it.", 1.0), w("One", 1.7), w("says", 2.0), w("no.", 2.3)];
    const lines = ["[excited] Critics love it.", "One says no."];
    // The old cut, on the stamps, lands inside the second line's first word.
    expect(splitRead(words, lines)![0]!.to).toBeGreaterThan(1.3);
    const parts = splitReadAt(words, lines, { step, rms })!;
    expect(parts[0]!.to).toBeGreaterThanOrEqual(1.0);
    expect(parts[0]!.to).toBeLessThanOrEqual(1.3);
    expect(parts[1]!.from).toBe(parts[0]!.to);
    expect(parts[1]!.words[0]!.start).toBeCloseTo(1.3 - parts[1]!.from, 2);
    expect(parts[0]!.from).toBeCloseTo(0.05);
    expect(parts[1]!.to).toBeCloseTo(2.5);
  });

  it("shortens a long pause between lines and keeps the words whole", () => {
    const rms = Array.from({ length: 300 }, (_, f) => ((f >= 10 && f < 100) || (f >= 200 && f < 280) ? 0.3 : 0.001));
    const w = (word: string, start: number) => ({ word, start, end: start + 0.25 });
    const parts = splitReadAt([w("a", 0.1), w("b", 0.6), w("c", 2.0), w("d", 2.5)], ["a b", "c d"], { step: 0.01, rms })!;
    expect(parts[0]!.to).toBeGreaterThanOrEqual(1.0);
    expect(parts[1]!.from).toBeLessThanOrEqual(2.0);
    expect(parts[1]!.from - parts[0]!.to).toBeGreaterThan(0.5);
    expect(parts[0]!.to - 1.0 + (2.0 - parts[1]!.from)).toBeCloseTo(MAX_PAUSE, 2);
  });

  it("measures loudness from raw samples", () => {
    const pcm = Buffer.alloc(16000 * 2 * 0.1);
    for (let i = 800; i < 1600; i++) pcm.writeInt16LE(16384, i * 2);
    const l = loudness(pcm, 16000);
    expect(l.rms.length).toBe(10);
    expect(l.rms[0]).toBe(0);
    expect(l.rms[6]).toBeCloseTo(0.5);
  });

  it("asks for v3 with settings, and aligns when the speech call gives no timings", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      if (url.includes("forced-alignment")) return new Response(JSON.stringify({ words: [{ text: "Hi", start: 0, end: 0.2 }, { text: " ", start: 0.2, end: 0.2 }, { text: "there", start: 0.2, end: 0.5 }] }));
      return new Response(JSON.stringify({ audio_base64: Buffer.from("mp3").toString("base64") }));
    }) as unknown as typeof fetch;
    const s = await speak("[excited] Hi there", { fetchImpl: f, apiKey: "k", voiceId: "v" });
    const body = JSON.parse(String(calls[0]!.body));
    expect(body).toMatchObject({ model_id: "eleven_v3", voice_settings: { stability: 0 } });
    expect(body.previous_text).toBeUndefined();
    expect(calls[1]!.url).toContain("forced-alignment");
    expect((calls[1]!.body as FormData).get("text")).toBe("Hi there");
    expect(s.words.map((x) => x.word)).toEqual(["Hi", "there"]);
    expect(align).toBeTypeOf("function");
  });
});
