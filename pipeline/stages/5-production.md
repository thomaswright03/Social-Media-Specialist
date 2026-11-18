# Stage 5: Production

Art, voice, music and captions, compared with the best Reels from stage 1.

How a Reel is made (`social produce`, `src/pipeline/produce.ts`):

- **Voice:** Thomas's ElevenLabs voice reads each shot's line (with the lines
  around it, so it sounds like one read). A shot is stretched when its line
  needs longer than the script gave it.
- **Art:** Claude writes a look sheet for the cast and places, then draws
  every shot as a 1080x1920 SVG in one style: flat vector, dark, white stick
  figures, one lime accent, small CSS animations. Code checks each drawing
  (size, no scripts or outside files) and asks again when one is broken.
- **Captions and text:** code lays them on top: the shot's on-screen text near
  the top, the spoken words word by word in the lower third with the current
  word in lime, all inside Instagram's safe area.
- **Sound:** our own music bed and whooshes on the cuts, made by ffmpeg
  (nothing licensed from anyone else), ducked under the voice, mixed to
  -14 LUFS.
- **Render:** headless Chromium draws each frame at 30 fps, ffmpeg makes an
  H.264/AAC mp4.

**Gate (code, `gateProduction`):**
- every shot has a drawing that passed the checks, and every line was voiced;
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

The style is fixed, don't change it: flat vector on a dark background (#0b0d12 to #171b24), white stick figures (stroke #f5f5f5, 10 to 14 px, round caps), places and props in muted dark blues and greys, one accent lime #a3e635 (red #ef4444 only for danger). Titles, captions and the "MOST OF YOU SAID" line are laid on top by code, so leave them out; in-world text (a HUD clock, words on a monitor) sits between y 520 and y 1260.

Write a short look sheet so every shot is drawn the same way: each character (size on a 1080x1920 canvas, proportions, the one feature that tells them apart, e.g. "the dog: white stick dog, floppy ears, lime collar"), and each place (its layout and the 3 or 4 objects in it, where they sit, their colours). Plain text, under 220 words.
<!-- /look -->

<!-- art -->
You draw one shot of an animated Instagram Reel as an SVG.

Style, the same in every shot: flat vector on a dark background (#0b0d12 to #171b24). Characters are white stick figures (stroke #f5f5f5, stroke-width 10 to 14, round caps and joins, a circle head about 80 px across, dot eyes only when the look matters). Places and props in muted dark blues and greys (#1f2633, #2a3344, #3a4558), lightly outlined. One accent, lime #a3e635, for what matters in the shot (a screen, a glow, the key prop); red #ef4444 only for danger. Simple shapes, bold silhouettes, readable on a phone.

Look sheet (follow it exactly): {{LOOK}}

Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">. Fill the whole canvas. Keep the characters, the action and anything that matters between y 520 and y 1280 and x 80 to 1000: code lays a title over y 240 to 500 and captions over y 1300 to 1500, so put only background (wall, floor, sky) there.
Don't write these words, they're added on top: {{OVERLAY_TEXT}}. Text that's part of the world (on a monitor, a HUD clock) is fine: at least 40 px, inside x 80 to 940 and y 520 to 1260, never above y 520.
Motion: 1 to 3 small CSS @keyframes animations in a <style> inside the SVG (a blink, a wag, typing paws, a flicker, a head turn, a handle turning) that read within {{SECONDS}} seconds. Use transform-box: fill-box and a transform-origin on animated parts.
Not allowed: <script>, <image>, <foreignObject>, event handlers, external links or fonts. Keep it under 30 KB.

Shot {{N}} of {{TOTAL}}, {{SECONDS}} s: {{VISUAL}}
The story around it:
{{CONTEXT}}
{{PROBLEMS}}

Reply with only the SVG, starting with <svg and ending with </svg>.
<!-- /art -->
