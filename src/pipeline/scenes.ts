// Stage 5's art: a look sheet for the cast and places, then one SVG drawing
// per shot in the same style (pipeline/stages/5-production.md, the "look" and
// "art" prompts). Code checks every drawing before it's used and asks again,
// with what was wrong, when one is broken.
import type { Shot } from "./gates.ts";
import { repeatsLine } from "./compose.ts";
import { stagePrompt } from "./stages.ts";

type Ask = (p: string) => Promise<string>;
export const SCENE_TRIES = 3;
export const MAX_SVG_BYTES = 60_000;
/** Drawings made at the same time (each is its own Claude call). */
export const SCENE_CONCURRENCY = 4;

const shotLine = (s: Shot, i: number) =>
  `${i + 1}. ${s.start ?? "?"}-${s.end ?? "?"} s${s.camera ? `, ${s.camera}` : ""}${s.place ? `, ${s.place}` : ""}: ${s.visual ?? ""}${s.onScreenText ? ` | text: "${s.onScreenText}"` : ""}${s.line ? ` | voice: "${s.line}"` : ""}`;

export const shotList = (shots: Shot[]) => shots.map(shotLine).join("\n");

/** The SVG in Claude's answer (it may wrap it in a code fence). */
export function svgFrom(answer: string): string | null {
  const start = answer.indexOf("<svg");
  const end = answer.lastIndexOf("</svg>");
  return start >= 0 && end > start ? answer.slice(start, end + 6) : null;
}

/** What's wrong with a drawing; an empty list when it can be used. */
export function svgProblems(svg: string | null): string[] {
  if (!svg) return ["There was no <svg> … </svg> in the answer."];
  const p: string[] = [];
  const open = svg.slice(0, svg.indexOf(">") + 1);
  if (!/viewBox\s*=\s*["']\s*0[\s,]+0[\s,]+1080[\s,]+1920\s*["']/.test(open)) p.push('The <svg> tag must have viewBox="0 0 1080 1920".');
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) p.push(`It's ${Math.round(Buffer.byteLength(svg) / 1000)} KB; keep it under 30 KB.`);
  if (/<script\b/i.test(svg)) p.push("It has a <script>.");
  if (/<(image|foreignObject|iframe)\b/i.test(svg)) p.push("It uses <image> or <foreignObject>.");
  if (/\son[a-z]+\s*=/i.test(svg)) p.push("It has an event handler (on…=).");
  if (/(href|src)\s*=\s*["']\s*(https?:|\/\/|data:)/i.test(svg) || /@import|url\(\s*["']?(https?:|\/\/)/i.test(svg)) p.push("It links to something outside the SVG.");
  if ((svg.match(/<(path|rect|circle|ellipse|line|polyline|polygon)\b/gi) ?? []).length < 6) p.push("It's nearly empty: draw the place, the characters and the props.");
  return p;
}

/** Strips anything that could reach outside the page, in case a check missed it. */
export const safeSvg = (svg: string) => svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "");

export async function lookSheet(shots: Shot[], ask: Ask): Promise<string> {
  const a = (await ask(stagePrompt(5, { SHOTS: shotList(shots) }, "look"))).trim();
  return a.slice(0, 3000);
}

/**
 * The cast, drawn once: each character's head (and what tells them apart) and
 * each recurring prop as an SVG <g> that every shot places with <use>, so
 * Mia looks like Mia in all twelve shots.
 */
export type Cast = { defs: string; parts: { id: string; note: string }[] };
export const NO_CAST: Cast = { defs: "", parts: [] };
export const MAX_CAST_BYTES = 16_000;
const PART_ID = /^[cp]-[a-z0-9-]+$/;

export function castFrom(answer: string): Cast | null {
  const svg = svgFrom(answer);
  if (!svg) return null;
  const a = svg.indexOf("<defs>");
  const b = svg.lastIndexOf("</defs>");
  if (a < 0 || b < a) return null;
  const defs = svg.slice(a + 6, b).trim();
  const parts = [...defs.matchAll(/<g\b([^>]*)>/gi)].flatMap((m) => {
    const id = /\sid\s*=\s*["']([^"']+)["']/.exec(m[1]!)?.[1];
    const note = /\sdata-note\s*=\s*["']([^"']*)["']/.exec(m[1]!)?.[1] ?? "";
    return id && PART_ID.test(id) ? [{ id, note }] : [];
  });
  return { defs, parts };
}

/** What's wrong with a cast sheet; an empty list when it can be used. */
export function castProblems(c: Cast | null): string[] {
  if (!c) return ["There was no <svg> with a <defs> … </defs> in the answer."];
  const p: string[] = [];
  if (!c.parts.some((x) => x.id.startsWith("c-"))) p.push('There is no character group: each one is a <g id="c-name" data-note="…">.');
  if (Buffer.byteLength(c.defs) > MAX_CAST_BYTES) p.push(`It's ${Math.round(Buffer.byteLength(c.defs) / 1000)} KB; keep it under 12 KB.`);
  if (/<script\b/i.test(c.defs)) p.push("It has a <script>.");
  if (/<(image|foreignObject|iframe)\b/i.test(c.defs)) p.push("It uses <image> or <foreignObject>.");
  if (/\son[a-z]+\s*=/i.test(c.defs)) p.push("It has an event handler (on…=).");
  if (/(href|src)\s*=\s*["']\s*(https?:|\/\/|data:)/i.test(c.defs) || /@import|url\(\s*["']?(https?:|\/\/)/i.test(c.defs)) p.push("It links to something outside the SVG.");
  return p;
}

/** The cast sheet, asked again with what was wrong; no cast (each shot draws its own) if it never works. */
export async function castSheet(shots: Shot[], look: string, ask: Ask): Promise<Cast> {
  let problems: string[] = [];
  for (let t = 1; t <= SCENE_TRIES; t++) {
    const prompt = stagePrompt(5, { SHOTS: shotList(shots), LOOK: look, PROBLEMS: problems.length ? `Your last cast sheet was refused: ${problems.join(" ")} Fix that.` : "" }, "cast");
    const c = castFrom(await ask(prompt).catch(() => ""));
    problems = castProblems(c);
    if (!problems.length) return { defs: safeSvg(c!.defs), parts: c!.parts };
  }
  return NO_CAST;
}

const castNote = (c: Cast) =>
  c.parts.length
    ? `These are already drawn and defined; place them, never redraw them:\n${c.parts.map((x) => `- #${x.id}: ${x.note || "(no note)"}`).join("\n")}\nTheir SVG, for reference (don't copy it into your answer):\n${c.defs}`
    : "(none: draw everyone yourself, following the look sheet)";

/** <use href="#…"> that points at nothing in the drawing or the cast. */
export function missingRefs(svg: string, cast: Cast): string[] {
  const own = new Set([...svg.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]!));
  const known = new Set(cast.parts.map((x) => x.id));
  return [...new Set([...svg.matchAll(/<use\b[^>]*?href\s*=\s*["']#([^"']+)["']/gi)].map((m) => m[1]!))].filter((id) => !own.has(id) && !known.has(id));
}

/** The cast's definitions put inside the drawing, so it stands alone. */
export const withCast = (svg: string, cast: Cast) => (cast.defs ? svg.replace(/<svg\b[^>]*>/i, (m) => `${m}<defs>${cast.defs}</defs>`) : svg);

export type Scene = { svg: string | null; tries: number; problems: string[] };

/** One shot's drawing, asked again (with what was wrong) up to SCENE_TRIES times. */
export async function drawScene(shots: Shot[], i: number, look: string, ask: Ask, cast: Cast = NO_CAST): Promise<Scene> {
  const s = shots[i]!;
  const seconds = Math.max(0, (s.end ?? 0) - (s.start ?? 0)).toFixed(1);
  const context = shots
    .map((x, j) => (Math.abs(j - i) <= 2 ? `${j === i ? "→ " : "  "}${shotLine(x, j)}` : null))
    .filter(Boolean)
    .join("\n");
  let problems: string[] = [];
  for (let t = 1; t <= SCENE_TRIES; t++) {
    const prompt = stagePrompt(
      5,
      {
        LOOK: look,
        OVERLAY_TEXT: (s.line?.trim() || s.onScreenText?.trim()) ? `"${(s.line?.trim() || s.onScreenText!.trim())}"` : "(none)",
        IN_WORLD: s.line?.trim() && s.onScreenText?.trim() && !repeatsLine(s.onScreenText, s.line) ? `The script also wants "${s.onScreenText.trim()}" seen. Show it in the world itself if it fits (a clock, a sign, a calendar, a phone screen), or leave it out.` : "",
        SECONDS: seconds,
        N: String(i + 1),
        TOTAL: String(shots.length),
        VISUAL: s.visual ?? "",
        CAMERA: s.camera ?? "medium",
        PLACE: s.place ?? "",
        CAST: castNote(cast),
        CONTEXT: context,
        PROBLEMS: problems.length ? `Your last drawing for this shot was refused: ${problems.join(" ")} Fix that.` : "",
      },
      "art",
    );
    const svg = svgFrom(await ask(prompt).catch(() => ""));
    problems = svgProblems(svg);
    const refs = svg ? missingRefs(svg, cast) : [];
    if (refs.length) problems.push(`It uses ${refs.map((r) => `#${r}`).join(", ")}, which isn't defined; the cast is ${cast.parts.map((x) => `#${x.id}`).join(", ") || "empty"}.`);
    if (!problems.length) return { svg: safeSvg(withCast(svg!, cast)), tries: t, problems };
  }
  return { svg: null, tries: SCENE_TRIES, problems };
}

/** Every shot's drawing, a few at a time. */
export async function drawScenes(shots: Shot[], look: string, ask: Ask, log?: (m: string) => void, cast: Cast = NO_CAST): Promise<Scene[]> {
  const out: Scene[] = new Array(shots.length);
  let next = 0;
  const worker = async () => {
    while (next < shots.length) {
      const i = next++;
      out[i] = await drawScene(shots, i, look, ask, cast);
      log?.(`Shot ${i + 1}: ${out[i]!.svg ? `drawn${out[i]!.tries > 1 ? ` on try ${out[i]!.tries}` : ""}` : `no usable drawing (${out[i]!.problems.join(" ")})`}.`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCENE_CONCURRENCY, shots.length) }, worker));
  return out;
}
