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
