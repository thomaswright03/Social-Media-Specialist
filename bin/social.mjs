#!/usr/bin/env node
// Thin launcher so `npx social …` / `npm link` work without a build step.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const result = spawnSync(tsx, [path.join(root, "src", "cli.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
