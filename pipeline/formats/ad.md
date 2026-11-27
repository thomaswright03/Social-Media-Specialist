# Format: product ad (20% of Reels)

One product from wright-ai-solutions.com, advertised to the people who would
use it. Thomas, 2026-11-20, after the first test ad:

1. "The ad is for individuals regulating their daily consumption and no one is
   gonna eat straight ice cream": the ad speaks to the product's real users,
   in situations they really live.
2. "Ads should not have stickmen in them they should only be like the
   informational entertainment ads with slides and transitions but it will
   inform people about the app": the explainer's motion graphics, plus the
   product's own screens (the motion kit's `app` piece).
3. "We are advertising people to use the calorie app. not offering to make
   apps": the ad sells the product, never custom software (code checks this).

Thomas, 2026-11-20, on the hook: "Maybe start a hook with 'Are you trying to be
healthy, but don't want to pay for an expensive calorie tracking app? Good! Cus
we made one for free. No sign up, no payment! Here's how it works...'". So the
ad runs: the viewer's question, "Good, we made one", what it costs (only what
the product's page says), then "here's how it works" on the product's screens.

Thomas, 2026-11-27, after reading the ads it wrote: "the scripts for the ads
have been terrible. Especially the hooks" and "we need to make the scripts
muuuch simpler for the ads. they are very poorly worded." The ads it wrote
opened on fragments ("Junk removal, hands full." / "Ever finish a bathroom?
And hear 'different'?"), split sentences across shots, and used lines that
only made sense with the picture ("Answer none.", "Still carrying"). So an ad
is now a fixed, plain template: one whole question, "Good! We made [it]", what
it is, "Here's how it works", three steps, what's easier, "link in bio". Every
line is one short, whole sentence, and code checks it (`adWordingChecks` and
`adOpeningChecks` in src/pipeline/formats.ts). Each product's opening question
is pinned in `AD_HOOKS`.

<!-- ideas -->
Format: an ad. It advertises ONE product (below) to the people who would use it. It never offers to build software, apps or AI agents for anyone.

Who it's for: read the product's description below and decide who really uses it. A calorie and weight tracker is for an ordinary person keeping an eye on what they eat each day, not a business. A lead tool for haulers is for the hauling company. Speak to that person as "you".

What you are pitching: a short, plain ad, about 30 to 35 seconds. It is clear first: a viewer should understand every line the first time they hear it. Every ad has the same shape, so the pitches differ only in which real features they show:
- The question: one whole, plain question the viewer would answer "yes" to, about what they want and the catch that stops them.
- "Good! We made [the product]": what it is, and what it costs, only as the product's page says it.
- "Here's how it works": three simple steps, shown on the product's own screen.
- What is easier for the viewer afterwards.

A pitch's `sentence` is the question, as one whole sentence of 12 words or fewer that ends with "?". Its `answer` is the product settling it: the product's exact name, what it is, and the three steps it shows, in plain words.

Test every pitch before you offer it:
1. Plain test. A 12-year-old would understand every word of it the first time.
2. Real-life test. This is how the product's real users live and use it. Nothing silly or extreme (no one eats a tub of ice cream for lunch).
3. Feature test. The steps are real features of this product, from what is given below.
4. Honesty test. Nothing in the pitch is something the product can't do, and no result is claimed that the product's page doesn't claim.
5. Sells-the-product test. It invites the viewer to use the product. It never offers to build an app, software or AI agents.

Pitches that fail:
- A clever, punny or mysterious question. Plain beats clever.
- A list of every feature.
- A made-up scene or person the ad is about ("a hauler carrying a couch while three leads text"). The ad speaks to the viewer ("you").
- A made-up customer praising the product. That is an invented review.
- Anything about businesses, when the product is for individuals.
<!-- /ideas -->

<!-- script -->
Format: an ad. It advertises ONE product (below) to the people who would use it. Name no other product. Never offer to build software, apps or AI agents for anyone (code checks this).

The most important rule: keep it simple. Write the way you would explain the product to a friend across the table. Every line is one short, whole sentence that a normal person would say out loud. A viewer understands each line the first time, with the sound on and without looking at the screen. If a line makes anyone think twice, rewrite it plainer.

How this video is made: one narrator's voice plays over bold motion graphics, one per shot, with transitions between them. Some shots are the product's own screen on a phone. There are no characters and no stick figures.

The script, shot by shot. Follow it exactly. This replaces the general advice about telling a story, writing 80 to 110 words, and cutting sentences into pieces:

1. The opening: ONE shot, 3 to 4.5 seconds. The narrator asks the question, whole, as one sentence that ends with "?". If a question is given below for this product, say exactly that question. Otherwise write one: 12 words or fewer, to "you", naming what the viewer wants and the catch that stops them. Its `onScreenText` is the question's key words (5 words at most). The picture shows the problem the question names, plainly.
2. "Good! We made [the product's exact name]."
3. What it is and what it costs, in one or two short sentences, only as the product's page says it ("It's a free calorie counter. No sign-up, no payment.").
4. "Here's how it works."
5, 6, 7. Three steps, one per shot, on the product's screen. Each is one short sentence about what you do or what it does ("Type in what you ate." / "It adds up your calories." / "You see your total for the day.").
8, and 9 if you need it. What is easier for you now, in one or two short sentences. This is the `payoff`.
Last. The call to action: "Try [the product]. Link in bio." Add "It's free." first only if the page says it's free.

That is 10 to 12 shots and 30 to 40 seconds in all, with the opening.

How every line is worded (code checks the first five):
- Every `line` is a whole sentence: it starts with a capital letter and ends with ".", "!" or "?". Never split a sentence across two shots.
- No sentence is longer than 10 words (the opening question: 12).
- The whole narration is 45 to 80 words.
- Everyday words a 12-year-old knows. No jargon.
- `onScreenText` uses the words of its own shot's line (the key 2 to 5 of them), so what you read is what you hear.
- No wordplay, puns, slogans, riddles or made-up phrases. No lines that only make sense with the picture.
- No made-up scenes, people or stories. Talk to the viewer about their problem and the product.
- Say the product's name in "Good! We made ..." and in the last line. Say Wright AI Solutions at most once, only as who made it.

Bad lines, from ads that were rejected (don't write anything like them):
- "Junk removal, hands full." (no verb, nobody says this)
- "Ever finish a bathroom?" then "And hear 'different'?" (one question split in two, and unclear)
- "Answer none. It texts them back itself." (a riddle)
- "Meanwhile, you keep carrying that couch!" (a made-up scene)
Good lines:
- "Are you losing leads because nobody texts them back fast?"
- "It texts every new lead back for you."
- "You see your total for the day."

Who it's for:
- Decide from the product's description who really uses it, and speak to that person as "you".
- Everything happens the way real life does: normal meals, normal days, normal amounts.

Honesty. Breaking one of these makes the ad false:
- Only claims the product's page makes. A number about the product (time saved, a price) is said only if the page says it, and exactly as the page says it.
- On screen, the product does only what it really does, with the words a real screen of it would show.
- Example entries on its screen (a meal and its calories, a weight) are ordinary and realistic, and are shown as an example of what you'd log, never as a fact about food or health.
- No reviews, no testimonials, no customer quotes, no "#1", no guarantees, no health or weight-loss promises.

The narrator:
- A friendly, confident explainer talking to the viewer. Upbeat, never silly.
- Speaks from the first second and in every shot.

The graphics (`visual`):
- Each shot shows ONE graphic that shows its line: a big number, a before-and-after compare, a short list ticking in, an icon of the thing (a plate, a phone, a clock), a goal meter.
- Every `visual` stands on its own. Say what kind of graphic it is, its exact values and labels, and which one part is highlighted.

The product's screen:
- The three steps are the product's screen on a phone, each showing a different moment of the feature working.
- Give the exact words on the screen in `visual`, in quotes: the screen's name, at most 3 short rows of a label and a value ("Oatmeal: 320 cal"), and, if it has one, the goal with its number ("1,240 of 1,800 cal") and one button ("+ Add food").

Numbers:
- Every number is on screen as it is said.

The camera, used as graphic moves:
- `camera` is exactly one of: wide, medium, close-up, over-the-shoulder, low angle, high angle, insert.
- The product's screen is always an insert. close-up: one number. wide: a whole list or compare.
- Change the camera on every cut, and use at least three kinds.

Other fields:
- `place` is the graphic space ("the slides", "the phone"). One or two in the whole video.
- `story` says in two plain sentences what the product does for the viewer and how.

The caption:
- The first line is the opening question, alone (125 characters at most).
- Then one plain line: the product's name and what it does for you. Then "Link in bio", then on the last line 3 to 5 hashtags its real users follow (for a calorie counter: #calorietracking, not #smallbusiness).
<!-- /script -->

<!-- style -->
Bold, friendly motion graphics, like a sharp product explainer. Each shot is watched on a phone for two or three seconds, so each graphic makes one point and makes it huge. No characters and no stick figures.

Background:
- Deep navy to black (#0b1020 to #121a33) with a faint grid, edge to edge.

Graphics:
- Big flat shapes, thick clean lines, and simple icons built from geometry.
- Depth comes from layered cards with soft drop shadows, not from perspective scenes.

The product's screen:
- A light phone screen with the product's name at the top, its rows and goal drawn big and readable, labels at least 36 px tall, with the words exactly as the shot gives them.
- One thing on the screen is the point. It is highlighted in lime.

Numbers and labels:
- Drawn huge in a heavy sans-serif (generic sans-serif, weight 900, no external fonts), with the key number at least 120 px tall.
- Inside x 80 to 940 and between y 340 and y 1250.

Palette, 2 or 3 colours in any one graphic:
- White for the base.
- Lime #a3e635 for the product's moment of success and for its buttons.
- Red #ef4444 only for the problem.
- Muted blue-grey #64748b for everything else.

Motion:
- Things slide in, count up, fill and highlight, each on a crisp ease-out.
- The highlighted part moves last, so the eye ends on it.
<!-- /style -->
