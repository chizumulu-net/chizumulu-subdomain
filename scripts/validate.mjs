// PR에 올라온 subdomains/*.json 파일들을 스키마 + 이름 규칙 + 레코드 규칙
// 순서로 검증한다. .github/workflows/validate.yml의 "Schema validate" 단계와
// `npm run validate`(로컬 검증)에서 이 스크립트를 그대로 쓴다.
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
  // 서브도메인 삭제 PR(파일을 지우는 PR)에서는 검증할 내용이 없다.
  // 예전엔 이 체크가 없어서 삭제 PR이 ENOENT로 무조건 실패했었다.
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
