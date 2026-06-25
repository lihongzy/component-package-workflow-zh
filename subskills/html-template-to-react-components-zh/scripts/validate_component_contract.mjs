#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function fail(message, code = 1) {
  console.error(`错误：${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = {
    contract: null,
    module: null,
    manifest: null,
    schema: null,
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
    } else if (arg === "--contract") {
      args.contract = nextValue();
    } else if (arg === "--module") {
      args.module = nextValue();
    } else if (arg === "--manifest") {
      args.manifest = nextValue();
    } else if (arg === "--schema") {
      args.schema = nextValue();
    } else {
      fail(`未知参数：${arg}`);
    }
  }

  for (const key of ["contract", "module", "manifest", "schema"]) {
    if (!args[key]) {
      fail(`必须传入 --${key}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`usage: validate_component_contract.mjs --contract CONTRACT_JSON --module HTML_ID_OR_NAME --manifest MANIFEST_JSON --schema SCHEMA_JSON

校验组件 manifest/schema 是否遵守模板说明解析出的字段契约。`);
}

function propsArray(manifest) {
  return Array.isArray(manifest?.props) ? manifest.props : [];
}

function schemaField(schema, propName) {
  if (!schema || typeof schema !== "object") {
    return undefined;
  }
  if (schema[propName]) {
    return schema[propName];
  }
  if (schema.properties?.[propName]) {
    return schema.properties[propName];
  }
  if (schema.fields?.[propName]) {
    return schema.fields[propName];
  }
  return undefined;
}

function propByName(manifest, propName) {
  return propsArray(manifest).find((prop) => prop?.name === propName);
}

function hasExpectedFixedValue(value, expected) {
  if (value == null) {
    return false;
  }
  if (value.default === expected || value.const === expected || value.fixed === expected) {
    return true;
  }
  return Array.isArray(value.enum) && value.enum.length === 1 && value.enum[0] === expected;
}

function hasExpectedNumber(value, key, expected) {
  return value && Number(value[key]) === expected;
}

function includesEnum(value, expectedValues) {
  if (!Array.isArray(value?.enum)) {
    return false;
  }
  return expectedValues.every((item) => value.enum.includes(item));
}

export function validateComponentContract({ contract, manifest, schema }) {
  const errors = [];
  const warnings = [];

  if (!contract || typeof contract !== "object") {
    return { errors: ["缺少 contract"], warnings };
  }

  if (manifest?.name !== contract.componentDisplayName) {
    errors.push(
      `manifest.name 必须等于场景模块名称：${contract.componentDisplayName}`,
    );
  }

  if (manifest?.description !== contract.componentDescription) {
    errors.push(
      `manifest.description 必须等于用户要解决的问题：${contract.componentDescription}`,
    );
  }

  for (const field of contract.fields || []) {
    const propName = field.propName;
    const manifestProp = propByName(manifest, propName);
    const schemaProp = schemaField(schema, propName);

    if (!manifestProp || !schemaProp) {
      errors.push(`缺少字段：${propName}（来源字段：${field.name}）`);
      continue;
    }

    const constraints = contract.constraints?.[propName] || {};
    if (constraints.fixed) {
      if (!hasExpectedFixedValue(manifestProp, constraints.fixed)) {
        errors.push(`manifest.props.${propName} 必须固定为：${constraints.fixed}`);
      }
      if (!hasExpectedFixedValue(schemaProp, constraints.fixed)) {
        errors.push(`schema.${propName} 必须固定为：${constraints.fixed}`);
      }
    }

    if (constraints.maxLength) {
      if (!hasExpectedNumber(manifestProp, "maxLength", constraints.maxLength)) {
        errors.push(`manifest.props.${propName}.maxLength 必须为 ${constraints.maxLength}`);
      }
      if (!hasExpectedNumber(schemaProp, "maxLength", constraints.maxLength)) {
        errors.push(`schema.${propName}.maxLength 必须为 ${constraints.maxLength}`);
      }
    }

    if (constraints.maxItems) {
      if (!hasExpectedNumber(manifestProp, "maxItems", constraints.maxItems)) {
        errors.push(`manifest.props.${propName}.maxItems 必须为 ${constraints.maxItems}`);
      }
      if (!hasExpectedNumber(schemaProp, "maxItems", constraints.maxItems)) {
        errors.push(`schema.${propName}.maxItems 必须为 ${constraints.maxItems}`);
      }
    }

    if (constraints.enum) {
      if (!includesEnum(manifestProp, constraints.enum)) {
        errors.push(`manifest.props.${propName}.enum 必须包含：${constraints.enum.join("/")}`);
      }
      if (!includesEnum(schemaProp, constraints.enum)) {
        errors.push(`schema.${propName}.enum 必须包含：${constraints.enum.join("/")}`);
      }
    }
  }

  return { errors, warnings };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function findContractModule(contractDoc, moduleKey) {
  const modules = Array.isArray(contractDoc?.modules) ? contractDoc.modules : [];
  return modules.find(
    (item) =>
      item.htmlId === moduleKey ||
      item.sceneModuleName === moduleKey ||
      item.componentDisplayName === moduleKey,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [contractDoc, manifest, schema] = await Promise.all([
    readJson(args.contract),
    readJson(args.manifest),
    readJson(args.schema),
  ]);
  const contract = findContractModule(contractDoc, args.module);
  if (!contract) {
    fail(`契约文件中找不到模块：${args.module}`);
  }

  const result = validateComponentContract({ contract, manifest, schema });
  if (result.errors.length > 0) {
    console.error("组件契约校验失败：");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("组件契约校验通过。");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.stack || error.message || String(error)));
}
