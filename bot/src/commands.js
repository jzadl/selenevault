import { parseSman } from "./sman.js";
import { CATEGORY_FILES, CATEGORY_FIELDS, CATEGORY_LABELS, CATEGORY_PLURALS } from "./categories.js";
import { escapeMd } from "./telegram.js";
import { getFileContent, getRecentAdds } from "./github.js";
import { parseSearchArgs, matchesFilters, filtersSummary, fuzzyNameHit } from "./entrymeta.js";
import { publishTelegraphPage } from "./telegraph.js";

async function fetchRawViaGithub(env, filename) {
  try {
    const { content } = await getFileContent(env, filename);
    return content;
  } catch {
    return null;
  }
}

async function fetchSman(env, filename) {
  const text = await fetchRawViaGithub(env, filename);
  if (text === null) return { about: "", entries: [] };
  return parseSman(text);
}

export async function fetchRawSman(env, filename) {
  return fetchRawViaGithub(env, filename);
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

const ADD_SUBJECT_RE = /^ADD:\s*(.+?)\s+by\s+(.+?)\s+to\s+(\S+\.sman)\s*$/i;

export async function cmdLatest(env, arg) {
  const wantFile = arg && CATEGORY_FILES[arg] ? CATEGORY_FILES[arg] : null;

  // Which entry was actually added last, from commit subjects (local git log)
  const subjects = await getRecentAdds(env, 100);
  if (subjects.length === 0) return "No entries found\\.";

  const then = { latest: null };
  const files = {};
  // ponytail: 100-commit window
  for (const subject of subjects) {
    const mm = subject.split("\n")[0].match(ADD_SUBJECT_RE);
    if (!mm || (wantFile && mm[3] !== wantFile)) continue;

    const name = mm[1].toString().toLowerCase();
    const creator = mm[2].toString().toLowerCase();
    if (!files[mm[3]]) files[mm[3]] = await fetchSman(env, mm[3]).then((r) => r.entries).catch(() => []);
    const entry = files[mm[3]].find(
      (e) =>
        (e.name || "").toLowerCase().includes(name) &&
        (e.maintainer || "").toLowerCase().includes(creator)
    );
    if (entry) {
      then.latest = { file: mm[3], entry };
      break;
    }
  }

  if (!then.latest) return "No entries found\\.";

  const category = Object.entries(CATEGORY_FILES).find(([, v]) => v === then.latest.file)?.[0] || "rom";
  return `*Latest addition:*\n\n${formatEntry(env.SITE_URL, category, then.latest.entry)}`;
}

export async function statsData(env, arg) {
  const { category, filters } = parseSearchArgs(arg || "", CATEGORY_FILES);
  const filterText = filtersSummary(filters);

  if (category && !filterText) {
    const { entries } = await fetchSman(env, CATEGORY_FILES[category]);
    return {
      single: { label: CATEGORY_PLURALS[category] || CATEGORY_LABELS[category], count: entries.length },
    };
  }

  const cats = category ? [category] : Object.keys(CATEGORY_FILES).filter((c) => c !== "channel");
  const counts = await Promise.all(
    cats.map((cat) => fetchSman(env, CATEGORY_FILES[cat]).then((r) => ({
      cat,
      count: filterText ? r.entries.filter((e) => matchesFilters(e, filters)).length : r.entries.length,
    })))
  );

  return {
    filterText,
    rows: counts.map(({ cat, count }) => ({
      label: CATEGORY_PLURALS[cat] || CATEGORY_LABELS[cat],
      count,
    })),
  };
}

export async function cmdStats(env, arg) {
  const data = await statsData(env, arg);
  if (data.single) {
    return `*${escapeMd(data.single.label)} on svault:* ${data.single.count}`;
  }

  const lines = [data.filterText ? `*svault stats \\(${escapeMd(data.filterText)}\\):*` : "*svault stats:*", ""];
  let total = 0;
  for (const { label, count } of data.rows) {
    total += count;
    lines.push(`${escapeMd(label)}: ${count}`);
  }
  lines.push("", `Total: ${total}`);
  return lines.join("\n");
}

export async function cmdStatsRich(env, arg) {
  const data = await statsData(env, arg);

  if (data.single) {
    return {
      blocks: [
        { type: "heading", size: 2, text: data.single.label + " on svault" },
        {
          type: "table",
          is_bordered: true,
          is_compact: true,
          cells: [
            [{ text: "Category", is_header: true }, { text: "Entries", is_header: true, align: "center" }],
            [{ text: data.single.label }, { text: String(data.single.count), align: "center" }],
          ],
        },
      ],
    };
  }

  const title = data.filterText ? `svault stats (${data.filterText})` : "svault stats";
  const total = data.rows.reduce((sum, r) => sum + r.count, 0);
  return {
    blocks: [
      { type: "heading", size: 2, text: title },
      {
        type: "table",
        is_bordered: true,
        is_compact: true,
        is_striped: true,
        cells: [
          [{ text: "Category", is_header: true }, { text: "Entries", is_header: true, align: "center" }],
          ...data.rows.map(({ label, count }) => [{ text: label }, { text: String(count), align: "center" }]),
          [{ text: "Total", is_header: true }, { text: String(total), align: "center", is_header: true }],
        ],
      },
    ],
  };
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dedupeLetters(s) {
  return (s || "").replace(/([a-z])\1+/g, "$1");
}

function plainEntry(siteUrl, category, entry) {
  const rawName = entry.name || "";
  const labelText = CATEGORY_LABELS[category] || category;
  const nameHasLabel = rawName.toLowerCase().includes(`(${labelText.toLowerCase()})`);
  const label = nameHasLabel ? "" : ` - ${labelText}`;
  const version = entry.version ? ` ${entry.version}` : "";
  const maintainer = entry.maintainer ? ` by ${entry.maintainer}` : "";
  const date = entry.date ? ` (${entry.date})` : "";
  const link = entryLink(siteUrl, category, entry);
  return `${rawName}${version}${label}${maintainer}${date}\n${link}`;
}

const TELEGRAPH_THRESHOLD = 8;

export async function cmdSearch(env, arg) {
  if (!arg) return "Usage: /ssearch \\[category\\] \\[by:name\\] \\[vendor:x\\] \\[date:2026\\] \\[android:14\\] \\[gapps:gapps\\] query";

  const { category, filters, query } = parseSearchArgs(arg, CATEGORY_FILES);

  if (!query && Object.keys(filters).length === 0) return "Give me something to search for\\.";

  const categories = category ? [category] : Object.keys(CATEGORY_FILES).filter((c) => c !== "channel");
  const direct = [];
  const other = [];
  const q = query.toLowerCase();
  const qNorm = normalize(query);
  const filterText = filtersSummary(filters);
  const titleQuery = [filterText, query].filter(Boolean).join(" ");

  const results = await Promise.all(
    categories.map((cat) => fetchSman(env, CATEGORY_FILES[cat]).then((r) => ({ cat, entries: r.entries })))
  );

  for (const { cat, entries } of results) {
    for (const entry of entries) {
      if (!matchesFilters(entry, filters)) continue;
      if (!q) {
        direct.push({ category: cat, entry });
        continue;
      }
      const name = (entry.name || "").toLowerCase();
      const nameNorm = normalize(entry.name);
      if (name.includes(q) || nameNorm.includes(qNorm) || fuzzyNameHit(entry.name, query)) {
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
    return `No results for *${escapeMd(titleQuery)}*\\.`;
  }

  const total = direct.length + other.length;

  if (total > TELEGRAPH_THRESHOLD) {
    const plainLines = [];
    if (direct.length > 0) {
      plainLines.push("[ RESULTS ]", "");
      for (const { category: cat, entry } of direct) {
        plainLines.push(plainEntry(env.SITE_URL, cat, entry));
        plainLines.push("");
      }
    }
    if (other.length > 0) {
      plainLines.push("[ OTHER RESULTS ]", "");
      for (const { category: cat, entry } of other) {
        plainLines.push(plainEntry(env.SITE_URL, cat, entry));
        plainLines.push("");
      }
    }

    try {
      const url = await publishTelegraphPage(env, `svault results for "${titleQuery}"`, plainLines.join("\n"));
      return `*Results for* \`${escapeMd(titleQuery)}\`\\: ${total} matches\\.\n[View full results](${url})`;
    } catch {
      // fall through to inline results if telegraph fails
    }
  }

  const lines = [`*Results for* \`${escapeMd(titleQuery)}\:`];

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

export async function searchEntries(env, query) {
  const categories = Object.keys(CATEGORY_FILES).filter((c) => c !== "channel");
  const results = await Promise.all(
    categories.map((cat) => fetchSman(env, CATEGORY_FILES[cat]).then((r) => ({ cat, entries: r.entries })))
  );
  const q = (query || "").trim().toLowerCase();
  const qNorm = normalize(q);
  if (!q) return [];

  const direct = [];
  const other = [];
  for (const { cat, entries } of results) {
    for (const entry of entries) {
      const name = (entry.name || "").toLowerCase();
      const nameNorm = normalize(entry.name);
      if (name.includes(q) || nameNorm.includes(qNorm) || fuzzyNameHit(entry.name, query)) {
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
  return [...direct, ...other].slice(0, 50);
}

export async function buildInlineResults(env, query) {
  if (!(query || "").trim()) {
    return [{
      type: "article",
      id: "hint",
      title: "Search the vault",
      description: "Type a ROM, kernel, port, recovery, tool or guide name",
      input_message_content: {
        message_text: "*svault* \\- search any name in any chat with @selenevaultbot",
        parse_mode: "MarkdownV2",
      },
    }];
  }

  const matches = await searchEntries(env, query);
  return matches.map(({ category: cat, entry }, i) => {
    const name = (entry.name || "svault entry") + (entry.version ? " " + entry.version : "");
    const description = [CATEGORY_LABELS[cat], entry.maintainer, entry.date].filter(Boolean).join(" - ");
    return {
      type: "article",
      id: "sv" + i,
      title: name.slice(0, 64),
      description: description.slice(0, 200),
      input_message_content: {
        message_text: formatEntry(env.SITE_URL, cat, entry),
        parse_mode: "MarkdownV2",
      },
      reply_markup: {
        inline_keyboard: [[{ text: "View on svault", url: entryLink(env.SITE_URL, cat, entry) }]],
      },
    };
  });
}

export async function cmdChannels(env) {
  const { entries } = await fetchSman(env, CATEGORY_FILES.channel);
  if (entries.length === 0) return "No channels listed\\.";

  const lines = ["*Known community channels:*", ""];
  for (const entry of entries) {
    const name = escapeMd(entry.name);
    const url = entry.url || "";
    lines.push(url ? `[${name}](${url})` : name);
  }
  return lines.join("\n");
}

export function extractQueryFromText(text) {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (/^(download|note|notes|changelog|by:|original post|device:|build date:)/i.test(line)) continue;
    let candidate = line.split("|")[0].trim();
    candidate = candidate.replace(/^[•\-\*]\s*/, "");
    if (candidate.length >= 3) return candidate;
  }
  return null;
}

export async function cmdIsThisOnSv(env, replyText) {
  const query = extractQueryFromText(replyText);
  if (!query) {
    return "Couldn't figure out what to search for in that message\\.";
  }

  const categories = Object.keys(CATEGORY_FILES).filter((c) => c !== "channel");
  const q = query.toLowerCase();
  const qNorm = dedupeLetters(normalize(query));

  const results = await Promise.all(
    categories.map((cat) => fetchSman(env, CATEGORY_FILES[cat]).then((r) => ({ cat, entries: r.entries })))
  );

  const matches = [];
  for (const { cat, entries } of results) {
    for (const entry of entries) {
      const name = (entry.name || "").toLowerCase();
      const nameNorm = dedupeLetters(normalize(entry.name));
      if (name.includes(q) || qNorm.includes(nameNorm) || nameNorm.includes(qNorm) || q.includes(name)) {
        matches.push({ cat, entry });
      }
    }
  }

  const escapedQuery = escapeMd(query);

  if (matches.length === 0) {
    return `No, there's no "${escapedQuery}" on Svault\\.`;
  }

  const verb = matches.length === 1 ? "is" : "are";
  const lines = [`Yes, there ${verb} "${escapedQuery}" in Svault:`, ""];
  for (const { cat, entry } of matches) {
    lines.push(formatEntry(env.SITE_URL, cat, entry));
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function cmdPing(env, request, msg) {
  const start = Date.now();
  const res = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/getMe");
  const workerLatency = Date.now() - start;
  const colo = (request && request.cf && request.cf.colo) || process.env.HOSTNAME || "srv";

  let telegramDelayText = "";
  if (msg && msg.date) {
    const telegramDelay = Date.now() - msg.date * 1000;
    telegramDelayText = ` \\(${telegramDelay}ms delay from Telegram\\)`;
  }

  return escapeMd(`Pong! from ${colo} - ${workerLatency}ms`) + telegramDelayText;
}
