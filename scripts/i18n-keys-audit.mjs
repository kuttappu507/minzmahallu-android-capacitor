#!/usr/bin/env node
/* Audit: every t("key") call must exist in the i18n dictionary.
 * Missing keys render the literal key string to the user (EN and ML). */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();
const dictPath = path.join(root, "src/i18n/index.ts");
const dict = fs.readFileSync(dictPath, "utf8");
const keys = new Set();
for (const m of dict.matchAll(/([a-z_0-9]+):\s*\{\s*en:/g)) keys.add(m[1]);

const files = execSync(`grep -rl 't("' src --include=*.tsx --include=*.ts`)
  .toString().trim().split("\n").filter(Boolean);

const missing = new Map();
for (const f of files) {
  const c = fs.readFileSync(path.join(root, f), "utf8");
  for (const m of c.matchAll(/\bt\("([a-z_0-9]+)"\)/g)) {
    if (!keys.has(m[1])) {
      if (!missing.has(f)) missing.set(f, new Set());
      missing.get(f).add(m[1]);
    }
  }
}

let n = 0;
for (const [f, ks] of missing) { n += ks.size; console.log(`${f}: ${[...ks].join(", ")}`); }
console.log(`\nTOTAL missing-key usages: ${n}`);
process.exit(n ? 1 : 0);
