# Stage 1: Research what wins

For each format (story, satisfying, explainer, ad), study two or three
accounts that make that kind of Reel, and find what their winning Reels do
that their average Reels don't.

**Why it compares.** An account's top Reels on their own show what that
account always does (its template), not why some Reels won. So each Reel is
scored against its own account: its views divided by what that account's
Reels were getting around the same time, the median of the 21 Reels it posted
nearest to it (its "lift"). Against the whole year's median, an account that
grew would have only its newest Reels as winners, and the comparison would
show how the account changed, not why a Reel won. A **winner** is in its
account's top quarter by lift, with a lift of at least 1.5. It is compared
with the same account's **average** Reels: the middle half, with a lift from
0.67 to under 1.5 (in an account where a few Reels run far ahead, the middle
half by rank reaches past 1.5, and the first real run had "average" Reels at
1.68 next to a winner at 1.79). Reels under 7 days old are left out (still
collecting views), and so are Reels over a year old.

**Who does what.**

| Step | Who | What |
|------|-----|------|
| Read the accounts | code (`src/instagram.ts`, Business Discovery) | up to 200 posts an account, fewer once it has 60 Reels to score: views, likes, comments, caption, date, the video file when Instagram gives it |
| Score and pick | code (`research-sample.ts`) | lift, winners and average Reels, up to 20 of each, taken from the accounts in turns, those with a video file first |
| Measure | code (`research-measure.ts`, `src/transcribe.ts`) | the caption; from the video: length, every cut, loudness; from the transcript (ElevenLabs speech to text): when the voice starts, words a second, shots with speech, the longest stretch where nothing changes |
| Label | Claude, blind (the `prompt` block) | what only eyes and ears can tell, chosen from fixed lists; it is never told how a Reel performed |
| Replace | code | accounts post other things too (a skit, a repost, an announcement): each Reel the reader says isn't the format is left out and replaced, once, by the next in line from the same group, up to 10 a group |
| Test our rules | code (`research-rules.ts`) | every rule stages 3 to 6 hold, counted on winners and on average Reels: backed (winners follow it 20+ points more often), against (20+ points less often), winners break it (under half of them follow it, average Reels about the same), no difference, or not enough data (under 5 Reels on a side) |
| Propose patterns | Claude (the `patterns` block) | up to 5 things winners do that our rules don't cover, from half of the Reels, each as a yes/no question |
| Check patterns | Claude, blind (the `check` block) | answers each question for the other half of the Reels, one by one |
| Keep or drop | code (`patternHolds`) | a pattern is kept only when it could be told for 5+ of those winners and 5+ of those average Reels, 3+ of the winners show it, they are at least half of those winners and come from 2+ accounts, and winners show it at least 25 points more often than average Reels |

Instagram gives the video only for some Reels: not when the sound is from its
music library, and not when the owner turned downloads off. The first real
run got a video for 3 of 24 Reels, so Reels that come with one are now taken
first. The rest are studied from their cover and caption, and the rules that
need the video don't count them. Comment text, saves and shares of other
accounts aren't readable.

Reading other accounts has an hourly allowance, shared by everything the app
does on Instagram, and it is small: the first test of 21 accounts was refused
after about 48 requests of 50 posts each, and a later test measured 13
requests as 15% of the hour. So a run reads no further back
than it needs, and reads no new account once Meta says 75% of the allowance
is used: that account is reported as not read, and the format fails its gate
rather than using the hour up. In a run of all four formats, the labelling
between two formats gives the allowance time to recover. Running the stage,
or `accounts-test`, several times within the hour may not.

Whether Instagram gives a Reel's video is itself a sign of its sound: it
withholds the file when a Reel carries copyrighted sound, most often music
from its library. When an account's winners and average Reels differ by 30
points or more in that, the report says so (`soundSigns`), for Thomas to
weigh against our rule that a Reel carries its own sound.

The numbers are small (20 Reels a group, 10 of each held back for the
check), so the report gives every count, says when a gap could still be
chance, and a pattern is a lead to try, not a law: stages 2 to 4 are told
so in those words.

What the first real runs changed (2026-11-20). The story run counted 19 of
19 average Reels as standing alone from their captions, while its reader
described several of them as "part 12 of a serialized story": the reader now
answers `series` for every Reel, and the rule counts that as well as the
caption. The explainer run lost 12 of its 40 Reels as not explainers (one
account posts mostly skits), which is why those are now replaced. And both
runs kept a pattern on 3 winners against 1 average Reel, so a kept pattern
must now be shown by at least half of the winners it wasn't drawn from.

**The accounts** are in `pipeline/research/accounts.json`, by format. A run
can name its own ("story: a, b; ad: c" in the workflow's accounts box).
`social accounts-test` reads the same accounts and says which of them this
stage could use: how many Reels it can score, how many winners and average
Reels, and how many come with a video file. It asks Claude nothing and saves
nothing, so it is the way to try an account before listing it.

**What later stages get.** Stages 2 to 4 read `researchBrief` for their
format: the rules winners follow clearly more often, the patterns kept, and
what a few winners were about. A rule the winners speak against, or one
most of them break, is never changed by this stage: it is shown to Thomas
(the run's report, the History, Hitta), and he decides.

**Gate (code, `gateResearch`):**
- at least 2 accounts could be studied, so one creator's habits don't pass for what wins;
- at least 6 winners and 6 average Reels of the format to compare;
- the videos Instagram gave were measured (the first run measured none: ffmpeg wasn't installed);
- every Reel was labelled, none was added, and every label is one of its choices;
- at least 5 of our rules have enough Reels behind them for a verdict;
- every pattern kept is shown by 3+ winners it wasn't drawn from, at least half of them, in 2+ accounts, and clearly more often than by average Reels.

## What each format means here

<!-- niche-story -->
short story Reels, stick-figure animation and comedy channels
<!-- /niche-story -->

<!-- niche-satisfying -->
oddly satisfying videos with no narrator: animated or AI-made loops, perfect fits, smooth transformations, precise motion
<!-- /niche-satisfying -->

<!-- niche-explainer -->
news and how-it-works explainers under a minute: one voice, bold graphics, fast transitions
<!-- /niche-explainer -->

<!-- niche-ad -->
short ads for software and AI products for businesses: one product, one problem it solves, one call to action
<!-- /niche-ad -->

<!-- account -->
our account is Wright AI Solutions (AI tools for small businesses), and its Reels should bring profile visits that lead to the website
<!-- /account -->

## Step 1: label (blind)

<!-- prompt -->
You are the Social Media Specialist. Stage 1, step 1 of 3: describe other creators' Reels so that code can count what they do.

Why: we are finding out what winning Reels do that ordinary ones don't. Code has already measured everything it can: length, cuts, loudness, the words and when they are said. What it can't do is look and listen. That part is yours. Code counts your answers across many Reels, so each answer has to come from a fixed list, and it has to describe what is actually in the frames and the words. You are not told how any Reel performed, on purpose. Describe each one the same way, and don't guess which did well.

The kind of Reel being studied: {{FORMAT}} ({{NICHE}}).

<reels>
{{REELS}}
</reels>

What you get for each Reel:
- `caption`: what the creator wrote under it.
- `open`: a picture file with three frames side by side, at 0.1 s, 0.5 s and 1.5 s.
- `shots`: a picture file with one frame from the middle of each of `shotFrames` shots, in order, left to right and top to bottom, four to a row.
- `cover`: Instagram gave no video for this Reel, so there is only its cover image.
- `transcript`: what is said, each line with the second it starts.

Open every picture file a Reel has with the Read tool before you answer for it. A field that isn't there wasn't available: leave out the answers that need it.

Answer with exactly the choices given. When you can't tell, answer "unclear", never anything else: an answer outside its list fails the check.

For every Reel:
- `onFormat`: is this the kind of Reel being studied? yes, no. Accounts post other things too: a behind-the-scenes clip, a repost, an announcement.
- `series`: is this Reel one part of a continuing series? part-of-a-series (its caption, cover, frames or words give a part, episode, chapter or day number, say "to be continued", pick up where an earlier Reel stopped, or send the viewer to the next one), stands-alone (nothing you were given marks it as a part).
- `premise`: one sentence saying what the Reel is about, in your own words.

When there is `open`, `shots` or `cover`:
- `art`: stick-figures, other-drawn, 3d-render, live-action, screen-recording, graphics.
- `lighting`: dark (mostly dark frames, lit from inside the scene), bright.

When there is only `cover`:
- `coverText`: the words on the cover, exactly as written, or "" when there are none.

When there are `open` and `shots`:
- `opening`: what the 0.1 s frame shows. action (something is already happening), face (a person looking at the camera), title-card (mostly a title or other text), blank (black or empty), graphic (a still chart, logo or diagram).
- `hookText`: the words on screen in the 0.5 s frame, exactly as written, or "" when there are none.
- `captions`: how the spoken words are shown as text across the `shots` frames. word-by-word (one to three words at a time), full-lines (a line or a sentence at a time), none.
- `captionPosition`: where those captions sit in the frame. top, middle, lower, none.
- `shots`: one entry for each frame in the `shots` picture, in order. Exactly `shotFrames` entries, each with:
  - `camera`: wide, medium, close-up, over-the-shoulder, low angle, high angle, insert (a close view of an object or a detail).
  - `people`: how many people or characters are in the frame. 0, 1, 2, 3+.
  - `place`: where it is, in two or three plain words ("kitchen", "office desk", "plain backdrop"). Use the very same words each time the place is the same.

When there is a `transcript`:
- `narrator`: who tells it. first-person ("I"), second-person (speaks to "you"), named-character (about someone with a name), third-person (about "he", "she", "a man"), several-voices (a conversation or an interview), none.
- `firstLineSaysWhoAndWhere`: does the first spoken sentence say who this is about and where they are? yes, no.
- `question`: the question the Reel makes a viewer ask, in a few words, or "" when it raises none.
- `answered`: where that question is answered. at-the-end (in the last quarter of the Reel), earlier, never, no-question.

{{GATE_FAILURES}}

Reply with only JSON, one entry for every Reel above and no others:
{"reels":[{"id":"r01","onFormat":"yes","series":"…","premise":"…","art":"…","lighting":"…","coverText":"…","opening":"…","hookText":"…","captions":"…","captionPosition":"…","shots":[{"camera":"wide","people":"1","place":"kitchen"}],"narrator":"…","firstLineSaysWhoAndWhere":"…","question":"…","answered":"…"}]}
<!-- /prompt -->

## Step 2: propose patterns (sees which Reels won, in half of them)

<!-- patterns -->
You are the Social Media Specialist. Stage 1, step 2 of 3: say what the winners do that the average Reels don't.

Below are {{COUNT}} {{FORMAT}} Reels from other accounts ({{NICHE}}). Each is marked winner or average. `lift` is the Reel's result divided by what its own account's Reels were getting around the same time. A winner is in its account's top quarter, with a lift of at least {{WINNER_LIFT}}; an average Reel is from the same account's middle half, with a lift from {{AVERAGE_FROM}} to under {{WINNER_LIFT}}. For each you get what code measured and how a reader who didn't know the results described it. A Reel's picture files (`open`, `shots`, `cover`) are in this folder: open one with the Read tool when a description isn't enough.

<reels>
{{REELS}}
</reels>

Code already tested our own rules on these accounts' Reels:
<rules>
{{TABLE}}
</rules>

Find up to 5 things the winners do that the average Reels don't, and that the rules above don't already cover. Look at what the Reels are about, how they open, what the first words promise, how they end, and what the caption does.

Each one will be tested on Reels you haven't seen. A separate reader, who isn't told which are winners, answers your question for each of them, and code keeps a pattern only when at least 3 of those winners show it, they are at least half of those winners and come from more than one account, and winners show it clearly more often than average Reels. So:
- Write each as a question with a yes or no answer about one Reel, answerable from its frames, transcript and caption alone. "Does the first spoken sentence name a specific amount of money or time?" works. "Is the hook strong?" doesn't, because two readers would answer it differently.
- Never ask about views, likes, the account or the date.
- Something most Reels in both groups do is a habit of these accounts, not a reason a Reel won. Leave it out.
- Something only one account's winners do is that creator's habit. Look for what winners of different accounts share.
- Fewer is fine. When nothing separates the two groups, return an empty list.

Reply with only JSON: {"patterns":[{"pattern":"what to do, written as an instruction for our own Reels","question":"the yes/no question"}]}
<!-- /patterns -->

## Step 3: check the patterns (blind, on the other half)

<!-- check -->
You are the Social Media Specialist. Stage 1, step 3 of 3: answer yes/no questions about other creators' Reels.

Why: these were proposed as things winning Reels do. Code will count your answers to see whether that holds. You are not told how any Reel performed, on purpose. Answer from what is in the frames, the transcript and the caption, the same way for every Reel.

<questions>
{{QUESTIONS}}
</questions>

<reels>
{{REELS}}
</reels>

What you get for each Reel:
- `caption`: what the creator wrote under it.
- `open`: a picture file with three frames side by side, at 0.1 s, 0.5 s and 1.5 s.
- `shots`: a picture file with one frame from the middle of each of `shotFrames` shots, in order, four to a row.
- `cover`: Instagram gave no video for this Reel, so there is only its cover image.
- `transcript`: what is said, each line with the second it starts.

Open every picture file a Reel has with the Read tool before you answer for it.

For each Reel, answer every question in order with yes, no or unclear. Answer unclear when the Reel doesn't give you enough to tell. Don't guess.

Reply with only JSON, one entry for every Reel above: {"reels":[{"id":"r02","answers":["yes","no","unclear"]}]}
<!-- /check -->
