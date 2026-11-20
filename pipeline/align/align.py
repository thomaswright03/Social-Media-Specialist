"""Forced alignment with WhisperX: when each word of a known script is heard.

Usage: python3 align.py voice.wav words.json aligned.json
words.json is a list of the script's words, in order. The output is the same
list as [{"word", "start", "end"}], with start and end null for a word the
aligner couldn't place (like "$156", whose characters it has no sound for).
Stage 5 uses it to time the cuts and captions from the audio itself
(Thomas, 2026-11-20), instead of trusting the speech service's stamps.
"""
import json
import sys
import wave

import numpy as np
import whisperx


def main() -> None:
    wav, words_file, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
    # Libraries print progress (like "Downloading…") on stdout, so the answer goes to a file.
    words = json.load(open(words_file))
    w = wave.open(wav)
    if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
        raise SystemExit("expects 16 kHz mono 16-bit WAV")
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    seconds = len(audio) / 16000
    model, meta = whisperx.load_align_model(language_code="en", device="cpu")
    out = whisperx.align([{"text": " ".join(words), "start": 0.0, "end": seconds}], model, meta, audio, "cpu", return_char_alignments=False)
    got = out.get("word_segments", [])
    res = []
    k = 0
    for word in words:
        seg = got[k] if k < len(got) else None
        k += 1
        if seg and seg.get("start") is not None:
            res.append({"word": word, "start": float(seg["start"]), "end": float(seg["end"])})
        else:
            res.append({"word": word, "start": None, "end": None})
    with open(out_file, "w") as f:
        json.dump(res, f)


if __name__ == "__main__":
    main()
