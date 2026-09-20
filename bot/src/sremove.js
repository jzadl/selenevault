import { CATEGORY_FILES } from "./categories.js";
import { escapeMd } from "./telegram.js";

const REMOVE_EMOJIS = ["\ud83d\udd25", "\u26a1", "\ud83d\udc8e", "\ud83c\udfaf", "\u2705", "\ud83d\ude80", "\ud83d\udc80", "\ud83d\uddd1\ufe0f", "\u26a0\ufe0f", "\ud83d\udd27"];

export function generateRandomEmoji() {
  return REMOVE_EMOJIS[Math.floor(Math.random() * REMOVE_EMOJIS.length)];
}

export function findEntryByCreator(content, nameQuery, creatorQuery) {
  const blocks = content.split(/\n\n+/);
  const nameQ = nameQuery.trim().toLowerCase();
  const creatorQ = creatorQuery.trim().toLowerCase();
  for (const block of blocks) {
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const maintMatch = block.match(/^maintainer:\s*(.+)$/m);
    if (nameMatch && maintMatch) {
      const name = nameMatch[1].trim().toLowerCase();
      const maint = maintMatch[1].trim().toLowerCase();
      if (name.includes(nameQ) && maint.includes(creatorQ)) {
        return block.trim();
      }
    }
  }
  return null;
}

export function findEntriesByNameAndCreator(content, nameQuery, creatorQuery) {
  const blocks = content.split(/\n\n+/);
  const nameQ = nameQuery.trim().toLowerCase();
  const creatorQ = creatorQuery.trim().toLowerCase();
  const matches = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const maintMatch = block.match(/^maintainer:\s*(.+)$/m);
    if (nameMatch && maintMatch) {
      const name = nameMatch[1].trim().toLowerCase();
      const maint = maintMatch[1].trim().toLowerCase();
      if (name.includes(nameQ) && (creatorQ === "" || maint.includes(creatorQ))) {
        matches.push(block.trim());
      }
    }
  }
  return matches;
}

export function buildRemovePreview(block) {
  const fields = {};
  const lines = block.split("\n");
  for (const line of lines) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) fields[kv[1].toLowerCase()] = kv[2].trim();
  }
  const parts = ["Are you sure you want to remove this entry?", ""];
  parts.push("Entry: " + escapeMd(fields.name || "Unknown") + (fields.version ? " \\(" + escapeMd(fields.version) + "\\)" : ""));
  if (fields.maintainer) parts.push("By: " + escapeMd(fields.maintainer));
  if (fields.date) parts.push("Date: " + escapeMd(fields.date));
  if (fields.url) parts.push("URL: " + escapeMd(fields.url));
  parts.push("", "Reply *yes* to proceed, or *no* to cancel.");
  return parts.join("\n");
}

export function parseRemoveArgs(arg) {
  if (!arg) return { file: null, category: null, name: null, creator: null };
  const parts = arg.trim().split(/\s+/);
  let fileKey = null;
  let category = null;
  let startIdx = 0;
  if (CATEGORY_FILES[parts[0].toLowerCase()]) {
    fileKey = CATEGORY_FILES[parts[0].toLowerCase()];
    category = parts[0].toLowerCase();
    startIdx = 1;
  } else {
    const reversed = Object.entries(CATEGORY_FILES).find(([, f]) => f === parts[0].toLowerCase());
    if (reversed) {
      fileKey = parts[0].toLowerCase();
      category = reversed[0];
      startIdx = 1;
    }
  }
  let name = null;
  let creator = null;
  const remaining = parts.slice(startIdx);
  if (remaining.length >= 2) {
    const lastTwo = remaining.slice(-2);
    creator = lastTwo[1];
    name = lastTwo.slice(0, -1).join(" ");
    if (remaining.length > 2) {
      name = remaining.slice(0, -2).join(" ");
    }
  } else if (remaining.length === 1) {
    name = remaining[0];
  }
  return {
    file: fileKey,
    category: category,
    name: name,
    creator: creator,
  };
}
