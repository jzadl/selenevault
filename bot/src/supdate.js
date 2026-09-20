import { CATEGORY_FILES, CATEGORY_FIELDS } from "./categories.js";
import { escapeMd } from "./telegram.js";
import { getFileContent } from "./github.js";

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function entryPreview(entry) {
  const name = entry.name || "Unknown";
  const version = entry.version ? " (" + entry.version + ")" : "";
  const maintainer = entry.maintainer ? " by " + entry.maintainer : "";
  const date = entry.date ? " " + entry.date : "";
  return name + version + maintainer + date;
}

export function findEntries(content, nameQuery) {
  const blocks = content.split(/\n\n+/);
  const q = nameQuery.trim().toLowerCase();
  const matches = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    if (nameMatch && nameMatch[1].trim().toLowerCase().includes(q)) {
      matches.push(block.trim());
    }
  }
  return matches;
}

export async function findEntriesByFile(env, file, nameQuery) {
  try {
    const { content } = await getFileContent(env, file);
    return findEntries(content, nameQuery);
  } catch {
    return [];
  }
}

export function buildMatchList(matches) {
  const lines = ["Found multiple entries, reply with the number:", ""];
  for (let i = 0; i < matches.length; i++) {
    const block = matches[i];
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const maintMatch = block.match(/^maintainer:\s*(.+)$/m);
    const versionMatch = block.match(/^version:\s*(.+)$/m);
    const dateMatch = block.match(/^date:\s*(.+)$/m);
    const name = escapeMd(nameMatch ? nameMatch[1].trim() : "Unknown");
    const maint = escapeMd(maintMatch ? maintMatch[1].trim() : "Unknown");
    const version = versionMatch ? " \\(" + escapeMd(versionMatch[1].trim()) + "\\)" : "";
    const date = dateMatch ? " " + escapeMd(dateMatch[1].trim()) : "";
    lines.push((i + 1) + "\\. " + name + version + " by " + maint + date);
  }
  lines.push("", "Or reply *cancel*\\.");
  return lines.join("\n");
}

export function getFieldButtons(category) {
  const fields = CATEGORY_FIELDS[category] || CATEGORY_FIELDS.rom;
  const buttons = [];
  const row = [];
  for (const field of fields) {
    row.push({ text: field, callback_data: "supdate_field:" + field });
    if (row.length === 4) {
      buttons.push(row);
      row.length = 0;
    }
  }
  if (row.length > 0) buttons.push(row);
  return { inline_keyboard: buttons };
}

export function parseEntryFields(block) {
  const fields = {};
  const lines = block.split("\n");
  for (const line of lines) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) {
      fields[kv[1].toLowerCase()] = kv[2].trim();
    }
  }
  return fields;
}

export function buildDiff(oldFields, field, newValue) {
  const oldValue = oldFields[field] || "(empty)";
  const label = field === "url" ? "download link" : field;
  return [
    "Confirm this change?",
    "",
    "\ud83d\udd34 \u2014 " + escapeMd(label) + ": " + escapeMd(oldValue),
    "\ud83d\udfe2 \u202b " + escapeMd(label) + ": " + escapeMd(newValue),
    "",
    "Reply *yes* to confirm or *no* to cancel.",
  ].join("\n");
}

export function buildUpdatePreview(fields) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value) lines.push(key + ": " + value);
  }
  return lines.join("\n");
}

export function parseFileFromArgs(arg) {
  if (!arg) return { file: null, category: null, query: null };
  const parts = arg.trim().split(/\s+/);
  const first = parts[0].toLowerCase();
  if (CATEGORY_FILES[first]) {
    return { file: CATEGORY_FILES[first], category: first, query: parts.slice(1).join(" ") };
  }
  const reversed = Object.entries(CATEGORY_FILES).find(([, f]) => f === first);
  if (reversed) {
    return { file: first, category: reversed[0], query: parts.slice(1).join(" ") };
  }
  return { file: null, category: null, query: arg.trim() };
}
