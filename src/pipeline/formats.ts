// What kind of Reel to make next (Thomas, 2026-11-18): about 80%
// entertainment and 20% ads.
//
//   Entertainment
//     story       a standalone stick-figure story (stage 1's patterns)
//     satisfying  a satisfying AI-made video
//     explainer   a current event explained with bold graphics and transitions
//   Ads
//     ad          one product from wright-ai-solutions.com, plus Wright AI
//                 Solutions itself: we build custom AI agents and software
//                 for businesses
//
// The mix is code, not a promise: nextFormat picks from what was already
// made, and gateFormat checks each script against its format.
import type { Check, GateResult } from "./gates.ts";
import { check, gate } from "./gates.ts";
import { join } from "node:path";
import type { Product } from "../vault.ts";
import { fillPrompt, pipelineFile } from "./stages.ts";

export const ENTERTAINMENT = ["story", "satisfying", "explainer"] as const;
export type Format = (typeof ENTERTAINMENT)[number] | "ad";
export const ENTERTAINMENT_SHARE = 0.8;
/** The mix is kept over the last 10 Reels. */
export const MIX_WINDOW = 10;
/** At least this many entertainment Reels between two ads. */
export const MIN_GAP_BETWEEN_ADS = 3;
/** A current event is at most this many days old. */
export const NEWS_MAX_DAYS = 14;

export type Made = { format: Format; productId?: string | null; at: string };
export type Choice = { format: Format; product: Product | null };

/** Characters drawn once and re-posed (the cast sheet) only in formats that have them. */
export const HAS_CAST: Record<Format, boolean> = { story: true, ad: true, explainer: false, satisfying: false };
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
export function formatBrief(c: Choice, block: "ideas" | "script" = "script", fill: Record<string, string> = {}): string {
  const product = c.product ? `\nThe product: ${c.product.name} (${c.product.url}). ${c.product.description ?? ""}` : "";
  return `${fillPrompt(formatPrompt(c.format, block), fill)}${product}`;
}

/** Everything the viewer reads or hears, from a stage 4 script plus its caption. */
export type FormatDraft = {
  caption: string;
  shots: { onScreenText?: string; line?: string; start?: number }[];
  /** Explainers: where each fact comes from. */
  sources?: { url?: string; published?: string; title?: string }[];
};

// Sales talk, not words a story or the news might use ("price", "$2 billion").
export const SELLING = /\b(link in (my |our )?bio|sign ?up|buy (it |one )?now|order now|free trial|discount code|promo code|dm (us|me)|book a (call|demo)|wright ai solutions)\b/i;
const CUSTOM_BUILD = /\bcustom\b[^.!?]{0,60}\b(ai )?(agents?|software|apps?|tools?)\b|\bbuild[^.!?]{0,40}\b(ai )?(agents?|software)\b[^.!?]{0,40}\b(business|you)/i;
const CALL_TO_ACTION = /\b(link in (my |our )?bio|visit|sign ?up|try it|book|dm us|message us|tap)\b/i;
export const MADE_WITH_AI = /\b(made|created|generated|animated) (with|by|using) ai\b|\bai[- ](generated|made|animation|video)\b|#aiart|#ai\b/i;

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
    checks.push(check("The ad says we build custom AI agents and software for businesses", CUSTOM_BUILD.test(all)));
    checks.push(check("The ad ends on a call to action", CALL_TO_ACTION.test(all)));
  } else {
    const sell = all.match(SELLING)?.[0];
    checks.push(check("Entertainment doesn't sell", !sell && others.length === 0, sell ? `says "${sell}"` : others.length ? `names ${others.join(", ")}` : undefined));
  }
  if (c.format === "satisfying") checks.push(check("The caption says it was made with AI", MADE_WITH_AI.test(d.caption)));
  if (c.format === "explainer") {
    const fresh = (d.sources ?? []).filter((s) => {
      const t = Date.parse(s.published ?? "");
      return /^https?:\/\//.test(s.url ?? "") && Number.isFinite(t) && t <= now.getTime() + 86_400_000 && now.getTime() - t <= NEWS_MAX_DAYS * 86_400_000;
    });
    checks.push(check(`At least 2 dated sources from the last ${NEWS_MAX_DAYS} days`, fresh.length >= 2, `${fresh.length} of ${(d.sources ?? []).length} sources are linked, dated and recent`));
    // Thomas (2026-11-20): an explainer ends with a question to the viewer.
    const last = [...d.shots].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).at(-1)?.line?.trim() ?? "";
    checks.push(check("Ends on a question to the viewer", /\?["'”’)]*$/.test(last), last ? `the last line is "${last.slice(-80)}"` : "the last shot has no line"));
  }
  return gate(checks);
}
