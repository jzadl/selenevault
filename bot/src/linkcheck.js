// Periodic dead-link checker for all .sman entries.
// Reports questionable URLs to every owner (OWNER_ID, comma-separated) with
// inline Keep / Delete buttons handled via callback queries in index.js.

import { parseSman } from "./sman.js";
import { CATEGORY_FILES, CATEGORY_FIELDS } from "./categories.js";
import { getFileContent, removeSmanEntry } from "./github.js";
import { sendMessage, editMessageText, escapeMd } from "./telegram.js";
import { upsertPending, deletePending, hasLinkKeep, expiresAt } from "./db.js";

const PROBE_TIMEOUT_MS = 15000;
const CONCURRENCY = 5;
const KEEP_TTL_MS = 30 * 24 * 60 * 60 * 1000; // don't re-report kept links for 30d

export function ownerIds(env) {
  return String(env.OWNER_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function escapeMdSafe(text) {
  return escapeMd(String(text || "")).slice(0, 500);
}

// Single GET, body cancelled right after headers: enough for a verdict
// without downloading (potentially huge) files.
export async function probeUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; svault-linkcheck/1.0)",
        Range: "bytes=0-0",
      },
    });
    try {
      await res.body?.cancel();
    } catch {}
    if (res.status === 404 || res.status === 410) {
      return { state: "dead", reason: "HTTP " + res.status };
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      return { state: "unknown", reason: "HTTP " + res.status };
    }
    return { state: "alive", reason: "HTTP " + res.status };
  } catch (err) {
    if (err && err.name === "AbortError") return { state: "unknown", reason: "timeout" };
    const code = (err && err.cause && err.cause.code) || (err && err.message) || "fetch error";
    return { state: "dead", reason: String(code).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// Locate the exact raw block for an entry in fresh file content (needed for
// delete; files may change between check and button press).
export function findRawBlock(content, name, url) {
  const nm = (name || "").trim().toLowerCase();
  const blocks = content.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocks) {
    const m = b.match(/^name:\s*(.+)$/m);
    if (!m || m[1].trim().toLowerCase() !== nm) continue;
    if (url && !b.includes(url)) continue;
    return b;
  }
  return null;
}

async function collectEntries(env, onlyCategory) {
  const out = [];
  for (const [cat, file] of Object.entries(CATEGORY_FILES)) {
    if (onlyCategory && cat !== onlyCategory) continue;
    let content;
    try {
      ({ content } = await getFileContent(env, file));
    } catch {
      continue;
    }
    const { entries } = parseSman(content);
    for (const entry of entries) {
      const url = (entry.url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      out.push({ file, category: cat, name: entry.name || "Unknown", url });
    }
  }
  return out;
}

async function mapPool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

async function checkOne(env, item) {
  if (await hasLinkKeep(null, null, item.url).catch(() => false)) {
    return { ...item, state: "kept", reason: "kept by admin" };
  }
  const probe = await probeUrl(item.url);
  return { ...item, ...probe };
}

function reportText(item) {
  const verdict = item.state === "dead" ? "Dead link" : "Link needs review";
  return [
    "🔗 *" + verdict + "*",
    "",
    "*" + escapeMdSafe(item.name) + "* \\(`" + escapeMd(item.file) + "`\\)",
    escapeMdSafe(item.url),
    "",
    "Reason: `" + escapeMd(item.reason) + "`",
  ].join("\n");
}

export async function runLinkCheck(env, onlyCategory) {
  const owners = ownerIds(env);
  if (owners.length === 0) throw new Error("OWNER_ID is not set");
  const items = await collectEntries(env, onlyCategory);
  const problems = [];
  await mapPool(items, CONCURRENCY, async (item) => {
    const res = await checkOne(env, item);
    if (res.state === "dead" || res.state === "unknown") problems.push(res);
  });

  for (const item of problems) {
    const row = await upsertPending(null, null, {
      chat_id: 0,
      user_id: 0,
      op_type: "linkcheck",
      file: item.file,
      data: JSON.stringify({
        file: item.file,
        name: item.name,
        url: item.url,
        reason: item.reason,
        state: item.state,
      }),
      expires_at: new Date(Date.now() + KEEP_TTL_MS).toISOString(),
    });
    const keyboard = {
      inline_keyboard: [[
        { text: "Keep", callback_data: "linkkeep:" + row.id },
        { text: "Delete", callback_data: "linkdel:" + row.id },
      ]],
    };
    for (const ownerId of owners) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, ownerId, reportText(item), {
        replyMarkup: keyboard,
      }).catch(() => {});
    }
  }
  return { checked: items.length, problems: problems.length };
}

// --- button handlers (called from index.js on callback_query) ---

export async function handleLinkCallback(env, query) {
  const { answerCallbackQuery } = await import("./telegram.js");
  const reply = (text) => answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, query.id, text).catch(() => {});
  const [action, id] = String(query.data || "").split(":");
  const { getPendingById } = await import("./db.js");
  const pending = id ? await getPendingById(null, null, id).catch(() => null) : null;
  if (!pending || pending.op_type !== "linkcheck") {
    await reply("Already handled.");
    return;
  }
  let d;
  try {
    d = JSON.parse(pending.data);
  } catch {
    await reply("Broken record, ignoring.");
    return;
  }

  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;

  if (action === "linkkeep") {
    await deletePending(null, null, pending.id).catch(() => {});
    await upsertPending(null, null, {
      chat_id: chatId || 0,
      user_id: query.from?.id || 0,
      op_type: "linkkeep",
      file: "-",
      data: JSON.stringify({ url: d.url }),
      expires_at: new Date(Date.now() + KEEP_TTL_MS).toISOString(),
    }).catch(() => {});
    if (chatId && messageId) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
        "✅ *Kept:* " + escapeMdSafe(d.name) + "\nWon't remind for 30 days\\.").catch(() => {});
    }
    await reply("Kept.");
    return;
  }

  if (action === "linkdel") {
    let content;
    try {
      ({ content } = await getFileContent(env, d.file));
    } catch (err) {
      await reply("Can't read file: " + String(err.message || err).slice(0, 100));
      return;
    }
    const block = findRawBlock(content, d.name, d.url);
    if (!block) {
      await deletePending(null, null, pending.id).catch(() => {});
      if (chatId && messageId) {
        await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
          "Entry *" + escapeMdSafe(d.name) + "* is already gone from `" + escapeMd(d.file) + "`\\.").catch(() => {});
      }
      await reply("Already gone.");
      return;
    }
    try {
      const fields = {};
      for (const line of block.split("\n")) {
        const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
        if (kv) fields[kv[1].toLowerCase()] = kv[2].trim();
      }
      await removeSmanEntry(env, d.file, block,
        "REMOVE (dead link): " + (fields.name || d.name) + " by " + (fields.maintainer || "unknown") + " from " + d.file);
    } catch (err) {
      await reply("Delete failed: " + String(err.message || err).slice(0, 100));
      return;
    }
    await deletePending(null, null, pending.id).catch(() => {});
    if (chatId && messageId) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId,
        "🗑 *Deleted:* " + escapeMdSafe(d.name) + " \\(`" + escapeMd(d.file) + "`\\)").catch(() => {});
    }
    await reply("Deleted.");
    return;
  }

  await reply("Unknown action.");
}

export { expiresAt };
