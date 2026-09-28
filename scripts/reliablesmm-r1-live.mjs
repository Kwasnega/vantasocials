import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, "");
}
if (!env.RELIABLESMM_API_KEY) throw new Error("RELIABLESMM_API_KEY is missing.");

async function call(action) {
  const response = await fetch("https://reliablesmm.com/api/v2", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ key: env.RELIABLESMM_API_KEY, action }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error) throw new Error(`${action} request failed.`);
  return body;
}

const balance = await call("balance");
const serviceResponse = await call("services");
const services = Array.isArray(serviceResponse) ? serviceResponse : serviceResponse.services || [];
const vanta = [
  ["instagram-followers", "instagram", "followers"], ["instagram-likes", "instagram", "likes"], ["instagram-views", "instagram", "views"], ["instagram-comments", "instagram", "comments"], ["instagram-saves", "instagram", "saves"],
  ["tiktok-followers", "tiktok", "followers"], ["tiktok-likes", "tiktok", "likes"], ["tiktok-views", "tiktok", "views"], ["tiktok-shares", "tiktok", "shares"], ["tiktok-comments", "tiktok", "comments"],
  ["youtube-subscribers", "youtube", "subscribers"], ["youtube-views", "youtube", "views"], ["youtube-likes", "youtube", "likes"], ["youtube-comments", "youtube", "comments"],
  ["facebook-page-followers", "facebook", "followers"], ["facebook-page-likes", "facebook", "likes"], ["facebook-post-likes", "facebook", "likes"], ["facebook-reactions", "facebook", "reactions"], ["facebook-video-views", "facebook", "views"],
  ["x-followers", "twitter", "followers"], ["x-likes", "twitter", "likes"], ["x-reposts", "twitter", "reposts"], ["x-post-views", "twitter", "views"], ["telegram-channel-members", "telegram", "members"], ["telegram-post-views", "telegram", "views"], ["telegram-reactions", "telegram", "reactions"],
];
const aliases = { instagram: ["instagram"], tiktok: ["tiktok"], youtube: ["youtube"], facebook: ["facebook"], twitter: ["twitter"], telegram: ["telegram"] };
const normalized = services.map((service) => ({ id: String(service.service), name: String(service.name || ""), type: String(service.type || ""), category: String(service.category || ""), rate: String(service.rate), min: Number(service.min), max: Number(service.max), refill: service.refill, cancel: service.cancel, metadata: service }));
const report = { balance: { balance: String(balance.balance), currency: String(balance.currency) }, count: normalized.length, categories: [...new Set(normalized.map((service) => service.category))].sort(), types: [...new Set(normalized.map((service) => service.type))].sort(), candidates: {} };
for (const [slug, platform, term] of vanta) {
  const candidates = normalized.filter((service) => aliases[platform].some((alias) => `${service.name} ${service.category}`.toLowerCase().includes(alias)) && `${service.name} ${service.category}`.toLowerCase().includes(term));
  report.candidates[slug] = candidates.slice(0, 30);
}
fs.writeFileSync("scripts/reliablesmm-r1-live.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ balance: report.balance, count: report.count, categoryCount: report.categories.length, types: report.types, candidateCounts: Object.fromEntries(Object.entries(report.candidates).map(([key, value]) => [key, value.length])) }));
