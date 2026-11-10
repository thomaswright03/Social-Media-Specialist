import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { instagramClient, parseReelInsights, type InstagramClient, type Media, type ReelInsights } from "../src/instagram.ts";
import { median, postNumbers, runDiagnose } from "../src/pipeline/diagnose.ts";
import {
  emptySlices,
  failuresText,
  gateDiagnose,
  gateIdeas,
  gateLearn,
  gateOpening,
  gatePrepublish,
  gateProduction,
  gateResearch,
  gateScript,
  gateTest,
  isOneSentence,
  mayAutoPost,
  sameNumber,
  scoreVariants,
  type Shot,
} from "../src/pipeline/gates.ts";
import { parseJson, STAGES, stagePrompt } from "../src/pipeline/stages.ts";
import { Vault } from "../src/vault.ts";

async function memoryVault(): Promise<Vault> {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  return vault;
}

const NOW = new Date("2026-11-10T20:00:00Z");

describe("stage prompts", () => {
  it("every stage has a file, and every stage with a prompt fills its placeholders", () => {
    expect(STAGES.map((s) => s.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const p = stagePrompt(0, { DATA: "THE-DATA", AVOID: "THE-AVOID", GATE_FAILURES: "" });
    expect(p).toContain("THE-DATA");
    expect(p).toContain("THE-AVOID");
    expect(p).not.toMatch(/\{\{/);
    for (const n of [1, 2, 3, 4, 5, 8]) expect(stagePrompt(n, {})).not.toMatch(/\{\{/);
  });

  it("reads JSON out of a wrapped answer", () => {
    expect(parseJson<{ a: number }>('Here it is:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson("no json")).toBeNull();
  });

  it("lists failed checks for the next try", () => {
    expect(failuresText({ passed: false, checks: [{ name: "A", passed: true }, { name: "B", passed: false, detail: "why" }] })).toBe("Your last answer failed these checks. Fix every one:\n- B: why");
    expect(failuresText(null)).toBe("");
  });
});

describe("Instagram reels", () => {
  it("parses reel insights (ms to s, skip rate as a share)", () => {
    const i = parseReelInsights([
      { name: "views", values: [{ value: 1200 }] },
      { name: "reach", values: [{ value: 900 }] },
      { name: "ig_reels_avg_watch_time", values: [{ value: 14_200 }] },
      { name: "reels_skip_rate", values: [{ value: 62 }] },
      { name: "shares", total_value: { value: 3 } },
    ]);
    expect(i).toMatchObject({ views: 1200, reach: 900, avgWatchSeconds: 14.2, skipRate: 0.62, shares: 3, saves: null });
  });

  it("posts a Trial Reel with trial_params and waits for the video", async () => {
    const calls: { url: string; body: string }[] = [];
    let polls = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? String(init.body) : "" });
      if (u.includes("/media_publish")) return Response.json({ id: "M1" });
      if (u.includes("/media") && init?.method === "POST") return Response.json({ id: "C1" });
      if (u.includes("/C1?")) return Response.json({ status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" });
      if (u.includes("/M1?")) return Response.json({ permalink: "https://instagram.com/reel/x" });
      return Response.json({});
    }) as typeof fetch;
    const ig = instagramClient("tok", { fetchImpl, userId: "IG", pollMs: 0 });
    const r = await ig.publishReel!("https://vault/v.mp4", "Hook line", { trial: "MANUAL" });
    expect(r).toEqual({ containerId: "C1", mediaId: "M1", permalink: "https://instagram.com/reel/x" });
    const create = new URLSearchParams(calls[0]!.body);
    expect(create.get("media_type")).toBe("REELS");
    expect(JSON.parse(create.get("trial_params")!)).toEqual({ graduation_strategy: "MANUAL" });
  });
});

describe("only Trial Reels go out on their own", () => {
  const passed = { passed: true, checks: [{ name: "x", passed: true }] };
  it("needs a trial, every pre-publish check, and not paused", () => {
    expect(mayAutoPost({ trial: true, prepublish: passed, paused: false }).ok).toBe(true);
    expect(mayAutoPost({ trial: false, prepublish: passed, paused: false }).ok).toBe(false);
    expect(mayAutoPost({ trial: true, prepublish: null, paused: false }).ok).toBe(false);
    expect(mayAutoPost({ trial: true, prepublish: { passed: false, checks: [{ name: "Loudness", passed: false }] }, paused: false }).why).toContain("Loudness");
    expect(mayAutoPost({ trial: true, prepublish: passed, paused: true }).ok).toBe(false);
  });
});

// --- Stage 0 -------------------------------------------------------------------

const media = (id: string, over: Partial<Media> = {}): Media => ({ id, caption: `Part ${id}`, mediaType: "VIDEO", productType: "REELS", timestamp: "2026-10-01T10:00:00+0000", permalink: null, mediaUrl: `https://cdn/${id}.mp4`, thumbnailUrl: null, likes: 3, comments: 0, ...over });
const insight = (over: Partial<ReelInsights> = {}): ReelInsights => ({ views: 400, reach: 300, likes: 3, comments: 0, saves: 1, shares: 0, totalInteractions: 4, avgWatchSeconds: 14, totalWatchSeconds: 5600, skipRate: 0.62, ...over });

describe("stage 0, diagnose", () => {
  it("derives watch %, 3-second hold and per-1k rates in code", () => {
    const p = postNumbers(media("a"), insight({ shares: 3 }), 120);
    expect(p).toMatchObject({ type: "reel", lengthSeconds: 120, watchPct: 0.12, hold3s: 0.38, sharesPer1k: 10 });
    expect(median([3, null, 1, 2, "x"])).toBe(2);
  });

  it("matches numbers with rounding and as a percentage", () => {
    expect(sameNumber(62, 0.62)).toBe(true);
    expect(sameNumber(0.38, 0.381)).toBe(true);
    expect(sameNumber(14, 14.04)).toBe(true);
    expect(sameNumber(20, 14)).toBe(false);
  });

  const data = { posts: [{ id: "a", views: 400, hold3s: 0.38, watchPct: 0.12, avgWatchSeconds: 14, lengthSeconds: 120, sharesPer1k: 0 }], median: { hold3s: 0.38, watchPct: 0.12, lengthSeconds: 120, sharesPer1k: 0 } };
  const good = {
    summary: "s",
    reasons: [
      { reason: "62% gone by 0:03", evidence: [{ metric: "hold3s", value: 0.38, post: "median" }], fix: "stage 3" },
      { reason: "Average watch time 14 s out of 120", evidence: [{ metric: "avgWatchSeconds", value: 14, post: "a" }, { metric: "lengthSeconds", value: 120, post: "a" }], fix: "stage 4" },
      { reason: "0 shares per 1,000 reached", evidence: [{ metric: "sharesPer1k", value: 0, post: "median" }], fix: "stage 2" },
    ],
  };

  it("passes three reasons backed by the data", () => {
    expect(gateDiagnose(good, data).passed).toBe(true);
  });

  it("fails a made-up number, a missing number, or the wrong count", () => {
    const made = structuredClone(good);
    made.reasons[0]!.evidence[0]!.value = 0.2;
    const g = gateDiagnose(made, data);
    expect(g.passed).toBe(false);
    expect(g.checks.find((c) => !c.passed)?.detail).toContain("0.38");
    const noNum = structuredClone(good);
    noNum.reasons[1]!.reason = "People get bored";
    expect(gateDiagnose(noNum, data).passed).toBe(false);
    expect(gateDiagnose({ reasons: good.reasons.slice(0, 2) }, data).passed).toBe(false);
    expect(gateDiagnose(good, { posts: [], median: {} }).passed).toBe(false);
  });

  it("runs end to end: retries with the failures, saves each try, records it, keeps the reasons as lessons", async () => {
    const vault = await memoryVault();
    const ig: InstagramClient = {
      account: async () => ({ id: "IG", username: "wright", followers: 50, posts: 2 }),
      publishImage: async () => {
        throw new Error("never");
      },
      stats: async () => ({ likes: 0, comments: 0, reach: 0, saves: 0, shares: 0, views: 0, permalink: null }),
      listMedia: async () => [media("a"), media("b", { mediaType: "IMAGE", productType: "FEED", mediaUrl: null })],
      reelInsights: async () => insight(),
      recentFollows: async () => 4,
    };
    const prompts: string[] = [];
    const answers = [
      JSON.stringify({ reasons: [{ reason: "bad", evidence: [], fix: "" }] }),
      JSON.stringify({
        summary: "Short version.",
        reasons: [
          { reason: "62% gone by 0:03", evidence: [{ metric: "skipRate", value: 62, post: "a" }], fix: "Stage 3: no title card." },
          { reason: "Average watch 14 s of 120", evidence: [{ metric: "avgWatchSeconds", value: 14, post: "a" }], fix: "Stage 4: 30 to 60 s." },
          { reason: "Watched 12% through", evidence: [{ metric: "watchPct", value: 12, post: "median" }], fix: "Stage 2: standalone premises." },
        ],
      }),
    ];
    const r = await runDiagnose({ vault, ig, ask: async (p) => (prompts.push(p), answers.shift()!), probe: async () => 120, now: () => NOW });
    expect(r.passed).toBe(true);
    expect(r.tries).toBe(2);
    expect(prompts[0]).toContain('"skipRate": 0.62');
    expect(prompts[1]).toContain("Exactly three reasons");
    const stage = await vault.latestStage(0);
    expect(stage).toMatchObject({ stage: 0, attempt: 2, passed: true });
    const history = await vault.actions();
    expect(history[0]).toMatchObject({ kind: "stage", ok: true });
    expect(history[0]!.summary).toContain("passed its gate on try 2");
    expect((await vault.lessons("avoid")).map((l) => l.text)).toContain("62% gone by 0:03");
    vault.close();
  });

  it("stops at the gate after three tries and says why", async () => {
    const vault = await memoryVault();
    const ig = { listMedia: async () => [media("a")], reelInsights: async () => insight() } as unknown as InstagramClient;
    const r = await runDiagnose({ vault, ig, ask: async () => "{}", probe: async () => 120, now: () => NOW });
    expect(r.passed).toBe(false);
    expect(r.tries).toBe(3);
    const [last] = await vault.actions();
    expect(last).toMatchObject({ ok: false });
    expect(last!.detail).toContain("Exactly three reasons");
    vault.close();
  });
});

// --- Stages 1 to 8 ---------------------------------------------------------------

describe("stage 1, research", () => {
  const reel = (i: number) => ({ url: `https://instagram.com/reel/${i}`, views: 100_000 + i, likes: 1, comments: 1, lengthSeconds: 40, first2s: "mid-fall", cutsPerTenSeconds: 5, voice: "human", art: "clean", onScreenText: "hook", postsPerWeek: 4, commentThemes: "relatable" });
  it("needs 15-20 reels with every field and 3+ examples per pattern", () => {
    const reels = Array.from({ length: 15 }, (_, i) => reel(i));
    const ok = { reels, patterns: [{ pattern: "Start mid-fall", examples: reels.slice(0, 3).map((r) => r.url) }] };
    expect(gateResearch(ok).passed).toBe(true);
    expect(gateResearch({ ...ok, patterns: [{ pattern: "x", examples: [reels[0]!.url, reels[0]!.url, "https://made-up"] }] }).passed).toBe(false);
    expect(gateResearch({ ...ok, reels: reels.slice(0, 10) }).passed).toBe(false);
    const missing = { ...ok, reels: [...reels.slice(1), { ...reel(0), voice: "" }] };
    expect(gateResearch(missing).checks.find((c) => !c.passed)?.detail).toContain("voice");
  });
});

describe("stage 2, ideas", () => {
  const pitches = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, sentence: `A man finds a door in his kitchen number ${i + 1}.`, hook: i < 3 ? 5 : 2, shareable: 3, standalone: 4, different: 3 }));
  it("keeps the top 3, one sentence each, read cold", () => {
    const cold = { 1: [true, true, false], 2: [true, true, true], 3: [true, false, true] };
    expect(gateIdeas({ pitches, finalists: [1, 2, 3] }, cold).passed).toBe(true);
    expect(gateIdeas({ pitches, finalists: [1, 2, 9] }, { ...cold, 9: [true, true, true] }).passed).toBe(false);
    expect(gateIdeas({ pitches, finalists: [1, 2, 3] }, { ...cold, 3: [false, false, true] }).passed).toBe(false);
    const leaning = pitches.map((p) => (p.id === 1 ? { ...p, sentence: "In part 2 he opens the door." } : p));
    expect(gateIdeas({ pitches: leaning, finalists: [1, 2, 3] }, cold).passed).toBe(false);
  });
  it("one sentence means one sentence", () => {
    expect(isOneSentence("He opens the door.")).toBe(true);
    expect(isOneSentence("He opens the door. It's a wall.")).toBe(false);
  });
});

describe("stage 3, the first 3 seconds", () => {
  const opening = { intendedHook: "why is he falling", shots: [{ start: 0, end: 1.5, kind: "action", visual: "A stick figure mid-fall past a window", onScreenText: "He has 3 seconds", textAt: 0.2 }, { start: 1.5, end: 3, kind: "action", visual: "He grabs a ledge" }] };
  it("passes a mid-action opening with an early, short hook", () => {
    expect(gateOpening(opening, [true, true, false]).passed).toBe(true);
  });
  it("fails a title card, a late or long hook, and a failed sound-off test", () => {
    expect(gateOpening({ ...opening, shots: [{ start: 0, end: 2.2, kind: "title", visual: "Black title card", onScreenText: "Low Tide Part 5", textAt: 0 }] }, [true, true, true]).passed).toBe(false);
    expect(gateOpening({ ...opening, shots: [{ ...opening.shots[0]!, textAt: 0.8 }, opening.shots[1]!] }, [true, true, true]).passed).toBe(false);
    expect(gateOpening({ ...opening, shots: [{ ...opening.shots[0]!, onScreenText: "This is the story of a man who had only three seconds left" }, opening.shots[1]!] }, [true, true, true]).passed).toBe(false);
    expect(gateOpening(opening, [true, false, false]).passed).toBe(false);
  });
  it("adds learned checks", () => {
    expect(gateOpening(opening, [true, true, true], [{ name: "Learned: face in frame 1", passed: false }]).passed).toBe(false);
  });
});

describe("stage 4, script", () => {
  const opening = { shots: [{ start: 0, end: 1.5, kind: "action", visual: "Mid-fall", onScreenText: "He has 3 seconds", textAt: 0.2 }] };
  const shots: Shot[] = [{ start: 0, end: 1.5, visual: "Mid-fall", onScreenText: "He has 3 seconds", textAt: 0.2 }];
  for (let t = 1.5; t < 36; t += 2.5) shots.push({ start: t, end: t + 2.5, visual: `shot at ${t}`, line: "", onScreen: "" });
  const script = { shots, payoff: "He lands in the pool", nextHook: "The pool is on the roof" };

  it("passes a 30-60 s standalone script with something new each slice", () => {
    expect(gateScript(script, opening, { problems: [] }).passed).toBe(true);
  });

  it("flags empty 3-second slices", () => {
    const slow: Shot[] = [{ start: 0, end: 1.5, visual: "Mid-fall", onScreenText: "He has 3 seconds", textAt: 0.2 }, { start: 1.5, end: 10, visual: "long hold" }, { start: 10, end: 31, visual: "end" }];
    expect(emptySlices(slow, 31)).toEqual([3, 6, 12, 15, 18, 21, 24, 27]);
    const g = gateScript({ ...script, shots: slow }, opening, { problems: [] });
    expect(g.checks.find((c) => c.name.includes("3-second"))?.detail).toContain("3-6 s");
  });

  it("fails a spoken claim not on screen, a reference to another part, a long script, and review problems", () => {
    const unshown = { ...script, shots: script.shots.map((s, i) => (i === 3 ? { ...s, line: "He's been falling for an hour", onScreen: "" } : s)) };
    expect(gateScript(unshown, opening, { problems: [] }).passed).toBe(false);
    expect(gateScript({ ...script, nextHook: "See part 6" }, opening, { problems: [] }).passed).toBe(false);
    expect(gateScript(script, opening, { problems: ["He falls 40 floors in 2 seconds"] }).passed).toBe(false);
    expect(gateScript(script, opening, null).passed).toBe(false);
    const long = { ...script, shots: [...shots, { start: 36, end: 75, visual: "more" }] };
    expect(gateScript(long, opening, { problems: [] }).checks[0]!.passed).toBe(false);
  });
});

describe("stage 5, production", () => {
  it("passes only when ours is at least as good on every axis", () => {
    const j = { ours: { art: 4, readability: 4, voice: 4, sound: 3 }, benchmark: { art: 4, readability: 3, voice: 4, sound: 3 } };
    expect(gateProduction(j, { ours: 5, benchmarks: 2 }).passed).toBe(true);
    expect(gateProduction({ ...j, ours: { ...j.ours, voice: 2 } }, { ours: 5, benchmarks: 2 }).passed).toBe(false);
    expect(gateProduction(j, { ours: 5, benchmarks: 1 }).passed).toBe(false);
  });
});

describe("stage 6, pre-publish", () => {
  const m = { width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fps: 30, seconds: 42, lufs: -14.2, truePeak: -1.5 };
  const boxes = [{ text: "He has 3 seconds", x: 100, y: 400, w: 800, h: 160 }];
  const p = { coverAt: 0.5, coverText: "He has 3 seconds", caption: "He had 3 seconds to land this.\nA stick figure story about falling, luck and a pool.\nFollow for the next one.", keywords: ["stick figure", "story", "falling"] };
  it("passes a clean file and packaging", () => {
    expect(gatePrepublish(m, boxes, p).passed).toBe(true);
  });
  it("fails text under the buttons, loudness, length, and a caption without a call to action", () => {
    expect(gatePrepublish(m, [{ text: "low", x: 100, y: 1600, w: 800, h: 100 }], p).passed).toBe(false);
    expect(gatePrepublish({ ...m, lufs: -23 }, boxes, p).passed).toBe(false);
    expect(gatePrepublish({ ...m, seconds: 120 }, boxes, p).passed).toBe(false);
    expect(gatePrepublish(m, boxes, { ...p, caption: "He had 3 seconds.\nA stick figure story about falling." }).passed).toBe(false);
  });
});

describe("stage 7, test small", () => {
  const v = (id: string, skipRate: number, avg: number, shares: number) => ({ id, postedAt: "2026-11-08T10:00:00Z", durationSeconds: 40, reach: 500, skipRate, avgWatchSeconds: avg, shares });
  it("picks the winner by 3-second hold, watch % and shares per reach after 48 h", () => {
    const g = gateTest([v("A", 0.5, 12, 2), v("B", 0.3, 20, 6), v("C", 0.4, 18, 1)], NOW);
    expect(g.passed).toBe(true);
    expect(g.winner?.id).toBe("B");
    expect(scoreVariants([v("A", 0.5, 12, 2), v("B", 0.3, 20, 6)])[0]!.hold3s).toBeCloseTo(0.7);
  });
  it("waits for 48 hours and enough reach", () => {
    expect(gateTest([v("A", 0.5, 12, 2), { ...v("B", 0.3, 20, 6), postedAt: "2026-11-10T00:00:00Z" }], NOW).winner).toBeNull();
    expect(gateTest([v("A", 0.5, 12, 2), { ...v("B", 0.3, 20, 6), reach: 40 }], NOW).passed).toBe(false);
  });
});

describe("stage 8, learn", () => {
  it("turns every lesson into a check for stages 3 to 6", () => {
    const l = { lessons: [{ lesson: "Faces in frame 1 held better", stage: 3, check: "A face is visible in the first frame" }], patterns: [{ pattern: "Faces first", change: "added", numbers: "hold 71% vs 52%" }], decision: "double_down", why: "B won" };
    expect(gateLearn(l, true).passed).toBe(true);
    expect(gateLearn({ ...l, lessons: [{ lesson: "x", stage: 7, check: "y" }] }, true).passed).toBe(false);
    expect(gateLearn(l, false).passed).toBe(false);
    expect(gateLearn({ ...l, decision: "maybe" }, true).passed).toBe(false);
  });
});

describe("the History", () => {
  it("records actions newest first and never throws", async () => {
    const vault = await memoryVault();
    await vault.logAction({ kind: "posted", summary: "Posted A", onInstagram: true }, new Date("2026-11-10T10:00:00Z"));
    await vault.logAction({ kind: "drafted", summary: "Drafted B" }, new Date("2026-11-10T11:00:00Z"));
    const a = await vault.actions();
    expect(a.map((x) => x.summary)).toEqual(["Drafted B", "Posted A"]);
    expect(a[1]).toMatchObject({ onInstagram: true, ok: true });
    vault.close();
    await expect(vault.logAction({ kind: "drafted", summary: "after close" })).resolves.toBeUndefined();
  });

  it("keeps one copy of a lesson", async () => {
    const vault = await memoryVault();
    expect(await vault.addLesson({ kind: "check", stage: 3, text: "Face in frame 1", source: "stage 8" })).toBe(true);
    expect(await vault.addLesson({ kind: "check", stage: 3, text: "face in frame 1", source: "stage 8" })).toBe(false);
    expect(await vault.lessons("check")).toHaveLength(1);
    vault.close();
  });
});
