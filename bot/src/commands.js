import { parseSman, CATEGORY_FILES, CATEGORY_LABELS } from "./sman.js";
import { escapeMd } from "./telegram.js";

async function fetchSman(cdnBase, filename) {
  const res = await fetch(`${cdnBase}/${filename}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return { about: "", entries: [] };
  return parseSman(await res.text());
}

function entryLink(siteUrl, category, entry) {
  const q = encodeURIComponent(entry.name);
  return `${siteUrl}/?q=${q}`;
}

function formatEntry(siteUrl, category, entry) {
  const name = escapeMd(entry.name);
  const label = escapeMd(CATEGORY_LABELS[category] || category);
  const version = entry.version ? ` \`${escapeMd(entry.version)}\`` : "";
  const date = entry.date ? ` \\(${escapeMd(entry.date)}\\)` : "";
  const link = entryLink(siteUrl, category, entry);
  return `*${name}*${version} \\- ${label}${date}\n[View on svault](${link})`;
}

async function fetchLastCommitDate(githubApiBase, filename) {
  const res = await fetch(
    `${githubApiBase}/commits?path=${filename}&per_page=1`,
    { headers: { "User-Agent": "svault-bot" }, cf: { cacheTtl: 60 } }
  );
  if (!res.ok) return null;
  const commits = await res.json();
  if (!commits.length) return null;
  return commits[0].commit.committer.date;
}

export async function cmdLatest(env, arg) {
  const categories = arg && CATEGORY_FILES[arg] ? [arg] : Object.keys(CATEGORY_FILES).filter((c) => c !== "channel");

  let newestFileDate = null;
  let newestCategory = null;

  for (const category of categories) {
    const commitDate = await fetchLastCommitDate(env.GITHUB_API_BASE, CATEGORY_FILES[category]);
    if (!commitDate) continue;
    if (!newestFileDate || commitDate > newestFileDate) {
      newestFileDate = commitDate;
      newestCategory = category;
    }
  }

  if (!newestCategory) return "No entries found\\.";

  const { entries } = await fetchSman(env.CDN_BASE, CATEGORY_FILES[newestCategory]);
  if (!entries.length) return "No entries found\\.";

  const last = entries[entries.length - 1];
  return `*Latest addition:*\n\n${formatEntry(env.SITE_URL, newestCategory, last)}`;
}

export async function cmdStats(env, arg) {
  if (arg && CATEGORY_FILES[arg]) {
    const { entries } = await fetchSman(env.CDN_BASE, CATEGORY_FILES[arg]);
    const label = escapeMd(CATEGORY_LABELS[arg]);
    return `*${label}s on svault:* ${entries.length}`;
  }

  const lines = ["*svault stats:*", ""];
  let total = 0;
  for (const [category, file] of Object.entries(CATEGORY_FILES)) {
    if (category === "channel") continue;
    const { entries } = await fetchSman(env.CDN_BASE, file);
    total += entries.length;
    const label = escapeMd(CATEGORY_LABELS[category]);
    lines.push(`${label}s: ${entries.length}`);
  }
  lines.push("", `Total: ${total}`);
  return lines.join("\n");
}

export async function cmdSearch(env, arg) {
  if (!arg) return "Usage: /search \\[category\\] query";

  const parts = arg.trim().split(/\s+/);
  let category = null;
  let query = arg.trim();

  if (CATEGORY_FILES[parts[0].toLowerCase()]) {
    category = parts[0].toLowerCase();
    query = parts.slice(1).join(" ");
  }

  if (!query) return "Give me something to search for\\.";

  const categories = category ? [category] : Object.keys(CATEGORY_FILES).filter((c) => c !== "channel");
  const results = [];
  const q = query.toLowerCase();

  for (const cat of categories) {
    const { entries } = await fetchSman(env.CDN_BASE, CATEGORY_FILES[cat]);
    for (const entry of entries) {
      if (entry.name && entry.name.toLowerCase().includes(q)) {
        results.push({ category: cat, entry });
      }
    }
    if (results.length >= 5) break;
  }

  if (results.length === 0) return `No results for *${escapeMd(query)}*\\.`;

  const lines = [`*Results for* \`${escapeMd(query)}\`:`, ""];
  for (const { category: cat, entry } of results.slice(0, 5)) {
    lines.push(formatEntry(env.SITE_URL, cat, entry));
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function cmdChannels(env) {
  const { entries } = await fetchSman(env.CDN_BASE, CATEGORY_FILES.channel);
  if (entries.length === 0) return "No channels listed\\.";

  const lines = ["*Known community channels:*", ""];
  for (const entry of entries) {
    const name = escapeMd(entry.name);
    const url = entry.url || "";
    lines.push(url ? `[${name}](${url})` : name);
  }
  return lines.join("\n");
}
