// The Reels already on Instagram, onto YouTube as Shorts (Thomas, 2026-11-21:
// "all the reels that the ai has posted besides the two pinned posts on
// instagram need to be uploaded and posted as youtube shorts"). His request is
// the approval for these. Each Reel goes up once: an upload, or a refusal, is
// recorded against its Instagram id, and a recorded one is never sent again.
// Run without "go" it only lists what it would upload.
import { pageText } from "./facebook.ts";
import type { InstagramClient, Media } from "./instagram.ts";
import { SITE_URL } from "./site.ts";
import type { Vault } from "./vault.ts";
import { YouTubeError, type YouTubeClient } from "./youtube.ts";

type Fetch = typeof fetch;

export const igTarget = (mediaId: string) => `ig:${mediaId}`;

/** A Short's title from an Instagram caption: its first line, without hashtags. */
export function titleFromCaption(caption: string | null): string {
  const line = (caption ?? "").split("\n").map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, "").trim()).find((l) => l.length > 0);
  return line || "Wright AI Solutions";
}

export const hashtagsIn = (caption: string | null): string[] => [...new Set((caption ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? [])];

/** Whether a skip entry (an id, a permalink, or its shortcode) names this Reel. */
export function skipped(m: Media, skip: string[]): boolean {
  return skip.some((s) => {
    const t = s.trim().replace(/\/+$/, "");
    if (!t) return false;
    if (t === m.id) return true;
    const code = t.split("/").pop()!;
    return Boolean(m.permalink && code && m.permalink.replace(/\/+$/, "").endsWith(`/${code}`));
  });
}

/** The Reels on the account, oldest first. */
export const reelsOf = (media: Media[]) => media.filter((m) => m.mediaType === "VIDEO" && (m.productType ?? "REELS") === "REELS").sort((a, b) => a.timestamp.localeCompare(b.timestamp));

const QUOTA = /quota/i;

export type BackfillResult = { planned: Media[]; uploaded: { media: Media; url: string }[]; failed: { media: Media; error: string }[]; already: number; stoppedForQuota: boolean };

export async function backfillYouTube(d: { vault: Vault; ig: InstagramClient; yt: YouTubeClient; log: (m: string) => void; skip: string[]; go: boolean; fetchImpl?: Fetch; now?: Date }): Promise<BackfillResult> {
  if (!d.ig.listMedia) throw new Error("This Instagram client can't list the account's posts.");
  const f = d.fetchImpl ?? fetch;
  const reels = reelsOf(await d.ig.listMedia(500));
  // Already sent: by this backfill (target ig:<id>), or by publishDue (target the Vault post that holds this Instagram id).
  const actions = await d.vault.actions(5000);
  // The quoted title is left out: a Reel called "YouTube may pay schools" isn't on YouTube.
  const ytDone = new Set(actions.filter((a) => /YouTube/.test(a.summary.replace(/"[^"]*"/g, "")) && (a.kind === "posted" || a.kind === "post_failed") && a.target).map((a) => a.target!));
  const posts = await d.vault.posts(`"igMediaId" IS NOT NULL`);
  const postByMedia = new Map(posts.map((p) => [p.igMediaId!, p.id]));
  const done = (m: Media) => ytDone.has(igTarget(m.id)) || (postByMedia.has(m.id) && ytDone.has(postByMedia.get(m.id)!));

  const result: BackfillResult = { planned: [], uploaded: [], failed: [], already: 0, stoppedForQuota: false };
  for (const m of reels) {
    if (skipped(m, d.skip)) continue;
    if (done(m)) {
      result.already++;
      continue;
    }
    result.planned.push(m);
  }
  d.log(`${reels.length} Reels on Instagram; ${result.planned.length} to upload to YouTube, ${result.already} already there, ${reels.length - result.planned.length - result.already} skipped as asked.`);
  for (const m of result.planned) d.log(`  ${m.timestamp.slice(0, 10)}  ${m.id}  ${m.permalink ?? ""}  "${titleFromCaption(m.caption).slice(0, 70)}"`);
  if (!d.go) return result;

  for (const m of result.planned) {
    const title = titleFromCaption(m.caption);
    try {
      if (!m.mediaUrl) throw new Error("Instagram gave no video address for it.");
      const res = await f(m.mediaUrl, { signal: AbortSignal.timeout(5 * 60_000) });
      if (!res.ok) throw new Error(`Instagram's video address answered ${res.status}.`);
      const video = new Uint8Array(await res.arrayBuffer());
      const r = await d.yt.uploadShort(video, { title, description: pageText(m.caption ?? "", SITE_URL()), tags: hashtagsIn(m.caption) });
      result.uploaded.push({ media: m, url: r.url });
      const locked = r.privacy && r.privacy !== "public" ? ` YouTube kept it ${r.privacy} until Google's API audit passes.` : "";
      d.log(`Uploaded "${title}" to YouTube: ${r.url}.${locked}`);
      await d.vault.logAction({ kind: "posted", summary: `Posted the Instagram Reel "${title.slice(0, 80)}" to YouTube as a Short (you asked for all past Reels).${locked}`, detail: `${r.url} (from ${m.permalink ?? m.id})`, target: igTarget(m.id), onInstagram: true }, d.now);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Out of YouTube's daily allowance: nothing went up, so the rest wait for the next run.
      if (err instanceof YouTubeError && QUOTA.test(error)) {
        result.stoppedForQuota = true;
        d.log(`YouTube's daily upload allowance is used up; ${result.planned.length - result.uploaded.length - result.failed.length} Reels wait for the next run.`);
        break;
      }
      result.failed.push({ media: m, error });
      d.log(`YouTube refused "${title}": ${error}`);
      await d.vault.logAction({ kind: "post_failed", summary: `Tried to post the Instagram Reel "${title.slice(0, 80)}" to YouTube; it was refused, and it won't be tried again on its own.`, detail: error.slice(0, 500), target: igTarget(m.id), onInstagram: true, ok: false }, d.now);
    }
  }
  return result;
}
