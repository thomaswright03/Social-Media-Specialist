# Stage 5: Production

Art, voice, music and captions, compared with the best Reels from stage 1.
This is where the voice (a stronger AI voice, or a real person), the art and
the sound design are decided.

**Gate (code, `gateProduction`):**
- key frames from our video and from at least 2 benchmark Reels, side by side;
- a judge (Claude looking at the images, or Thomas) scores art, text
  readability, voice and sound from 1 to 5 for both;
- ours is not worse than the benchmark on any of them. If it is, that is
  fixed before anything else;
- every learned check for stage 5.

<!-- prompt -->
You are judging stage 5. Look at our frames and the benchmark frames side by side ({{FRAMES}}). Score each from 1 to 5 on art, readability (on-screen text), voice and sound (from the notes: {{AUDIO_NOTES}}). Be strict: the benchmark is what people already choose to watch.

Reply with only JSON: {"ours": {"art": 3, "readability": 4, "voice": 2, "sound": 3}, "benchmark": {"art": 4, "readability": 4, "voice": 4, "sound": 4}, "fixFirst": "the single biggest gap"}
<!-- /prompt -->
