import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { formatBrief, gateFormat } from "../src/pipeline/formats.ts";
import { gateScript } from "../src/pipeline/gates.ts";
import { DAILY_MIX, LIVE_SERIES, SERIES_DAY_TRIES, SERIES_SLOT, seriesForSlot } from "../src/pipeline/reel.ts";
import { NIGHT_DESK, OUTRO, SERIES_SECONDS, SERIES_SHOTS, nextEpisode, seriesBrief, seriesChecks, seriesIdeaCheck, seriesLook, seriesProgress } from "../src/pipeline/series.ts";
import { pipelineFile } from "../src/pipeline/stages.ts";
import { Vault } from "../src/vault.ts";

const ep1 = { id: "night-desk", episode: 1 };
const shots = [
  { start: 0, end: 3, line: "At 3:07 every night, the bell on the desk rang.", visual: "Insert: the brass bell on the wooden front desk, ringing, no one there.", onScreenText: "3:07 a.m." },
  { start: 3, end: 7, line: "Ruth works the night desk at the Starlite Motel, alone.", visual: "Wide: Ruth in round glasses behind the wooden front desk under the green-shaded desk lamp." },
  { start: 7, end: 11, line: "Tonight she turned off the lamp and waited.", visual: "Close-up: Ruth in round glasses in the dark, lit red by the neon sign." },
  { start: 11, end: 15, line: "The bell rang. A small boy stood there, fast asleep.", visual: "Medium: a small boy in a pom-pom hat and pyjamas at the desk, eyes closed, hand on the bell." },
  { start: 15, end: 19, line: "Ruth walked him back to Room 4. Part 2 tomorrow!", visual: "Wide: Ruth in round glasses leading the boy in the pom-pom hat to Room 4's door." },
];
const draft = { caption: "The bell rang at 3 a.m. with nobody there. Would you have waited?\n#TheNightDesk #motel #nightshift", shots, payoff: "The boy from Room 4 was sleepwalking: he rang the bell fast asleep." };
const failed = (checks: { name: string; passed: boolean }[]) => checks.filter((c) => !c.passed).map((c) => c.name);

describe("The Night Desk", () => {
  it("has 8 episodes, each with a brief in the prompt file, and a look", () => {
    expect(NIGHT_DESK.episodes.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const e of NIGHT_DESK.episodes) {
      const ideas = seriesBrief({ id: NIGHT_DESK.id, episode: e.n }, "ideas");
      const script = seriesBrief({ id: NIGHT_DESK.id, episode: e.n }, "script");
      expect(script).toContain(`Title: "${e.title}"`);
      expect(script).toContain("The story, locked:");
      expect(script).toContain("Caption vote:");
      expect(ideas).toContain("20 different ways to open this same story");
      expect(script).not.toContain("20 different ways");
    }
    expect(seriesLook(ep1)).toContain("round glasses");
    expect(seriesLook(null)).toBe("");
  });

  it("each episode's locked ending is in its own brief, and no brief uses another episode's story words", () => {
    const md = pipelineFile("series/night-desk.md");
    for (const e of NIGHT_DESK.episodes) {
      const brief = md.match(new RegExp(`<!-- episode ${e.n} -->([\\s\\S]*?)<!-- /episode ${e.n} -->`))![1]!;
      const locked = brief.match(/The story, locked:([^\n]*)/)![1]!;
      for (const r of e.answer) expect(locked, `${e.title}: ${r}`).toMatch(r);
      for (const g of e.guests) expect(brief, `${e.title}: ${g}`).toMatch(g);
      for (const o of NIGHT_DESK.episodes.filter((x) => x.n !== e.n)) expect(o.own.test(brief), `"${e.title}" says ${brief.match(o.own)?.[0]} (from "${o.title}")`).toBe(false);
    }
  });

  it("no brief or shared block carries words the standalone check refuses", () => {
    // The caption example and the briefs feed the script; they mustn't teach "part 2" or "#3".
    const blocks = ["ideas", "script"].flatMap((stage) => NIGHT_DESK.episodes.map((e) => seriesBrief({ id: NIGHT_DESK.id, episode: e.n }, stage as "ideas" | "script"))).concat(seriesLook(ep1));
    const text = blocks.join("\n").replace(/No "episode"[^.]*\./g, "").replace(OUTRO, " ");
    const s = gateScript({ shots: [{ start: 0, end: 30, line: text }], payoff: "p", nextHook: "n", caption: "c" }, null, { problems: [] });
    expect(s.checks.find((c) => c.name.startsWith("Stands alone"))!.passed).toBe(true);
  });

  it("goes into the story's prompts after the format's own rules", () => {
    const b = formatBrief({ format: "story", product: null, series: ep1 }, "script");
    expect(b.indexOf("Format: a stick-figure story")).toBeLessThan(b.indexOf("The Night Desk"));
    expect(b).toContain('Title: "The 3 a.m. bell"');
    expect(formatBrief({ format: "story", product: null }, "script")).not.toContain("The Night Desk");
  });

  it("passes a script that follows the brief", () => {
    expect(failed(seriesChecks(ep1, draft))).toEqual([]);
    expect(failed(gateFormat({ format: "story", product: null, series: ep1 }, draft, []).checks)).toEqual([]);
  });

  it("refuses an episode that doesn't introduce Ruth and the motel, loses her glasses, changes the ending, or leans on another episode", () => {
    const noIntro = { ...draft, shots: [shots[0]!, { ...shots[2]!, start: 3 }, ...shots.slice(1).map((s) => ({ ...s, start: (s.start ?? 0) + 10 }))].map((s, i) => (i === 2 ? { ...s, line: "She was alone." } : s)) };
    expect(failed(seriesChecks(ep1, noIntro))).toEqual([expect.stringMatching(/^Opens by saying who Ruth is/)]);
    const bare = { ...draft, shots: shots.map((s) => ({ ...s, visual: s.visual.replace("Ruth in round glasses", "Ruth") })) };
    expect(failed(seriesChecks(ep1, bare))).toEqual([expect.stringMatching(/always with her round glasses/)]);
    expect(failed(seriesChecks(ep1, { ...draft, payoff: "It was the wind." }))).toEqual([expect.stringMatching(/^Ends the way "The 3 a.m. bell"/)]);
    const leak = seriesChecks(ep1, { ...draft, caption: `${draft.caption} Remember the crow?` });
    expect(leak.find((c) => !c.passed)?.detail).toContain('"crow" (from "The pen that comes back different")');
    expect(failed(seriesChecks(ep1, { ...draft, caption: "Would you have waited? #motel" }))).toEqual(["The caption carries #TheNightDesk"]);
    expect(failed(seriesChecks(ep1, { ...draft, shots: shots.map((s) => ({ ...s, visual: s.visual.replace(/pom-pom hat/g, "cap") })) }))).toEqual(["The guest's marker is named in the drawings"]);
  });

  it("lets the outro say the next part, and nothing else name a part (Thomas, 2026-11-23)", () => {
    const standalone = (caption: string, allow?: RegExp) => gateScript({ shots, payoff: "p", nextHook: "n", caption }, null, { problems: [] }, [], { allow }).checks.find((c) => c.name.startsWith("Stands alone"))!.passed;
    // A story outside a series still can't say it.
    expect(standalone("#TheNightDesk")).toBe(false);
    expect(standalone("#TheNightDesk", OUTRO)).toBe(true);
    expect(standalone("Previously at the Starlite #TheNightDesk", OUTRO)).toBe(false);
    const named = (d: typeof draft, n = 1) => seriesChecks({ id: "night-desk", episode: n }, d).filter((c) => !c.passed).map((c) => c.name);
    const noOutro = { ...draft, shots: shots.map((x, i) => (i === shots.length - 1 ? { ...x, line: "Ruth walked him back to Room 4." } : x)) };
    expect(named(noOutro)).toEqual(['The outro says "Part 2 tomorrow"']);
    const wrongPart = { ...draft, shots: shots.map((x, i) => (i === shots.length - 1 ? { ...x, line: "Ruth walked him back. Part 3 tomorrow!" } : x)) };
    expect(named(wrongPart)).toEqual(['The outro says "Part 2 tomorrow"']);
    expect(named({ ...draft, caption: `Part 1: ${draft.caption}` })).toEqual(["A part number only in the outro (not the opening, the middle or the caption)"]);
    expect(named({ ...draft, shots: shots.map((x, i) => (i === 0 ? { ...x, onScreenText: "PART 1" } : x)) })).toEqual(["A part number only in the outro (not the opening, the middle or the caption)"]);
    // The last part promises nothing.
    const brief8 = seriesBrief({ id: "night-desk", episode: 8 }, "script");
    expect(brief8).toContain("names no next part");
    expect(brief8).not.toMatch(/Part 9/);
    expect(seriesBrief(ep1, "script")).toContain('"Part 2 tomorrow!"');
  });

  it("runs 60 to 120 seconds in 20 to 50 shots", () => {
    expect(SERIES_SECONDS).toEqual([60, 120]);
    expect(SERIES_SHOTS).toEqual([20, 50]);
    const long = (end: number) => gateScript({ shots: [{ start: 0, end, line: "x" }], payoff: "p", nextHook: "n", caption: "c" }, null, { problems: [] }, [], { seconds: SERIES_SECONDS }).checks.find((c) => /seconds long/.test(c.name))!;
    expect(long(45).passed).toBe(false);
    expect(long(75).passed).toBe(true);
    expect(long(75).name).toBe("60 to 120 seconds long");
    expect(long(130).passed).toBe(false);
  });

  it("checks a stage 2 finalist's ending against the lock", () => {
    expect(seriesIdeaCheck(ep1, 3, "A sleepwalking boy rings it.").passed).toBe(true);
    expect(seriesIdeaCheck(ep1, 3, "A ghost rings it.").passed).toBe(false);
  });

  it("makes the first part not yet posted and never skips ahead (each outro promised the next)", () => {
    const p = (posted: number[], tries: Record<number, number> = {}) => ({ posted, tries, lastPostedAt: null });
    expect(nextEpisode(NIGHT_DESK, p([]))).toEqual(ep1);
    expect(nextEpisode(NIGHT_DESK, p([1, 2], { 1: 1, 2: 2 }))).toEqual({ id: "night-desk", episode: 3 });
    expect(nextEpisode(NIGHT_DESK, p([1], { 1: 1, 2: 9 }))).toEqual({ id: "night-desk", episode: 2 });
    expect(nextEpisode(NIGHT_DESK, p([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it("reads which episodes posted from the Vault (a posted action on the Reel)", async () => {
    const vault = new Vault(createClient({ url: ":memory:" }));
    await vault.ensureTables();
    const at = new Date("2026-11-23T15:00:00Z");
    const start = async (subject: string, episode: number, passed: boolean) =>
      vault.saveStage({ stage: 2, subject, attempt: 1, passed, output: {}, gate: {}, input: { format: "story", series: { id: "night-desk", episode } } }, at);
    await start("reel:a", 1, true);
    await start("reel:b", 2, true);
    await start("reel:c", 2, false);
    await start("reel:d", 3, true);
    await vault.saveStage({ stage: 2, subject: "reel:e", attempt: 1, passed: true, output: {}, gate: {}, input: { format: "story" } }, at);
    await vault.logAction({ kind: "posted", summary: "Posted", target: "reel:a", onInstagram: true }, at);
    await vault.logAction({ kind: "post_failed", summary: "Refused", target: "reel:b", onInstagram: true, ok: false }, at);
    expect(await seriesProgress(vault, "night-desk")).toEqual({ posted: [1], tries: { 1: 1, 2: 1, 3: 1 }, lastPostedAt: at.toISOString() });
    expect((await vault.reelsStarted()).find((r) => r.subject === "reel:d")?.series).toEqual({ id: "night-desk", episode: 3 });
    expect((await vault.reelsStarted()).find((r) => r.subject === "reel:e")?.series).toBeNull();
    vault.close();
  });

  it("takes the fifth Reel of the day, and the next tries until a part went out (Thomas, 2026-11-23: daily)", () => {
    expect(LIVE_SERIES).toBe("night-desk");
    expect(SERIES_DAY_TRIES).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((t) => seriesForSlot(t))).toEqual([null, null, null, null, "night-desk", "night-desk", "night-desk", null]);
    expect(seriesForSlot(5, "night-desk", true)).toBeNull();
    expect(seriesForSlot(4, null)).toBeNull();
    expect(DAILY_MIX[SERIES_SLOT]).toBe("satisfying");
  });
});
