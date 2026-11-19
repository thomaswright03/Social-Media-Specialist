# Stage 8: Learn

Log the results, update the winning-patterns list, and turn every lesson
into a new check for stages 3 to 6. Then double down on what worked or drop
the idea.

**Inputs (gathered by code):** the Reel itself (format, premise, opening, script,
caption), the stage 7 test numbers, the same numbers before the test, the
patterns list and the current checks. A check listed in `retire` is taken out
only with Thomas seeing it in History, never silently.

**Gate (code, `gateLearn`):**
- the test results are logged (stage 7 output);
- at least one lesson, and every lesson names the stage (3, 4, 5 or 6) its
  new check belongs to and the check itself, written so it can be applied;
- the patterns list is updated (added to, or confirmed, with the numbers);
- a decision: double down (make the next episode in this direction) or drop,
  and it must follow the numbers: double down only when the winner beat stage
  0's medians on at least 2 of 3-second hold, watch % and shares per reach.

<!-- prompt -->
You are the Social Media Specialist. Stage 8: learn from this test.

What you write here becomes rules. Every lesson's check is run against every future Reel at its stage, and every pattern is handed to the stages that pitch and script. A true lesson makes every later Reel better. A wrong one makes every later Reel worse, and nobody will know why. One test is one data point, so claim only what its numbers can carry.

<reel>
{{REEL}}
</reel>

<test_results>
{{RESULTS}}
</test_results>

<where_we_started>
{{BASELINE}}
</where_we_started>

<current_patterns>
{{PATTERNS}}
</current_patterns>

<current_checks>
{{LESSONS}}
</current_checks>

1. The decision

It is arithmetic, not judgement. `decision` is "double_down" if this Reel beat where we started on at least 2 of the 3 test numbers. Otherwise it is "drop". In `why`, give all three comparisons, with both numbers in each.

2. What each number is about

- Who left in the first 3 seconds is about the opening: stage 3.
- How much of it people watched is about the script, its pace, its clarity and its payoff: stage 4.
- Shares, saves and follows are about the idea: stage 2.
- Comments are about the caption's question.
- No number here measures the art or the sound on its own. Don't write a lesson about them unless the results include one that does.

3. Lessons: one to three

Each lesson says what this Reel did, which number moved, and which way, with the number in it. For example: "The opening showed the object before the person, and 71% stayed past 3 seconds against 52% before." (An example of the form. Don't reuse it.)

- A lesson is about something this Reel did differently from what came before. If nothing was different, the number tells you nothing about it.
- When the numbers are close, say less. A difference too small to trust is not a lesson.
- `stage` is the stage whose work the lesson is about: 2, 3, 4 or 5.
- `check` is a rule a reviewer can answer YES or NO to, before publishing, by reading only that stage's output. One condition, about something that can be seen in the output, worded so that passing is YES. Not "the hook is strong" but "the first shot's visual shows the strange object itself".

Test every check before you include it:
- A good Reel that looks nothing like this one could still pass it. If only a copy of this Reel passes, it is too narrow.
- It doesn't repeat a current check.
- It doesn't contradict a current check. If this test shows a current check is wrong, put that check's text in `retire` and say why in `why`.

4. Patterns

For each pattern this Reel used or tested, say what the test did to it:
- "confirmed": it was used, and the number it is about beat where we started.
- "dropped": it was used, and that number fell short.
- "added": something new this test showed, that isn't on the list yet.
Give the numbers for each. Leave out patterns this Reel didn't test. At least one pattern must change.

The numbers: copy them exactly from the results above. Never round them, average them or work out new ones.

<last_failures>
{{GATE_FAILURES}}
</last_failures>
If failures are listed above, fix every one of them.

Reply with only JSON: {"lessons": [{"lesson": "...", "stage": 3, "check": "a check that can be applied before publishing"}], "patterns": [{"pattern": "...", "change": "added" | "confirmed" | "dropped", "numbers": "..."}], "retire": ["the text of a current check this test showed to be wrong"], "decision": "double_down" | "drop", "why": "..."}
<!-- /prompt -->
