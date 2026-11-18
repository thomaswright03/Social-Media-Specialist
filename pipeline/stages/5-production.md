# Stage 5: Production

Art, voice, music and captions, compared with the best Reels from stage 1.

How a Reel is made (`social produce`, `src/pipeline/produce.ts`):

- **Voice:** Thomas's ElevenLabs voice reads each shot's line (with the lines
  around it, so it sounds like one read). A shot is stretched when its line
  needs longer than the script gave it.
- **Art:** Claude writes a look sheet for the cast and places, then draws
  every shot as a 1080x1920 SVG in one style: a moody flat-vector film still
  drawn edge to edge with depth and light, big white stick figures with
  simple faces, one lime accent, small CSS animations. Code checks each drawing
  (size, no scripts or outside files) and asks again when one is broken.
- **Captions and text:** one style, like the benchmark: the spoken words in
  big bold chunks of up to 3 just below the middle, the current word in lime
  (a shot with no voice shows its on-screen text there instead), and a small
  line near the top only when the on-screen text adds something the voice
  doesn't say. All inside Instagram's safe area.
- **Sound:** a sound effect per shot from the script's cue, made by
  Thomas's ElevenLabs account (REEL_SFX=off skips them), over our own pad,
  room tone, a slow pulse and whooshes on the cuts made by ffmpeg, ducked
  under the voice and mixed to -14 LUFS. No music anyone else owns.
- **Render:** headless Chromium draws each frame at 30 fps, ffmpeg makes an
  H.264/AAC mp4.

**Gate (code, `gateProduction`):**
- every shot has a drawing that passed the checks, and every line was voiced;
- a cold viewer who sees one frame of every shot with what the voice says
  over it retells the story right and isn't confused;
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

<!-- look -->
You're the art director of an animated Instagram Reel drawn as flat vector stick figures. Here is its shot list:

{{SHOTS}}

The style is fixed, don't change it: a moody flat-vector film still; white stick figures (stroke #f5f5f5, 12 to 18 px, round caps, filled white heads with simple expressive faces); places drawn edge to edge with depth and light from a source in the scene; dark falloff; one accent lime #a3e635 (red #ef4444 only for danger). Captions are laid on top by code, so leave them out.

Write a short look sheet so every shot is drawn the same way: each character (size on a 1080x1920 canvas, proportions, the one feature that tells them apart, e.g. "the dog: white stick dog, floppy ears, lime collar"), and each place (its layout and the 3 or 4 objects in it, where they sit, their colours). Plain text, under 220 words.
<!-- /look -->

<!-- art -->
You draw one shot of an animated Instagram Reel as an SVG.

Style, the same in every shot: a moody flat-vector film still, like the best stick-figure story channels. Characters are white stick figures (stroke #f5f5f5, stroke-width 12 to 18, round caps and joins, a filled white circle head, simple expressive faces: eyes, brows and a mouth that show the feeling). Places are drawn in full, edge to edge, with depth: a floor or ground plane in perspective, walls or sky behind, 2 or 3 layers where far things are smaller and darker. Light comes from something in the scene (a lamp, a monitor, a window, a streetlight) as soft radial gradients with a pool of light on the floor and a soft shadow under each character; the rest falls off into dark (#0e1117 to #3a4150). One accent, lime #a3e635, for what matters (a screen, a glow, the key prop); red #ef4444 only for danger.

Look sheet (follow it exactly): {{LOOK}}

Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">. Fill the whole canvas, top to bottom: no empty bands. Frame it like a camera: characters are big (a standing figure 900 to 1300 px tall in a medium shot; a close-up face fills a third of the frame), not small in the middle. The shot must read in half a second: one clear pose, one clear feeling, the key thing lit.
Code lays a small line of text near y 300 and the big caption over y 1000 to 1200; keep faces and the key prop out of y 1000 to 1200.
Don't write these words, they're added on top: {{OVERLAY_TEXT}}. Text that's part of the world (on a monitor, a clock) is fine: at least 48 px, inside x 80 to 940, below y 420 and out of y 1000 to 1200.
Motion: 1 to 3 small CSS @keyframes animations in a <style> inside the SVG (a blink, a wag, typing paws, a flicker, a head turn, a handle turning) that read within {{SECONDS}} seconds. Use transform-box: fill-box and a transform-origin on animated parts.
Not allowed: <script>, <image>, <foreignObject>, event handlers, external links or fonts. Keep it under 30 KB.

Shot {{N}} of {{TOTAL}}, {{SECONDS}} s: {{VISUAL}}
The story around it:
{{CONTEXT}}
{{PROBLEMS}}

Reply with only the SVG, starting with <svg and ending with </svg>.
<!-- /art -->
