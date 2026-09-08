// PR을 연 사람(PR_AUTHOR)이 파일 안 owner.username과 같은지 검사한다.
// 이걸로 "남의 서브도메인을 대신 등록/수정"하는 걸 막는다. ADMIN_USERS에
// 있는 계정(리포지토리 vars.ADMIN_USERS, 콤마구분)은 이 검사를 우회한다
// (관리자가 대신 처리해줄 때 쓰라고 만든 탈출구).
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
