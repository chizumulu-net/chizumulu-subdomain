import { loadJson, subdomainNameFromPath } from "./lib.mjs";

const prAuthor = process.env.PR_AUTHOR;
const files = process.argv.slice(2);

if (!prAuthor) {
  console.error("PR_AUTHOR env var required");
  process.exit(1);
}

let failed = false;

for (const file of files) {
  let data;
  try {
    data = loadJson(file);
  } catch {
    continue;
  }
  const name = subdomainNameFromPath(file);
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
