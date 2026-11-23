// Five Reels a day (Thomas, 2026-11-23: "5 reels scheduled every day and it's
// not so thinly spread out"). The day has five times, Arizona time (UTC-7 all
// year), the hours of DAILY_SLOTS in src/pipeline/reel.ts. A post Thomas
// approves takes the next open one; at a time nothing he approved has taken,
// reels.yml makes the specialist's own Reel. Each time owns the three hours
// from its hour, so a post the backup plan put back in the queue still counts
// for the slot it lands in. The Vault's copy (src/lib/social.ts nextSlot) must
// match, since approving on the page picks the time there.

import { vaultNow, type Post, type Vault } from "./vault.ts";

const AZ_OFFSET_MS = 7 * 3600_000;
const SPAN_MS = 3 * 3600_000;

export const SLOT_HOURS = [7, 10, 13, 16, 19] as const;
/** Minutes past the hour an approved post is set for, so the hourly :29 run posts it. */
export const SLOT_MINUTE = 20;

export type Slot = { hour: number; at: Date; start: Date; end: Date };

/** The five times of the Arizona day that holds `day`. */
export function slotsOn(day: Date): Slot[] {
  const az = new Date(day.getTime() - AZ_OFFSET_MS);
  const midnight = Date.UTC(az.getUTCFullYear(), az.getUTCMonth(), az.getUTCDate()) + AZ_OFFSET_MS;
  return SLOT_HOURS.map((hour) => {
    const start = new Date(midnight + hour * 3600_000);
    return { hour, at: new Date(start.getTime() + SLOT_MINUTE * 60_000), start, end: new Date(start.getTime() + SPAN_MS) };
  });
}

/** The slot a run at `now` is for: the latest one that has started (before 7 AM, last night's). */
export function currentSlot(now: Date): Slot {
  const started = [...slotsOn(new Date(now.getTime() - 86_400_000)), ...slotsOn(now)].filter((s) => s.start.getTime() <= now.getTime());
  return started.at(-1)!;
}

export const inSlot = (t: string | Date | null | undefined, s: Slot): boolean => {
  if (!t) return false;
  const ms = new Date(t).getTime();
  return ms >= s.start.getTime() && ms < s.end.getTime();
};

/** When an approved post goes out: the next of the day's times no other approved or posted post has, at least 15 minutes out. */
export function nextSlot(taken: (string | null)[], now: Date): Date {
  for (let i = 0; i < 120; i++) {
    for (const s of slotsOn(new Date(now.getTime() + i * 86_400_000))) {
      if (s.at.getTime() < now.getTime() + 15 * 60_000) continue;
      if (taken.some((t) => inSlot(t, s))) continue;
      return s.at;
    }
  }
  return new Date(now.getTime() + 24 * 3600_000);
}

/** The post Thomas approved (or that already went out) in the slot a run at `now` is for, if any. */
export async function approvedInSlot(vault: Pick<Vault, "posts">, now: Date): Promise<Post | null> {
  const s = currentSlot(now);
  const near = await vault.posts(`"state" IN ('approved','publishing','published') AND "scheduledFor" IS NOT NULL AND "scheduledFor" >= ?`, [vaultNow(new Date(s.start.getTime() - 86_400_000))]);
  return near.find((p) => inSlot(p.scheduledFor, s)) ?? null;
}
