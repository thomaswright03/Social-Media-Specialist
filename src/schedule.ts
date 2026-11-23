// Five posts a day, made from 6 AM until there are five (Thomas, 2026-11-23:
// "I want it to be making content and posting it starting at 6am everyday
// until there's 5 posts a day"). There are no fixed times: from 6 AM to 9 PM
// Arizona time (UTC-7 all year) reels.yml runs every hour, and each run makes
// and posts one Reel unless today already has five on Instagram (counting
// what Thomas approved for today). A Reel that fails a check is simply
// followed by the next run's, up to MAX_TRIES a day. A post Thomas approves
// goes out at the next free hour of the day (one an hour); the Vault's copy of
// nextSlot (src/lib/social.ts) must match, since approving there picks it.
import { vaultNow, type Vault } from "./vault.ts";

const AZ_OFFSET_MS = 7 * 3600_000;
const HOUR_MS = 3600_000;

/** SocialStatus row with today's count, for the Vault page's Schedule. */
export const REELS_TODAY_ROW = "reels-today";

/** Posts a day, everything on Instagram counted. */
export const DAILY_TARGET = 5;
/** The day's runs: the first starts at 6 AM, the last at 9 PM (Arizona). */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 21;
/** Reels the specialist starts in one day at most, so failed checks can't run up the bill. */
export const MAX_TRIES = 10;
/** Minutes past the hour an approved post is set for, so the hourly :29 run posts it. */
export const POST_MINUTE = 20;

/** Midnight of the Arizona day that holds `t`. */
export function azDayStart(t: Date): Date {
  const az = new Date(t.getTime() - AZ_OFFSET_MS);
  return new Date(Date.UTC(az.getUTCFullYear(), az.getUTCMonth(), az.getUTCDate()) + AZ_OFFSET_MS);
}

export const azHour = (t: Date) => new Date(t.getTime() - AZ_OFFSET_MS).getUTCHours();

/** When an approved post goes out: the next hour from 6 AM to 9 PM that no other approved or posted post has, at :20, at least 15 minutes out. */
export function nextSlot(taken: (string | Date | null)[], now: Date): Date {
  const times = taken.filter((t): t is string | Date => !!t).map((t) => new Date(t).getTime());
  for (let d = 0; d < 120; d++) {
    const day = azDayStart(new Date(now.getTime() + d * 86_400_000));
    for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) {
      const start = day.getTime() + h * HOUR_MS;
      const at = start + POST_MINUTE * 60_000;
      if (at < now.getTime() + 15 * 60_000) continue;
      if (times.some((t) => t >= start && t < start + HOUR_MS)) continue;
      return new Date(at);
    }
  }
  return new Date(now.getTime() + 24 * HOUR_MS);
}

export type DayCount = {
  /** The Arizona date, YYYY-MM-DD. */
  date: string;
  /** Posts on Instagram today, whoever made them. */
  posted: number;
  /** Posts Thomas approved that go out later today. */
  approvedLater: number;
  /** Reels the specialist started today. */
  tries: number;
  target: number;
  maxTries: number;
};

export type DayDecision = { make: boolean; why: string };

/** Whether this run makes a Reel, and why not. */
export function decideRun(c: DayCount, now: Date): DayDecision {
  const hour = azHour(now);
  if (hour < DAY_START_HOUR) return { make: false, why: `It's before ${DAY_START_HOUR} AM; the day's Reels start then.` };
  if (c.posted + c.approvedLater >= c.target)
    return { make: false, why: `Today has its ${c.target}: ${c.posted} posted${c.approvedLater ? ` and ${c.approvedLater} of yours still to go out` : ""}.` };
  if (c.tries >= c.maxTries) return { make: false, why: `${c.tries} Reels were started today, the most it makes in a day; it starts again tomorrow at ${DAY_START_HOUR} AM.` };
  return { make: true, why: `Today has ${c.posted} of ${c.target} posted${c.approvedLater ? ` plus ${c.approvedLater} of yours to come` : ""}, so it makes another.` };
}

/** Today's count: Instagram's own list of posts, the approved posts still to go out today, and the Reels started today. */
export async function countToday(vault: Pick<Vault, "posts" | "reelsTriedSince">, listMedia: (() => Promise<{ timestamp: string }[]>) | null, now: Date): Promise<DayCount> {
  const start = azDayStart(now);
  const end = new Date(start.getTime() + 86_400_000);
  const media = listMedia ? await listMedia() : [];
  const posted = media.filter((m) => Date.parse(m.timestamp) >= start.getTime() && Date.parse(m.timestamp) < end.getTime()).length;
  const approved = await vault.posts(`"state" IN ('approved','publishing') AND "scheduledFor" IS NOT NULL AND "scheduledFor" < ?`, [vaultNow(end)]);
  const tries = await vault.reelsTriedSince(start);
  return { date: new Date(start.getTime() - AZ_OFFSET_MS).toISOString().slice(0, 10), posted, approvedLater: approved.length, tries, target: DAILY_TARGET, maxTries: MAX_TRIES };
}
