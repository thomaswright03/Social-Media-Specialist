// What kind of Reel to make next (Thomas, 2026-11-18): about 80%
// entertainment and 20% ads.
//
//   Entertainment
//     story       a standalone stick-figure story (stage 1's patterns)
//     satisfying  a satisfying AI-made video
//     explainer   a current event explained with bold graphics and transitions
//   Ads
//     ad          one product from wright-ai-solutions.com, told with bold
//                 graphics and the product's own screens, to the people who
//                 would use it (Thomas, 2026-11-20: not an offer to build apps)
//
// The mix is code, not a promise: nextFormat picks from what was already
// made, and gateFormat checks each script against its format.
import type { Check, GateResult } from "./gates.ts";
import { check, gate, soundChecks } from "./gates.ts";
import { join } from "node:path";
import type { Product } from "../vault.ts";
import { fillPrompt, pipelineFile } from "./stages.ts";
import { seriesBrief, seriesChecks, type SeriesPick } from "./series.ts";

export const ENTERTAINMENT = ["story", "satisfying", "explainer"] as const;
export type Format = (typeof ENTERTAINMENT)[number] | "ad";
export const ENTERTAINMENT_SHARE = 0.8;
/** The mix is kept over the last 10 Reels. */
export const MIX_WINDOW = 10;
/** At least this many entertainment Reels between two ads. */
export const MIN_GAP_BETWEEN_ADS = 3;
/** A current event is at most this many days old. */
export const NEWS_MAX_DAYS = 14;
/**
 * An explainer's narration, in words (Thomas, 2026-11-21, on the 30 s killer-robots test: "make the information
 * ones 40-50% longer"). The voice runs about 2.7 words a second at VOICE_SPEED, so this is 40 to 46 s of voice,
 * about 42 to 48 s with the end card.
 */
export const EXPLAINER_WORDS = [105, 125] as const;
/** An explainer's shots: more of them, so each still makes one point in 2 to 3 seconds. */
export const EXPLAINER_SHOTS = [14, 20] as const;

export type Made = { format: Format; productId?: string | null; at: string };
/** `series`: a story that is one episode of a series (src/pipeline/series.ts). */
export type Choice = { format: Format; product: Product | null; series?: SeriesPick | null };

/** Characters drawn once and re-posed (the cast sheet) only in formats that have them. */
export const HAS_CAST: Record<Format, boolean> = { story: true, ad: false, explainer: false, satisfying: false };
/** Formats told by a narrator (stage 4 checks the voice runs through it). */
export const NARRATED: Record<Format, boolean> = { story: true, ad: true, explainer: true, satisfying: false };
/**
 * Formats that inform, so their voice must make sense with no picture: the
 * opening's words say what the video is about (stage 3), and listeners who
 * only hear the narration follow it (stage 4). Thomas, 2026-11-20, on an
 * explainer that opened "Two people solved it": "i dont honestly dont even
 * understand what the videos is about".
 */
export const EARS_ONLY: Record<Format, boolean> = { story: false, ad: true, explainer: true, satisfying: false };

/**
 * A format's own prompt (pipeline/formats/<format>.md, between <!-- block -->
 * markers): "ideas" for stage 2, "script" for stages 3 and 4, "style" for
 * stage 5's art.
 */
export function formatPrompt(format: Format, block: "ideas" | "script" | "style"): string {
  const md = pipelineFile(join("formats", `${format}.md`));
  const m = md.match(new RegExp(`<!-- ${block} -->\\n([\\s\\S]*?)<!-- \\/${block} -->`));
  if (!m) throw new Error(`Format ${format} has no ${block} prompt`);
  return m[1]!.trim();
}

export const isFormat = (f: string): f is Format => f === "ad" || (ENTERTAINMENT as readonly string[]).includes(f);

/**
 * The next format: an ad when that keeps ads at 20% or less of the last 10
 * and the last 3 weren't ads; otherwise the entertainment format made least
 * recently. An ad's product is the one advertised least recently.
 */
export function nextFormat(history: Made[], products: Product[]): Choice {
  const recent = [...history].sort((a, b) => b.at.localeCompare(a.at));
  const window = recent.slice(0, MIX_WINDOW - 1);
  const ads = window.filter((m) => m.format === "ad").length;
  const sinceAd = recent.findIndex((m) => m.format === "ad");
  const gapOk = sinceAd === -1 ? recent.length >= MIN_GAP_BETWEEN_ADS : sinceAd >= MIN_GAP_BETWEEN_ADS;
  if (products.length && gapOk && (ads + 1) / MIX_WINDOW <= 1 - ENTERTAINMENT_SHARE + 1e-9) return { format: "ad", product: nextProduct(history, products) };
  const lastMade = (f: Format) => recent.find((m) => m.format === f)?.at ?? "";
  const format = [...ENTERTAINMENT].sort((a, b) => lastMade(a).localeCompare(lastMade(b)) || ENTERTAINMENT.indexOf(a) - ENTERTAINMENT.indexOf(b))[0]!;
  return { format, product: null };
}

/** The product advertised least recently (A to Z among ties). */
export function nextProduct(history: Made[], products: Product[]): Product | null {
  const last = (p: Product) => history.filter((m) => m.format === "ad" && m.productId === p.id).map((m) => m.at).sort().at(-1) ?? "";
  return [...products].sort((a, b) => last(a).localeCompare(last(b)) || a.name.localeCompare(b.name))[0] ?? null;
}

/**
 * The format's prompt for stage 2 (ideas) or stages 3 and 4 (script), with the
 * ad's product and the explainer's news (NEWS for ideas, SOURCES for script).
 */
/**
 * Each product's opening question, said word for word (`line`), and what the
 * next shots say (`then`). Free Calorie Counter's is Thomas's own hook
 * (`hook`, 2026-11-20): "Are you trying to be healthy, but don't want to pay
 * for an expensive calorie tracking app? Good! Cus we made one for free." Test
 * run 44876401844 drifted to "Fifth app, 'allow tracking'?". The other two were
 * pinned on 2026-11-27, when Thomas called the ads' hooks "terrible" and asked
 * for "muuuch simpler" scripts: they had opened "Junk removal, hands full." and
 * "Ever finish a bathroom? / And hear 'different'?". Change the words here.
 */
export const AD_HOOKS: Record<string, { hook: string; line: string; then: string }> = {
  "Free Calorie Counter": {
    hook: "Are you trying to be healthy, but don't want to pay for an expensive calorie tracking app?",
    line: "Trying to be healthy, but don't want to pay for an app?",
    then: "Good! We made Free Calorie Counter. It's free. No sign-up, no payment! Here's how it works.",
  },
  "AI Waste Bot": {
    hook: "Are you losing leads because nobody texts them back fast?",
    line: "Are you losing leads because nobody texts them back fast?",
    then: "Good! We made AI Waste Bot. It texts every new lead back for you. Here's how it works.",
  },
  "Room Designer 3D": {
    hook: "Do your customers struggle to picture their new bathroom?",
    line: "Do your customers struggle to picture their new bathroom?",
    then: "Good! We made Room Designer 3D. You design the bathroom with your customer. Here's how it works.",
  },
};
export const adHook = (c: Choice) => (c.format === "ad" && c.product ? AD_HOOKS[c.product.name] ?? null : null);

// --- Plain ads (Thomas, 2026-11-27: "we need to make the scripts muuuch simpler for the ads. they are very poorly
// worded.") Every ad follows one template (pipeline/formats/ad.md), and these checks hold its wording to it.

/** An ad's opening: one shot of 3 to 4.5 s whose line is the whole question. */
export const AD_OPENING_SECONDS = [3, 4.5] as const;
/** The opening question, in words. */
export const AD_HOOK_WORDS = 12;
/** Any other sentence, in words. */
export const AD_SENTENCE_WORDS = 10;
/** The whole narration, in words (30 to 40 s at the narrator's pace, with room to breathe). */
export const AD_WORDS = [45, 80] as const;
/** An ad's shots, the opening included. */
export const AD_SHOTS = [10, 12] as const;
/** The narration's reading grade at most (Flesch-Kincaid, the product's name left out). */
export const AD_MAX_GRADE = 6;

const plainWords = (t: string) => t.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
/** Spoken words with no audio tags, lower-cased with no punctuation, for comparing two lines. */
export const normalLine = (t: string) =>
  plainWords(t)
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .join(" ");
/** The sentences in a line (audio tags dropped). */
export const sentences = (t: string) =>
  t
    .replace(/\[[^\]]*\]/g, " ")
    .split(/(?<=[.!?]["'”’)]*)\s+/)
    .map((x) => x.trim())
    .filter((x) => /[\p{L}\p{N}]/u.test(x));
/** A whole sentence: starts with a capital letter (or a number or quote) and ends with . ! or ?. */
export const WHOLE_SENTENCE = /^["'“‘(]?[\p{Lu}\p{N}][\s\S]*[.!?]["'”’)]*$/u;

/** Syllables in an English word, by vowel groups (good enough to tell plain from wordy). */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Flesch-Kincaid grade of a text: about the school year a reader needs. */
export function readingGrade(text: string): number {
  const ss = sentences(text);
  const ws = plainWords(text);
  if (!ss.length || !ws.length) return 0;
  const syl = ws.reduce((n, w) => n + (/^\W*\d/.test(w) ? 1 : syllables(w)), 0);
  return 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
}

const stem = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(ing|ed|es|s)$/, "");
/** Of an on-screen text's words (3+ letters, no bare numbers), the share also heard in the shot's line. */
export function heardShare(onScreen: string, line: string): number {
  const heard = new Set(plainWords(line).map(stem));
  const shown = plainWords(onScreen)
    .map(stem)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  if (!shown.length) return 1;
  return shown.filter((w) => heard.has(w)).length / shown.length;
}

type AdShot = FormatDraft["shots"][number] & { end?: number; audio?: string };
const untagged = (t: string) => t.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

/** Stage 3: an ad opens on one shot whose words are the whole question (the product's own, if it has one). */
export function adOpeningChecks(c: Choice, o: { shots?: AdShot[] } | null): Check[] {
  const shots = o?.shots ?? [];
  const first = shots[0];
  const said = untagged(first?.audio ?? first?.line ?? "");
  const secs = (first?.end ?? 0) - (first?.start ?? 0);
  const parts = sentences(said);
  const words = plainWords(said).length;
  const h = adHook(c);
  return [
    check(
      `The ad opens on one shot of ${AD_OPENING_SECONDS[0]} to ${AD_OPENING_SECONDS[1]} s`,
      shots.length === 1 && secs >= AD_OPENING_SECONDS[0] - 0.01 && secs <= AD_OPENING_SECONDS[1] + 0.01,
      shots.length !== 1 ? `${shots.length} shots` : `${secs.toFixed(1)} s`,
    ),
    check(`The opening says one whole question of ${AD_HOOK_WORDS} words or fewer`, parts.length === 1 && WHOLE_SENTENCE.test(parts[0]!) && /\?["'”’)]*$/.test(said) && words <= AD_HOOK_WORDS, said ? `says "${said}" (${words} words)` : "no words"),
    ...(h ? [check("The opening asks this product's question, word for word", normalLine(said) === normalLine(h.line), `should say "${h.line}"${said ? `, says "${said}"` : ""}`)] : []),
  ];
}

/** Stage 4: the ad's lines are short, whole, plain sentences in the template's order. */
export function adWordingChecks(c: Choice, shots: AdShot[]): Check[] {
  const ordered = [...shots].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const lines = ordered.map((s) => untagged(s.line ?? ""));
  const name = c.product?.name ?? "";
  const h = adHook(c);
  const broken = lines.map((l, i) => ({ l, i })).filter(({ l }) => l && !sentences(l).every((x) => WHOLE_SENTENCE.test(x)));
  const long = lines.flatMap((l, i) => sentences(l).map((x) => ({ x, i, n: plainWords(x).length }))).filter(({ i, n }) => n > (i === 0 ? AD_HOOK_WORDS : AD_SENTENCE_WORDS));
  const words = lines.reduce((n, l) => n + plainWords(l).length, 0);
  const all = lines.filter(Boolean).join(" ");
  const grade = readingGrade(name ? all.split(name).join("It") : all);
  const good = lines.slice(1, 3).find((l) => /^good\b/i.test(l) && l.toLowerCase().includes(name.toLowerCase()));
  const how = lines.some((l) => /\bhere'?s how it works\b/i.test(l.replace(/’/g, "'")));
  const unheard = ordered
    .map((s, i) => ({ s, i }))
    .slice(1)
    .filter(({ s }) => s.onScreenText?.trim() && s.line?.trim() && heardShare(s.onScreenText, s.line) < 0.5);
  return [
    ...(h ? [check("The ad opens with this product's question, word for word", normalLine(lines[0] ?? "") === normalLine(h.line), `should say "${h.line}", says "${lines[0] ?? ""}"`)] : []),
    check("Every line is a whole sentence (none split across shots)", broken.length === 0, broken.length ? broken.map(({ l, i }) => `shot ${i + 1}: "${l}"`).join("; ") : undefined),
    check(`Short sentences (${AD_SENTENCE_WORDS} words at most; the opening question ${AD_HOOK_WORDS})`, long.length === 0, long.length ? long.map(({ x, i, n }) => `shot ${i + 1}: ${n} words, "${x}"`).join("; ") : undefined),
    check(`The narration is ${AD_WORDS[0]} to ${AD_WORDS[1]} words`, words >= AD_WORDS[0] && words <= AD_WORDS[1], `${words} words`),
    check(`Plain words (reading grade ${AD_MAX_GRADE} or lower)`, grade <= AD_MAX_GRADE, `grade ${grade.toFixed(1)}`),
    check(`Says "Good! We made ${name || "the product"}." right after the question`, Boolean(good), good ? undefined : `shots 2 and 3 say "${lines.slice(1, 3).join(" / ")}"`),
    check(`Says "Here's how it works."`, how),
    check("On-screen words are the words you hear in that shot", unheard.length === 0, unheard.length ? unheard.map(({ s, i }) => `shot ${i + 1}: shows "${s.onScreenText}", says "${untagged(s.line ?? "")}"`).join("; ") : undefined),
  ];
}

export function formatBrief(c: Choice, block: "ideas" | "script" = "script", fill: Record<string, string> = {}): string {
  const product = c.product ? `\nThe product: ${c.product.name} (${c.product.url}). ${c.product.description ?? ""}` : "";
  const h = adHook(c);
  const hook = h
    ? block === "ideas"
      ? `\nThis product's question is set. Every pitch's \`sentence\` is exactly: "${h.line}" The pitches differ only in their \`answer\`: which three steps of the product they show.`
      : `\nThis product's question is set, and the ad opens with it, word for word: "${h.line}" Then, in the next shots: "${h.then}" Code checks both.`
    : "";
  const series = c.series ? `\n\n${seriesBrief(c.series, block)}` : "";
  return `${fillPrompt(formatPrompt(c.format, block), fill)}${product}${hook}${series}`;
}

/** Everything the viewer reads or hears, from a stage 4 script plus its caption. */
export type FormatDraft = {
  caption: string;
  shots: { onScreenText?: string; line?: string; start?: number; visual?: string; sound?: string; pause?: boolean }[];
  /** The script's two-sentence story and its payoff. */
  story?: string;
  payoff?: string;
  /** Explainers: where each fact comes from. */
  sources?: { url?: string; published?: string; title?: string }[];
};

// Sales talk, not words a story or the news might use ("price", "$2 billion").
export const SELLING = /\b(link in (my |our )?bio|sign ?up|buy (it |one )?now|order now|free trial|discount code|promo code|dm (us|me)|book a (call|demo)|wright ai solutions)\b/i;
const CUSTOM_BUILD = /\bcustom\b[^.!?]{0,60}\b(ai )?(agents?|software|apps?|tools?)\b|\bbuild[^.!?]{0,40}\b(ai )?(agents?|software)\b[^.!?]{0,40}\b(business|you)/i;
const CALL_TO_ACTION = /\b(link in (my |our )?bio|visit|sign ?up|try it|book|dm us|message us|tap)\b/i;
export const MADE_WITH_AI = /\b(made|created|generated|animated) (with|by|using) ai\b|\bai[- ](generated|made|animation|video)\b|#aiart|#ai\b/i;

/** Colour words a satisfying video's later on-screen text can't use: the simulation, not the script, decides who leads. */
export const COLOUR_WORD = /\b(green|pink|blue|yellow|orange|red|purple|gold|teal|cyan|mint|white|lilac|cream|sky|lime|violet|indigo|rainbow)\b/i;
/** A race's order, which only the run decides (test run 44841594624: "they finish fully reversed, violet first"). */
export const RACE_ORDER = new RegExp(`\\b(reversed?( order)?|in (rainbow|the same|exact|the exact) order|takes? the lead|overtakes?|(${COLOUR_WORD.source.replace(/\\b/g, "")})( ball)?( \\w+){0,3} (first|last|wins?|leads?|ahead|in front))\\b`, "i");
const MANY = /\b(five|six|seven|eight|nine|ten|eleven|twelve|[5-9]|[1-9]\d) (\w+ )?(coloured |colored )?balls\b/i;
/** Things a physics scene never has. */
export const NOT_IN_SCENE = /\b(flags?|teams?|players?|countr(y|ies)|nations?|horses?|cars?|runners?)\b/i;

/** Words that jump an explainer to a second, unrelated fact. */
export const STORY_JUMP = /\b(separately|elsewhere|meanwhile|in other news|on top of that|in another)\b/i;

const named = (text: string, p: Product) => text.toLowerCase().includes(p.name.toLowerCase());

/** The format's own checks, run with stage 4's gate (and again at stage 6 on the caption). */
export function gateFormat(c: Choice, d: FormatDraft, products: Product[], now = new Date()): GateResult {
  const spoken = d.shots.map((s) => [s.onScreenText, s.line].filter(Boolean).join(" ")).join(" ");
  const all = `${spoken} ${d.caption}`;
  const others = products.filter((p) => p.id !== c.product?.id && named(all, p)).map((p) => p.name);
  const checks: Check[] = [];
  if (c.format === "ad") {
    const p = c.product;
    checks.push(check("The ad names its one product", Boolean(p) && named(all, p!), p ? `"${p.name}" isn't in the script or caption` : "no product chosen"));
    checks.push(check("The ad markets only one product", others.length === 0, others.length ? `also names ${others.join(", ")}` : undefined));
    // Thomas, 2026-11-20: "we are advertising people to use the calorie app. not offering to make apps."
    const pitch = all.match(CUSTOM_BUILD)?.[0];
    checks.push(check("The ad sells the product itself, not custom software", !pitch, pitch ? `says "${pitch}"` : undefined));
    checks.push(check("The ad ends on a call to action", CALL_TO_ACTION.test(all)));
    // Thomas, 2026-11-27: "we need to make the scripts muuuch simpler for the ads". A caption alone has no lines to check.
    if (d.shots.some((s) => s.line?.trim())) checks.push(...adWordingChecks(c, d.shots));
  } else {
    const sell = all.match(SELLING)?.[0];
    checks.push(check("Entertainment doesn't sell", !sell && others.length === 0, sell ? `says "${sell}"` : others.length ? `names ${others.join(", ")}` : undefined));
  }
  // Narrated Reels get their effects from the script's cues; a physics run makes its own notes.
  if (NARRATED[c.format]) checks.push(...soundChecks([...d.shots].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))));
  if (c.format === "satisfying") {
    checks.push(check("The caption says it was made with AI", MADE_WITH_AI.test(d.caption)));
    // The run decides who leads and wins, so later words can't say (test run 3: "PINK PULLS AHEAD", "WHOSE FLAG WINS?").
    const ordered = [...d.shots].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const called = ordered.slice(1).map((s) => s.onScreenText?.match(COLOUR_WORD)?.[0]).find(Boolean);
    const invented = ordered.map((s) => s.onScreenText?.match(NOT_IN_SCENE)?.[0]).find(Boolean);
    checks.push(check("On-screen words after the hook name no colour (the run decides who leads)", !called, called ? `says "${called}"` : undefined));
    checks.push(check("On-screen words name nothing the scene doesn't have (flags, teams, players)", !invented, invented ? `says "${invented}"` : undefined));
    // A race has 2 to 4 balls and the run decides their order, so the script can't promise either.
    const told = [d.story, d.payoff, ...ordered.map((s) => s.visual)].filter(Boolean).join(" ");
    if (/\b(race|laps?)\b/i.test(told)) {
      const order = told.match(RACE_ORDER)?.[0];
      const many = told.match(MANY)?.[0];
      checks.push(check("A race's script promises no order (the run decides who finishes where)", !order, order ? `says "${order}"` : undefined));
      checks.push(check("A race has 2 to 4 balls", !many, many ? `says "${many}"` : undefined));
    }
  }
  if (c.format === "explainer") {
    const fresh = (d.sources ?? []).filter((s) => {
      const t = Date.parse(s.published ?? "");
      return /^https?:\/\//.test(s.url ?? "") && Number.isFinite(t) && t <= now.getTime() + 86_400_000 && now.getTime() - t <= NEWS_MAX_DAYS * 86_400_000;
    });
    const words = d.shots.reduce((n, s) => n + (s.line ?? "").replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 0);
    checks.push(check(`The narration is ${EXPLAINER_WORDS[0]} to ${EXPLAINER_WORDS[1]} words (about 45 seconds)`, words >= EXPLAINER_WORDS[0] && words <= EXPLAINER_WORDS[1], `${words} words`));
    checks.push(check(`At least 2 dated sources from the last ${NEWS_MAX_DAYS} days`, fresh.length >= 2, `${fresh.length} of ${(d.sources ?? []).length} sources are linked, dated and recent`));
    // One story: test run 3's listeners lost the thread at "Separately, 65% in three islands..." (2026-11-20).
    const jump = d.shots.map((s) => s.line ?? "").join(" ").match(STORY_JUMP)?.[0];
    checks.push(check("Tells one story (no \"separately\", \"elsewhere\", \"meanwhile\" jumping to another fact)", !jump, jump ? `says "${jump}"` : undefined));
    // Thomas (2026-11-20): an explainer ends with a question to the viewer.
    const last = [...d.shots].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).at(-1)?.line?.trim() ?? "";
    checks.push(check("Ends on a question to the viewer", /\?["'”’)]*$/.test(last), last ? `the last line is "${last.slice(-80)}"` : "the last shot has no line"));
  }
  if (c.series) checks.push(...seriesChecks(c.series, d));
  return gate(checks);
}
