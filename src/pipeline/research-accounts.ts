// Stage 1: which accounts are studied for each format.
//
// The list is pipeline/research/accounts.json, two or three accounts a
// format, so one creator's template doesn't pass for "what wins". Edit that
// file to change it for good. For one run, the workflow's accounts box (or
// RESEARCH_RUN_ACCOUNTS) wins: "story: a, b; ad: c", or plain "a, b" for the
// format being studied. Each account carries what `social accounts-test`
// found for it; "also tested" lists accounts that were tried and aren't
// studied, so nobody tries them twice. Only the four formats' lists are read.
import { ENTERTAINMENT, isFormat, type Format } from "./formats.ts";
import { pipelineFile } from "./stages.ts";

export const RESEARCH_FORMATS: readonly Format[] = [...ENTERTAINMENT, "ad"];

/** A username from "@name", a profile link or a bare name; null when it isn't one. */
export function cleanHandle(a: string): string | null {
  const h = a.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/[/?#].*$/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
}

const handles = (text: string) => [...new Set(text.split(/[\s,]+/).map(cleanHandle).filter((h): h is string => Boolean(h)))];

/** The accounts in pipeline/research/accounts.json. */
export function fileAccounts(json: string = pipelineFile("research/accounts.json")): Record<Format, string[]> {
  const out = { story: [], satisfying: [], explainer: [], ad: [] } as Record<Format, string[]>;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return out;
  }
  for (const [format, list] of Object.entries(parsed)) {
    if (!isFormat(format) || !Array.isArray(list)) continue;
    out[format] = handles(list.map((x) => (typeof x === "string" ? x : String((x as { account?: unknown })?.account ?? ""))).join(" "));
  }
  return out;
}

/**
 * Accounts typed for one run: "story: a, b; ad: c" names formats; a plain
 * "a, b" belongs to `format`. Formats left out aren't in the answer.
 */
export function parseAccounts(text: string, format?: Format): Partial<Record<Format, string[]>> {
  const out: Partial<Record<Format, string[]>> = {};
  for (const part of text.split(/[;\n]+/)) {
    const m = part.match(/^\s*([a-z]+)\s*:(?!\/\/)(.*)$/i);
    const f = m ? m[1]!.toLowerCase() : format;
    const names = handles(m ? m[2]! : part);
    if (!f || !isFormat(f) || !names.length) continue;
    out[f] = [...new Set([...(out[f] ?? []), ...names])];
  }
  return out;
}

/** The accounts to study for a format: this run's own, else the file's. */
export function accountsFor(format: Format, typed = "", json?: string): string[] {
  return parseAccounts(typed, format)[format] ?? fileAccounts(json)[format];
}
