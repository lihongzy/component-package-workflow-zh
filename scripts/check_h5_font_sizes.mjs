#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] || "src";
const MAX_FONT_PX = 24;
const allowLargeFontMarker = "allow-large-font";

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

function collectNumbers(pattern, text) {
  return Array.from(text.matchAll(pattern), (match) => Number.parseFloat(match[1])).filter(Number.isFinite);
}

function isFontSizeLine(line) {
  return /font-size\s*:/.test(line);
}

const findings = [];

for (const file of walk(root)) {
  const source = readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!isFontSizeLine(line) || line.includes(allowLargeFontMarker)) {
      return;
    }

    const trimmed = line.trim();
    const largePx = collectNumbers(/(\d+(?:\.\d+)?)px\b/g, line).filter((value) => value > MAX_FONT_PX);
    const largeVwFn = collectNumbers(/\bvw\(\s*(\d+(?:\.\d+)?)\s*\)/g, line).filter((value) => value > MAX_FONT_PX);
    const hasBareVwFunction = /\bvw\(\s*\d+(?:\.\d+)?\s*\)/.test(line) && !/\bfluidFont\(/.test(line) && !/\bclamp\(/.test(line);
    const hasBareVwUnit = /\d+(?:\.\d+)?vw\b/.test(line) && !/\bclamp\(/.test(line);

    if (largePx.length > 0) {
      findings.push({
        file,
        line: index + 1,
        reason: `font-size 超过 ${MAX_FONT_PX}px：${largePx.join(", ")}`,
        text: trimmed,
      });
    }

    if (largeVwFn.length > 0) {
      findings.push({
        file,
        line: index + 1,
        reason: `font-size 的 vw() 输入超过 ${MAX_FONT_PX}px：${largeVwFn.join(", ")}`,
        text: trimmed,
      });
    }

    if (hasBareVwFunction || hasBareVwUnit) {
      findings.push({
        file,
        line: index + 1,
        reason: "font-size 不应裸用无边界 vw，改用 fluidFont() 或 clamp()",
        text: trimmed,
      });
    }
  });
}

if (findings.length > 0) {
  console.error("H5 font size check failed:");
  for (const finding of findings) {
    console.error(`${relative(process.cwd(), finding.file)}:${finding.line} ${finding.reason}`);
    console.error(`  ${finding.text}`);
  }
  process.exit(1);
}

console.log("H5 font size check passed.");
