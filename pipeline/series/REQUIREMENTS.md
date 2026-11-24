# Series requirements

What every story series must meet (The Night Desk is the first). The prompts in
`pipeline/series/<id>.md` say this to Claude; the code in `src/pipeline/series.ts`
and the gates check it. A new series follows this file.

## Thomas's requirements (2026-11-23)

1. **Eight parts, a prompt for every part.** Each part has its own brief in the
   series file: the locked ending, the guest, the beats in order, the key
   drawings, the traps to avoid and the caption's vote. ("Let's make a 8 part
   series with prompts for every part to ensure high quality.")
2. **The outro names the next part.** The last spoken line says the next part
   is coming, with its number and "tomorrow", for example "Part 2 tomorrow!".
   It is the only place a part number appears, and only in the last shot. The
   final part has no next part, so its outro names none. ("The outro must
   mention the next part like Part 2 tomorrow! or something.")
3. **One to two minutes long.** Each part runs 60 to 120 seconds of story, plus
   the end card. No tighter time budget than that: the story takes the time it
   needs within that range. ("Each part must be at least one minute long and
   can be between 1 and 2 minutes. Budgeting time can be a limitation that
   seems unnecessary.")
4. **One a day, no part numbers anywhere else.** He chose "Daily, no part
   numbers" on 2026-11-23: one part a day in the fifth daily slot, with no part
   label in the opening, the caption or the cover. Requirement 2 is the one
   exception, at the very end.

Because the outro promises tomorrow, a part that fails its checks is tried
again (up to 3 times that day, then again the next day), and parts never skip
ahead: Part 3 never goes out before Part 2.

## What stays from the story format and our first series

Our first series lost viewers because each part leaned on the one before
(`pipeline/avoid.md`). So:

- **Each part is a complete story.** Its question is asked and answered in that
  part. A viewer who has never seen another part follows it, and the cold
  viewers (stage 4) see only this part.
- **The first lines say who the lead is and where**, every part, as if for the
  first time.
- **No "previously", "last time" or "episode",** and no event from another part.
  What carries over is the lead, the place and how they look.
- **No title card.** The first frame already shows the odd thing.
- Everything else in `pipeline/formats/story.md`: one narrator, one action per
  drawing, at most two characters per drawing, a named camera per shot,
  markers that tell characters apart, the answer shown and said in the same
  shot, never gore, never selling.

## What a longer part needs

At 35 seconds a story is a question and an answer. At 60 to 120 seconds it
needs a middle that earns the time, or viewers leave:

- **More tries, each stranger than the last.** The lead tries two or three
  things to find out, each turning up a new clue, never repeating one.
- **Something new every 2 to 3 seconds** (stage 4's 3-second slices still apply),
  so 20 to 50 shots.
- **One small turn at the midpoint** that raises the question, never a second
  mystery.
- **The answer lands in the last 20 seconds,** then a short after-beat, then
  the outro.

## Checked by code

| Requirement | Check |
|---|---|
| 60 to 120 s of story | stage 4 script length, stage 6 video length (plus the end card) |
| 20 to 50 shots | stage 4 shot count |
| Outro says "Part N+1 ... tomorrow" (not in the last part) | `seriesChecks`: the last shot's line |
| Part number only in the outro | `seriesChecks`, and the standalone check with the outro removed |
| Lead and place named in the first 2 lines | `seriesChecks` |
| Lead keeps her marker in every drawing; the guest's is drawn | `seriesChecks` |
| Ends the way the brief locks it | `seriesChecks` (stage 4) and `seriesIdeaCheck` (stage 2) |
| No other part's story mentioned | `seriesChecks` |
| Caption carries the series tag | `seriesChecks` |
| Parts in order, one a day, retried rather than skipped | `nextEpisode`, `seriesForSlot` |

## Known costs

- A 1 to 2 minute part has about 2 to 3 times the drawings and voice of a 35
  second story, so it costs about 2 to 3 times the Claude use.
- Facebook Page Reels are 90 seconds at most, so a part over 90 seconds is
  refused there (logged, never retried). Instagram and YouTube Shorts take it.
