#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FIELD_PROP_NAMES = new Map([
  ["标题", "title"],
  ["摘要", "summary"],
  ["主线列表", "mainLineList"],
  ["主线标题", "mainLineTitle"],
  ["说明", "description"],
  ["适配度", "fitScore"],
  ["适配结论", "fitConclusion"],
  ["结论说明", "conclusionDescription"],
  ["评分依据", "scoreBasis"],
  ["适配证据列表", "fitEvidenceList"],
  ["适配维度", "fitDimension"],
  ["表现证据", "performanceEvidence"],
  ["问答列表", "qaList"],
  ["问题类型", "questionType"],
  ["问题原意", "questionIntent"],
  ["回答重点", "answerFocus"],
  ["表现判断", "performanceJudgment"],
  ["可补强点", "improvementPoint"],
  ["积极信号列表", "positiveSignalList"],
  ["保留信号列表", "reservedSignalList"],
  ["信号描述", "signalDescription"],
  ["录音依据", "audioEvidence"],
  ["风险列表", "riskList"],
  ["风险点", "riskPoint"],
  ["对话表现", "dialoguePerformance"],
  ["可能疑虑", "possibleConcern"],
  ["补强方向", "improvementDirection"],
  ["准备列表", "preparationList"],
  ["优先级", "priority"],
  ["准备主题", "preparationTopic"],
  ["准备方式", "preparationMethod"],
  ["反问分组列表", "reverseQuestionGroupList"],
  ["分组名称", "groupName"],
  ["问题列表", "questionList"],
  ["反问问题", "reverseQuestion"],
  ["反问目的", "reverseQuestionPurpose"],
]);

function fail(message, code = 1) {
  console.error(`错误：${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    html: null,
    template: null,
    out: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nextValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        fail(`${arg} 缺少参数值`);
      }
      i += 1;
      return value;
    };

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--html") {
      args.html = nextValue();
    } else if (arg === "--template") {
      args.template = nextValue();
    } else if (arg === "--out") {
      args.out = nextValue();
    } else {
      fail(`未知参数：${arg}`);
    }
  }

  if (!args.html) {
    fail("必须传入 --html");
  }
  if (!args.template) {
    fail("必须传入 --template");
  }

  return args;
}

function printHelp() {
  console.log(`usage: analyze_template_pair.mjs --html HTML_FILE --template TEMPLATE_MD [--out OUT_JSON]

解析移动端 HTML 预览和模板说明，输出可用于拆分 React 组件的模块契约。`);
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractTemplateTitle(templateText) {
  const match = templateText.match(/^#\s+(.+)$/m);
  return match ? stripMarkdown(match[1]).replace(/模板说明$/, "") : "";
}

function extractSceneModuleRows(templateText) {
  const lines = templateText.split(/\r?\n/);
  const tableStart = lines.findIndex((line) =>
    /^\|\s*顺序\s*\|\s*模块名称\s*\|\s*场景模块名称\s*\|\s*用户要解决的问题\s*\|\s*结构规范\s*\|/.test(line),
  );

  if (tableStart === -1) {
    throw new Error("模板说明中未找到场景模块表格");
  }

  const rows = [];
  for (let i = tableStart + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) {
      break;
    }
    const cells = splitMarkdownRow(line);
    if (cells.length < 5) {
      continue;
    }
    rows.push({
      order: Number.parseInt(cells[0], 10),
      moduleName: stripMarkdown(cells[1]),
      sceneModuleName: stripMarkdown(cells[2]),
      userProblem: stripMarkdown(cells[3]),
      structureSpec: cells.slice(4).join("|").trim(),
    });
  }

  return rows;
}

function extractBacktickValues(text) {
  return Array.from(String(text || "").matchAll(/`([^`]+)`/g), (match) => match[1].trim())
    .filter(Boolean);
}

function propNameForField(fieldName, index) {
  return FIELD_PROP_NAMES.get(fieldName) || `field${index + 1}`;
}

function extractTopLevelFields(structureSpec) {
  const match = structureSpec.match(/字段：(.+?)(?:。|$)/);
  const source = match ? match[1] : structureSpec;
  return extractBacktickValues(source).map((name, index) => ({
    name,
    propName: propNameForField(name, index),
    required: true,
  }));
}

function segmentForField(structureSpec, fieldName) {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(
    structureSpec.matchAll(new RegExp(`\`${escaped}\`([^；。|]*)`, "g")),
    (match) => match[1].split("`")[0],
  );
  return (
    matches.find((segment) => /固定为|不超过|最多|只使用/.test(segment)) ||
    matches.at(-1) ||
    ""
  );
}

function extractQuotedValue(text) {
  const match = text.match(/固定为[“"]([^”"]+)[”"]/);
  return match ? match[1].trim() : null;
}

function extractEnum(text) {
  const match = text.match(/只使用([^，；。]+)/);
  if (!match) {
    return null;
  }
  const values = match[1]
    .split(/[、/]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

function extractConstraints(structureSpec, fields) {
  const constraints = {};
  const allFieldNames = extractBacktickValues(structureSpec);

  allFieldNames.forEach((fieldName, index) => {
    const propName = propNameForField(fieldName, index);
    const segment = segmentForField(structureSpec, fieldName);
    const fieldConstraints = {
      sourceFieldName: fieldName,
    };

    const fixed = extractQuotedValue(segment);
    if (fixed) {
      fieldConstraints.fixed = fixed;
    }

    const maxLength = segment.match(/不超过\s*(\d+)\s*字/);
    if (maxLength) {
      fieldConstraints.maxLength = Number.parseInt(maxLength[1], 10);
    }

    const maxItems = segment.match(/最多\s*(\d+)\s*条/);
    if (maxItems) {
      fieldConstraints.maxItems = Number.parseInt(maxItems[1], 10);
    }

    const enumValues = extractEnum(segment);
    if (enumValues) {
      fieldConstraints.enum = enumValues;
    }

    if (Object.keys(fieldConstraints).length > 1) {
      constraints[propName] = fieldConstraints;
    }
  });

  fields.forEach((field) => {
    constraints[field.propName] = {
      sourceFieldName: field.name,
      ...(constraints[field.propName] || {}),
    };
  });

  return constraints;
}

function getAttributeValue(attributes, name) {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? match[1].trim() : "";
}

function extractClassNames(html) {
  const names = new Set();
  for (const match of html.matchAll(/class\s*=\s*["']([^"']+)["']/gi)) {
    match[1].split(/\s+/).filter(Boolean).forEach((name) => names.add(name));
  }
  return Array.from(names).sort();
}

function extractHtmlSections(htmlText) {
  const sections = [];
  const sectionPattern = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  for (const match of htmlText.matchAll(sectionPattern)) {
    const attributes = match[1];
    const fullHtml = match[0];
    const className = getAttributeValue(attributes, "class");
    if (!className.split(/\s+/).includes("module")) {
      continue;
    }

    const title = fullHtml.match(/class\s*=\s*["'][^"']*\bmodule__title\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
    const preview = fullHtml.match(/class\s*=\s*["'][^"']*\bmodule__preview\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);

    sections.push({
      htmlId: getAttributeValue(attributes, "id"),
      title: title ? stripTags(title[1]) : "",
      previewText: preview ? stripTags(preview[1]) : "",
      bodyHtml: fullHtml,
      classNames: extractClassNames(fullHtml),
    });
  }
  return sections;
}

function packageNameFromSection(section, fallbackIndex) {
  const source = section?.htmlId || section?.title || `component-${fallbackIndex + 1}`;
  const ascii = source
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `component-${fallbackIndex + 1}`;
}

function mapTemplateRowsToHtmlSections(rows, sections) {
  const sectionByTitle = new Map(sections.map((section) => [section.title, section]));
  const usedSectionIds = new Set();

  const modules = rows.map((row, index) => {
    const section = sectionByTitle.get(row.sceneModuleName) || null;
    if (section?.htmlId) {
      usedSectionIds.add(section.htmlId);
    }
    const fields = extractTopLevelFields(row.structureSpec);

    return {
      order: row.order,
      moduleName: row.moduleName,
      sceneModuleName: row.sceneModuleName,
      userProblem: row.userProblem,
      componentDisplayName: row.sceneModuleName,
      componentDescription: row.userProblem,
      packageNameSuggestion: packageNameFromSection(section, index),
      htmlId: section?.htmlId || "",
      htmlTitle: section?.title || "",
      previewText: section?.previewText || "",
      fields,
      constraints: extractConstraints(row.structureSpec, fields),
      structureSpec: row.structureSpec,
      bodyHtml: section?.bodyHtml || "",
      classNames: section?.classNames || [],
      hasHtmlMatch: Boolean(section),
    };
  });

  const unmatchedHtmlSections = sections.filter((section) => !usedSectionIds.has(section.htmlId));
  return { modules, unmatchedHtmlSections };
}

export function analyzeTemplatePair({ htmlText, templateText }) {
  if (!htmlText || !templateText) {
    throw new Error("必须同时传入 htmlText 和 templateText");
  }

  const templateTitle = extractTemplateTitle(templateText);
  const rows = extractSceneModuleRows(templateText);
  const sections = extractHtmlSections(htmlText);
  const { modules, unmatchedHtmlSections } = mapTemplateRowsToHtmlSections(rows, sections);

  return {
    templateTitle,
    moduleCount: modules.length,
    modules,
    unmatchedHtmlSections,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [htmlText, templateText] = await Promise.all([
    readFile(args.html, "utf8"),
    readFile(args.template, "utf8"),
  ]);
  const result = analyzeTemplatePair({ htmlText, templateText });
  const output = `${JSON.stringify(result, null, 2)}\n`;

  if (args.out) {
    await writeFile(args.out, output);
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.stack || error.message || String(error)));
}
