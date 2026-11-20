// Finished Reel videos kept in the repo (posts/reels) become ordinary drafts on
// the Vault page, so Thomas approves each one like any other post (CLAUDE.md:
// nothing goes out without his approval). A reel draft's picture is its cover
// frame; its sourceUrl ("repo:posts/reels/<file>.mp4") names the video that
// publishDue uploads once he approves it.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Post, Vault } from "./vault.ts";

export const REEL_DIR = "posts/reels";
const SOURCE = /^repo:posts\/reels\/([A-Za-z0-9][A-Za-z0-9._-]*\.mp4)$/;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

export type ReelDraft = { file: string; cover: string; headline: string; caption: string; hashtags: string[] };

export const reelSource = (file: string): string => `repo:${REEL_DIR}/${file}`;

/** The video file a reel post names, inside posts/reels only. */
export function reelPath(sourceUrl: string | null, root = REPO_ROOT): string {
  const m = SOURCE.exec(sourceUrl ?? "");
  if (!m) throw new Error(`This Reel doesn't name a video in ${REEL_DIR} (${sourceUrl ?? "no source"}).`);
  return join(root, REEL_DIR, m[1]!);
}

export async function readReel(sourceUrl: string | null, root = REPO_ROOT): Promise<Uint8Array> {
  const path = reelPath(sourceUrl, root);
  return new Uint8Array(await readFile(path).catch(() => {
    throw new Error(`The Reel's video isn't in the repo any more (${path.slice(root.length)}).`);
  }));
}

export function parseReelDrafts(json: unknown): ReelDraft[] {
  if (!Array.isArray(json)) throw new Error(`${REEL_DIR}/drafts.json isn't a list.`);
  return json.map((d, i) => {
    const r = d as Partial<ReelDraft>;
    const ok = typeof r.file === "string" && SOURCE.test(reelSource(r.file)) && typeof r.cover === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/.test(r.cover)
      && typeof r.headline === "string" && r.headline.trim() !== "" && typeof r.caption === "string" && r.caption.trim() !== ""
      && Array.isArray(r.hashtags) && r.hashtags.every((h) => typeof h === "string" && h.startsWith("#"));
    if (!ok) throw new Error(`Entry ${i + 1} in ${REEL_DIR}/drafts.json needs file (.mp4), cover (.jpg), headline, caption and #hashtags.`);
    return { file: r.file!, cover: r.cover!, headline: r.headline!.trim(), caption: r.caption!.trim(), hashtags: r.hashtags! };
  });
}

/** Adds each listed Reel as a draft once (a second run skips it), and logs it. */
export async function addReelDrafts(d: { vault: Vault; log: (m: string) => void; root?: string; now?: Date }): Promise<{ added: Post[]; skipped: string[] }> {
  const root = d.root ?? REPO_ROOT;
  const now = d.now ?? new Date();
  const drafts = parseReelDrafts(JSON.parse(await readFile(join(root, REEL_DIR, "drafts.json"), "utf8")));
  const added: Post[] = [];
  const skipped: string[] = [];
  for (const r of drafts) {
    const source = reelSource(r.file);
    await readFile(reelPath(source, root)).catch(() => { throw new Error(`${REEL_DIR}/${r.file} is listed but isn't in the repo.`); });
    if ((await d.vault.posts(`"sourceUrl" = ?`, [source])).length > 0) {
      skipped.push(r.file);
      d.log(`${r.file} is already on the Vault page; skipped.`);
      continue;
    }
    const cover = await readFile(join(root, REEL_DIR, r.cover));
    const post = await d.vault.addPost({ productId: null, productName: null, ideaId: null, kind: "reel", angle: "Reel (video); the picture is a frame from it", headline: r.headline, subline: null, caption: r.caption, hashtags: r.hashtags, theme: "ink", sourceUrl: source }, cover, now);
    added.push(post);
    d.log(`Added the Reel "${r.headline}" as a draft for Thomas to approve.`);
    await d.vault.logAction({ kind: "drafted", summary: `Drafted the Reel "${r.headline}" for your approval.`, detail: `${REEL_DIR}/${r.file}`, target: post.id }, now);
  }
  return { added, skipped };
}
