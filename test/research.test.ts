import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { discoverAccount, type DiscoveredAccount, type Media } from "../src/instagram.ts";
import { CAMERAS, LABELS, MAX_SHOTS, MIN_SHOTS, UNCLEAR, type ReelLabels } from "../src/pipeline/gates.ts";
import { LEGACY_SOURCE, blindView, nicheFor, patternSource, reportText, researchBrief, runResearch, summaryText, tallyPatterns, type ResearchDeps } from "../src/pipeline/research.ts";
import { RESEARCH_FORMATS, accountsFor, cleanHandle, fileAccounts, parseAccounts } from "../src/pipeline/research-accounts.ts";
import { captionFacts, cutTimes, lufsFrom, sampleShots, shotBounds, shotStats, soundShareFrom, speechFacts, type MeasureFile, type VideoFacts } from "../src/pipeline/research-measure.ts";
import { NOT_MEASURED, RULES, fisher, rowText, rulesTable, tableText, verdictOf, type StudiedReel } from "../src/pipeline/research-rules.ts";
import { MIN_SCORED, pickSample, postsPerWeek, studyAccount } from "../src/pipeline/research-sample.ts";
import { stagePrompt } from "../src/pipeline/stages.ts";
import { heardFrom, transcribe, type Heard } from "../src/transcribe.ts";
import { Vault } from "../src/vault.ts";

const NOW = new Date("2026-11-19T20:00:00Z");

async function memoryVault(): Promise<Vault> {
  const vault = new Vault(createClient({ url: ":memory:" }));
  await vault.ensureTables();
  return vault;
}

const reel = (acc: string, i: number, views: number | null, extra: Partial<Media> = {}, daysAgo = 10 + i): Media => ({
  id: `${acc}-${i}`,
  caption: `${acc} reel ${i}`,
  mediaType: "VIDEO",
  productType: "REELS",
  timestamp: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
  permalink: `https://www.instagram.com/reel/${acc}${i}/`,
  mediaUrl: `https://cdn.example/${acc}${i}.mp4`,
  thumbnailUrl: `https://cdn.example/${acc}${i}.jpg`,
  likes: 10,
  comments: 1,
  views,
  ...extra,
});

const account = (username: string, views: (number | null)[], extra: (i: number) => Partial<Media> = () => ({})): DiscoveredAccount => ({ username, followers: 1000, posts: views.length, media: views.map((v, i) => reel(username, i, v, extra(i))) });

// 16 Reels, median 100: the top 4 are 5, 4, 3 and 2 times the median.
const SIXTEEN = [500, 400, 300, 200, 100, 100, 100, 100, 100, 100, 100, 100, 90, 80, 70, 60];

// --- Reading another account ----------------------------------------------------------

describe("discoverAccount", () => {
  const row = (i: number) => ({ id: String(i), media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-01T00:00:00+0000", permalink: `https://www.instagram.com/reel/${i}/`, media_url: `https://cdn/${i}.mp4`, like_count: 10, comments_count: 2, view_count: 1000 + i, media_audio_type: "ORIGINAL_SOUND" });
  const page = (rows: unknown[], after?: string) => new Response(JSON.stringify({ business_discovery: { username: "stickmanstorys22", followers_count: 5000, media_count: 70, media: { data: rows, ...(after ? { paging: { cursors: { after } } } : {}) } } }), { status: 200 });

  it("reads views and the sound's kind, and follows the cursor past the first 50 posts", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(decodeURIComponent(url));
      return urls.length === 1 ? page(Array.from({ length: 50 }, (_, i) => row(i)), "CURSOR1") : page(Array.from({ length: 20 }, (_, i) => row(50 + i)), "CURSOR2");
    }) as typeof fetch;
    const a = await discoverAccount(fetchImpl, "EAAx", "ig1", "https://www.instagram.com/stickmanstorys22/", 200);
    expect(a).toMatchObject({ username: "stickmanstorys22", followers: 5000, gave: { views: true, audioType: true } });
    expect(a.media).toHaveLength(70);
    expect(a.media[0]).toMatchObject({ id: "0", likes: 10, comments: 2, views: 1000, audioType: "ORIGINAL_SOUND", productType: "REELS" });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("business_discovery.username(stickmanstorys22)");
    expect(urls[0]).toContain("view_count");
    expect(urls[0]).toContain("graph.facebook.com");
    expect(urls[1]).toContain("media.after(CURSOR1).limit(50)");
  });

  it("drops a field Instagram refuses and asks again", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(decodeURIComponent(url));
      if (urls.at(-1)!.includes("media_audio_type")) return new Response(JSON.stringify({ error: { message: "(#100) Tried accessing nonexisting field (media_audio_type) on node type (Media)", code: 100 } }), { status: 400 });
      return page([{ ...row(1), media_audio_type: undefined }]);
    }) as typeof fetch;
    const a = await discoverAccount(fetchImpl, "EAAx", "ig1", "stickmanstorys22");
    expect(urls).toHaveLength(2);
    expect(a.gave).toEqual({ views: true, audioType: false });
    expect(a.media[0]).toMatchObject({ views: 1001, audioType: null });
  });

  it("refuses something that isn't a username", async () => {
    await expect(discoverAccount(fetch, "EAAx", "ig1", "not a name!")).rejects.toThrow("isn't an Instagram username");
  });
});

// --- Which accounts -------------------------------------------------------------------

describe("the accounts to study", () => {
  it("lists two or three accounts for every format, each a valid username", () => {
    const file = fileAccounts();
    for (const f of RESEARCH_FORMATS) {
      expect(file[f].length, f).toBeGreaterThanOrEqual(2);
      expect(file[f].length, f).toBeLessThanOrEqual(3);
      for (const a of file[f]) expect(cleanHandle(a)).toBe(a);
    }
    expect(RESEARCH_FORMATS).toEqual(["story", "satisfying", "explainer", "ad"]);
  });

  it("reads accounts typed for one run", () => {
    expect(parseAccounts("story: @a, https://www.instagram.com/b/ ; ad: c")).toEqual({ story: ["a", "b"], ad: ["c"] });
    expect(parseAccounts("a, b", "explainer")).toEqual({ explainer: ["a", "b"] });
    expect(parseAccounts("a, b")).toEqual({});
    expect(parseAccounts("https://www.instagram.com/a/", "story")).toEqual({ story: ["a"] });
    expect(cleanHandle("not a name!")).toBeNull();
  });

  it("uses the run's accounts for a format, else the file's", () => {
    const json = JSON.stringify({ story: [{ account: "one" }, "two"], ad: ["three"] });
    expect(accountsFor("story", "", json)).toEqual(["one", "two"]);
    expect(accountsFor("story", "ad: x", json)).toEqual(["one", "two"]);
    expect(accountsFor("ad", "ad: x, y", json)).toEqual(["x", "y"]);
    expect(accountsFor("satisfying", "", json)).toEqual([]);
  });
});

// --- Winners and average Reels ------------------------------------------------------------

describe("scoring an account's Reels against the account itself", () => {
  it("calls a Reel a winner when it's in the top quarter and well above the median", () => {
    const s = studyAccount(account("a", SIXTEEN), NOW);
    expect(s).toMatchObject({ scoredBy: "views", median: 100, winners: 4, average: 8, problem: null, settled: 16 });
    expect(s.candidates.filter((c) => c.group === "winner").map((c) => c.lift)).toEqual([5, 4, 3, 2]);
    expect(s.candidates.filter((c) => c.group === "average").every((c) => c.lift === 1)).toBe(true);
    expect(s.candidates.filter((c) => c.group === "other")).toHaveLength(4);
  });

  it("has no winners in an account whose best Reels are barely above its median", () => {
    const s = studyAccount(account("flat", [120, 115, 110, 105, 100, 100, 100, 100, 100, 100, 100, 100, 95, 90, 85, 80]), NOW);
    expect(s.winners).toBe(0);
    expect(s.average).toBe(8);
  });

  it("leaves out Reels still collecting views and Reels over a year old", () => {
    const acc = account("a", SIXTEEN);
    acc.media.push(reel("a", 100, 999_999, {}, 2), reel("a", 101, 999_999, {}, 400));
    const s = studyAccount(acc, NOW);
    expect(s.reels).toBe(18);
    expect(s.settled).toBe(16);
    expect(s.candidates.some((c) => c.views === 999_999)).toBe(false);
  });

  it("scores by likes and comments when Instagram gives no views, and says so", () => {
    const s = studyAccount(account("a", SIXTEEN.map(() => null), (i) => ({ likes: SIXTEEN[i]!, comments: 0 })), NOW);
    expect(s).toMatchObject({ scoredBy: "likes and comments", median: 100, winners: 4 });
  });

  it("can't use an account with too few scored Reels", () => {
    const s = studyAccount(account("small", [300, 200, 100, 100, 50]), NOW);
    expect(s.problem).toBe(`only 5 Reels old enough to score (needs ${MIN_SCORED})`);
    expect(s.candidates).toEqual([]);
    expect(studyAccount(account("new", SIXTEEN, () => ({ timestamp: NOW.toISOString() })), NOW).problem).toContain("between 7 and 365 days old");
  });

  it("takes winners and average Reels from the accounts in turns", () => {
    const sample = pickSample([studyAccount(account("a", SIXTEEN), NOW), studyAccount(account("b", SIXTEEN), NOW), { ...studyAccount(account("c", SIXTEEN), NOW), problem: "unreadable" }], 6);
    expect(sample.winners.map((c) => `${c.account}:${c.lift}`)).toEqual(["a:5", "b:5", "a:4", "b:4", "a:3", "b:3"]);
    expect(sample.average).toHaveLength(6);
    expect(new Set(sample.average.map((c) => c.account))).toEqual(new Set(["a", "b"]));
  });

  it("counts posts a week over what was fetched", () => {
    expect(postsPerWeek([reel("a", 0, 1, {}, 0), reel("a", 1, 1, {}, 14)], NOW)).toBe(1);
    expect(postsPerWeek([reel("a", 0, 1, {}, 0)], NOW)).toBeNull();
  });
});

// --- What code measures -----------------------------------------------------------------

describe("measuring a Reel", () => {
  it("reads the caption with the same tests the gates use", () => {
    const f = captionFacts("He found a door in his kitchen. Would you open it?\nFollow for part 2! #stickman #story #fyp");
    expect(f).toMatchObject({ firstLine: "He found a door in his kitchen. Would you open it?", firstLineChars: 50, hasQuestion: true, callToAction: true, hashtags: 3, leansOnEpisodes: true, sells: false, saysAI: false });
    expect(captionFacts("Episode 4: the night shift #12")).toMatchObject({ leansOnEpisodes: true, hashtags: 0 });
    expect(captionFacts("So satisfying. Made with AI #oddlysatisfying").saysAI).toBe(true);
    expect(captionFacts("Sign up today, link in bio").sells).toBe(true);
    expect(captionFacts("A quiet day #part2goals")).toMatchObject({ leansOnEpisodes: false, hashtags: 1 });
    expect(captionFacts("")).toMatchObject({ chars: 0, hashtags: 0, hasQuestion: false });
  });

  it("turns ffmpeg's scene changes into cuts and shots", () => {
    const showinfo = "pts_time:0.1\npts_time:3.0\npts_time:3.1\npts_time:6.02\npts_time:9\npts_time:11.9";
    const cuts = cutTimes(showinfo, 12);
    // 0.1 and 11.9 are too close to the ends, 3.1 too close to 3.0.
    expect(cuts).toEqual([3, 6.02, 9]);
    expect(shotBounds(cuts, 12)).toHaveLength(4);
    expect(shotStats(cuts, 12)).toEqual({ shots: 4, medianShot: 3, longestShot: 3, firstCutAt: 3 });
    expect(shotStats([], 20)).toEqual({ shots: 1, medianShot: 20, longestShot: 20, firstCutAt: null });
  });

  it("reads loudness and silence from ffmpeg's output", () => {
    expect(lufsFrom("[Parsed_ebur128_1 @ 0x1] t: 1 M: -20.0\n[Parsed_ebur128_1 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.2 LUFS")).toBe(-14.2);
    expect(lufsFrom("Summary:\n  Integrated loudness:\n    I:         -70.0 LUFS")).toBeNull();
    expect(lufsFrom("nothing")).toBeNull();
    expect(soundShareFrom("silence_start: 0\nsilence_end: 2 | silence_duration: 2", 10)).toBe(0.8);
    expect(soundShareFrom("silence_start: 5", 10)).toBe(0.5);
    expect(soundShareFrom("", 10)).toBe(1);
  });

  it("measures the voice from a transcript with times", () => {
    const heard: Heard = {
      text: "",
      language: "en",
      // Ten words in the first shot (0.5 s to 3 s), none in the second, two in the third.
      words: [...Array.from({ length: 10 }, (_, i) => ({ word: i === 9 ? "night." : `w${i}`, start: 0.5 + i * 0.25, end: 0.7 + i * 0.25 })), { word: "Then", start: 9, end: 9.2 }, { word: "silence.", start: 9.3, end: 9.6 }],
      events: [{ what: "music", at: 0 }, { what: "laughter", at: 4 }],
    };
    const s = speechFacts(heard, 12, [4, 8]);
    expect(s).toMatchObject({ words: 12, firstWordAt: 0.5, speechShotShare: 0.67, music: true, sounds: ["laughter"] });
    // 12 words in about 3.05 s of speaking; pauses aren't counted.
    expect(s.wordsPerSecond).toBeCloseTo(3.9, 1);
    // Between the cuts at 4 s and 8 s nobody speaks and nothing cuts.
    expect(s.longestStill).toBe(4);
    expect(s.text).toBe("0.5 s: w0 w1 w2 w3 w4 w5 w6 w7 w8 night.\n9 s: Then silence.");
    expect(speechFacts({ text: "", language: null, words: [], events: [] }, 10, [])).toMatchObject({ words: 0, firstWordAt: null, wordsPerSecond: null, longestStill: 10 });
  });

  it("spreads the frames Claude sees over the Reel, first and last shot included", () => {
    const shots = Array.from({ length: 30 }, (_, i) => i);
    const picked = sampleShots(shots, 12);
    expect(picked).toHaveLength(12);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(29);
    expect(sampleShots([1, 2, 3], 12)).toEqual([1, 2, 3]);
  });
});

describe("speech to text", () => {
  const answer = { language_code: "en", text: "Hello there.", words: [{ text: "(music)", type: "audio_event", start: 0, end: 1 }, { text: "Hello", type: "word", start: 0.4, end: 0.7 }, { text: " ", type: "spacing", start: 0.7, end: 0.8 }, { text: "there.", type: "word", start: 0.8, end: 1.1 }] };

  it("keeps words with their times and sound tags, and drops spacing", () => {
    expect(heardFrom(answer)).toEqual({ text: "Hello there.", language: "en", words: [{ word: "Hello", start: 0.4, end: 0.7 }, { word: "there.", start: 0.8, end: 1.1 }], events: [{ what: "music", at: 0 }] });
    expect(heardFrom(null)).toEqual({ text: "", language: null, words: [], events: [] });
  });

  it("sends the sound to ElevenLabs with word times and sound tags on", async () => {
    let sent: { url: string; key: string | null; form: FormData } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, key: new Headers(init.headers).get("xi-api-key"), form: init.body as FormData };
      return new Response(JSON.stringify(answer), { status: 200 });
    }) as unknown as typeof fetch;
    const heard = await transcribe(Buffer.from("mp3"), { fetchImpl, apiKey: "key" });
    expect(heard.words).toHaveLength(2);
    expect(sent!.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(sent!.key).toBe("key");
    expect(sent!.form.get("model_id")).toBe("scribe_v2");
    expect(sent!.form.get("tag_audio_events")).toBe("true");
    expect(sent!.form.get("timestamps_granularity")).toBe("word");
    expect(sent!.form.get("file")).toBeInstanceOf(Blob);
  });

  it("fails with ElevenLabs' own words when the key may not transcribe", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ detail: { status: "missing_permissions", message: "The API key you used is missing the permission speech_to_text to execute this operation." } }), { status: 401 })) as unknown as typeof fetch;
    await expect(transcribe(Buffer.from("mp3"), { fetchImpl, apiKey: "key" })).rejects.toThrow("ElevenLabs speech to text said: The API key you used is missing the permission");
    await expect(transcribe(Buffer.from("mp3"), { apiKey: "" })).rejects.toThrow("ELEVENLABS_API_KEY isn't set");
  });
});

// --- Our rules, measured ------------------------------------------------------------------

const video = (seconds: number, shotSeconds = 2.5): VideoFacts => {
  const cuts = Array.from({ length: Math.max(0, Math.ceil(seconds / shotSeconds) - 1) }, (_, i) => Math.round((i + 1) * shotSeconds * 100) / 100);
  return { seconds, cuts, ...shotStats(cuts, seconds), lufs: -14, soundShare: 1 };
};

const studied = (group: "winner" | "average", i: number, over: Partial<StudiedReel> = {}): StudiedReel => ({
  url: `https://www.instagram.com/reel/${group}${i}/`,
  account: "a",
  postedAt: "2026-10-01",
  ageDays: 40,
  caption: "",
  views: 1000,
  likes: 10,
  comments: 1,
  audioType: null,
  mediaUrl: null,
  thumbnailUrl: null,
  score: 1000,
  lift: group === "winner" ? 3 : 1,
  group,
  id: `${group[0]}${i}`,
  facts: captionFacts("A night cleaner hears a knock. Who is it?\n#stickman #story #fyp"),
  video: null,
  speech: null,
  labels: null,
  ...over,
});

describe("our rules, counted on winners and on average Reels", () => {
  it("has one row a rule, each from stages 3 to 6, with gate numbers read from the gates", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(RULES.every((r) => r.stage >= 3 && r.stage <= 6)).toBe(true);
    expect(RULES.find((r) => r.id === "shots")!.rule).toBe(`${MIN_SHOTS} to ${MAX_SHOTS} shots`);
    expect(NOT_MEASURED.length).toBeGreaterThan(0);
    expect(NOT_MEASURED.every((n) => n.check && n.why)).toBe(true);
  });

  it("knows Fisher's exact test", () => {
    expect(fisher(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
    expect(fisher(5, 5, 5, 5)).toBe(1);
    expect(fisher(10, 0, 0, 10)).toBeCloseTo(0.0000108, 6);
    expect(fisher(0, 0, 0, 0)).toBe(1);
  });

  it("gives a verdict only with enough Reels on both sides", () => {
    expect(verdictOf({ n: 4, follow: 4, median: null }, { n: 10, follow: 0, median: null })).toBe("not enough data");
    expect(verdictOf({ n: 10, follow: 4, median: null }, { n: 10, follow: 9, median: null })).toBe("winners break it");
    expect(verdictOf({ n: 10, follow: 8, median: null }, { n: 10, follow: 5, median: null })).toBe("backed");
    expect(verdictOf({ n: 10, follow: 8, median: null }, { n: 10, follow: 7, median: null })).toBe("no difference");
  });

  it("backs a rule winners follow and average Reels don't, with both medians", () => {
    const reels = [...Array.from({ length: 8 }, (_, i) => studied("winner", i, { video: video(40) })), ...Array.from({ length: 8 }, (_, i) => studied("average", i, { video: video(20) }))];
    const table = rulesTable("story", reels);
    const length = table.find((r) => r.id === "length")!;
    expect(length).toMatchObject({ verdict: "backed", winners: { n: 8, follow: 8, median: 40 }, average: { n: 8, follow: 0, median: 20 }, clear: true });
    expect(rowText(length)).toBe("30 to 60 seconds long (stage 4): 8 of 8 winners, 0 of 8 average Reels. Winners' median 40 s, average 20. A gap this size is unlikely to be chance.");
    // 40 s in 2.5 s shots is 16 shots: over our 14.
    expect(table.find((r) => r.id === "shots")).toMatchObject({ verdict: "winners break it", winners: { follow: 0, median: 16 } });
    // Nobody was labelled or transcribed, so those rules have nothing to count.
    expect(table.find((r) => r.id === "mid-action")).toMatchObject({ verdict: "not enough data", winners: { n: 0 } });
    expect(table.find((r) => r.id === "pace")!.verdict).toBe("not enough data");
    const text = tableText(table);
    expect(text.indexOf("Winners break our rule")).toBeLessThan(text.indexOf("Backed"));
    expect(text).toContain("Not enough Reels to tell");
  });

  it("leaves out Reels that aren't the format, and rules that aren't the format's", () => {
    const reels = [...Array.from({ length: 6 }, (_, i) => studied("winner", i, { video: video(40) })), studied("winner", 9, { video: video(5), labels: { onFormat: "no" } }), ...Array.from({ length: 6 }, (_, i) => studied("average", i, { video: video(40) }))];
    expect(rulesTable("story", reels).find((r) => r.id === "length")!.winners).toMatchObject({ n: 6, follow: 6 });
    const satisfying = rulesTable("satisfying", reels).map((r) => r.id);
    expect(satisfying).toContain("made-with-ai");
    expect(satisfying).not.toContain("pace");
    expect(satisfying).not.toContain("stick-figures");
    expect(rulesTable("story", reels).map((r) => r.id)).not.toContain("made-with-ai");
  });

  it("counts labels and never counts \"unclear\"", () => {
    const labels = (opening: string): ReelLabels => ({ onFormat: "yes", opening, hookText: "He never came back", shots: [{ camera: "wide", people: "1", place: "The kitchen" }, { camera: "close-up", people: "3+", place: "kitchen" }, { camera: "insert", people: "1", place: "a street" }] });
    const reels = [...Array.from({ length: 5 }, (_, i) => studied("winner", i, { labels: labels("action") })), studied("winner", 8, { labels: labels(UNCLEAR) }), ...Array.from({ length: 5 }, (_, i) => studied("average", i, { labels: labels("title-card") }))];
    const table = rulesTable("story", reels);
    expect(table.find((r) => r.id === "mid-action")).toMatchObject({ verdict: "backed", winners: { n: 5, follow: 5 }, average: { n: 5, follow: 0 } });
    expect(table.find((r) => r.id === "hook-short")).toMatchObject({ winners: { n: 6, follow: 6, median: 4 } });
    // "The kitchen" and "kitchen" are one place; with the street that's two.
    expect(table.find((r) => r.id === "two-places")).toMatchObject({ winners: { follow: 6, median: 2 } });
    expect(table.find((r) => r.id === "two-people")).toMatchObject({ winners: { n: 6, follow: 0 }, verdict: "winners break it" });
    expect(table.find((r) => r.id === "cameras")).toMatchObject({ winners: { follow: 6, median: 3 } });
  });
});

// --- The prompts -----------------------------------------------------------------------

describe("stage 1's prompts", () => {
  it("offers Claude exactly the choices code counts", () => {
    const prompt = stagePrompt(1, { FORMAT: "story", NICHE: "x", REELS: "[]" });
    for (const choice of [...Object.values(LABELS).flat(), ...CAMERAS, UNCLEAR]) expect(prompt, choice).toContain(choice);
    for (const field of Object.keys(LABELS)) expect(prompt, field).toContain(`\`${field}\``);
    expect(prompt).not.toContain("{{");
  });

  it("has a niche line for every format, and stories keep theirs", () => {
    for (const f of RESEARCH_FORMATS) expect(nicheFor(f)).toContain("our account is Wright AI Solutions");
    expect(nicheFor("story")).toBe("short story Reels, stick-figure animation and comedy channels; our account is Wright AI Solutions (AI tools for small businesses), and its Reels should bring profile visits that lead to the website");
    expect(nicheFor("satisfying")).not.toContain("stick-figure");
  });

  it("fills the pattern and check prompts", () => {
    const p = stagePrompt(1, { COUNT: "12", FORMAT: "ad", NICHE: "n", WINNER_LIFT: "1.5", REELS: "[]", TABLE: "t" }, "patterns");
    expect(p).toContain("12 ad Reels");
    expect(p).toContain("at least 1.5 times");
    expect(p).not.toContain("{{");
    expect(stagePrompt(1, { QUESTIONS: "1. Is it?", REELS: "[]" }, "check")).toContain("1. Is it?");
  });
});

// --- The whole stage --------------------------------------------------------------------

/** 40 Reels: the first 10 win big (their captions name an amount of money), 20 sit on the median, 10 are below. */
const bigAccount = (name: string, extra: (i: number) => Partial<Media> = () => ({})): DiscoveredAccount =>
  account(name, [...Array.from({ length: 10 }, (_, i) => 1000 - i * 10), ...Array.from({ length: 20 }, () => 100), ...Array.from({ length: 10 }, () => 50)], (i) => ({
    caption: i < 10 ? `He lost $${i + 1}00 in one day. Would you risk it?\nFollow for more #stickman #story #fyp` : `A quiet day at the office. What would you do?\nFollow for more #stickman #story #fyp`,
    mediaUrl: `https://cdn.example/${name}${i}-${i < 10 ? "win" : "avg"}.mp4`,
    ...extra(i),
  }));

type Shown = { id: string; caption: string; open?: string; shots?: string; shotFrames?: number; cover?: string; transcript?: string };
const reelsIn = (prompt: string): Record<string, unknown>[] => JSON.parse(prompt.slice(prompt.indexOf("<reels>") + 7, prompt.indexOf("</reels>")));

const labelFor = (r: Shown): ReelLabels => ({
  id: r.id,
  onFormat: "yes",
  premise: `A man and his money: ${r.caption.slice(0, 20)}`,
  ...(r.open || r.cover ? { art: "stick-figures", lighting: "dark" } : {}),
  ...(r.cover ? { coverText: "" } : {}),
  ...(r.open ? { opening: "action", hookText: "He lost it all", captions: "word-by-word", captionPosition: "lower", shots: Array.from({ length: r.shotFrames ?? 0 }, (_, i) => ({ camera: CAMERAS[i % 3]!, people: "1", place: "office" })) } : {}),
  ...(r.transcript ? { narrator: "third-person", firstLineSaysWhoAndWhere: "yes", question: "Will he get it back?", answered: "at-the-end" } : {}),
});

/** A Claude that labels what it's shown, proposes two patterns, and answers them from the caption. */
function fakeClaude(over: { label?: (r: Shown, round: number) => ReelLabels; patterns?: { pattern: string; question: string }[] } = {}) {
  const prompts: { step: 1 | 2 | 3; prompt: string; reels: Record<string, unknown>[] }[] = [];
  const rounds = new Map<string, number>();
  const ask = async (prompt: string) => {
    const reels = reelsIn(prompt);
    if (prompt.includes("step 1 of 3")) {
      prompts.push({ step: 1, prompt, reels });
      return JSON.stringify({
        reels: (reels as Shown[]).map((r) => {
          rounds.set(r.id, (rounds.get(r.id) ?? 0) + 1);
          return (over.label ?? labelFor)(r, rounds.get(r.id)!);
        }),
      });
    }
    if (prompt.includes("step 2 of 3")) {
      prompts.push({ step: 2, prompt, reels });
      return JSON.stringify({ patterns: over.patterns ?? [{ pattern: "Name an exact amount of money in the first line.", question: "Does the caption's first line name an amount of money?" }, { pattern: "End the caption on a follow.", question: "Does the caption ask for a follow?" }, { pattern: "no question mark", question: "not a question" }] });
    }
    prompts.push({ step: 3, prompt, reels });
    return JSON.stringify({ reels: (reels as Shown[]).map((r) => ({ id: r.id, answers: [/\$\d/.test(r.caption) ? "yes" : "no", "yes"] })) });
  };
  return { ask, prompts };
}

const heardWords: Heard = { text: "", language: "en", events: [], words: Array.from({ length: 20 }, (_, i) => ({ word: `w${i}`, start: 0.2 + i * 0.4, end: 0.5 + i * 0.4 })) };

function fakes() {
  const urlOf = new Map<string, string>();
  const measured: string[] = [];
  const download: ResearchDeps["download"] = async (_f, url, file) => (urlOf.set(file, url), true);
  const measure: MeasureFile = async (file, _dir, name, want) => {
    measured.push(name);
    return { video: video(urlOf.get(file)!.includes("win") ? 40 : 20), open: `${name}-open.jpg`, shotsSheet: `${name}-shots.jpg`, shotFrames: 3, audio: want.audio ? Buffer.from("mp3") : null };
  };
  return { download, measure, measured };
}

const base = (vault: Vault, over: Partial<ResearchDeps> = {}): ResearchDeps => ({
  vault,
  token: "EAAx",
  igUserId: "ig1",
  format: "story",
  accounts: ["a", "b", "c"],
  discover: async (_f, _t, _ig, name) => bigAccount(name),
  ffmpeg: true,
  transcribe: async () => heardWords,
  outDir: null,
  now: () => NOW,
  ...over,
});

describe("runResearch", () => {
  it("compares winners with average Reels, keeps only the pattern the blind check backs, and replaces the old patterns", async () => {
    const vault = await memoryVault();
    await vault.addLesson({ kind: "pattern", stage: 1, text: "Use a numbered, serialized story.", source: LEGACY_SOURCE }, NOW);
    await vault.addLesson({ kind: "avoid", text: "Slow openings.", source: "stage 0" }, NOW);
    expect(await researchBrief(vault, "story")).toBe("- Use a numbered, serialized story.");
    expect(await researchBrief(vault, "ad")).toBe("(none yet)");

    const claude = fakeClaude();
    const f = fakes();
    const out = await mkdtemp(join(tmpdir(), "research-test-"));
    const logs: string[] = [];
    const r = await runResearch(base(vault, { ask: claude.ask, download: f.download, measure: f.measure, outDir: out, log: (m) => logs.push(m) }));

    expect(r.gate.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.gate.checks.every((c) => c.name.startsWith("Story: "))).toBe(true);
    const found = r.findings;
    expect(found.accounts.map((a) => [a.username, a.winners, a.average])).toEqual([["a", 10, 20], ["b", 10, 20], ["c", 10, 20]]);
    expect(found.reels.filter((x) => x.group === "winner")).toHaveLength(12);
    expect(found.reels.filter((x) => x.group === "average")).toHaveLength(12);
    expect(new Set(found.reels.filter((x) => x.group === "winner").map((x) => x.account))).toEqual(new Set(["a", "b", "c"]));
    expect(found).toMatchObject({ videosGiven: 24, videosMeasured: 24, transcripts: 24, labelRounds: 1, asked: true });
    expect(f.measured).toHaveLength(24);

    // Code measured the difference; Claude never supplied a number.
    expect(found.table.find((x) => x.id === "length")).toMatchObject({ verdict: "backed", winners: { n: 12, follow: 12, median: 40 }, average: { n: 12, follow: 0, median: 20 } });
    expect(found.table.find((x) => x.id === "standalone")).toMatchObject({ verdict: "no difference", winners: { follow: 12 } });
    expect(found.table.find((x) => x.id === "pace")!.winners.n).toBe(12);

    // Labelling and checking are blind: no results, no group, no account.
    const blind = claude.prompts.filter((p) => p.step !== 2);
    expect(blind.length).toBeGreaterThanOrEqual(5);
    for (const p of blind) for (const shown of p.reels) expect(Object.keys(shown).sort()).toEqual(["caption", "id", "open", "seconds", "shotFrames", "shots", "transcript"]);
    // The ids don't give the groups away: winners aren't simply the first twelve.
    const ids = found.reels.filter((x) => x.group === "winner").map((x) => x.id).sort();
    expect(ids).not.toEqual(Array.from({ length: 12 }, (_, i) => `r${String(i + 1).padStart(2, "0")}`));

    // Patterns are drawn from one half and checked on the other.
    const proposedFrom = claude.prompts.find((p) => p.step === 2)!.reels.map((x) => x.id);
    const checkedOn = claude.prompts.filter((p) => p.step === 3).flatMap((p) => p.reels.map((x) => x.id));
    expect(proposedFrom).toHaveLength(12);
    expect(checkedOn).toHaveLength(12);
    expect(proposedFrom.filter((id) => checkedOn.includes(id))).toEqual([]);
    expect(found.reels.filter((x) => x.heldOut).map((x) => x.id).sort()).toEqual([...checkedOn].sort());
    expect(claude.prompts.find((p) => p.step === 2)!.reels[0]).toHaveProperty("lift");
    expect(found.patterns).toEqual([
      { pattern: "Name an exact amount of money in the first line.", question: "Does the caption's first line name an amount of money?", winnersYes: 6, winnersAsked: 6, averageYes: 0, averageAsked: 6, kept: true },
      { pattern: "End the caption on a follow.", question: "Does the caption ask for a follow?", winnersYes: 6, winnersAsked: 6, averageYes: 6, averageAsked: 6, kept: false },
    ]);

    // The Vault: the new pattern in, the old one retired, other lessons untouched, all of it in the History.
    const lessons = await vault.lessons();
    expect(lessons.map((l) => [l.kind, l.source, l.text])).toEqual([["avoid", "stage 0", "Slow openings."], ["pattern", patternSource("story"), "Name an exact amount of money in the first line."]]);
    expect(lessons[1]!.evidence).toBe("Does the caption's first line name an amount of money? Yes for 6 of 6 winners and 0 of 6 average Reels it wasn't drawn from");
    const row = await vault.latestStage(1, { subject: "research:story", passedOnly: true });
    expect(row).toMatchObject({ passed: true, attempt: 1 });
    const actions = await vault.actions();
    expect(actions.map((a) => a.kind).sort()).toEqual(["lesson", "stage"]);
    const lesson = actions.find((a) => a.kind === "lesson")!;
    expect(lesson.summary).toBe("Research, story: 12 winners compared with 12 average Reels from @a, @b, @c. Winners break 3 rules of ours, 2 backed, 1 pattern kept, 1 earlier pattern retired.");
    expect(lesson.detail).toContain("Winners break our rule");
    expect(actions.every((a) => !a.onInstagram)).toBe(true);

    // What later stages are told, per format.
    const brief = await researchBrief(vault, "story");
    expect(brief).toContain("Stage 1 compared 12 winning Reels with 12 average Reels from @a, @b, @c (2026-11-19)");
    expect(brief).toContain("- 30 to 60 seconds long (stage 4): 12 of 12 winners, 0 of 12 average Reels.");
    expect(brief).toContain("- Name an exact amount of money in the first line. (Does the caption's first line name an amount of money? Yes for 6 of 6 winners");
    expect(brief).toContain("A man and his money");
    expect(brief).not.toContain("serialized");
    expect(brief).not.toContain("Winners break");
    expect(await researchBrief(vault, "ad")).toBe("(none yet)");

    // The report and the spoken summary.
    expect(r.reportFile).toBe(join(out, "story.md"));
    const report = await readFile(r.reportFile!, "utf8");
    expect(report).toContain("# Stage 1 research: story");
    expect(report).toContain("Passed its gate.");
    expect(report).toContain("- Kept: Name an exact amount of money in the first line.");
    expect(report).toContain("- Dropped: End the caption on a follow.");
    expect(report).toContain("What can't be measured on someone else's Reel");
    expect(report).toBe(`${reportText(found, r.gate)}\n`);
    expect(summaryText(found, true)).toContain("story: 12 winners and 12 average Reels from @a, @b, @c. Winners break 3 rules of ours");
    expect(logs.some((l) => l.includes("24 transcripts (12 min of sound, about $0.04"))).toBe(true);
    await rm(out, { recursive: true, force: true });
    vault.close();
  });

  it("studies covers and captions when Instagram gives no video", async () => {
    const vault = await memoryVault();
    const claude = fakeClaude({ patterns: [] });
    const f = fakes();
    const r = await runResearch(base(vault, { ask: claude.ask, download: f.download, measure: f.measure, discover: async (_f, _t, _ig, name) => bigAccount(name, () => ({ mediaUrl: null })) }));
    expect(r.passed).toBe(true);
    expect(f.measured).toEqual([]);
    expect(r.findings).toMatchObject({ videosGiven: 0, videosMeasured: 0, transcripts: 0 });
    expect(r.findings.reels.every((x) => x.sight === "cover" && x.video === null && x.labels?.art === "stick-figures")).toBe(true);
    expect(Object.keys(claude.prompts[0]!.reels[0]!).sort()).toEqual(["caption", "cover", "id"]);
    expect(r.findings.notes.join(" ")).toContain("Instagram gave no video for 24 of the 24 Reels");
    expect(r.gate.checks.find((c) => c.name.includes("videos Instagram gave"))!.detail).toContain("only covers and captions");
    expect(r.findings.table.find((x) => x.id === "length")!.verdict).toBe("not enough data");
    expect(r.findings.table.find((x) => x.id === "stick-figures")).toMatchObject({ verdict: "no difference", winners: { n: 12, follow: 12 } });
    // No patterns proposed, so nothing to check.
    expect(claude.prompts.filter((p) => p.step === 3)).toEqual([]);
    expect(r.findings.patterns).toEqual([]);
    vault.close();
  });

  it("stops at the gate with one account, without asking Claude or touching the saved patterns", async () => {
    const vault = await memoryVault();
    await vault.addLesson({ kind: "pattern", stage: 1, text: "An old pattern.", source: LEGACY_SOURCE }, NOW);
    const claude = fakeClaude();
    const f = fakes();
    const r = await runResearch(
      base(vault, {
        accounts: ["a", "private"],
        ask: claude.ask,
        download: f.download,
        measure: f.measure,
        discover: async (_f, _t, _ig, name) => {
          if (name === "private") throw new Error("@private can't be read: Instagram only shows business and creator accounts to other apps.");
          return bigAccount(name);
        },
      }),
    );
    expect(r.passed).toBe(false);
    expect(claude.prompts).toEqual([]);
    const failed = r.gate.checks.filter((c) => !c.passed);
    expect(failed[0]).toMatchObject({ name: "Story: at least 2 accounts could be studied", detail: "1 of 2. @private: @private can't be read: Instagram only shows business and creator accounts to other apps" });
    expect(failed.map((c) => c.detail).filter((x) => x?.includes("Claude wasn't asked"))).toHaveLength(2);
    expect((await vault.lessons("pattern")).map((l) => l.text)).toEqual(["An old pattern."]);
    expect(await vault.latestStage(1, { subject: "research:story" })).toMatchObject({ passed: false });
    expect(await vault.latestStage(1, { subject: "research:story", passedOnly: true })).toBeNull();
    expect((await vault.actions()).map((a) => [a.kind, a.ok])).toEqual([["stage", false]]);
    expect(reportText(r.findings, r.gate)).toContain("Did not pass its gate");
    expect(summaryText(r.findings, false)).toContain("It didn't pass its gate, so nothing was saved.");
    vault.close();
  });

  it("doesn't ask Claude when there are too few Reels to compare", async () => {
    const vault = await memoryVault();
    const claude = fakeClaude();
    // 8 Reels an account: 2 winners each, so 4 in all.
    const r = await runResearch(base(vault, { accounts: ["a", "b"], ask: claude.ask, discover: async (_f, _t, _ig, name) => account(name, [500, 400, 100, 100, 100, 100, 90, 80], () => ({ mediaUrl: null, thumbnailUrl: null })) }));
    expect(r.passed).toBe(false);
    expect(claude.prompts).toEqual([]);
    const failed = r.gate.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
    expect(failed).toContain("Story: at least 6 winners and 6 average Reels to compare: 4 winners, 8 average");
    expect(failed).toContain("Story: every Reel was labelled, and none was added: Claude wasn't asked: the checks above come first");
    vault.close();
  });

  it("sends back labels that aren't among the choices, with what was wrong", async () => {
    const vault = await memoryVault();
    const claude = fakeClaude({ patterns: [], label: (r, round) => (r.id === "r03" && round === 1 ? { ...labelFor(r), art: "pretty" } : labelFor(r)) });
    const f = fakes();
    const r = await runResearch(base(vault, { ask: claude.ask, download: f.download, measure: f.measure }));
    expect(r.passed).toBe(true);
    expect(r.findings.labelRounds).toBe(2);
    const again = claude.prompts.filter((p) => p.step === 1).at(-1)!;
    expect(again.reels.map((x) => x.id)).toEqual(["r03"]);
    expect(again.prompt).toContain("- r03: art must be one of stick-figures, other-drawn, 3d-render, live-action, screen-recording, graphics, unclear");
    vault.close();
  });

  it("fails the gate when Claude keeps answering outside the choices", async () => {
    const vault = await memoryVault();
    const claude = fakeClaude({ label: (r) => ({ ...labelFor(r), opening: "explosive" }) });
    const f = fakes();
    const r = await runResearch(base(vault, { ask: claude.ask, download: f.download, measure: f.measure }));
    expect(r.passed).toBe(false);
    expect(r.findings.labelRounds).toBe(3);
    expect(r.gate.checks.find((c) => !c.passed)).toMatchObject({ name: "Story: every label is one of its choices" });
    // No patterns are proposed from labels that failed.
    expect(claude.prompts.filter((p) => p.step !== 1)).toEqual([]);
    expect(await vault.lessons("pattern")).toEqual([]);
    vault.close();
  });

  it("carries on without transcripts when ElevenLabs refuses, and says why", async () => {
    const vault = await memoryVault();
    const claude = fakeClaude({ patterns: [] });
    const f = fakes();
    let calls = 0;
    const r = await runResearch(
      base(vault, {
        ask: claude.ask,
        download: f.download,
        measure: f.measure,
        transcribe: async () => {
          calls++;
          throw new Error("ElevenLabs speech to text said: The API key you used is missing the permission speech_to_text");
        },
      }),
    );
    expect(r.passed).toBe(true);
    // The pool had at most 3 Reels in flight when the first refusal came back.
    expect(calls).toBeLessThanOrEqual(3);
    expect(r.findings.transcripts).toBe(0);
    expect(r.findings.notes.join(" ")).toContain("missing the permission speech_to_text");
    expect(r.findings.table.find((x) => x.id === "pace")!.verdict).toBe("not enough data");
    expect(Object.keys(claude.prompts[0]!.reels[0]!)).not.toContain("transcript");
    vault.close();
  });

  it("fails the gate when the videos couldn't be measured, the way the first run went unnoticed", async () => {
    const vault = await memoryVault();
    const claude = fakeClaude();
    const r = await runResearch(base(vault, { ask: claude.ask, ffmpeg: false, fetchImpl: (async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 })) as unknown as typeof fetch }));
    expect(r.passed).toBe(false);
    expect(r.gate.checks.find((c) => !c.passed)).toMatchObject({ name: "Story: the videos Instagram gave were measured", detail: "0 of 24" });
    expect(r.findings.notes[0]).toContain("ffmpeg isn't installed");
    expect(claude.prompts).toEqual([]);
    vault.close();
  });

  it("keeps each format's findings apart", async () => {
    const vault = await memoryVault();
    const f = fakes();
    await runResearch(base(vault, { ask: fakeClaude().ask, download: f.download, measure: f.measure }));
    const ad = await runResearch(base(vault, { format: "ad", ask: fakeClaude({ patterns: [{ pattern: "Show the product by second two.", question: "Does the caption's first line name an amount of money?" }] }).ask, download: f.download, measure: f.measure }));
    expect(ad.passed).toBe(true);
    expect(ad.gate.checks[0]!.name).toBe("Ad: at least 2 accounts could be studied");
    const patterns = await vault.lessons("pattern");
    expect(patterns.map((l) => [l.source, l.text])).toEqual([["stage 1 (story)", "Name an exact amount of money in the first line."], ["stage 1 (ad)", "Show the product by second two."]]);
    expect(await researchBrief(vault, "ad")).toContain("Show the product by second two.");
    expect(await researchBrief(vault, "ad")).not.toContain("Name an exact amount");
    expect(await researchBrief(vault, "story")).not.toContain("Show the product");
    expect(await researchBrief(vault, "explainer")).toBe("(none yet)");
    vault.close();
  });
});

describe("what Claude is shown", () => {
  it("counts a blind reader's answers only on the Reels it was asked about", () => {
    const held = [...Array.from({ length: 4 }, (_, i) => ({ id: `w${i}`, group: "winner" as const })), ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, group: "average" as const }))];
    const answers = new Map<string, string[]>([["w0", ["yes"]], ["w1", ["yes"]], ["w2", ["yes"]], ["w3", ["unclear"]], ["a0", ["no"]], ["a1", ["yes"]], ["a2", ["no"]]]);
    expect(tallyPatterns([{ pattern: "p", question: "q?" }], answers, held)).toEqual([{ pattern: "p", question: "q?", winnersYes: 3, winnersAsked: 3, averageYes: 1, averageAsked: 3, kept: true }]);
  });

  it("never shows a result in the blind view", () => {
    const shown = blindView({ ...studied("winner", 1, { caption: "c" }), id: "r01", group: "winner", videoGiven: false, sight: "none", shotFrames: 0, heard: false, heldOut: false, files: { open: null, shots: null, cover: null } });
    expect(shown).toEqual({ id: "r01", caption: "c" });
  });
});
