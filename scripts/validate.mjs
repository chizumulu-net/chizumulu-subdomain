import { existsSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { loadJson, subdomainNameFromPath, validateName, validateRecords } from "./lib.mjs";

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const schema = loadJson(new URL("../schema/subdomain.schema.json", import.meta.url));
const validateSchema = ajv.compile(schema);

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/validate.mjs <file.json> [...]");
  process.exit(1);
}

let failed = false;

for (const file of files) {
  if (!existsSync(file)) {
    console.log(`[SKIP] ${file} (deleted)`);
    continue;
  }

  const name = subdomainNameFromPath(file);
  const errors = [];

  let data;
  try {
    data = loadJson(file);
  } catch (e) {
    errors.push(`JSON 파싱 실패: ${e.message}`);
  }

  if (data) {
    if (!validateSchema(data)) {
      for (const e of validateSchema.errors) {
        errors.push(`스키마 오류: ${e.instancePath || "/"} ${e.message}`);
      }
    } else {
      errors.push(...validateRecords(data.records));
    }
  }

  errors.push(...validateName(name));

  if (errors.length > 0) {
    failed = true;
    console.error(`\n[FAIL] ${file}`);
    for (const e of errors) console.error(`  - ${e}`);
  } else {
    console.log(`[OK] ${file} (${name})`);
  }
}

if (failed) process.exit(1);
