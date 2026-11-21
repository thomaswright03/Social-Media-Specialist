// Where the explainer's news comes from (Thomas, 2026-11-19): code reads a
// fixed list of news feeds and keeps the last NEWS_MAX_DAYS days; Claude picks
// only from that list and never supplies news from memory. Stages 3 and 4 get
// the text of the items a finalist is built on, and the gate checks that every
// figure the script uses is in that text.
import { NEWS_MAX_DAYS } from "./formats.ts";
import type { Check } from "./gates.ts";
import { check } from "./gates.ts";

/** The feeds, by publisher. Plain RSS or Atom, readable without an account. */
export const NEWS_FEEDS: { publisher: string; url: string }[] = [
  { publisher: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { publisher: "NPR", url: "https://feeds.npr.org/1006/rss.xml" },
  { publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { publisher: "BBC News", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { publisher: "The Guardian", url: "https://www.theguardian.com/business/rss" },
  { publisher: "The Guardian", url: "https://www.theguardian.com/technology/rss" },
  { publisher: "CNBC", url: "https://www.cnbc.com/id/10001147/device/rss/rss.html" },
  { publisher: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { publisher: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { publisher: "TechCrunch", url: "https://techcrunch.com/feed/" },
];

/** At most this many items go to stage 2, newest first. */
export const NEWS_LIST_MAX = 80;
/** Each source's text handed to stages 3 and 4 is cut to this. */
export const SOURCE_TEXT_MAX = 5000;

export type NewsItem = { n: number; headline: string; publisher: string; url: string; published: string; summary: string };
export type SourceText = { url: string; publisher: string; title: string; published: string; text: string };
type Fetch = (url: string) => Promise<string>;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", hellip: "…" };

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (all, e: string) => ENTITIES[e.toLowerCase()] ?? all);

/**
 * Tags and entities out, whitespace squeezed. Entities are decoded before tags
 * are stripped (twice, for double encoding), so an encoded tag like
 * &lt;/sources&gt; in an article can't come out as a real tag in a prompt.
 */
export function plainText(html: string): string {
  const stripTags = (s: string) => s.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<\/?[a-z!?/][^>]*>/gi, " ");
  return stripTags(decode(stripTags(decode(stripTags(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"))))))
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml: string, names: string[]) => {
  for (const n of names) {
    const m = xml.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return plainText(m[1]!);
  }
  return "";
};

/** The items in one RSS or Atom feed. */
export function parseFeed(xml: string, publisher: string): Omit<NewsItem, "n">[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks
    .map((b) => {
      const atomLink = b.match(/<link\b[^>]*?(?:rel=["']alternate["'][^>]*?)?href=["']([^"']+)["']/i)?.[1];
      const url = (tag(b, ["link"]) || atomLink || tag(b, ["guid"])).trim();
      const when = Date.parse(tag(b, ["pubDate", "published", "updated", "dc:date"]));
      return {
        headline: tag(b, ["title"]),
        publisher,
        url,
        published: Number.isFinite(when) ? new Date(when).toISOString().slice(0, 10) : "",
        summary: tag(b, ["description", "summary", "content"]).slice(0, 300),
      };
    })
    .filter((i) => i.headline && /^https?:\/\//.test(i.url) && i.published);
}

async function getText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; news-reader)" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${r.status} from ${url}`);
  return r.text();
}

/** Every feed's items from the last NEWS_MAX_DAYS days, newest first, numbered from 1. A feed that fails is skipped. */
export async function newsList(now = new Date(), get: Fetch = getText, log?: (m: string) => void): Promise<NewsItem[]> {
  const all: Omit<NewsItem, "n">[] = [];
  for (const f of NEWS_FEEDS) {
    try {
      all.push(...parseFeed(await get(f.url), f.publisher));
    } catch (e) {
      log?.(`News feed ${f.url} failed: ${(e as Error).message}`);
    }
  }
  const day = 86_400_000;
  const seen = new Set<string>();
  return all
    .filter((i) => {
      const t = Date.parse(i.published);
      return t <= now.getTime() + day && now.getTime() - t <= NEWS_MAX_DAYS * day;
    })
    .filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)))
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, NEWS_LIST_MAX)
    .map((i, k) => ({ ...i, n: k + 1 }));
}

/** The list as stage 2 reads it. */
export const newsText = (items: NewsItem[]) => items.map((i) => `${i.n}. ${i.headline} | ${i.publisher} | ${i.url} | ${i.published} | ${i.summary}`).join("\n");

/** The article's own paragraphs; the feed's summary when the page can't be read. */
export async function sourceTexts(items: NewsItem[], get: Fetch = getText): Promise<SourceText[]> {
  const out: SourceText[] = [];
  for (const i of items) {
    let text = "";
    try {
      const html = await get(i.url);
      text = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => plainText(m[1]!)).filter((p) => p.length > 40).join(" ");
    } catch {}
    out.push({ url: i.url, publisher: i.publisher, title: i.headline, published: i.published, text: (text || i.summary).slice(0, SOURCE_TEXT_MAX) });
  }
  return out;
}

/** The sources as stages 3 and 4 read them. */
export const sourcesText = (s: SourceText[]) => s.map((x, k) => `Source ${k + 1}: ${x.title}\nPublisher: ${x.publisher}\nLink: ${x.url}\nPublished: ${x.published}\nText: ${x.text}`).join("\n\n");

// Figures: 3.1%, $2,400, 1.5 billion, 40. Years and whole numbers 0 to 10 pass on their own.
const FIGURE = /\d[\d,]*(?:\.\d+)?/g;
const toNumber = (f: string) => Number(f.replace(/,/g, ""));

/** Every number in the text. */
export const numbers = (text: string) => [...text.matchAll(FIGURE)].map((m) => toNumber(m[0])).filter(Number.isFinite);

/** Every figure in the text that stands for something: not a year, not a whole number from 0 to 10 ("3 hens"). */
export function figures(text: string): number[] {
  return numbers(text).filter((v) => !(Number.isInteger(v) && (v <= 10 || (v >= 1900 && v <= 2100))));
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);

/** A figure is sourced if it's in the sources, or is simple arithmetic on two figures that are. */
export function sourcedFigure(v: number, sourced: number[]): boolean {
  if (sourced.some((s) => close(v, s))) return true;
  const xs = [...new Set(sourced)].slice(0, 200);
  for (const a of xs) for (const b of xs) if (close(v, a + b) || close(v, a - b) || close(v, a * b) || (b && close(v, a / b)) || close(v, (a * b) / 100)) return true;
  return false;
}

/** The explainer's source checks: links from the list, 2+ publishers, every figure sourced. */
export function sourceChecks(script: { shots?: { line?: string; onScreenText?: string; visual?: string }[]; sources?: { url?: string }[] }, supplied: SourceText[]): Check[] {
  const allowed = new Map(supplied.map((s) => [s.url, s]));
  const used = (script.sources ?? []).map((s) => s.url ?? "");
  const foreign = used.filter((u) => !allowed.has(u));
  const publishers = new Set(used.map((u) => allowed.get(u)?.publisher).filter(Boolean));
  const sourced = supplied.flatMap((s) => numbers(`${s.title} ${s.text}`));
  const said = (script.shots ?? []).flatMap((s) => [s.line ?? "", s.onScreenText ?? "", ...[...(s.visual ?? "").matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => m[1] ?? m[2] ?? "")]);
  const unsourced = [...new Set(said.flatMap((t) => [...t.matchAll(FIGURE)].map((m) => m[0])).filter((f) => figures(f).length && !sourcedFigure(toNumber(f), sourced)))];
  return [
    check("Every source is from the news list", used.length > 0 && foreign.length === 0, foreign.length ? `not on the list: ${foreign.slice(0, 3).join(", ")}` : used.length ? undefined : "no sources"),
    check("Sources from at least 2 publishers", publishers.size >= 2, `${publishers.size}: ${[...publishers].join(", ")}`),
    check("Every figure is in the sources", unsourced.length === 0, unsourced.length ? `not in the sources: ${unsourced.slice(0, 6).join(", ")}` : undefined),
  ];
}
