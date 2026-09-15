import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const extensions = new Set([".tsx", ".ts", ".jsx", ".js"]);
const ignored = new Set([path.join("src", "i18n", "index.ts")]);
const technicalTokens = new Set([
  "results.reduce",
  "Promise",
  "Excel",
  "err",
  "warn",
  "t-em",
  "t-gold",
]);
const findings = [];

// This is intentionally a report, not a build blocker. Technical identifiers,
// SQL, imports, CSS class names and file-format names are not user-visible English.
const jsxText = />\s*([A-Za-z][A-Za-z0-9 &'().,:!?+\-/]{2,})\s*</g;
const userProp = /\b(placeholder|title|aria-label|alt|label|description)\s*=\s*["']([^"']*[A-Za-z][^"']*)["']/g;
const commonLiteral = /\b(?:toast|error|message|confirm|warning|success)\s*[:=]\s*["'`]([^"'`]*[A-Za-z][^"'`]*)["'`]/gi;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name))) scan(full);
  }
}

function scan(file) {
  const rel = path.relative(process.cwd(), file);
  if (ignored.has(rel)) return;
  const text = fs.readFileSync(file, "utf8");
  const add = (match, value, index, kind) => {
    const before = text.slice(0, index);
    const line = before.split(/\r?\n/).length;
    const clean = value.trim();
    if (!clean || technicalTokens.has(clean) || /^[A-Z_]+$/.test(clean) || /^[A-Za-z]+\d+$/.test(clean)) return;
    findings.push({ file: rel, line, kind, text: clean });
  };

  for (const re of [jsxText, userProp, commonLiteral]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) add(m, m[2] ?? m[1], m.index, re === jsxText ? "JSX text" : re === userProp ? m[1] : "message literal");
  }
}

walk(root);
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

console.log(`\nHardcoded English audit: ${findings.length} candidate(s)\n`);
for (const item of findings) console.log(`${item.file}:${item.line} [${item.kind}] ${item.text}`);
console.log("\nMove genuine user-visible strings to src/i18n/index.ts and render them through t().");
