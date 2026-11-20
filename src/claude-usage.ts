// What the Claude calls of this run used, from `claude -p --output-format json`
// (its "usage" and "total_cost_usd"). The daily Reels add it to the History
// per Reel (Thomas, 2026-11-20: post as much as is reasonable token-wise).

export type ClaudeUsage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };

const zero = (): ClaudeUsage => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

/** Everything this process has used so far. */
export const claudeUsage: ClaudeUsage = zero();

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Adds one call's JSON answer to the running total. */
export function addUsage(json: { usage?: Record<string, unknown>; total_cost_usd?: unknown } | null | undefined, into: ClaudeUsage = claudeUsage): void {
  if (!json) return;
  const u = json.usage ?? {};
  into.calls += 1;
  into.input += num(u.input_tokens);
  into.output += num(u.output_tokens);
  into.cacheRead += num(u.cache_read_input_tokens);
  into.cacheWrite += num(u.cache_creation_input_tokens);
  into.costUsd += num(json.total_cost_usd);
}

/** A copy of the total now, to subtract later. */
export const usageMark = (from: ClaudeUsage = claudeUsage): ClaudeUsage => ({ ...from });

/** What was used since `mark`. */
export function usageSince(mark: ClaudeUsage, from: ClaudeUsage = claudeUsage): ClaudeUsage {
  return { calls: from.calls - mark.calls, input: from.input - mark.input, output: from.output - mark.output, cacheRead: from.cacheRead - mark.cacheRead, cacheWrite: from.cacheWrite - mark.cacheWrite, costUsd: from.costUsd - mark.costUsd };
}

/** "41 Claude calls, 512k tokens (38k written), about $2.10 at API prices". */
export function usageText(u: ClaudeUsage): string {
  const total = u.input + u.output + u.cacheRead + u.cacheWrite;
  const k = (x: number) => (x >= 10_000 ? `${Math.round(x / 1000)}k` : String(x));
  return `${u.calls} Claude call${u.calls === 1 ? "" : "s"}, ${k(total)} tokens (${k(u.output)} written)${u.costUsd > 0 ? `, about $${u.costUsd.toFixed(2)} at API prices` : ""}`;
}
