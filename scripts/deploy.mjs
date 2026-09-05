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

async function cfRaw(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Cloudflare API error: ${JSON.stringify(json.errors)}`);
  }
  return json;
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

async function upsertRecord(subdomain, record) {
  const name = fqdn(subdomain, record.name);
  const existing = await cf(`?type=${record.type}&name=${encodeURIComponent(name)}`);

  const body = {
    type: record.type,
    name,
    content: record.content,
    ttl: record.ttl ?? 1,
    proxied: record.type !== "TXT" ? Boolean(record.proxied) : false,
  };

  if (existing.length > 0) {
    await cf(`/${existing[0].id}`, { method: "PUT", body: JSON.stringify(body) });
    console.log(`[UPDATED] ${name} (${record.type})`);
  } else {
    await cf("", { method: "POST", body: JSON.stringify(body) });
    console.log(`[CREATED] ${name} (${record.type})`);
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
  for (const file of changed) {
    const subdomain = subdomainNameFromPath(file);
    if (!existsSync(file)) {
      await deleteSubdomain(subdomain);
      continue;
    }
    const data = loadJson(file);
    data.proxied = data.proxied ?? false;
    for (const record of data.records) {
      record.proxied = record.proxied ?? data.proxied;
      await upsertRecord(subdomain, record);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
