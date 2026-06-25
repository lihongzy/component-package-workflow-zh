#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] || "src";
const allowedPxPatterns = [
  /max-width\s*:\s*\d+(?:\.\d+)?px/,
  /min-height\s*:\s*max\(\s*44px,/,
  /border(?:-[a-z]+)?\s*:\s*1px\b/,
  /border-(?:top|right|bottom|left)\s*:\s*1px\b/,
  /outline\s*:\s*1px\b/,
];

function walk(dir) {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return walk(path);
    }
    return /\.(styles\.ts|styles\.tsx|tsx|ts)$/.test(entry) ? [path] : [];
  });
}

const findings = [];

for (const file of walk(root)) {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!/\d+(?:\.\d+)?px/.test(line)) {
      return;
    }
    if (!/[a-zA-Z-]+\s*:.*\d+(?:\.\d+)?px/.test(line)) {
      return;
    }
    if (/["'`][^"'`]*\d+(?:\.\d+)?px/.test(line)) {
      return;
    }
    if (allowedPxPatterns.some((pattern) => pattern.test(line))) {
      return;
    }
    findings.push({
      file: relative(process.cwd(), file),
      line: index + 1,
      text: line.trim(),
    });
  });
}

if (findings.length > 0) {
  console.error("H5 vw unit check failed. Convert visual px values to vw():");
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.text}`);
  }
  process.exit(1);
}

console.log("H5 vw unit check passed.");
