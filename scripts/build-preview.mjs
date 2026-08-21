import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { loadJson } from "./lib.mjs";

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "chizumulu.net";
const OUT_DIR = "dist-preview";

const files = readdirSync("subdomains").filter((f) => f.endsWith(".json"));

const rows = files
  .map((f) => {
    const name = f.replace(/\.json$/, "");
    let data;
    try {
      data = loadJson(`subdomains/${f}`);
    } catch {
      return `<tr><td>${name}</td><td colspan="3">파싱 실패</td></tr>`;
    }
    const records = data.records
      .map((r) => `${r.type} ${r.name} → ${escapeHtml(r.content)}`)
      .join("<br>");
    return `<tr>
      <td>${name}.${ROOT_DOMAIN}</td>
      <td>${escapeHtml(data.owner?.username ?? "?")}</td>
      <td>${records}</td>
    </tr>`;
  })
  .join("\n");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>chizumulu.net subdomains preview</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; vertical-align: top; }
th { background: #f4f4f4; }
</style>
</head>
<body>
<h1>chizumulu.net subdomains</h1>
<p>등록된/신청된 서브도메인 목록 (총 ${files.length}개)</p>
<table>
<thead><tr><th>subdomain</th><th>owner</th><th>records</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/index.html`, html);
console.log(`preview built: ${OUT_DIR}/index.html (${files.length} subdomains)`);
