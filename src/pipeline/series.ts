// A story series (Thomas, 2026-11-23: "Let's make a 8 part series with prompts
// for every part to ensure high quality"). Our first series decayed because
// each part leaned on the one before (pipeline/avoid.md), so a series here is a
// recurring character and place, never a continuing plot: each episode is a
// complete stick-figure story, and the gates still read it cold.
//
// Thomas's requirements (2026-11-23, pipeline/series/REQUIREMENTS.md): a
// prompt for every part, an outro that names the next part ("Part 2
// tomorrow!"), and 1 to 2 minutes a part. The outro is the one place a part
// number may appear, and since it promises tomorrow, parts go out in order and
// a failed part is tried again rather than skipped.
//
// Each series has a prompt file (pipeline/series/<id>.md) with the shared
// rules, the look, and one brief per episode, and the checks below, which code
// runs on every episode's script (stage 4, and the ideas at stage 2):
//   - it opens by saying who the lead is and where, for viewers who are new;
//   - the lead keeps her marker in every drawing, and the guest theirs;
//   - it ends the way its brief locks it;
//   - it mentions no other episode's story;
//   - the caption carries the series tag;
//   - the last line names the next part and "tomorrow", and no other line does.
// "Episode", "previously" and the like stay banned (REFERS_TO_OTHER_EPISODES
// in gates.ts), and so does a part number anywhere but that outro.
import { join } from "node:path";
import type { Vault } from "../vault.ts";
import { check, type Check } from "./gates.ts";
import { fillPrompt, pipelineFile } from "./stages.ts";

export type Episode = {
  n: number;
  title: string;
  /** The ending the brief locks: every one must match the payoff (and a stage 2 finalist's answer). */
  answer: RegExp[];
  /** Each guest's marker; each is named in at least one drawing. */
  guests: RegExp[];
  /** Words only this episode's story uses; no other episode may say them. */
  own: RegExp;
};

export type Series = {
  id: string;
  name: string;
  tag: string;
  lead: { name: string; marker: RegExp; markerText: string };
  /** The place the first lines name. */
  place: RegExp;
  episodes: Episode[];
};

export const NIGHT_DESK: Series = {
  id: "night-desk",
  name: "The Night Desk",
  tag: "#TheNightDesk",
  lead: { name: "Ruth", marker: /\bround glasses\b/i, markerText: "round glasses" },
  place: /\bStarlite\b/i,
  episodes: [
    { n: 1, title: "The 3 a.m. bell", answer: [/\b(asleep|sleepwalk\w*|sleeping)\b/i], guests: [/\bpom-?pom hat\b/i], own: /\b(sleepwalk\w*|pom-?pom)\b/i },
    { n: 2, title: "The pen that comes back different", answer: [/\bcrows?\b/i, /\b(trad\w*|swap\w*|exchang\w*)\b/i], guests: [/\bcrows?\b/i], own: /\bcrows?\b/i },
    { n: 3, title: "Room 12's lamp", answer: [/\bwife\b/i, /\b(care home|across the (road|highway|street))\b/i], guests: [/\bflat cap\b/i], own: /\b(care home|flat cap)\b/i },
    { n: 4, title: "The envelope for Marigold", answer: [/\bpropos\w*/i], guests: [/\bbraid\b/i, /\bbeanie\b/i], own: /\b(marigold|propos\w*)/i },
    { n: 5, title: "No vacancy at 2 a.m.", answer: [/\bowner\b/i, /\bsnor\w*/i], guests: [/\b(moustache|mustache)\b/i], own: /\b(no vacancy|bathrobe|snor\w*)\b/i },
    { n: 6, title: "The car with the window down", answer: [/\bowls?\b/i, /\brecord\w*/i], guests: [/\bbucket hat\b/i], own: /\b(owls?|microphone|station wagon)\b/i },
    { n: 7, title: "The chairs face the window", answer: [/\btruck\w*/i, /\b(sleep|asleep)\b/i], guests: [/\btrucker cap\b/i], own: /\b(trucker cap|armchairs?)\b/i },
    { n: 8, title: "One puzzle piece a night", answer: [/\bpuzzle\b/i, /\b(painting|painted|paints|picture|portrait)\b/i], guests: [/\bpaintbrush\b/i], own: /\b(puzzle|jigsaw)\b/i },
  ],
};

export const SERIES: Record<string, Series> = { [NIGHT_DESK.id]: NIGHT_DESK };

/** The episode a Reel is: kept with stage 2's input, so stages 3 to 5 make the same one. */
export type SeriesPick = { id: string; episode: number };

/** A part's length before the end card (Thomas: "at least one minute long and can be between 1 and 2 minutes"). */
export const SERIES_SECONDS = [60, 120] as const;
/** Its shots: still 2 to 3 seconds each, so something new lands in every 3-second slice. */
export const SERIES_SHOTS = [20, 50] as const;
/** The outro's promise, wherever it is: "Part 3 tomorrow!", "tomorrow, part 3". Taken out before the standalone check. */
export const OUTRO = /\bpart\s*\d+\b[^.!?\n]{0,40}\btomorrow\b[.!]*|\btomorrow\b[^.!?\n]{0,40}\bpart\s*\d+\b[.!]*/gi;
const outroFor = (n: number) => new RegExp(`\\bpart\\s*${n}\\b[^.!?\\n]{0,40}\\btomorrow\\b|\\btomorrow\\b[^.!?\\n]{0,40}\\bpart\\s*${n}\\b`, "i");

const block = (id: string, name: string) => {
  const md = pipelineFile(join("series", `${id}.md`));
  const m = md.match(new RegExp(`<!-- ${name} -->\\n([\\s\\S]*?)<!-- \\/${name} -->`));
  if (!m) throw new Error(`Series ${id} has no ${name} block`);
  return m[1]!.trim();
};

export const seriesOf = (p: SeriesPick | null | undefined) => (p ? SERIES[p.id] ?? null : null);
export const episodeOf = (p: SeriesPick | null | undefined) => seriesOf(p)?.episodes.find((e) => e.n === p!.episode) ?? null;

/** Stage 2 writes 20 openings for one locked story, not 20 stories, so its range rules give way. */
const IDEAS_NOTE = `For this video the story is already chosen: the guest, the odd thing and the ending are locked by the brief below. Your 20 pitches are 20 different ways to open this same story: each \`sentence\` leads with a different detail or angle of its odd thing, and every \`answer\` is the brief's locked ending in one sentence. Here, the range rules about different settings and different endings don't apply, and "different" scores how fresh a sentence's angle is next to the other 19. A sentence never names the series or a number counting the videos.`;

/** What an episode adds to the story format's prompt: the series' shared rules, then this episode's brief. */
export function seriesBrief(p: SeriesPick, stage: "ideas" | "script"): string {
  const s = seriesOf(p);
  if (!s || !episodeOf(p)) throw new Error(`No episode ${p.episode} in series ${p.id}`);
  const last = p.episode === Math.max(...s.episodes.map((e) => e.n));
  const outro = last
    ? "this is the last story in the series, so the outro names no next part and no number. End on the after-beat."
    : `the last shot's line ends with "Part ${p.episode + 1} tomorrow!" (you may lead into it, like "Come back for Part ${p.episode + 1} tomorrow!"). It is the only place in the video, caption included, that says "part" or a part number. The story is already complete before it; the outro promises a new story, never the rest of this one.`;
  return [fillPrompt(block(s.id, "series"), { OUTRO: outro }), stage === "ideas" ? IDEAS_NOTE : "", `This story's brief:\n${block(s.id, `episode ${p.episode}`)}`].filter(Boolean).join("\n\n");
}

/** What stage 5's art adds for an episode: the lead and the place, drawn the same every time. */
export const seriesLook = (p: SeriesPick | null | undefined) => (seriesOf(p) ? block(p!.id, "look") : "");

type Draft = { caption: string; shots: { line?: string; visual?: string; start?: number; onScreenText?: string }[]; story?: string; payoff?: string };

/** An episode's own checks, run with the story format's (stage 4, and stage 6 on the caption). */
export function seriesChecks(p: SeriesPick, d: Draft): Check[] {
  const s = seriesOf(p);
  const e = episodeOf(p);
  if (!s || !e) return [check(`Series episode ${p.id} ${p.episode} exists`, false)];
  const shots = [...d.shots].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const lines = shots.map((x) => x.line?.trim() ?? "").filter(Boolean);
  const visuals = shots.map((x) => x.visual ?? "");
  const lead = new RegExp(`\\b${s.lead.name}\\b`, "i");
  const opening = lines.slice(0, 2).join(" ");
  const withLead = visuals.filter((v) => lead.test(v));
  const bare = withLead.filter((v) => !s.lead.marker.test(v)).length;
  const ending = [d.payoff, d.story].filter(Boolean).join(" ");
  const missing = e.answer.filter((r) => !ending.match(r));
  const guestsMissing = e.guests.filter((r) => !visuals.some((v) => r.test(v)));
  const all = [d.caption, ...shots.flatMap((x) => [x.line, x.onScreenText, x.visual])].filter(Boolean).join(" ");
  const leaks = s.episodes.filter((o) => o.n !== e.n && o.own.test(all)).map((o) => `"${all.match(o.own)![0]}" (from "${o.title}")`);
  const final = e.n === Math.max(...s.episodes.map((x) => x.n));
  const lastLine = shots.at(-1)?.line ?? "";
  const early = shots.slice(0, -1).filter((x) => /\bpart\s*\d+\b/i.test(`${x.line ?? ""} ${x.onScreenText ?? ""}`)).length + (/\bpart\s*\d+\b/i.test(d.caption) ? 1 : 0);
  return [
    check(`Opens by saying who ${s.lead.name} is and where, for new viewers (her name and the motel in the first 2 lines)`, lead.test(opening) && s.place.test(opening), opening ? `the first lines are "${opening.slice(0, 160)}"` : "no lines"),
    check(`${s.lead.name} is in at least half the drawings, always with her ${s.lead.markerText}`, withLead.length * 2 >= visuals.length && bare === 0, `${withLead.length} of ${visuals.length} drawings${bare ? `, ${bare} without her ${s.lead.markerText}` : ""}`),
    check("The guest's marker is named in the drawings", guestsMissing.length === 0, guestsMissing.length ? `no drawing has ${guestsMissing.map((r) => r.source.replace(/\\b/g, "")).join(", ")}` : undefined),
    check(`Ends the way "${e.title}" is locked`, missing.length === 0, missing.length ? `the payoff doesn't say ${missing.map((r) => r.source.replace(/\\b/g, "")).join(" or ")}` : undefined),
    check("Mentions no other episode's story (each one stands alone)", leaks.length === 0, leaks.length ? `says ${leaks.join(", ")}` : undefined),
    check(`The caption carries ${s.tag}`, d.caption.toLowerCase().includes(s.tag.toLowerCase())),
    final
      ? check("The last story's outro names no next part", !/\bpart\s*\d+\b/i.test(lastLine), `the last line is "${lastLine.slice(-80)}"`)
      : check(`The outro says "Part ${e.n + 1} tomorrow"`, outroFor(e.n + 1).test(lastLine), `the last line is "${lastLine.slice(-80)}"`),
    check("A part number only in the outro (not the opening, the middle or the caption)", early === 0, early ? `${early} other places say "part" and a number` : undefined),
  ];
}

/** Stage 2: each finalist's ending is the episode's locked one. */
export function seriesIdeaCheck(p: SeriesPick, id: number, answer: string): Check {
  const e = episodeOf(p);
  const missing = (e?.answer ?? []).filter((r) => !r.test(answer));
  return check(`Finalist ${id} ends the way "${e?.title ?? "the episode"}" is locked`, Boolean(e) && missing.length === 0, missing.length ? `"${answer.slice(0, 120)}"` : undefined);
}

export type SeriesProgress = { posted: number[]; tries: Record<number, number>; lastPostedAt: string | null };

/**
 * The next part to make: the first one not yet posted. Parts never skip ahead,
 * since each outro promised the next one. Null when the series is done.
 */
export function nextEpisode(s: Series, progress: SeriesProgress): SeriesPick | null {
  const e = s.episodes.find((x) => !progress.posted.includes(x.n)) ?? null;
  return e ? { id: s.id, episode: e.n } : null;
}

/** Which episodes went out (a "posted" action on the Reel) and how many Reels each one started. */
export async function seriesProgress(vault: Pick<Vault, "seriesReels">, id: string): Promise<SeriesProgress> {
  const out: SeriesProgress = { posted: [], tries: {}, lastPostedAt: null };
  for (const r of await vault.seriesReels(id)) {
    out.tries[r.episode] = (out.tries[r.episode] ?? 0) + 1;
    if (r.postedAt && !out.posted.includes(r.episode)) out.posted.push(r.episode);
    if (r.postedAt && (!out.lastPostedAt || r.postedAt > out.lastPostedAt)) out.lastPostedAt = r.postedAt;
  }
  out.posted.sort((a, b) => a - b);
  return out;
}
