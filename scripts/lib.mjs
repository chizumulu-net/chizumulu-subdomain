import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const RESERVED = new Set([
  "www", "api", "admin", "mail", "smtp", "pop", "imap", "ftp", "ns1", "ns2",
  "cpanel", "webmail", "autodiscover", "autoconfig", "cloudflare", "dns",
  "chizumulu", "root", "status", "support", "help", "blog", "shop", "store",
]);

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function subdomainNameFromPath(path) {
  return basename(path, ".json");
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function validateName(name) {
  const errors = [];
  if (!NAME_RE.test(name)) {
    errors.push(
      `"${name}": 소문자/숫자/하이픈만 허용, 하이픈으로 시작/끝 불가`
    );
  }
  if (RESERVED.has(name)) {
    errors.push(`"${name}": 예약어라 등록 불가`);
  }
  return errors;
}

export function validateRecords(records) {
  const errors = [];

  const byName = new Map();
  for (const r of records) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  for (const [name, group] of byName) {
    const hasCname = group.some((r) => r.type === "CNAME");
    const hasOther = group.some((r) => r.type !== "CNAME");
    if (hasCname && hasOther) {
      errors.push(`"${name}": CNAME 레코드는 같은 name에 A/TXT 등 다른 레코드와 공존 불가`);
    }
  }

  const cnameNames = records.filter((r) => r.type === "CNAME").map((r) => r.name);
  const dup = cnameNames.find((n, i) => cnameNames.indexOf(n) !== i);
  if (dup) errors.push(`CNAME name "${dup}" 중복`);
  return errors;
}
