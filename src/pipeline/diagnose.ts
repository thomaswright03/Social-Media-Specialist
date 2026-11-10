// Stage 0 of the content pipeline: Diagnose (pipeline/stages/0-diagnose.md).
//
// Code gathers the numbers: every post on the account, Instagram's Insights
// for each, the video's length (ffprobe reads it from the video's URL), and
// the derived rates. Claude names the top three reasons they underperformed,
// and the gate checks that every number it cites is really in the data.
import { spawn } from "node:child_process";
import type { InstagramClient, Media, ReelInsights } from "../instagram.ts";
import type { Vault } from "../vault.ts";
import { gateDiagnose, type Diagnosis, type DiagnosisData, type GateResult, type PostNumbers } from "./gates.ts";
import { pipelineFile, runStage, stagePrompt } from "./stages.ts";

export type Probe = (url: string) => Promise<number | null>;

/** A video's length in seconds, read by ffprobe from its URL (null when it can't). */
export const ffprobeSeconds: Probe = (url) =>
  new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", url], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const s = Number(out.trim());
      resolve(Number.isFinite(s) && s > 0 ? Math.round(s * 10) / 10 : null);
    });
  });

const r = (v: number | null, digits = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const per1k = (n: number | null, reach: number | null) => (n === null || !reach ? null : r((n / reach) * 1000, 1));

/** One post's numbers for the diagnosis, all derived here (not by Claude). */
export function postNumbers(m: Media, i: ReelInsights | null, seconds: number | null): PostNumbers {
  const reach = i?.reach ?? null;
  return {
    id: m.id,
    type: m.productType === "REELS" || m.mediaType === "VIDEO" ? "reel" : m.mediaType === "CAROUSEL_ALBUM" ? "carousel" : "photo",
    postedAt: m.timestamp.slice(0, 10),
    caption: (m.caption ?? "").split("\n")[0]!.slice(0, 100),
    lengthSeconds: seconds,
    views: i?.views ?? null,
    reach,
    likes: i?.likes ?? m.likes,
    comments: i?.comments ?? m.comments,
    saves: i?.saves ?? null,
    shares: i?.shares ?? null,
    avgWatchSeconds: r(i?.avgWatchSeconds ?? null, 1),
    watchPct: i?.avgWatchSeconds && seconds ? r(i.avgWatchSeconds / seconds) : null,
    skipRate: r(i?.skipRate ?? null),
    hold3s: i?.skipRate === null || i?.skipRate === undefined ? null : r(1 - i.skipRate),
    sharesPer1k: per1k(i?.shares ?? null, reach),
    savesPer1k: per1k(i?.saves ?? null, reach),
  };
}

export function median(values: (number | null | string | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return r(v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2);
}

const MEDIAN_OF = ["lengthSeconds", "views", "reach", "likes", "comments", "saves", "shares", "avgWatchSeconds", "watchPct", "skipRate", "hold3s", "sharesPer1k", "savesPer1k"];

export async function gatherDiagnosisData(ig: InstagramClient, probe: Probe = ffprobeSeconds, log?: (m: string) => void): Promise<DiagnosisData & { follows30d: number | null }> {
  if (!ig.listMedia || !ig.reelInsights) throw new Error("This Instagram client can't read Insights");
  const media = await ig.listMedia(100);
  log?.(`Instagram has ${media.length} posts on the account.`);
  const posts: PostNumbers[] = [];
  for (const m of media) {
    if (m.productType === "STORY") continue;
    const isVideo = m.productType === "REELS" || m.mediaType === "VIDEO";
    const insights = isVideo ? await ig.reelInsights(m.id).catch(() => null) : null;
    const seconds = isVideo && m.mediaUrl ? await probe(m.mediaUrl) : null;
    posts.push(postNumbers(m, insights, seconds));
  }
  const reels = posts.filter((p) => p.type === "reel");
  const med: Record<string, number | null> = {};
  for (const k of MEDIAN_OF) med[k] = median(reels.map((p) => p[k]));
  const follows30d = ig.recentFollows ? await ig.recentFollows(30).catch(() => null) : null;
  return { posts, median: med, follows30d };
}

export type DiagnoseResult = { passed: boolean; diagnosis: Diagnosis | null; gate: GateResult; data: DiagnosisData; tries: number };

/** Stage 0, end to end. Saves every try in SocialStage and the outcome in the History. */
export async function runDiagnose(d: { vault: Vault; ig: InstagramClient; ask: (prompt: string) => Promise<string>; probe?: Probe; log?: (m: string) => void; now?: () => Date }): Promise<DiagnoseResult> {
  const data = await gatherDiagnosisData(d.ig, d.probe, d.log);
  const lessons = await d.vault.lessons();
  const lessonText = lessons.length ? `What earlier stages learned:\n${lessons.map((l) => `- (${l.kind}) ${l.text}`).join("\n")}` : "";
  const dataText = JSON.stringify({ reels: data.posts.filter((p) => p.type === "reel"), otherPosts: data.posts.filter((p) => p.type !== "reel"), median: data.median, accountFollowsLast30Days: data.follows30d, notInTheApi: "the retention graph and per-Reel follows are only in the app's Insights" }, null, 1);
  const avoid = pipelineFile("avoid.md").replace(/^# .*\n/, "").trim();
  const run = await runStage<Diagnosis>({
    vault: d.vault,
    stage: 0,
    ask: d.ask,
    prompt: (failures) => stagePrompt(0, { DATA: dataText, AVOID: avoid, LESSONS: lessonText, GATE_FAILURES: failures }),
    gate: (out) => gateDiagnose(out, data),
    input: { posts: data.posts.length, reels: data.posts.filter((p) => p.type === "reel").length, median: data.median },
    log: d.log,
    now: d.now,
  });
  // A passed diagnosis becomes the first "avoid" lessons, which later stages read.
  if (run.gate.passed) {
    for (const reason of run.output?.reasons ?? []) {
      if (reason.reason) await d.vault.addLesson({ kind: "avoid", text: reason.reason, evidence: JSON.stringify(reason.evidence ?? []), source: "stage 0" }, d.now?.());
    }
  }
  return { passed: run.gate.passed, diagnosis: run.output, gate: run.gate, data, tries: run.tries };
}
