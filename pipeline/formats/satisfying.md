# Format: satisfying physics video (entertainment)

An oddly satisfying, loop-friendly physics simulation: glowing balls and rings
on a dark background, one continuous shot, every bounce a note (Thomas,
2026-11-20, after @CodeCraftedPhysics and @cutcountasmr). The picture and the
sound carry it. It never sells, and the caption says it was made with AI.

<!-- ideas -->
Format: a satisfying physics video. It is entertainment: no selling, no product, no business.

How it's made, which is why the rules below exist: code runs a real physics simulation of one of four scenes, about 35 seconds, one continuous shot with no voice, and every collision plays a note. The scenes:
- escape-rings: a ball bounces inside spinning rings, each with a gap, and breaks out ring by ring.
- growing-ball: a ball bounces inside a circle and grows on every bounce until it fills it.
- multiply: every ball that hits the wall makes a new one, so the count doubles faster and faster until the balls fill the whole circle.
- race: coloured balls race down a field of pegs for three laps; one wins.

Every video needs an end the viewer roots for (Thomas, 2026-11-20): the ball getting free, the colour they picked winning, the circle finally filling. Balls that only fall and stop give them nothing to hope for, and they scroll.

People watch these to the end because they can see what "finished" looks like and need to see it get there, and because they want to know who wins or whether it makes it. So the pitches that win share a shape:
- One scene, with a goal the viewer can see from the first second: rings to escape, a circle to fill, a race to win.
- One doubt or bet: will it get out, which colour wins, will it really fill the whole thing.
- A hook question on screen that makes the viewer pick a side or guess ("Which colour wins?", "How many bounces to fill it?").

A pitch is one sentence that names the scene, its numbers and its last, best moment: "A ball has to break out of 12 spinning rings with tiny gaps; the last ring shatters with a full chord."

Test every pitch before you offer it:
1. Scene test. Is it one of the four scenes above, with numbers in their ranges?
2. Goal test. Would a stranger, with the sound off, know from the first frame what it is building toward?
3. Bet test. Does the hook make the viewer guess or pick a side?
4. Last-moment test. Is the finish the biggest moment?

Not a story: no characters, no faces, no dialogue.
<!-- /ideas -->

<!-- script -->
Format: a satisfying physics video. It is entertainment: no selling, no product and no business, in any field.

How this video is made, which is the reason for the rules below: there is no voice. Code runs one continuous physics simulation (escape-rings, growing-ball, multiply or race), and every collision plays a note. The shots are the beats of that one run, in order; stage 5 picks the scene and its settings from your story and shots, and the run's finish lands where your payoff is.

What each scene does, and nothing more. Code draws only this, so a story, hook or on-screen word that needs anything else (a rule, a meaning for the colours, a winner the scene doesn't have) can't be shown and fails at stage 5:
- escape-rings: one ball bounces inside spinning rings, each with a gap; it slips out ring by ring until it's free. The counter is the rings left.
- growing-ball: one ball bounces inside a circle and grows on every bounce until it fills it. The counter is the bounces.
- multiply: every ball that hits the wall makes a new one, in a random colour, until they fill the circle. The counter is how full it is, in percent. Colours mean nothing and nothing "wins" or "survives": the bet is whether, or how fast, it fills.
- race: 2 to 4 coloured balls drop through a field of pegs, three laps; the first to finish wins. This is the only scene with a winner, and the run decides it: never say in advance which colour wins, and never give a ball a role (underdog, leader, comeback). The story says "one colour wins"; the counter names it at the end. Name colours only from one set: green, pink, blue, yellow.

The run:
- One scene, with a goal the viewer can see from the first frame.
- Each shot is one stage of progress, with the count at its start and end ("4 of 10 rings broken; the ball slips through the fifth gap").
- It escalates: faster, closer, more crowded, toward the finish in the second-to-last shot. That finish is the `payoff`.
- The last shot settles and the run fades back to its first frame, so the video loops.

No narrator:
- Every shot's `line` is empty.

The sound:
- The music is made from the collisions: one note per bounce from an original chord loop, a chord on each big moment, the fullest chord on the finish. Each shot's `sound` says what is heard then ("notes speeding up", "a low chord as a ring breaks").

`visual`: say what is on screen: the scene, the counts, the colours, and what changes in that shot.

The camera: `camera` is one of: wide, medium, close-up, over-the-shoulder, low angle, high angle, insert. The run is one continuous shot, so it only labels the beat: change it on every cut and use at least three kinds.

On-screen text:
- The opening carries its hook, as stage 3 requires: a question that makes the viewer guess or pick a side.
- After that, at most 3 words, only where it adds tension ("ONE LEFT", "SO CLOSE"). A counter is already shown at the top for the whole video.

Other fields:
- `place` is the scene, named the same way in every shot.
- `story` says in two sentences which scene it is, its numbers, and how it ends.
- The caption says it was made with AI ("Made with AI"), asks one light question ("Which colour did you pick?"), then has 3 to 5 hashtags including #satisfying.
<!-- /script -->

<!-- style -->
Glowing neon physics on a dark background, like the leading satisfying physics accounts. Code draws it: smooth balls with a soft glow and a short trail, thick glowing rings or white pegs, a dark gradient behind. Palettes: neon (green, pink, blue, yellow, orange), sunset, ocean, candy. A white flash on the finish. Never characters, hands, faces or text in the world; the only words are the hook at the top and the counter under it.
<!-- /style -->
