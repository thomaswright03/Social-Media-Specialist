// When an approved post goes out: the next posting day (Arizona time, which
// is UTC-7 all year) at the posting time that doesn't already have a post.
// The Vault's copy (src/lib/social.ts nextSlot) must match, since approving
// on the page picks the time there.
import type { SocialSettings } from "./vault.ts";

const AZ_OFFSET_MS = 7 * 3600_000;

export function nextSlot(settings: Pick<SocialSettings, "postDays" | "postTime">, taken: (string | null)[], now: Date): Date {
  const [h, m] = settings.postTime.split(":").map(Number) as [number, number];
  const busyDays = new Set(taken.filter((t): t is string => !!t).map((t) => new Date(Date.parse(t) - AZ_OFFSET_MS).toISOString().slice(0, 10)));
  const azToday = new Date(now.getTime() - AZ_OFFSET_MS);
  for (let i = 0; i < 120; i++) {
    const day = new Date(Date.UTC(azToday.getUTCFullYear(), azToday.getUTCMonth(), azToday.getUTCDate() + i));
    if (!settings.postDays.includes(day.getUTCDay())) continue;
    const key = day.toISOString().slice(0, 10);
    if (busyDays.has(key)) continue;
    const slot = new Date(day.getTime() + (h * 60 + m) * 60_000 + AZ_OFFSET_MS);
    // At least 15 minutes out, so the hourly run that picks it up isn't already past.
    if (slot.getTime() < now.getTime() + 15 * 60_000) continue;
    return slot;
  }
  return new Date(now.getTime() + 24 * 3600_000);
}
