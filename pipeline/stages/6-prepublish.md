# Stage 6: Pre-publish checks

A checklist where every item passes (code, `gatePrepublish`). Measured from
the rendered file with ffprobe and ffmpeg's loudness meter, and from the
render's own list of text boxes:

**Technical**
- 1080x1920 (9:16), H.264 video, AAC audio, 24 to 60 fps
- length 30 to 60 s
- loudness about -14 LUFS (-16 to -12), true peak at or below -1 dBTP
- no text in the zones Instagram's buttons and caption cover: top 220 px,
  bottom 420 px, right 140 px, left 60 px

**Packaging**
- a cover frame is chosen and has readable text on it
- the caption's first line is the hook, 125 characters or less
- 3 to 5 keywords in the caption (Instagram search reads captions)
- a call to action

**Learned:** every check stage 8 added for stage 6.

A Trial Reel goes out on its own only when every item passes.
