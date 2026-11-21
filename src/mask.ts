/**
 * Hides a token in GitHub's logs. The repo is public (2026-11-21), and the
 * Facebook Page token is made at run time, so no saved secret masks it.
 */
export function maskInLogs(value: string | null | undefined, write: (line: string) => void = (l) => void process.stdout.write(l)): void {
  if (value && process.env.GITHUB_ACTIONS === "true") write(`::add-mask::${value}\n`);
}
