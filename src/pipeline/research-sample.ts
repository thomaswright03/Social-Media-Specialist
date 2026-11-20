// Stage 1: which Reels are winners, and what they're compared with.
//
// A Reel's raw views say more about the size of its account than about the
// Reel, so each Reel is scored against its own account: its views divided by
// what that account's Reels were getting around the same time (its "lift").
// "Around the same time" is the median of the WINDOW Reels posted nearest to
// it: an account that grew tenfold in a year would otherwise have only its
// newest Reels as winners, and the comparison would show how the account
// changed, not why a Reel won. A winner is in its account's top quarter by
// lift, with a lift of at least WINNER_LIFT. It is compared with the same
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
/** A Reel is scored against the median of this many Reels posted nearest to it (itself included). */
export const WINDOW = 21;

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
  /** score ÷ the median score of the account's Reels posted around the same time. */
  lift: number;
  group: Group;
};

export type AccountStudy = {
  username: string;
  followers: number | null;
  /** Posts read, how many the account has in all (when Instagram says), and the requests reading them took. */
  postsRead?: number;
  postsInAll?: number | null;
  requests?: number;
  /** Reels among the posts read. */
  reels: number;
  /** Reels old enough to score and not too old. */
  settled: number;
  scoredBy: ScoredBy | null;
  median: number | null;
  postsPerWeek: number | null;
  winners: number;
  average: number;
  /** How many of those Instagram gives a video file for. */
  winnersWithVideo?: number;
  averageWithVideo?: number;
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
  const base: AccountStudy = { username: acc.username, followers: acc.followers, postsRead: acc.media.length, postsInAll: acc.posts, ...(acc.requests ? { requests: acc.requests } : {}), reels: reels.length, settled: settled.length, scoredBy: null, median: null, postsPerWeek: postsPerWeek(acc.media, now), winners: 0, average: 0, problem: null, candidates: [] };
  // One measure for the whole account: views when nearly every Reel shows
  // them, else likes plus comments. Mixing the two would rank Reels by which
  // number Instagram happened to give.
  const withViews = settled.filter((m) => typeof m.views === "number" && m.views > 0);
  const withLikes = settled.filter((m) => typeof m.likes === "number");
  const scoredBy: ScoredBy | null = settled.length && withViews.length >= settled.length * 0.8 ? "views" : settled.length && withLikes.length >= settled.length * 0.8 ? "likes and comments" : null;
  if (!scoredBy) return { ...base, problem: settled.length ? "Instagram shows neither views nor likes for its Reels" : `none of its ${reels.length} Reels is between ${MIN_AGE_DAYS} and ${MAX_AGE_DAYS} days old` };
  const byDate = (scoredBy === "views" ? withViews : withLikes).map((m) => ({ m, score: scoredBy === "views" ? m.views! : m.likes! + (m.comments ?? 0) })).sort((a, b) => Date.parse(a.m.timestamp) - Date.parse(b.m.timestamp));
  const med = median(byDate.map((s) => s.score));
  if (byDate.length < MIN_SCORED) return { ...base, scoredBy, median: med, problem: `only ${byDate.length} Reels old enough to score (needs ${MIN_SCORED})` };
  if (!med || med <= 0) return { ...base, scoredBy, median: med, problem: `its median Reel has no ${scoredBy}` };
  // Each Reel against the WINDOW Reels posted nearest to it (the whole account when it has no more than that).
  const size = Math.min(WINDOW, byDate.length);
  const scored = byDate
    .map(({ m, score }, i) => {
      const from = Math.max(0, Math.min(i - Math.floor(size / 2), byDate.length - size));
      const around = median(byDate.slice(from, from + size).map((s) => s.score));
      return { m, score, lift: round(score / (around && around > 0 ? around : med)) };
    })
    .sort((a, b) => b.lift - a.lift || b.score - a.score);
  const quarter = Math.floor(scored.length / 4);
  const candidates = scored.map(({ m, score, lift }, i): Candidate => {
    const group: Group = i < quarter ? (lift >= WINNER_LIFT ? "winner" : "other") : i < scored.length - quarter ? "average" : "other";
    return { url: m.permalink!, account: acc.username, postedAt: m.timestamp.slice(0, 10), ageDays: Math.round(age(m)), caption: m.caption ?? "", views: m.views ?? null, likes: m.likes, comments: m.comments, audioType: m.audioType ?? null, mediaUrl: m.mediaUrl, thumbnailUrl: m.thumbnailUrl, score, lift, group };
  });
  const inGroup = (group: Group, video = false) => candidates.filter((c) => c.group === group && (!video || c.mediaUrl)).length;
  return { ...base, scoredBy, median: med, winners: inGroup("winner"), average: inGroup("average"), winnersWithVideo: inGroup("winner", true), averageWithVideo: inGroup("average", true), candidates };
}

const n = (v: number) => v.toLocaleString("en-US");

/** One account in plain words, for the log, the report and the accounts test. */
export function accountLine(a: Omit<AccountStudy, "candidates">): string {
  const read = a.postsRead !== undefined ? `${n(a.postsRead)}${a.postsInAll ? ` of its ${n(a.postsInAll)}` : ""} posts read, ` : "";
  if (a.problem) return `@${a.username}: not used. ${a.problem}${a.postsRead ? ` (${read.replace(/, $/, "")})` : ""}.`;
  const video = (count: number | undefined) => (count === undefined ? "" : ` (${count} with a video file)`);
  return `@${a.username}: ${a.followers === null ? "?" : n(a.followers)} followers, ${read}${a.settled} Reels scored by ${a.scoredBy}, median ${a.median === null ? "?" : n(a.median)}, ${a.postsPerWeek ?? "?"} posts a week. ${a.winners} ${a.winners === 1 ? "winner" : "winners"}${video(a.winnersWithVideo)}, ${a.average} average${video(a.averageWithVideo)}.`;
}

/**
 * Up to `perGroup` winners and `perGroup` average Reels, taken from the
 * accounts in turns so one account doesn't crowd out the rest.
 *
 * Within an account, Reels that come with a video file go first: only those
 * can be measured (cuts, sound, the words), and the first real run got a
 * video for 3 of the 24 Reels it took by lift alone, which left every rule
 * about the video without data. After that, the biggest winners, and the
 * average Reels closest to the account's median.
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
  const videoFirst = (x: Candidate, y: Candidate) => Number(Boolean(y.mediaUrl)) - Number(Boolean(x.mediaUrl));
  const usable = accounts.filter((a) => !a.problem);
  return {
    winners: turns(usable.map((a) => a.candidates.filter((c) => c.group === "winner").sort((x, y) => videoFirst(x, y) || y.lift - x.lift))),
    average: turns(usable.map((a) => a.candidates.filter((c) => c.group === "average").sort((x, y) => videoFirst(x, y) || Math.abs(x.lift - 1) - Math.abs(y.lift - 1)))),
  };
}
