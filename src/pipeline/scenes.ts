// Stage 5's art: a look sheet for the cast and places, then one SVG drawing
// per shot in the same style (pipeline/stages/5-production.md, the "look" and
// "art" prompts). Code checks every drawing before it's used and asks again,
// with what was wrong, when one is broken.
import type { Shot } from "./gates.ts";
import { stagePrompt } from "./stages.ts";

type Ask = (p: string) => Promise<string>;
export const SCENE_TRIES = 3;
export const MAX_SVG_BYTES = 60_000;
/** Drawings made at the same time (each is its own Claude call). */
export const SCENE_CONCURRENCY = 4;

const shotLine = (s: Shot, i: number) =>
  `${i + 1}. ${s.start ?? "?"}-${s.end ?? "?"} s: ${s.visual ?? ""}${s.onScreenText ? ` | text: "${s.onScreenText}"` : ""}${s.line ? ` | voice: "${s.line}"` : ""}`;

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

export type Scene = { svg: string | null; tries: number; problems: string[] };

/** One shot's drawing, asked again (with what was wrong) up to SCENE_TRIES times. */
export async function drawScene(shots: Shot[], i: number, look: string, ask: Ask): Promise<Scene> {
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
        OVERLAY_TEXT: [s.onScreenText, s.line].filter((x) => x?.trim()).map((x) => `"${x}"`).join(", ") || "(none)",
        SECONDS: seconds,
        N: String(i + 1),
        TOTAL: String(shots.length),
        VISUAL: s.visual ?? "",
        CONTEXT: context,
        PROBLEMS: problems.length ? `Your last drawing for this shot was refused: ${problems.join(" ")} Fix that.` : "",
      },
      "art",
    );
    const svg = svgFrom(await ask(prompt).catch(() => ""));
    problems = svgProblems(svg);
    if (!problems.length) return { svg: safeSvg(svg!), tries: t, problems };
  }
  return { svg: null, tries: SCENE_TRIES, problems };
}

/** Every shot's drawing, a few at a time. */
export async function drawScenes(shots: Shot[], look: string, ask: Ask, log?: (m: string) => void): Promise<Scene[]> {
  const out: Scene[] = new Array(shots.length);
  let next = 0;
  const worker = async () => {
    while (next < shots.length) {
      const i = next++;
      out[i] = await drawScene(shots, i, look, ask);
      log?.(`Shot ${i + 1}: ${out[i]!.svg ? `drawn${out[i]!.tries > 1 ? ` on try ${out[i]!.tries}` : ""}` : `no usable drawing (${out[i]!.problems.join(" ")})`}.`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCENE_CONCURRENCY, shots.length) }, worker));
  return out;
}
