/** Today's date in Arizona (UTC-7 all year), like "2026-10-20". */
export function arizonaDay(now: Date): string {
  return new Date(now.getTime() - 7 * 3600_000).toISOString().slice(0, 10);
}

export const DAY_MS = 86_400_000;

/** Whole days from `iso` to `now`, or null when there's no date. */
export function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY_MS) : null;
}
