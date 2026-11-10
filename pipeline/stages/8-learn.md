# Stage 8: Learn

Log the results, update the winning-patterns list, and turn every lesson
into a new check for stages 3 to 6. Then double down on what worked or drop
the idea.

**Gate (code, `gateLearn`):**
- the test results are logged (stage 7 output);
- at least one lesson, and every lesson names the stage (3, 4, 5 or 6) its
  new check belongs to and the check itself, written so it can be applied;
- the patterns list is updated (added to, or confirmed, with the numbers);
- a decision: double down (make the next episode in this direction) or drop.

<!-- prompt -->
You are the Social Media Specialist. Stage 8: learn from this test.

Test results (stage 7): {{RESULTS}}
Current winning patterns: {{PATTERNS}}
Current checks: {{LESSONS}}

{{GATE_FAILURES}}

Reply with only JSON: {"lessons": [{"lesson": "...", "stage": 3, "check": "a check that can be applied before publishing"}], "patterns": [{"pattern": "...", "change": "added" | "confirmed" | "dropped", "numbers": "..."}], "decision": "double_down" | "drop", "why": "..."}
<!-- /prompt -->
