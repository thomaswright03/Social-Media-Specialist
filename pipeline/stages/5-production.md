# Stage 5: Production

Art, voice, music and captions, compared with the best Reels from stage 1.

How a Reel is made (`social produce`, `src/pipeline/produce.ts`):

- **Voice:** Thomas's ElevenLabs voice reads each shot's line (with the lines
  around it, so it sounds like one read). A shot is stretched when its line
  needs longer than the script gave it.
- **Art:** Claude writes a look sheet for the cast and places, draws the
  cast once (each character's head and what tells them apart, and every
  recurring prop, as SVG pieces), then draws every shot from its camera
  (wide, medium, close-up, over-the-shoulder, low or high angle, insert),
  placing the cast pieces and posing the stick bodies, as a 1080x1920 SVG in one style: a moody flat-vector film still
  drawn edge to edge with depth and light, big white stick figures with
  simple faces, one lime accent, small CSS animations. Code checks each drawing
  (size, no scripts or outside files) and asks again when one is broken.
- **Captions and text:** one caption band, like the benchmark: the spoken
  words in big bold chunks of up to 3 below the action (y 1290), the current
  word in lime (a shot with no voice shows its on-screen text there instead).
  On-screen text that adds something the voice doesn't say (a name, a time,
  how two people are related) is a small label near the top (y 240). The art
  keeps faces and the action between the label and the caption. All inside
  Instagram's safe area.
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
You're the art director of an animated Instagram Reel. Here is its shot list (each with its camera and place):

{{SHOTS}}

The style is fixed, don't change it:
{{STYLE}}
Captions are laid on top by code, so leave them out.

Write the look sheet every shot is drawn from. Be exact, like a model sheet, so a dozen separate drawings can't disagree:
- Each character, if there are any: name, height on the canvas in a medium shot, and the ONE thing on or by the head that tells them apart at a glance, with its shape and colour (a ponytail, a top hat, round glasses, a cap, floppy ears, a bow). Grown-ups tall, kids about two thirds as tall. Things on the body (a sash, a tie, an apron) are thin and in a muted colour, never a big accent-coloured block.
- Each recurring object, prop or graphic (the stand, the pitcher, the marble track, the map, the big number card): its exact shape, size on the canvas, colours, and the detail that makes it obviously that thing.
- Each place or background: what's in it, front to back, and what each camera sees, so a wide, a close-up and a reverse angle all show different parts of the same place.
- The light and the palette: where light comes from and the exact colours used.
Plain text, under 300 words.
<!-- /look -->

<!-- cast -->
You draw the cast of an animated Instagram Reel once, so every shot can reuse them. Look sheet:

{{LOOK}}

Shots: 
{{SHOTS}}

Reply with one SVG: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><defs> … </defs></svg>. Inside <defs>:
- For each character, one <g id="c-NAME" data-note="who they are and what the group holds"> (NAME lowercase letters and hyphens, e.g. c-mia, c-mayor): the head as a filled white circle of radius 70 centred on 0,0, with the neck coming down to 0,70, plus everything on or by the head that tells them apart (hair, hat, ears, glasses, a bow, a collar), in the look sheet's shapes and colours. No eyes, brows or mouth: each shot draws those for the feeling it needs. No body: each shot draws the stick body in its own pose under the neck.
- For each prop that appears in 2 or more shots, one <g id="p-NAME" data-note="what it is and its size"> drawn at its real size next to a character (a 180 px head means a standing adult about 1000 px tall), standing on 0,0 (its bottom centre is the origin), with the detail that makes it obviously that thing (a striped awning, a price sign, a glass pitcher with lemon slices).
Flat vector, the look sheet's colours, soft gradients allowed (define them inside <defs> too, with ids starting g-). Under 12 KB. No <script>, <image>, <foreignObject>, event handlers or outside links.
{{PROBLEMS}}

Reply with only the SVG.
<!-- /cast -->

<!-- art -->
You draw one shot of an animated Instagram Reel as an SVG, like one frame of a film storyboard by a great cinematographer.

Style, the same in every shot:
{{STYLE}}

Look sheet (follow it exactly): {{LOOK}}

The cast: {{CAST}}
The camera for this shot is {{CAMERA}}. Frame it like that:
- wide: the whole place and everyone in it, characters about a third of the frame tall; this is where we learn where we are.
- medium: one or two characters from the knees up, big (head scale 1.3 to 1.8), the place behind them.
- close-up: one face fills the upper half of the frame (head scale 3 to 4), the feeling is the shot.
- over-the-shoulder: the back of one character's head and shoulder big in the foreground, the other character facing us across from them.
- low angle / high angle: look up at someone big and powerful, or down at someone small; the ground line tilts.
- insert: the prop, object or number that matters, huge and detailed.
If the style above gives its own framing for a camera, follow the style.
When two characters share the shot they react to each other: they face each other, their eyes meet or one looks away, a hand points, gives, takes or reaches. Show the action itself happening (handing the cup over, the sign falling), not two figures standing still.
Place: {{PLACE}}. Show the part of it this camera would see, so neighbouring shots don't look the same.

Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">. Fill the whole canvas, top to bottom: no empty bands. The shot must read in half a second: one clear action, one clear feeling, the key thing lit.
Code lays the big caption over y 1270 to 1500, below the action. Compose the shot so everything that matters (faces, heads and hats, hands doing the action, the key prop) sits between y 330 and 1250; below 1260 is floor, table top, ground or shadow, nothing anyone needs to see. The top 330 px is wall, sky or ceiling: Instagram's buttons and a small text label sit there.
Don't write these words, the caption adds them: {{OVERLAY_TEXT}}. {{IN_WORLD}} Text that's part of the world (a sign, a price, a clock) is fine: at least 48 px, inside x 80 to 940, between y 340 and 1250.
Motion: 2 to 4 CSS @keyframes animations in a <style> inside the SVG that make the action move within {{SECONDS}} seconds: the arm handing over, the head turning, a blink, steam, leaves blowing, a sign swinging. Use transform-box: fill-box and a transform-origin on animated parts (a shoulder for an arm, the neck for a head).
Not allowed: <script>, <image>, <foreignObject>, event handlers, external links or fonts. Keep it under 30 KB.

Shot {{N}} of {{TOTAL}}, {{SECONDS}} s: {{VISUAL}}
The story around it:
{{CONTEXT}}
{{PROBLEMS}}

Reply with only the SVG, starting with <svg and ending with </svg>.
<!-- /art -->
