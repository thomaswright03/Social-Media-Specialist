# Stage 5: Production

Art, voice, music and captions, compared with the best Reels from stage 1.

How a Reel is made (`social produce`, `src/pipeline/produce.ts`):

- **Voice:** an upbeat ElevenLabs narrator (Liam, on v3's most expressive
  setting, Thomas's pick 2026-11-19) reads the whole script in one take, cut back into each shot's line (with the lines
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
- **Motion kit (explainers):** instead of drawings, Claude picks one ready-made
  animated piece per shot (title, news card, counter, bars, line, compare,
  quote, list, icon, timeline, waffle, people, coin stack, flow, split bar,
  calendar, stock ticker, meter, phone chat, stamp) and fills it in as JSON
  (the "motion" prompt);
  the pieces are built once in `pipeline/motion/runtime.js` with proper
  easing, readable by 0.6 s, over a moving background, and shots whip or zoom
  into each other. Code checks the plan (`src/pipeline/motion.ts`): every
  shot has 1 or 2 valid pieces, every figure on screen is one the script
  says, and no kind of piece is used twice in a Reel (Thomas, 2026-11-20).
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
- the look sheet has its six headings and a SHOT BY SHOT line for every shot (asked again up to 3 times, then the best one is used);
- every shot has a drawing that passed the checks, and every line was voiced;
- the cold viewer's PICTURES line names no frame whose picture doesn't show what the voice says;
- a cold viewer who sees one frame of every shot with what the voice says
  over it retells the story right and isn't confused;
- key frames from our video and from at least 2 benchmark Reels, side by side;
- a judge (Claude looking at the images, or Thomas) scores art, text
  readability, voice and sound from 1 to 5 for both;
- ours is not worse than the benchmark on any of them. If it is, that is
  fixed before anything else;
- every learned check for stage 5.

<!-- prompt -->
You are judging stage 5 of a Reel pipeline: is our finished Reel as good as the Reels people already choose to watch?

Your scores decide whether it ships, and your fixFirst note is what gets fixed if it doesn't. A generous score ships a weak Reel. A harsh one sends good work back. Be strict, and make every point you take off stand on something you can point to.

<frames>
{{FRAMES}}
</frames>
- Ours: one frame from every shot, in order.
- The benchmark: the cover image of each benchmark Reel. A cover is the one frame its maker chose to represent it.

<audio_notes>
{{AUDIO_NOTES}}
</audio_notes>
You cannot hear anything. Judge voice and sound only from these notes. If the notes don't cover something, don't assume it is good or bad. For the benchmark you have only an assumed description: score it from that description as written, and don't move it on a guess.

Score ours and the benchmark from 1 to 5, in whole numbers, on the four things below. Score each against the levels as written, not against the other side, and use the same levels for both.

ART (the pictures)
Look for: can you tell in half a second who is there, where they are and what is happening? Do the people, places, colours and light stay the same from frame to frame? Is there depth and one lit centre of attention? Is anything broken: limbs that don't join, objects that float, empty bands, things cut off?
5: every frame could be a cover. Instantly clear, consistent throughout, nothing broken.
4: clear and consistent. One or two frames are plainer than the rest, and nothing looks wrong.
3: readable but uneven. Some frames are flat or sparse, or people and places shift between frames, or one frame is visibly broken.
2: several frames are hard to read or visibly broken.
1: in most frames you cannot tell what is happening.

READABILITY (the text on screen)
Look for: is it big enough to read on a phone? Does it stand out from what is behind it? Is it inside the frame and clear of faces and the action? Is it short enough to read in the time one shot gives?
5: every piece of text is big, clear, well placed and short.
4: all of it can be read; one piece is a little small, faint or long.
3: one piece is hard to read, or sits over a face or the action.
2: several pieces are hard to read.
1: most of it cannot be read, or it is missing where it was needed.

VOICE (from the notes)
Look for: is every line there, clear over the music and effects, at a natural pace, with nothing cut off?
5: everything in the notes is on target.
4: one small miss a listener might not notice.
3: one clear miss a listener would notice.
2: several clear misses.
1: the voice is missing or mostly cannot be followed.

SOUND (from the notes)
Look for: is the loudness on target? Does the music stay under the voice? Do the effects land on the actions? Is there silence where sound was meant?
5: everything in the notes is on target.
4: one small miss a listener might not notice.
3: one clear miss a listener would notice.
2: several clear misses.
1: the sound is missing or gets in the way.

Write `seen` first, then the scores, then `fixFirst`.
- `seen.ours`: two sentences on what our frames show at their best and at their worst, naming shot numbers.
- `seen.benchmark`: one sentence on what the covers show.
- `fixFirst`: the one change that would close the biggest gap. Name the score, the shots, what is wrong and what to do instead. If we are level or ahead on all four, name the weakest thing still worth fixing.

Reply with only JSON: {"seen": {"ours": "...", "benchmark": "..."}, "ours": {"art": 3, "readability": 4, "voice": 2, "sound": 3}, "benchmark": {"art": 4, "readability": 4, "voice": 4, "sound": 4}, "fixFirst": "..."}
<!-- /prompt -->

<!-- look -->
You are the art director of an animated Instagram Reel.

The Reel is drawn one shot at a time. Each shot's artist sees your look sheet, their own shot and the two shots either side, and nothing else. Whatever you leave open, a dozen artists will each decide differently, and the Reel will look like a dozen different films. Your look sheet is the only thing that makes it one.

<shot_list>
{{SHOTS}}
</shot_list>

<style>
{{STYLE}}
</style>
The style is fixed. Choose inside its ranges; never change or contradict it.

How every frame is laid out, so you can plan for it:
- The canvas is 1080 wide and 1920 tall.
- Everything that matters (faces, hands, the key object) sits between y 330 and y 1250.
- Above y 330 is wall, sky or ceiling. Below y 1260 is floor, ground, table top or shadow.
- Code lays captions and labels on top. Leave them out of the look sheet.
- A standing adult at normal size is about 1000 px tall. Give sizes against that.

Write the look sheet under the six headings below, in this order. Be exact, like a model sheet: hex codes for colours, pixels for sizes, and left / centre / right and near / far for positions. Never "warm", "big" or "nearby". Take the names of people, objects and places from the shot list and spell them the same way every time.

PALETTE
Six to eight colours in all, counting the style's own. For each: its hex code and its one job (back wall, floor, key light, and so on). One accent colour, and the one thing it is saved for. Every shot uses these colours and no others.

LIGHT
For each place: the one thing the light comes from, exactly where it sits in that place, its colour, and which way shadows fall. It stays there in every shot unless the shot list moves it.

CHARACTERS (write "none" if the shot list has none)
For each character:
- an id: c- and a lowercase name (c-mia, c-mayor). Every shot will use it.
- who they are, in a few words.
- the ONE thing on or by the head that tells them apart at a glance, with its shape and colour (a ponytail, a flat cap, round glasses, a bow, floppy ears). If the shot list already gives them one, use that.
- height: adults full height, children about two thirds.
- anything on the body (a sash, a tie, an apron): thin and in a muted colour, never a big block of the accent colour.
- which side of the frame they stand on when two characters share a shot. They keep that side for the whole Reel unless the shot list moves them.

OBJECTS (props, recurring objects and graphics)
For each thing that appears in two or more shots, or that the Reel turns on:
- an id: p- and a lowercase name (p-ledger).
- its exact shape, its size in pixels, and its colours from the palette.
- the one detail that makes it obviously that thing.
- if it changes during the Reel (closed then open, empty then full), what each state looks like.

PLACES
For each place, under the name the shot list gives it:
- three to five landmarks, each with where it is (left, centre or right; near or far) and its colour.
- where the floor meets the wall, or the ground meets the sky, as a y value in a wide shot.
- what is at each side, so a shot facing the other way still shows the same place.

SHOT BY SHOT
One line for every shot: its number, its camera, which landmarks are behind the action, and where the light falls in the frame. Neighbouring shots in the same place show different parts of it. Every line agrees with PLACES and LIGHT: a close-up facing the door shows the door's wall, not the window's.

Plain text, under 600 words. No story, no captions, no advice: only what an artist needs in order to draw.
<!-- /look -->

<!-- cast -->
You draw the cast of an animated Instagram Reel once, as reusable pieces.

Each shot's artist will place your pieces at anything from about half size (a wide shot) to four times size (a close-up), sometimes mirrored, and will then draw the face and the stick body themselves. So every piece has to read at any size: bold, simple shapes, no detail smaller than 8 px, no stroke thinner than 4 px.

<look_sheet>
{{LOOK}}
</look_sheet>

<shot_list>
{{SHOTS}}
</shot_list>

Reply with one SVG, with everything inside <defs> so the sheet itself draws nothing:
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920"><defs> … </defs></svg>

Characters. For each character in the look sheet, one group: <g id="c-NAME" data-note="...">
- Use the look sheet's id exactly (lowercase letters and hyphens, such as c-mia or c-mayor).
- The head is a filled white circle of radius 70 centred on 0,0, with the neck coming down to 0,70. The shot attaches the body there.
- Add everything on or by the head that tells this character apart (hair, a hat, ears, glasses, a bow, a collar), in the look sheet's shapes and colours.
- Keep the face clear. Nothing covers the area from x -45 to 45 and y -30 to 45, where the shot draws the eyes, brows and mouth. Glasses are frames only, so the eyes show through.
- No eyes, brows or mouth: each shot draws those for the feeling it needs. No body: each shot draws the stick body in its own pose under the neck.
- It must still be right when mirrored: no letters or numbers on a head piece.
- data-note says who they are and what the group holds, for example "Mia, a girl, two thirds height: head, brown ponytail, red bow".

Props. For each object in the look sheet that appears in 2 or more shots, one group: <g id="p-NAME" data-note="...">
- Use the look sheet's id exactly.
- Draw it at its real size next to a character (the head circle is 140 px across, and a standing adult is about 1000 px tall).
- It stands on 0,0: its bottom centre is the origin.
- Include the detail that makes it obviously that thing, as the look sheet describes it.
- If the look sheet gives it two states, draw each as its own group (p-box-closed, p-box-open).
- data-note says what it is and its size, for example "the cash box, lid closed, 220 wide and 140 tall".

Drawing rules:
- Flat vector, in the look sheet's colours and no others. Soft gradients are allowed: define them inside <defs> too, with ids starting g-.
- Every id is unique and starts with c-, p- or g-.
- Under 12 KB. Round coordinates to whole numbers and prefer simple shapes to long paths.
- Not allowed: <script>, <image>, <foreignObject>, event handlers or outside links.

<last_refusal>
{{PROBLEMS}}
</last_refusal>
If a refusal is given above, fix exactly that and keep everything else.

Before you answer, check: every character in the look sheet has a c- group, every id matches the look sheet, and nothing is drawn outside <defs>.

Reply with only the SVG.
<!-- /cast -->

<!-- art -->
You draw one shot of an animated Instagram Reel as an SVG, the way a great cinematographer would frame one moment of a film.

The shot is on screen for two or three seconds, on a phone, between shots drawn by other artists from the same look sheet. Two things decide whether it is good:
- A stranger reads it in half a second: who is here, where they are, and the one thing happening.
- It looks like part of the same film as its neighbours: the same people, the same place, the same light.

<style>
{{STYLE}}
</style>
The style is the same in every shot. Follow it exactly.

<look_sheet>
{{LOOK}}
</look_sheet>
Follow the look sheet exactly: its colours and no others, its light where it says, its people and objects as it describes them, and its SHOT BY SHOT line for this shot as your background.

<cast>
{{CAST}}
</cast>
Use a cast piece wherever one exists for a person or object in this shot. Never redraw by hand something the cast already has, and never use an id that is not in the list.

THE SHOT

<shot>
Shot {{N}} of {{TOTAL}}, {{SECONDS}} s
Camera: {{CAMERA}}
Place: {{PLACE}}
What happens: {{VISUAL}}
</shot>

<story_around_it>
{{CONTEXT}}
</story_around_it>
The neighbours are for continuity only. Keep people on the side of the frame they were on, objects in the state they were left in, and the light where it was. Draw only this shot's moment, and show a different part of the place from the shot before.

FRAMING

Frame it the way this shot's camera says. If the style gives its own framing for a camera, follow the style.
- wide: the whole place and everyone in it, characters about a third of the frame tall. This is where the viewer learns where we are, so the place's landmarks are in view.
- medium: one or two characters from the knees up, big (head scale 1.3 to 1.8), the place behind them.
- close-up: one face fills the upper half of the frame (head scale 3 to 4). The feeling is the shot.
- over-the-shoulder: the back of one character's head and shoulder, big, in shadow and with no face, in the foreground. The other character faces us across from them, in the light.
- low angle: we look up at someone big and powerful. The ground line is low and tilts.
- high angle: we look down on someone small. The ground fills most of the frame and tilts.
- insert: the one prop, object or number that matters, huge and detailed. At most a hand comes into the frame.

COMPOSITION

- One action, one feeling. Show the action itself happening (the envelope halfway under the door, the lid lifting), never figures standing still. Add nothing that changes what the moment means.
- When two characters share the shot they react to each other: they face each other, their eyes meet or one looks away, a hand points, gives, takes or reaches.
- The key thing is lit. The brightest, sharpest part of the frame is the action, and the frame gets darker and plainer away from it.
- Build it back to front: the far background, the middle of the place with its landmarks, the light, the shadows on the ground, the characters and props, then anything in the near foreground.
- Give it depth: far things are smaller, darker and plainer, and near things overlap far ones.
- Everything is attached and grounded. A body starts at its head's neck point. Arms and legs bend at the elbow and the knee and join the body. A hand touches what it holds. Feet stand on the ground. Every person and object has a shadow where it meets a surface.
- Faces: draw the eyes, brows and mouth for the feeling this shot names, big enough to read at this size, and shifted toward the side the character is looking.
- Fill the whole canvas, top to bottom. No empty bands.

CANVAS AND SAFE ZONES

Start with: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
- Everything that matters (faces, heads and hats, the hands doing the action, the key prop) sits between y 330 and y 1250.
- Code lays the big caption over y 1270 to 1500. Below y 1260, draw only floor, table top, ground or shadow: nothing anyone needs to see.
- The top 330 px is wall, sky or ceiling. Instagram's buttons and a small text label sit there.

TEXT

- Don't write these words; the caption adds them: {{OVERLAY_TEXT}}
- {{IN_WORLD}}
- Text that is part of the world (a sign, a price, a clock) is fine: at least 48 px, inside x 80 to 940, between y 340 and 1250, spelled exactly as the shot gives it.

MOTION

Add 2 to 4 CSS @keyframes animations, in a <style> inside the SVG, that make the action move within {{SECONDS}} seconds.
- One of them is the action itself: the arm handing over, the head turning, the lid lifting. The others are small signs of life: a blink, steam, leaves blowing, a sign swinging.
- Put each moving part in its own group, with transform-box: fill-box and a transform-origin at its joint (the shoulder for an arm, the neck for a head).
- Keep each move small enough that nothing comes apart, leaves the y 330 to 1250 zone or covers a face.
- The drawing has to read at every moment of the motion, because any one frame may be pulled out and judged on its own.

LIMITS

- Under 30 KB. Round coordinates to whole numbers.
- Draw a finished scene. The code accepts as few as 6 shapes, but that is a floor, not a target.
- Not allowed: <script>, <image>, <foreignObject>, event handlers, external links or fonts.

<last_refusal>
{{PROBLEMS}}
</last_refusal>
If a refusal is given above, fix exactly that and keep what worked.

Before you answer, check:
1. Cover everything but the picture. Is it clear in half a second who, where and what?
2. Is everything that matters between y 330 and y 1250, with nothing needed below y 1260?
3. Does every body join its head, every hand reach its object, and every foot touch the ground?
4. Is every colour from the look sheet, and every cast id from the list?

Reply with only the SVG, starting with <svg and ending with </svg>.
<!-- /art -->

<!-- motion -->
You are the motion designer for a vertical Instagram Reel (1080x1920). A narrator speaks over one animated graphic per shot. The graphics are ready-made pieces, built and animated in code with proper easing; your job is to pick the right piece for each shot and fill it in.

<style>
{{STYLE}}
</style>

<shot_list>
{{SHOTS}}
</shot_list>

The pieces (every field not marked optional is required):
- title: {"kind":"title","text":"WAIT, WHAT?","highlight":"what"} Big words that drop in one by one. At most 40 characters; highlight (optional) is one word shown in lime. For a hook or a turn, never to repeat the voice word for word.
- headline: {"kind":"headline","publisher":"NPR","text":"…","date":"Nov 17"} A news card that drops in. Use the publisher and headline as the shot gives them. At most 110 characters.
- counter: {"kind":"counter","to":3.1,"from":0,"prefix":"","suffix":"%","label":"egg prices this month"} A big number that counts up with a ring filling around it. from is optional (default 0). label at most 40 characters.
- bars: {"kind":"bars","title":"…","items":[{"name":"2024","value":3.2},{"name":"2026","value":4.2}],"highlight":1,"prefix":"$","unit":""} 2 to 5 bars that grow from zero, values counting. highlight (optional) is the bar's index from 0; default the last. Names at most 18 characters.
- line: {"kind":"line","title":"…","points":[{"label":"Jan","value":2.1},{"label":"Nov","value":4.2}],"prefix":"$","unit":""} A line that draws itself, ending on the last value in big type. 2 to 8 points, labels at most 10 characters.
- compare: {"kind":"compare","left":{"name":"Before","value":"$59"},"right":{"name":"Now","value":"$80"},"highlight":"right"} Two cards slide in with VS between. A value may be a number (it counts up) or short text, at most 9 characters.
- quote: {"kind":"quote","text":"…","who":"the company"} Words appear one by one. At most 120 characters, copied from the shot exactly.
- list: {"kind":"list","title":"…","items":["…","…"]} 2 to 4 items that tick in. Each at most 30 characters.
- icon: {"kind":"icon","name":"phone","label":"…"} One big icon that draws itself, with a ripple. name is one of: {{ICONS}}. label at most 30 characters.
- timeline: {"kind":"timeline","items":[{"date":"2023","label":"…"},{"date":"Nov 2026","label":"…"}],"highlight":1} 2 to 4 dates on a line; the highlighted one pulses.
- waffle: {"kind":"waffle","percent":5,"label":"of shares to the fund"} A 10 by 10 grid of squares that lights up to the percent. For a share or a part of a whole.
- people: {"kind":"people","count":1,"of":10,"label":"Americans own stock"} A row of people figures, count of them lit. of is 2 to 20. For "1 in 10" and "half of all".
- stack: {"kind":"stack","to":80,"prefix":"$","suffix":"B","label":"fund value"} Gold coins pile up while the total counts. For an amount of money.
- flow: {"kind":"flow","from":"Anthropic staff","to":"Charity","value":"$80B"} Money or things pour from one name down into another. value (optional) at most 9 characters, names at most 22. For who gives what to whom.
- split: {"kind":"split","title":"…","parts":[{"name":"The fund","value":5},{"name":"Everyone else","value":95}],"unit":"%","highlight":0} One long bar that splits into 2 to 4 coloured parts, with a legend. For how something is divided.
- calendar: {"kind":"calendar","month":"Nov","day":"20","weekday":"Thursday","label":"IPO day"} A desk calendar flips to the date. Give day or weekday (or both). For when something happens.
- ticker: {"kind":"ticker","name":"ANTHROPIC","value":"$156B","change":"+12%","label":"valuation"} A stock-market card with a chart that draws itself and a scrolling tape; change starting with - turns it red. For a price, a valuation or a market move.
- meter: {"kind":"meter","value":81.3,"of":156,"prefix":"$","unit":"B","label":"raised so far"} A thermometer that fills toward a goal. For progress toward a target.
- chat: {"kind":"chat","title":"Messages","messages":["Wait, how much?","$156 billion."]} A phone with 1 to 3 text bubbles popping in (each at most 40 characters). For a question people are asking or a reaction.
- stamp: {"kind":"stamp","text":"APPROVED","title":"IPO filing","color":"green"} A rubber stamp slams onto a document. text at most 12 characters; color red (default) or green. For a verdict, a ruling or a big yes or no.

How to choose:
1. The picture proves what the voice says in that shot. A shot that says a number shows that number (counter, bars, line, compare). A shot that says who did what shows the news card or an icon of the thing. A shot that says what changes for the viewer shows a compare or a list.
2. Every figure on screen comes from that shot's own visual or line, exactly as written there. Never round, never add a number the script doesn't say. Code checks this.
3. One piece per shot, two only when the shot really needs both (a headline over a counter). Every kind of piece is used at most once in the whole video, so no picture repeats (there are 20 kinds; a video has at most 14 shots). Once a kind is used, pick the next best kind for the next shot: a percent can be a counter, a waffle, a split or people; money can be a counter, a stack, a meter, a ticker or a flow. Code checks this.
4. The first shot grabs: its piece is the most surprising thing in the video, usually the number.
5. Words on screen add to the voice; the voice is already captioned at the bottom. Labels are a few words, not sentences.
6. bg sets the mood: navy (default), red (bad news, a warning), green (good news, money saved), gold (money, records), slate (serious). Change it only when the mood turns.
7. transition is how the shot comes in: whip (default, fast slide), zoom (a reveal or a big turn), flash (a shock), cut (the same idea continuing).

<last_refusal>
{{PROBLEMS}}
</last_refusal>

Reply with only JSON: {"shots":[{"shot":1,"bg":"navy","transition":"cut","pieces":[{…}]}, …]}, one entry for every shot in the list, numbered as there.
<!-- /motion -->

<!-- physics -->
You are making a satisfying Instagram Reel (1080x1920, {{SECONDS}} seconds, no voice) as a real physics simulation, like the leading satisfying physics accounts: glowing balls and rings on a dark background, one continuous shot, and every bounce plays a note. Code runs the physics and makes the music; your job is to pick the scene that best tells this video's story and fill in its settings.

<story>
{{STORY}}
</story>

<shot_list>
{{SHOTS}}
</shot_list>

The scenes (every field not marked optional is required):
- escape-rings: {"kind":"escape-rings","rings":8,"gap":34,"balls":1,"counter":"{n} RINGS LEFT"} Spinning rings inside each other, each with a gap; a ball bounces inside and breaks out ring by ring. rings 3 to 14, gap in degrees 18 to 70 (smaller is harder), balls 1 to 4. The finish: the last ring breaks.
- growing-ball: {"kind":"growing-ball","counter":"{n} BOUNCES"} One ball bounces inside a circle and grows a little on every bounce until it fills the circle. The finish: it fills it.
- multiply: {"kind":"multiply","balls":150,"counter":"{n}% FULL"} One ball; every ball that hits the wall makes a new one, so the count doubles faster and faster until the balls fill the whole circle. balls 60 to 250 (more means smaller balls). The finish: the circle is full.
- race: {"kind":"race","balls":4,"names":["Green","Pink","Blue","Yellow"]} 2 to 4 coloured balls race down a field of pegs, three laps; the first to finish wins. names are the colours in order (green, pink, blue, yellow on neon). The counter shows the lap, then the winner.

Every scene also takes palette (optional): neon (default), sunset, ocean or candy.

How to choose:
1. The scene whose finish is the story's payoff, something the viewer roots for. Getting free is escape-rings; filling it up is growing-ball or multiply; a contest the viewer picks a side in is race.
2. The counter (optional) is short words with {n}, at most 24 characters, in capitals, counting toward the finish. It sits near the top for the whole video.
3. Code runs the scene and moves its timing so the finish lands between 55% and 90% of the video. If it can't, it tells you, and you change the settings.

<last_refusal>
{{PROBLEMS}}
</last_refusal>

Reply with only the JSON of one scene.
<!-- /physics -->

<!-- follow -->
These are frames from a short Instagram Reel, one per shot, in order, with what the voice says over each:

{{WATCHED}}

Look at every image. You have watched it once, as a stranger. Go only by what the pictures show and the voice says: if something isn't shown or said, you don't know it.

In two plain sentences, tell a friend what happened and who it was about.
Then, on a new line, write CONFUSED: and what didn't make sense, or CONFUSED: nothing.
Then, on a new line, write PICTURES: and the number of each frame where the picture doesn't show what the voice is saying, or PICTURES: fine.
<!-- /follow -->
