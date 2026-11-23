import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { formatBrief, gateFormat } from "../src/pipeline/formats.ts";
import { gateScript } from "../src/pipeline/gates.ts";
import { DAILY_MIX, LIVE_SERIES, SERIES_SLOT, seriesForSlot } from "../src/pipeline/reel.ts";
import { EPISODE_TRIES, NIGHT_DESK, nextEpisode, seriesBrief, seriesChecks, seriesIdeaCheck, seriesLook, seriesProgress } from "../src/pipeline/series.ts";
import { pipelineFile } from "../src/pipeline/stages.ts";
import { Vault } from "../src/vault.ts";

const ep1 = { id: "night-desk", episode: 1 };
const shots = [
  { start: 0, end: 3, line: "At 3:07 every night, the bell on the desk rang.", visual: "Insert: the brass bell on the wooden front desk, ringing, no one there.", onScreenText: "3:07 a.m." },
  { start: 3, end: 7, line: "Ruth works the night desk at the Starlite Motel, alone.", visual: "Wide: Ruth in round glasses behind the wooden front desk under the green-shaded desk lamp." },
  { start: 7, end: 11, line: "Tonight she turned off the lamp and waited.", visual: "Close-up: Ruth in round glasses in the dark, lit red by the neon sign." },
  { start: 11, end: 15, line: "The bell rang. A small boy stood there, fast asleep.", visual: "Medium: a small boy in a pom-pom hat and pyjamas at the desk, eyes closed, hand on the bell." },
  { start: 15, end: 19, line: "Ruth walked him back to Room 4.", visual: "Wide: Ruth in round glasses leading the boy in the pom-pom hat to Room 4's door." },
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
    const text = blocks.join("\n").replace(/No "part", "episode"[^.]*\./g, "");
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

  it("still refuses part numbers in an episode, as every story", () => {
    const s = gateScript({ shots, payoff: "p", nextHook: "n", caption: "The Night Desk, part 3 #TheNightDesk" }, null, { problems: [] });
    expect(s.checks.find((c) => c.name.startsWith("Stands alone"))!.passed).toBe(false);
  });

  it("checks a stage 2 finalist's ending against the lock", () => {
    expect(seriesIdeaCheck(ep1, 3, "A sleepwalking boy rings it.").passed).toBe(true);
    expect(seriesIdeaCheck(ep1, 3, "A ghost rings it.").passed).toBe(false);
  });

  it("makes the first episode not yet posted, and passes over one that failed EPISODE_TRIES times", () => {
    expect(nextEpisode(NIGHT_DESK, { posted: [], tries: {} })).toEqual(ep1);
    expect(nextEpisode(NIGHT_DESK, { posted: [1, 2], tries: { 1: 1, 2: 2 } })).toEqual({ id: "night-desk", episode: 3 });
    expect(nextEpisode(NIGHT_DESK, { posted: [1], tries: { 1: 1, 2: EPISODE_TRIES } })).toEqual({ id: "night-desk", episode: 3 });
    expect(nextEpisode(NIGHT_DESK, { posted: [1, 2, 3, 4, 5, 6, 7, 8], tries: {} })).toBeNull();
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
    expect(await seriesProgress(vault, "night-desk")).toEqual({ posted: [1], tries: { 1: 1, 2: 1, 3: 1 } });
    expect((await vault.reelsStarted()).find((r) => r.subject === "reel:d")?.series).toEqual({ id: "night-desk", episode: 3 });
    expect((await vault.reelsStarted()).find((r) => r.subject === "reel:e")?.series).toBeNull();
    vault.close();
  });

  it("stays out of the daily mix until Thomas chooses, then takes the fifth Reel", () => {
    expect(LIVE_SERIES).toBeNull();
    expect([0, 1, 2, 3, 4, 5].map((t) => seriesForSlot(t))).toEqual([null, null, null, null, null, null]);
    expect(DAILY_MIX[SERIES_SLOT]).toBe("satisfying");
    expect([0, 1, 2, 3, 4, 9].map((t) => seriesForSlot(t, "night-desk"))).toEqual([null, null, null, null, "night-desk", "night-desk"]);
  });
});
