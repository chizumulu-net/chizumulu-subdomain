import { existsSync } from "node:fs";
import { loadJson, subdomainNameFromPath } from "./lib.mjs";

const prAuthor = process.env.PR_AUTHOR;
const ADMIN_USERS = new Set(
  (process.env.ADMIN_USERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const files = process.argv.slice(2);

if (!prAuthor) {
  console.error("PR_AUTHOR env var required");
  process.exit(1);
}

let failed = false;

for (const file of files) {
  if (!existsSync(file)) continue; // deleted file: nothing to own-check

  let data;
  try {
    data = loadJson(file);
  } catch (e) {
    failed = true;
    console.error(`[FAIL] ${file}: JSON 파싱 실패 (${e.message})`);
    continue;
  }
  const name = subdomainNameFromPath(file);
  if (ADMIN_USERS.has(prAuthor.toLowerCase())) {
    console.log(`[OK] ${file} (${name}) admin override by ${prAuthor}`);
    continue;
  }
  if (data.owner?.username?.toLowerCase() !== prAuthor.toLowerCase()) {
    failed = true;
    console.error(
      `[FAIL] ${file}: owner.username("${data.owner?.username}")이 PR 작성자("${prAuthor}")와 다름`
    );
  } else {
    console.log(`[OK] ${file} (${name}) owner matches PR author`);
  }
}

if (failed) process.exit(1);
