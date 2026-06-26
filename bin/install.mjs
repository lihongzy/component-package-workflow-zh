#!/usr/bin/env node

import { cp, mkdir, rm, rename, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const SKILL_NAME = "component-package-workflow-zh";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  console.log(`usage: wucaishi-generative-react-skill [options]

Install the component-package-workflow-zh Codex skill.

options:
  -h, --help              Show help
  --target PATH           Install to a custom skill directory
  --no-backup             Replace an existing target without creating a backup

environment:
  CODEX_HOME              Defaults to ~/.codex when not set`);
}

function parseArgs(argv) {
  const args = {
    target: null,
    backup: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nextValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return value;
    };

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--target") {
      args.target = nextValue();
    } else if (arg === "--no-backup") {
      args.backup = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

async function pathExists(pathValue) {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

function defaultTarget() {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  return join(codexHome, "skills", SKILL_NAME);
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
}

async function copySkill(target) {
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target, { recursive: true });

  for (const entry of ["SKILL.md", "scripts", "subskills"]) {
    await cp(join(PACKAGE_ROOT, entry), join(target, entry), {
      recursive: true,
      force: true,
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolve(args.target || defaultTarget());

  if (await pathExists(target)) {
    if (args.backup) {
      const backupTarget = `${target}.backup-${timestamp()}`;
      await rename(target, backupTarget);
      console.log(`已备份已有 skill：${backupTarget}`);
    } else {
      await rm(target, { recursive: true, force: true });
    }
  }

  await copySkill(target);

  console.log(`已安装 ${SKILL_NAME} 到：${target}`);
  console.log("请重启 Codex 或刷新 skills 后使用。");
}

main().catch((error) => {
  console.error(`安装失败：${error.message}`);
  process.exit(1);
});
