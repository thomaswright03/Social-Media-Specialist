// Stage 1: which Reels are winners, and what they're compared with.
//
// A Reel's raw views say more about the size of its account than about the
// Reel, so each Reel is scored against its own account: its views divided by
// the account's median (its "lift"). A winner is in its account's top quarter
// and at least WINNER_LIFT times the median. It is compared with the same
// account's average Reels, the middle half. The top Reels on their own show
// only what an account always does; the difference between the two groups is
// what the winners did that the rest didn't.
import type { DiscoveredAccount, Media } from "../instagram.ts";
import { median } from "./diagnose.ts";

/** A Reel younger than this is still collecting views, so it isn't scored. */
export const MIN_AGE_DAYS = 7;
/** Older than this, the account and Instagram were different. */
export const MAX_AGE_DAYS = 365;
/** An account needs this many scored Reels before a "top quarter" means anything. */
export const MIN_SCORED = 8;
export const WINNER_LIFT = 1.5;

export type Group = "winner" | "average" | "other";
export type ScoredBy = "views" | "likes and comments";

export type Candidate = {
  url: string;
  account: string;
  postedAt: string;
  ageDays: number;
  caption: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** MUSIC (Instagram's library) or ORIGINAL_SOUND, when Instagram says. */
  audioType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  score: number;
  /** score ÷ the account's median score. */
  lift: number;
  group: Group;
};

export type AccountStudy = {
  username: string;
  followers: number | null;
  /** Reels among the posts read. */
  reels: number;
  /** Reels old enough to score and not too old. */
  settled: number;
  scoredBy: ScoredBy | null;
  median: number | null;
  postsPerWeek: number | null;
  winners: number;
  average: number;
  /** Why this account can't be used, or null. */
  problem: string | null;
  candidates: Candidate[];
};

export const isReel = (m: Media) => m.productType === "REELS" || m.mediaType === "VIDEO";

/** Posts a week over the span of what was fetched (at most the last 90 days). */
export function postsPerWeek(media: Media[], now = new Date()): number | null {
  const times = media.map((m) => Date.parse(m.timestamp)).filter((t) => Number.isFinite(t) && now.getTime() - t <= 90 * 86_400_000);
  if (times.length < 2) return null;
  const days = Math.max(7, (now.getTime() - Math.min(...times)) / 86_400_000);
  return Math.round((times.length / days) * 7 * 10) / 10;
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Scores one account's Reels against its own median and sorts them into winners, average and the rest. */
export function studyAccount(acc: DiscoveredAccount, now = new Date()): AccountStudy {
  const reels = acc.media.filter((m) => isReel(m) && m.permalink);
  const age = (m: Media) => (now.getTime() - Date.parse(m.timestamp)) / 86_400_000;
  const settled = reels.filter((m) => age(m) >= MIN_AGE_DAYS && age(m) <= MAX_AGE_DAYS);
  const base: AccountStudy = { username: acc.username, followers: acc.followers, reels: reels.length, settled: settled.length, scoredBy: null, median: null, postsPerWeek: postsPerWeek(acc.media, now), winners: 0, average: 0, problem: null, candidates: [] };
  // One measure for the whole account: views when nearly every Reel shows
  // them, else likes plus comments. Mixing the two would rank Reels by which
  // number Instagram happened to give.
  const withViews = settled.filter((m) => typeof m.views === "number" && m.views > 0);
  const withLikes = settled.filter((m) => typeof m.likes === "number");
  const scoredBy: ScoredBy | null = settled.length && withViews.length >= settled.length * 0.8 ? "views" : settled.length && withLikes.length >= settled.length * 0.8 ? "likes and comments" : null;
  if (!scoredBy) return { ...base, problem: settled.length ? "Instagram shows neither views nor likes for its Reels" : `none of its ${reels.length} Reels is between ${MIN_AGE_DAYS} and ${MAX_AGE_DAYS} days old` };
  const scored = (scoredBy === "views" ? withViews : withLikes).map((m) => ({ m, score: scoredBy === "views" ? m.views! : m.likes! + (m.comments ?? 0) })).sort((a, b) => b.score - a.score);
  const med = median(scored.map((s) => s.score));
  if (scored.length < MIN_SCORED) return { ...base, scoredBy, median: med, problem: `only ${scored.length} Reels old enough to score (needs ${MIN_SCORED})` };
  if (!med || med <= 0) return { ...base, scoredBy, median: med, problem: `its median Reel has no ${scoredBy}` };
  const quarter = Math.floor(scored.length / 4);
  const candidates = scored.map(({ m, score }, i): Candidate => {
    const lift = round(score / med);
    const group: Group = i < quarter ? (lift >= WINNER_LIFT ? "winner" : "other") : i < scored.length - quarter ? "average" : "other";
    return { url: m.permalink!, account: acc.username, postedAt: m.timestamp.slice(0, 10), ageDays: Math.round(age(m)), caption: m.caption ?? "", views: m.views ?? null, likes: m.likes, comments: m.comments, audioType: m.audioType ?? null, mediaUrl: m.mediaUrl, thumbnailUrl: m.thumbnailUrl, score, lift, group };
  });
  return { ...base, scoredBy, median: med, winners: candidates.filter((c) => c.group === "winner").length, average: candidates.filter((c) => c.group === "average").length, candidates };
}

/**
 * Up to `perGroup` winners and `perGroup` average Reels, taken from the
 * accounts in turns so one account doesn't crowd out the rest: each
 * account's biggest winners first, and its average Reels closest to its
 * median first.
 */
export function pickSample(accounts: AccountStudy[], perGroup: number): { winners: Candidate[]; average: Candidate[] } {
  const turns = (queues: Candidate[][]) => {
    const out: Candidate[] = [];
    while (out.length < perGroup && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next && out.length < perGroup) out.push(next);
      }
    }
    return out;
  };
  const usable = accounts.filter((a) => !a.problem);
  return {
    winners: turns(usable.map((a) => a.candidates.filter((c) => c.group === "winner").sort((x, y) => y.lift - x.lift))),
    average: turns(usable.map((a) => a.candidates.filter((c) => c.group === "average").sort((x, y) => Math.abs(x.lift - 1) - Math.abs(y.lift - 1)))),
  };
}
