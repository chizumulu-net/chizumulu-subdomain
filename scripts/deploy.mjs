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

async function syncSubdomain(subdomain, data) {
  const groups = new Map();
  for (const record of data.records) {
    record.proxied = record.proxied ?? data.proxied ?? false;
    const key = `${record.type}|${record.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const [key, records] of groups) {
    const [type, name] = key.split("|");
    await reconcileGroup(subdomain, type, name, records);
  }
}

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
