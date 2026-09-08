// main에 merge된 subdomains/*.json 변경분을 실제 Cloudflare DNS 레코드로
// 반영한다 (.github/workflows/deploy.yml의 push 트리거에서 실행됨).
// 파일 하나 = 서브도메인 하나 = Cloudflare 레코드 여러 개일 수 있어서,
// "JSON에 있는 상태"와 "Cloudflare에 있는 상태"를 diff해서 맞추는
// reconcile 방식으로 동작한다 (생성/수정/삭제를 전부 여기서 판단).
import { existsSync } from "node:fs";
import { loadJson, subdomainNameFromPath } from "./lib.mjs";

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = process.env.CF_ZONE_ID;
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || "chizumulu.net";

if (!CF_API_TOKEN || !CF_ZONE_ID) {
  console.error("CF_API_TOKEN / CF_ZONE_ID env vars required");
  process.exit(1);
}

const API = `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records`;

const MAX_RETRIES = 3;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cloudflare API 호출 하나 = 여기 통과. 네트워크 에러/429(rate limit)/5xx는
// 지수 백오프로 최대 3번까지 재시도한다. 4xx(요청 자체가 잘못된 경우, 예:
// 스키마는 통과했지만 Cloudflare가 거부하는 값)는 재시도해봤자 똑같이
// 실패하므로 즉시 에러를 던진다.
async function cfRaw(path, options = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw e;
      await sleep(2 ** attempt * 500);
      continue;
    }

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(2 ** attempt * 500);
      continue;
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(`Cloudflare API error: ${JSON.stringify(json.errors)}`);
    }
    return json;
  }
}

async function cf(path, options = {}) {
  return (await cfRaw(path, options)).result;
}

async function listAllRecords() {
  const all = [];
  let page = 1;
  while (true) {
    const json = await cfRaw(`?page=${page}&per_page=100`);
    all.push(...json.result);
    const totalPages = json.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return all;
}

// "@"는 서브도메인 자체(apex)를 가리킨다. 예: subdomain="foo", recordName="@"
// -> "foo.chizumulu.net". recordName="www" -> "www.foo.chizumulu.net".
function fqdn(subdomain, recordName) {
  const parts = recordName === "@" ? [subdomain] : [recordName, subdomain];
  return `${parts.join(".")}.${ROOT_DOMAIN}`;
}

// ttl 1 = Cloudflare "auto"; 스키마의 60~86400 범위는 사용자가 명시적으로
// ttl을 지정했을 때만 적용되고, 생략 시엔 auto로 둔다.
function recordBody(name, record) {
  return {
    type: record.type,
    name,
    content: record.content,
    ttl: record.ttl ?? 1,
    proxied: record.type !== "TXT" ? Boolean(record.proxied) : false,
  };
}

// 같은 type+name에 레코드가 여러 개(A 라운드로빈 등) 올 수 있으므로
// content로 매칭해 upsert하고, JSON에 더 이상 없는 레코드는 삭제한다.
async function reconcileGroup(subdomain, type, recordName, records) {
  const name = fqdn(subdomain, recordName);
  const existing = await cf(`?type=${type}&name=${encodeURIComponent(name)}`);
  const remaining = [...existing];

  for (const record of records) {
    const body = recordBody(name, record);
    const idx = remaining.findIndex((e) => e.content === record.content);
    if (idx >= 0) {
      const match = remaining.splice(idx, 1)[0];
      await cf(`/${match.id}`, { method: "PUT", body: JSON.stringify(body) });
      console.log(`[UPDATED] ${name} (${type}) -> ${record.content}`);
    } else {
      await cf("", { method: "POST", body: JSON.stringify(body) });
      console.log(`[CREATED] ${name} (${type}) -> ${record.content}`);
    }
  }

  for (const stale of remaining) {
    await cf(`/${stale.id}`, { method: "DELETE" });
    console.log(`[DELETED] ${name} (${type}) -> ${stale.content} (stale)`);
  }
}

// 레코드 name별로 JSON에 남아있는 type 집합을 구해, Cloudflare에 있는
// 그 외 type(예: A->CNAME으로 바뀐 경우 옛 A)을 먼저 지운다. reconcileGroup은
// type+name이 그대로 유지되는 경우만 다루므로 type 자체가 바뀐 레코드는
// 놓치고, Cloudflare가 같은 name에 A/CNAME 공존을 거부해 배포가 통째로
// 실패한다.
async function cleanupStaleTypes(subdomain, groups) {
  const typesByName = new Map();
  for (const key of groups.keys()) {
    const [type, name] = key.split("|");
    if (!typesByName.has(name)) typesByName.set(name, new Set());
    typesByName.get(name).add(type);
  }
  for (const [recordName, types] of typesByName) {
    const name = fqdn(subdomain, recordName);
    const existing = await cf(`?name=${encodeURIComponent(name)}`);
    for (const stale of existing.filter((r) => !types.has(r.type))) {
      await cf(`/${stale.id}`, { method: "DELETE" });
      console.log(`[DELETED] ${name} (${stale.type}) -> ${stale.content} (type changed)`);
    }
  }
}

// JSON 하나(서브도메인 하나)를 type+name별 그룹으로 나눠서 Cloudflare에
// 반영한다. proxied는 레코드에 직접 안 적혀있으면 파일 최상위 값(전체
// 서브도메인 기본값), 그것도 없으면 false로 떨어진다.
async function syncSubdomain(subdomain, data) {
  const groups = new Map();
  for (const record of data.records) {
    record.proxied = record.proxied ?? data.proxied ?? false;
    const key = `${record.type}|${record.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  await cleanupStaleTypes(subdomain, groups);
  for (const [key, records] of groups) {
    const [type, name] = key.split("|");
    await reconcileGroup(subdomain, type, name, records);
  }
}

// 서브도메인 파일 자체가 삭제됐을 때(신청 철회) 호출된다. 이름/타입별로
// 하나씩 찾아 지우는 대신, 그 서브도메인 밑에 있는 모든 레코드를(apex +
// 하위 name 전부) 한 번에 조회해서 통째로 삭제한다 - JSON이 이미 사라져서
// "어떤 name/type이 있었는지" 알 방법이 없기 때문.
async function deleteSubdomain(subdomain) {
  const apexName = `${subdomain}.${ROOT_DOMAIN}`;
  const suffix = `.${apexName}`;
  const all = await listAllRecords();
  const toDelete = all.filter((r) => r.name === apexName || r.name.endsWith(suffix));
  for (const record of toDelete) {
    await cf(`/${record.id}`, { method: "DELETE" });
    console.log(`[DELETED] ${record.name} (${record.type})`);
  }
}

// GitHub Actions에서 넘겨주는 변경된 subdomains/*.json 경로 목록을 순회한다.
// 파일 하나 처리 실패해도 나머지 파일은 계속 배포하고(한 사람 신청 실수가
// 다른 사람 배포까지 막지 않게), 마지막에 하나라도 실패했으면 워크플로
// 전체를 실패 처리해서 관리자가 알아채게 한다.
async function main() {
  const changed = process.argv.slice(2);
  let failed = false;
  for (const file of changed) {
    const subdomain = subdomainNameFromPath(file);
    try {
      if (!existsSync(file)) {
        await deleteSubdomain(subdomain);
        continue;
      }
      const data = loadJson(file);
      await syncSubdomain(subdomain, data);
    } catch (e) {
      failed = true;
      console.error(`[ERROR] ${file}: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
