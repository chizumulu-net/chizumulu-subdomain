// 서브도메인 이름/레코드 검증 공통 로직. validate.mjs(스키마+이름 검증),
// check-pr.mjs(owner 검증), deploy.mjs(파일명->서브도메인 이름 변환)에서
// 공유해서 쓴다.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// 서브도메인으로 등록 못 하게 막는 이름들. 인프라/보안상 민감한 이름
// (www, api, ns1 등)이거나 리포/도메인 자체 이름(chizumulu)이라 충돌 위험.
export const RESERVED = new Set([
  "www", "api", "admin", "mail", "smtp", "pop", "imap", "ftp", "ns1", "ns2",
  "cpanel", "webmail", "autodiscover", "autoconfig", "cloudflare", "dns",
  "chizumulu", "root", "status", "support", "help", "blog", "shop", "store",
]);

// 소문자/숫자/하이픈만 허용, 하이픈으로 시작/끝 불가 (DNS 라벨 규칙 + 가독성).
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// subdomains/foo.json -> "foo". 파일명 자체가 곧 서브도메인 이름이라는
// 이 리포의 핵심 규칙(파일 하나 = 서브도메인 하나)이 여기 반영돼있다.
export function subdomainNameFromPath(path) {
  return basename(path, ".json");
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// 이름 규칙(정규식) + 예약어 위반을 모두 모아서 반환. 하나만 걸려도
// 등록 불가지만, 사용자가 한 번에 다 고칠 수 있게 에러를 누적해서 준다.
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

// DNS 규칙상 같은 name엔 CNAME이 다른 타입(A/TXT 등)과 공존할 수 없다
// (CNAME은 그 이름에 대한 유일한 레코드여야 함). name별로 그룹을 나눠서
// 검사해야 하는 이유: 예전엔 파일 전체 기준으로 검사해서 apex(@)의 CNAME
// 하나 때문에 완전히 다른 name(예: api)의 A 레코드까지 막히던 버그가 있었다.
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
