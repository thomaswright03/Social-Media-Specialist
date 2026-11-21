// Stage 5's motion kit (Thomas, 2026-11-19: "the animations are terrible").
// Instead of drawing every frame from scratch, Claude picks a ready-made
// animated piece for each shot (a number counting up, bars growing, a news
// card, a timeline…) and fills it in as JSON. The pieces themselves are
// written once, in code (pipeline/motion/runtime.js), with proper easing, and
// every piece is readable by 0.6 s into its shot. Code checks the JSON before
// anything is rendered, and on-screen figures must come from the script.
import type { Format } from "./formats.ts";
import type { Shot } from "./gates.ts";
import { numbers, sourcedFigure, figures } from "./news.ts";
import { shotList } from "./scenes.ts";
import { parseJson, pipelineFile, stagePrompt } from "./stages.ts";

type Ask = (p: string) => Promise<string>;

export const MOTION_TRIES = 3;
/** Formats made of graphics rather than drawn scenes. */
// Ads too since 2026-11-20 (Thomas: "Ads should not have stickmen in them they should only be like the
// informational entertainment ads with slides and transitions but it will inform people about the app").
export const USES_MOTION: Record<Format, boolean> = { explainer: true, story: false, satisfying: false, ad: true };
export const KINDS = [
  "title", "headline", "counter", "bars", "line", "compare", "quote", "list", "icon", "timeline",
  // Added 2026-11-20 so a Reel never repeats a picture (Thomas: "why is there green circles for nearly every slide").
  "waffle", "people", "stack", "flow", "split", "calendar", "ticker", "meter", "chat", "stamp",
  // The product's own screen, for ads (2026-11-20).
  "app",
] as const;
/** The product's screen may show up to this many times in a Reel (each a different screen); every other kind once. */
export const APP_SCREENS_MAX = 3;
export const THEMES = ["navy", "red", "green", "gold", "slate"] as const;
export const TRANSITIONS = ["cut", "whip", "zoom", "flash"] as const;
export const ICONS = [
  "dollar", "up", "down", "phone", "chip", "court", "factory", "house", "car", "cart", "globe", "warning", "clock", "check", "cross", "question",
  "person", "people", "lock", "bolt", "game", "calendar", "egg", "chart", "robot", "mail", "heart", "fire", "plane", "store", "pill", "battery",
] as const;

export type Piece = { kind: string; [k: string]: unknown };
export type ShotMotion = { shot: number; bg?: string; transition?: string; pieces: Piece[] };
export type MotionPlan = { shots: ShotMotion[] };

/** The browser code that draws the pieces. */
export const motionRuntime = () => pipelineFile("motion/runtime.js");

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/,/g, "")) : NaN);
const isNum = (v: unknown) => Number.isFinite(num(v));

/** The plan in Claude's answer, shots sorted and numbered from 1. */
export function motionFrom(answer: string): MotionPlan | null {
  const j = parseJson<MotionPlan>(answer);
  if (!j || !Array.isArray(j.shots)) return null;
  return { shots: j.shots.filter((s) => s && typeof s === "object").map((s) => ({ ...s, shot: Number(s.shot), pieces: Array.isArray(s.pieces) ? s.pieces : [] })).sort((a, b) => a.shot - b.shot) };
}

/** Every number a piece puts on screen, as written. */
export function pieceFigures(p: Piece): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    for (const m of str(v).matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0]);
  };
  switch (p.kind) {
    case "counter":
      add(p.to);
      break;
    case "bars":
      for (const i of (p.items as { value?: unknown }[]) ?? []) add(i?.value);
      break;
    case "line":
      for (const i of (p.points as { value?: unknown }[]) ?? []) add(i?.value);
      break;
    case "compare":
      add((p.left as { value?: unknown })?.value);
      add((p.right as { value?: unknown })?.value);
      break;
    case "waffle":
      add(p.percent);
      break;
    case "people":
      add(p.count);
      add(p.of);
      break;
    case "stack":
      add(p.to);
      break;
    case "flow":
      add(p.value);
      add(p.from);
      add(p.to);
      break;
    case "split":
      for (const i of (p.parts as { value?: unknown }[]) ?? []) add(i?.value);
      break;
    case "calendar":
      add(p.day);
      add(p.month);
      break;
    case "ticker":
      add(p.value);
      add(p.change);
      break;
    case "meter":
      add(p.value);
      add(p.of);
      break;
    case "chat":
      for (const m of (p.messages as unknown[]) ?? []) add(m);
      break;
    case "stamp":
      add(p.text);
      break;
    case "app": {
      const r = p.ring as { value?: unknown; of?: unknown } | undefined;
      add(r?.value);
      add(r?.of);
      for (const row of (p.rows as { label?: unknown; value?: unknown }[]) ?? []) {
        add(row?.label);
        add(row?.value);
      }
      add(p.button);
      add(p.screen);
      break;
    }
  }
  // Numbers written inside the words (a title, a label, a headline) count too.
  const words = [p.text, p.label, p.title, p.who, ...(((p.items as unknown[]) ?? []).map((i) => (typeof i === "string" ? i : `${str((i as { name?: unknown; label?: unknown })?.name)} ${str((i as { label?: unknown })?.label)}`)))];
  for (const w of words) for (const m of str(w).matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0]);
  return out;
}

const tooLong = (v: unknown, max: number) => str(v).length > max;

/** What's wrong with one piece; an empty list when it can be drawn. */
export function pieceProblems(p: Piece, where: string): string[] {
  const out: string[] = [];
  const need = (ok: boolean, msg: string) => {
    if (!ok) out.push(`${where}: ${msg}`);
  };
  need((KINDS as readonly string[]).includes(p.kind), `"${p.kind}" isn't a piece (use one of ${KINDS.join(", ")})`);
  switch (p.kind) {
    case "title":
      need(Boolean(str(p.text).trim()), "a title needs text");
      need(!tooLong(p.text, 40), "a title is at most 40 characters");
      break;
    case "headline":
      need(Boolean(str(p.publisher).trim()) && Boolean(str(p.text).trim()), "a headline needs publisher and text");
      need(!tooLong(p.text, 110), "a headline's text is at most 110 characters");
      break;
    case "counter":
      need(isNum(p.to), "a counter needs a number in to");
      need(p.from == null || isNum(p.from), "a counter's from is a number");
      need(!tooLong(p.label, 40), "a counter's label is at most 40 characters");
      need(!tooLong(`${str(p.prefix)}${str(p.suffix)}`, 8), "prefix and suffix are short, like $ or % or M");
      break;
    case "bars": {
      const items = (p.items as { name?: unknown; value?: unknown }[]) ?? [];
      need(Array.isArray(items) && items.length >= 2 && items.length <= 5, "bars have 2 to 5 items");
      need(Array.isArray(items) && items.every((i) => str(i?.name).trim() && !tooLong(i?.name, 18) && isNum(i?.value) && num(i?.value) >= 0), "each bar has a name of at most 18 characters and a value of 0 or more");
      need(!tooLong(p.title, 40), "a title is at most 40 characters");
      break;
    }
    case "line": {
      const pts = (p.points as { label?: unknown; value?: unknown }[]) ?? [];
      need(Array.isArray(pts) && pts.length >= 2 && pts.length <= 8, "a line has 2 to 8 points");
      need(Array.isArray(pts) && pts.every((x) => isNum(x?.value) && !tooLong(x?.label, 10)), "each point has a value and a label of at most 10 characters");
      need(!tooLong(p.title, 40), "a title is at most 40 characters");
      break;
    }
    case "compare": {
      const l = p.left as { name?: unknown; value?: unknown } | undefined;
      const r = p.right as { name?: unknown; value?: unknown } | undefined;
      need(Boolean(l && r && str(l.name).trim() && str(r.name).trim()), "compare needs left and right, each with a name");
      need(!tooLong(l?.name, 24) && !tooLong(r?.name, 24) && !tooLong(l?.value, 9) && !tooLong(r?.value, 9), "names are at most 24 characters and values at most 9");
      need(p.highlight == null || p.highlight === "left" || p.highlight === "right", 'highlight is "left" or "right"');
      break;
    }
    case "quote":
      need(Boolean(str(p.text).trim()), "a quote needs text");
      need(!tooLong(p.text, 120), "a quote is at most 120 characters");
      break;
    case "list": {
      const items = (p.items as unknown[]) ?? [];
      need(Array.isArray(items) && items.length >= 2 && items.length <= 4, "a list has 2 to 4 items");
      need(Array.isArray(items) && items.every((i) => typeof i === "string" && i.trim() && i.length <= 30), "each list item is text of at most 30 characters");
      break;
    }
    case "icon":
      need((ICONS as readonly string[]).includes(str(p.name)), `the icon is one of ${ICONS.join(", ")}`);
      need(!tooLong(p.label, 30), "an icon's label is at most 30 characters");
      break;
    case "timeline": {
      const items = (p.items as { date?: unknown; label?: unknown }[]) ?? [];
      need(Array.isArray(items) && items.length >= 2 && items.length <= 4, "a timeline has 2 to 4 items");
      need(Array.isArray(items) && items.every((i) => str(i?.date).trim() && !tooLong(i?.date, 12) && !tooLong(i?.label, 22)), "each item has a date of at most 12 characters and a label of at most 22");
      break;
    }    case "waffle":
      need(isNum(p.percent) && num(p.percent) > 0 && num(p.percent) <= 100, "a waffle needs percent, a number above 0 and at most 100");
      need(!tooLong(p.label, 40), "a waffle's label is at most 40 characters");
      break;
    case "people":
      need(isNum(p.of) && Number.isInteger(num(p.of)) && num(p.of) >= 2 && num(p.of) <= 20, "people needs of, a whole number from 2 to 20");
      need(isNum(p.count) && Number.isInteger(num(p.count)) && num(p.count) >= 0 && num(p.count) <= num(p.of), "people needs count, a whole number no bigger than of");
      need(!tooLong(p.label, 40), "people's label is at most 40 characters");
      break;
    case "stack":
      need(isNum(p.to) && num(p.to) > 0, "a stack needs a number above 0 in to");
      need(!tooLong(`${str(p.prefix)}${str(p.suffix)}`, 8), "prefix and suffix are short, like $ or B");
      need(!tooLong(p.label, 40), "a stack's label is at most 40 characters");
      break;
    case "flow":
      need(Boolean(str(p.from).trim()) && Boolean(str(p.to).trim()), "a flow needs from and to");
      need(!tooLong(p.from, 22) && !tooLong(p.to, 22), "from and to are at most 22 characters");
      need(!tooLong(p.value, 9), "a flow's value is at most 9 characters");
      break;
    case "split": {
      const parts = (p.parts as { name?: unknown; value?: unknown }[]) ?? [];
      need(Array.isArray(parts) && parts.length >= 2 && parts.length <= 4, "a split has 2 to 4 parts");
      need(Array.isArray(parts) && parts.every((i) => str(i?.name).trim() && !tooLong(i?.name, 20) && isNum(i?.value) && num(i?.value) >= 0), "each part has a name of at most 20 characters and a value of 0 or more");
      need(!tooLong(p.title, 40), "a title is at most 40 characters");
      break;
    }
    case "calendar":
      need(Boolean(str(p.month).trim()) && !tooLong(p.month, 10), "a calendar needs month, at most 10 characters");
      need(Boolean(str(p.day).trim() || str(p.weekday).trim()), "a calendar needs a day or a weekday");
      need(!tooLong(p.day, 4) && !tooLong(p.weekday, 10), "day is at most 4 characters and weekday at most 10");
      need(!tooLong(p.label, 30), "a calendar's label is at most 30 characters");
      break;
    case "ticker":
      need(Boolean(str(p.name).trim()) && !tooLong(p.name, 14), "a ticker needs name, at most 14 characters");
      need(Boolean(str(p.value).trim()) && !tooLong(p.value, 9), "a ticker needs value, at most 9 characters");
      need(!tooLong(p.change, 8), "a ticker's change is at most 8 characters, like +12%");
      need(!tooLong(p.label, 24), "a ticker's label is at most 24 characters");
      break;
    case "meter":
      need(isNum(p.value) && isNum(p.of) && num(p.of) > 0 && num(p.value) >= 0, "a meter needs value and of, numbers with of above 0");
      need(!tooLong(`${str(p.prefix)}${str(p.unit)}`, 8), "prefix and unit are short, like $ or B");
      need(!tooLong(p.label, 40), "a meter's label is at most 40 characters");
      break;
    case "chat": {
      const m = (p.messages as unknown[]) ?? [];
      need(Array.isArray(m) && m.length >= 1 && m.length <= 3, "a chat has 1 to 3 messages");
      need(Array.isArray(m) && m.every((x) => typeof x === "string" && x.trim() && x.length <= 40), "each message is text of at most 40 characters");
      break;
    }
    case "stamp":
      need(Boolean(str(p.text).trim()) && !tooLong(p.text, 12), "a stamp needs text, at most 12 characters");
      need(!tooLong(p.title, 30), "a stamp's title is at most 30 characters");
      need(p.color == null || p.color === "red" || p.color === "green", 'a stamp\'s color is "red" or "green"');
      break;
    case "app": {
      const ring = p.ring as { value?: unknown; of?: unknown; unit?: unknown; label?: unknown } | undefined;
      const rows = (p.rows as { label?: unknown; value?: unknown }[]) ?? [];
      const maxRows = ring ? (str(p.button).trim() ? 2 : 3) : 4;
      need(Boolean(str(p.name).trim()) && !tooLong(p.name, 24), "an app needs name, the product's name, at most 24 characters");
      need(!tooLong(p.screen, 20), "an app's screen is at most 20 characters");
      need(ring == null || (isNum(ring.value) && isNum(ring.of) && num(ring.of) > 0 && num(ring.value) >= 0), "an app's ring needs value and of, numbers with of above 0");
      need(ring == null || (!tooLong(ring.unit, 6) && !tooLong(ring.label, 22)), "a ring's unit is at most 6 characters and its label at most 22");
      need(Array.isArray(rows) && rows.length <= maxRows, `an app has at most ${maxRows} rows${ring ? (str(p.button).trim() ? " with a ring and a button" : " with a ring") : ""}`);
      need(Array.isArray(rows) && rows.every((r) => str(r?.label).trim() && !tooLong(r?.label, 18) && !tooLong(r?.value, 10)), "each row has a label of at most 18 characters and a value of at most 10");
      need(Boolean(ring) || rows.length > 0 || Boolean(str(p.button).trim()), "an app shows something: a ring, rows or a button");
      need(!tooLong(p.button, 20), "an app's button is at most 20 characters");
      need(p.highlight == null || (Number.isInteger(num(p.highlight)) && num(p.highlight) >= 0 && num(p.highlight) < rows.length), "highlight is a row's index from 0");
      break;
    }
  }
  return out;
}

/**
 * What's wrong with a plan; an empty list when it can be rendered. Every shot
 * has one or two pieces, and every figure on screen is one the script says
 * (or simple arithmetic on them), so the pictures can't invent numbers.
 */
export function motionProblems(plan: MotionPlan | null, shots: Shot[]): string[] {
  if (!plan) return ['There was no JSON with "shots" in the answer.'];
  const p: string[] = [];
  const said = numbers(shots.map((s) => `${s.line ?? ""} ${s.onScreenText ?? ""} ${s.visual ?? ""}`).join(" "));
  const byShot = new Map(plan.shots.map((s) => [s.shot, s]));
  shots.forEach((_, i) => {
    const s = byShot.get(i + 1);
    if (!s) return void p.push(`Shot ${i + 1} has no entry.`);
    if (!s.pieces.length || s.pieces.length > 2) p.push(`Shot ${i + 1} has ${s.pieces.length} pieces; give it 1 or 2.`);
    if (s.bg != null && !(THEMES as readonly string[]).includes(s.bg)) p.push(`Shot ${i + 1}: bg is one of ${THEMES.join(", ")}.`);
    if (s.transition != null && !(TRANSITIONS as readonly string[]).includes(s.transition)) p.push(`Shot ${i + 1}: transition is one of ${TRANSITIONS.join(", ")}.`);
    s.pieces.forEach((piece, k) => {
      p.push(...pieceProblems(piece, `Shot ${i + 1}, piece ${k + 1}`));
      const invented = pieceFigures(piece).filter((f) => figures(f).length && !sourcedFigure(num(f), said));
      if (invented.length) p.push(`Shot ${i + 1}, piece ${k + 1} shows ${[...new Set(invented)].join(", ")}, which the script never says; use the script's figures.`);
    });
  });
  // Variety (Thomas, 2026-11-20: "once a slide gets used its theme cannot be
  // reused for the video"): every kind of piece appears at most once a Reel.
  const used = new Map<string, number[]>();
  for (const sh of plan.shots) for (const x of sh.pieces) used.set(x.kind, [...(used.get(x.kind) ?? []), sh.shot]);
  for (const [kind, at] of used) {
    if (kind === "app") continue;
    if (at.length > 1 && (KINDS as readonly string[]).includes(kind)) p.push(`The ${kind} piece is used ${at.length} times (shots ${at.join(", ")}); use each kind of piece once, so no picture repeats.`);
  }
  // An ad shows the product's screen more than once, but never the same screen twice.
  const apps = plan.shots.flatMap((sh) => sh.pieces.filter((x) => x.kind === "app").map((x) => ({ shot: sh.shot, key: JSON.stringify([x.screen ?? "", x.ring ?? null, x.rows ?? [], x.button ?? ""]) })));
  if (apps.length > APP_SCREENS_MAX) p.push(`The app piece is used ${apps.length} times (shots ${apps.map((a) => a.shot).join(", ")}); show the product's screen at most ${APP_SCREENS_MAX} times.`);
  const seen = new Map<string, number>();
  for (const a of apps) {
    const first = seen.get(a.key);
    if (first != null) p.push(`Shots ${first} and ${a.shot} show the same app screen; each app screen shows something new.`);
    else seen.set(a.key, a.shot);
  }
  const extra = plan.shots.filter((s) => !(s.shot >= 1 && s.shot <= shots.length));
  if (extra.length) p.push(`There are only ${shots.length} shots; drop ${extra.map((s) => s.shot).join(", ")}.`);
  return p;
}

/** The plan, asked again with what was wrong; the one with the fewest problems after MOTION_TRIES. */
export async function motionPlan(shots: Shot[], ask: Ask, log?: (m: string) => void, style = ""): Promise<{ plan: MotionPlan | null; problems: string[] }> {
  let problems: string[] = [];
  let best: { plan: MotionPlan | null; problems: string[] } = { plan: null, problems: ["no answer"] };
  for (let t = 1; t <= MOTION_TRIES; t++) {
    const prompt = stagePrompt(5, { SHOTS: shotList(shots), STYLE: style, ICONS: ICONS.join(", "), PROBLEMS: problems.length ? `Your last plan was refused: ${problems.join(" ")} Fix that.` : "" }, "motion");
    const plan = motionFrom(await ask(prompt).catch(() => ""));
    problems = motionProblems(plan, shots);
    if (!best.plan || problems.length < best.problems.length) best = { plan, problems };
    if (!problems.length) {
      if (t > 1) log?.(`Motion plan passed on try ${t}.`);
      return { plan, problems };
    }
  }
  log?.(`The motion plan still has problems after ${MOTION_TRIES} tries: ${best.problems.slice(0, 4).join(" ")}`);
  return best;
}

/** One shot's motion, ready for the page, or null when a shot uses its drawing. */
export const shotMotion = (plan: MotionPlan | null, i: number): ShotMotion | null => plan?.shots.find((s) => s.shot === i + 1) ?? null;
