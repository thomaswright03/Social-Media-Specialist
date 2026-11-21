// The Latest Update box on the specialist's Vault page (Security check
// template, 2026-11-21): after every round of changes, replace
// LATEST_UPDATE.json with the date, a plain summary of every change, the
// changes Thomas can see (frontend, shown first) and everything else. The
// hourly `requests` run copies it into the Vault, so the page shows it within
// the hour after a merge.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Vault } from "./vault.ts";

export type LatestUpdate = { date: string; summary: string; frontend: string[]; other: string[] };

export const LATEST_UPDATE_FILE = fileURLToPath(new URL("../LATEST_UPDATE.json", import.meta.url));

export function parseLatestUpdate(text: string): LatestUpdate {
  const raw = JSON.parse(text) as Partial<LatestUpdate>;
  const list = (v: unknown, name: string) => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`LATEST_UPDATE.json: "${name}" must be a list of sentences`);
    return v as string[];
  };
  if (typeof raw.date !== "string" || !raw.date.trim()) throw new Error('LATEST_UPDATE.json needs a "date"');
  if (typeof raw.summary !== "string" || !raw.summary.trim()) throw new Error('LATEST_UPDATE.json needs a "summary"');
  return { date: raw.date, summary: raw.summary, frontend: list(raw.frontend, "frontend"), other: list(raw.other, "other") };
}

/** Copies LATEST_UPDATE.json into the Vault when it changed. */
export async function syncLatestUpdate(vault: Vault, file = LATEST_UPDATE_FILE): Promise<boolean> {
  const update = parseLatestUpdate(await readFile(file, "utf8"));
  return vault.saveLatestUpdate(JSON.stringify(update));
}
