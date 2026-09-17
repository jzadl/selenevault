import { parseSman, CATEGORY_FILES, CATEGORY_LABELS } from "./sman.js";
import { escapeMd } from "./telegram.js";

async function fetchSman(cdnBase, filename) {
  const res = await fetch(`${cdnBase}/${filename}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) return { about: "", entries: [] };
  return parseSman(await res.text());
}

function entryLink(siteUrl, category, entry) {
  if (category === "channel" && entry.url) return entry.url;
  const q = encodeURIComponent(entry.name);
  return `${siteUrl}/?q=${q}`;
}

function formatEntry(siteUrl, category, entry) {
  const rawName = entry.name || "";
  const name = escapeMd(rawName);
  const labelText = CATEGORY_LABELS[category] || category;
  const nameHasLabel = rawName.toLowerCase().includes(`(${labelText.toLowerCase()})`);
  const label = nameHasLabel ? "" : ` \\- ${escapeMd(labelText)}`;
  const version = entry.version ? ` \`${escapeMd(entry.version)}\`` : "";
  const maintainer = entry.maintainer ? ` by ${escapeMd(entry.maintainer)}` : "";
  const date = entry.date ? ` \\(${escapeMd(entry.date)}\\)` : "";
  const link = entryLink(siteUrl, category, entry);
  const linkLabel = category === "channel" ? "Open channel" : "View on svault";
  return `*${name}*${version}${label}${maintainer}${date}\n[${linkLabel}](${link})`;
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
  const categories = arg && CATEGORY_FILES[arg] ? [arg] : Object.keys(CATEGORY_FILES);

  const dates = await Promise.all(
    categories.map((cat) =>
      fetchLastCommitDate(env.GITHUB_API_BASE, CATEGORY_FILES[cat]).then((date) => ({ cat, date }))
    )
  );

  let newestFileDate = null;
  let newestCategory = null;
  for (const { cat, date } of dates) {
    if (!date) continue;
    if (!newestFileDate || date > newestFileDate) {
      newestFileDate = date;
      newestCategory = cat;
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

  const categoryEntries = Object.entries(CATEGORY_FILES).filter(([cat]) => cat !== "channel");
  const counts = await Promise.all(
    categoryEntries.map(([cat, file]) => fetchSman(env.CDN_BASE, file).then((r) => ({ cat, count: r.entries.length })))
  );

  const lines = ["*svault stats:*", ""];
  let total = 0;
  for (const { cat, count } of counts) {
    total += count;
    const label = escapeMd(CATEGORY_LABELS[cat]);
    lines.push(`${label}s: ${count}`);
  }
  lines.push("", `Total: ${total}`);
  return lines.join("\n");
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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
  const direct = [];
  const other = [];
  const q = query.toLowerCase();
  const qNorm = normalize(query);

  const results = await Promise.all(
    categories.map((cat) => fetchSman(env.CDN_BASE, CATEGORY_FILES[cat]).then((r) => ({ cat, entries: r.entries })))
  );

  for (const { cat, entries } of results) {
    for (const entry of entries) {
      const name = (entry.name || "").toLowerCase();
      const nameNorm = normalize(entry.name);
      if (name.includes(q) || nameNorm.includes(qNorm)) {
        direct.push({ category: cat, entry });
        continue;
      }
      const note = (entry.note || "").toLowerCase();
      const version = (entry.version || "").toLowerCase();
      if (note.includes(q) || version.includes(q)) {
        other.push({ category: cat, entry });
      }
    }
  }

  if (direct.length === 0 && other.length === 0) {
    return `No results for *${escapeMd(query)}*\\.`;
  }

  const lines = [`*Results for* \`${escapeMd(query)}\`:`];

  if (direct.length > 0) {
    lines.push("", "*\\[ RESULTS \\]*", "");
    for (const { category: cat, entry } of direct) {
      lines.push(formatEntry(env.SITE_URL, cat, entry));
      lines.push("");
    }
  }

  if (other.length > 0) {
    lines.push("*\\[ OTHER RESULTS \\]*", "");
    for (const { category: cat, entry } of other) {
      lines.push(formatEntry(env.SITE_URL, cat, entry));
      lines.push("");
    }
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
