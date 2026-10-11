// Fails if a .tsx file contains user-facing text that doesn't come from i18n.ts.
// Checks JSX text between tags and literal aria-label / placeholder / title / alt attributes.
// Symbols, numbers and emoji are allowed; any run of 2+ letters (Latin or Devanagari) is not.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;
const LETTERS = /[A-Za-zऀ-ॿ]{2,}/;
const JSX_TEXT = />([^<>{}]+)</g;
const ATTR = /\b(aria-label|placeholder|title|alt)="([^"]*)"/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

const problems = [];
for (const file of files(ROOT)) {
  // Blank out TypeScript generics like Promise<Blob> or useState<string | null> (same length, so line numbers hold).
  const src = readFileSync(file, "utf8").replace(/([A-Za-z0-9_])<([A-Za-z_][\w\s,|.[\]]*?)>/g, (m, first) => first + " ".repeat(m.length - 1));
  const lines = src.split("\n");
  const report = (index, text) => {
    const line = src.slice(0, index).split("\n").length;
    if (!lines[line - 1].includes("i18n-ignore")) problems.push(`${file.replace(ROOT, "src")}:${line}  "${text.trim()}"`);
  };
  for (const m of src.matchAll(JSX_TEXT)) {
    const text = m[1];
    // Skip TypeScript generics/comparisons that look like tags, e.g. "Promise<void>" or "a > b".
    if (LETTERS.test(text) && !/[;=()]|=>|&&|\|\|/.test(text)) report(m.index, text);
  }
  for (const m of src.matchAll(ATTR)) if (LETTERS.test(m[2])) report(m.index, m[2]);
}

if (problems.length) {
  console.error(`Hard-coded UI text found (move it to src/lib/i18n.ts):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("i18n check passed: no hard-coded UI text in .tsx files.");
