// Local Postgres replacement for supabase.js (same table: pending_ops).
// Signatures are intentionally identical to the old Supabase helpers so that
// index.js call sites stay untouched; the first two args are ignored.
// Uses DATABASE_URL from process env (loaded from bot/.env by server.js).
//
// Data convention (preserved from Supabase days):
//   - most ops store JSON.stringify(obj) -> returned as string for JSON.parse
//   - "__last_entry" cache stores raw post text -> returned as-is

import pg from "pg";

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set (bot/.env)");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on("error", (err) => console.error("pg pool error:", err.message));
  }
  return pool;
}

// Normalize outgoing data: callers expect pending.data to be a string
// (JSON.parse(pending.data) for flows, raw text for __last_entry cache).
function dataToString(data) {
  if (data === null || data === undefined) return "{}";
  if (typeof data === "string") return data;
  return JSON.stringify(data);
}

// Normalize incoming data for a JSONB column: raw non-JSON strings are
// wrapped as JSON strings so the INSERT never fails (old REST code just
// swallowed that error and the cache silently never worked).
function dataToJsonb(data) {
  if (data === null || data === undefined) return {};
  if (typeof data === "object") return data;
  try {
    JSON.parse(data);
    return data;
  } catch {
    return JSON.stringify(data); // wrap raw text as a JSON string value
  }
}

function rowToPending(row) {
  if (!row) return null;
  return { ...row, data: dataToString(row.data) };
}

export async function upsertPending(_url, _key, row) {
  const cols = ["chat_id", "user_id", "op_type", "file", "data", "expires_at"];
  const vals = [row.chat_id, row.user_id, row.op_type, row.file, dataToJsonb(row.data), row.expires_at];
  if (row.message_id !== undefined && row.message_id !== null) {
    cols.push("message_id");
    vals.push(row.message_id);
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO pending_ops (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
  const res = await getPool().query(sql, vals);
  return rowToPending(res.rows[0]);
}

export async function getPending(_url, _key, chatId, userId, opType) {
  const res = await getPool().query(
    `SELECT * FROM pending_ops
     WHERE chat_id = $1 AND user_id = $2 AND op_type = $3 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [chatId, userId, opType]
  );
  return res.rows.length > 0 ? rowToPending(res.rows[0]) : null;
}

export async function deletePending(_url, _key, id) {
  await getPool().query(`DELETE FROM pending_ops WHERE id = $1`, [id]);
}

export async function deletePendingByUser(_url, _key, chatId, userId, opType) {
  await getPool().query(
    `DELETE FROM pending_ops WHERE chat_id = $1 AND user_id = $2 AND op_type = $3`,
    [chatId, userId, opType]
  );
}

export async function getPendingById(_url, _key, id) {
  const res = await getPool().query(`SELECT * FROM pending_ops WHERE id = $1`, [id]);
  return res.rows.length > 0 ? rowToPending(res.rows[0]) : null;
}

// Live linkcheck reports awaiting action, oldest first.
export async function listLinkcheck(_url, _key) {
  const res = await getPool().query(
    `SELECT * FROM pending_ops WHERE op_type = 'linkcheck' AND expires_at > NOW() ORDER BY created_at`
  );
  return res.rows.map(rowToPending);
}

// URLs with an unexpired linkcheck report (already notified, awaiting action).
export async function pendingLinkUrls(_url, _key) {
  const res = await getPool().query(
    `SELECT data ->> 'url' AS url FROM pending_ops
     WHERE op_type = 'linkcheck' AND expires_at > NOW()`
  );
  return new Set(res.rows.map((r) => r.url).filter(Boolean));
}

// True while a "keep" verdict for this URL is still fresh (link checker).
export async function hasLinkKeep(_url, _key, url) {
  const res = await getPool().query(
    `SELECT 1 FROM pending_ops
     WHERE op_type = 'linkkeep' AND data ->> 'url' = $1 AND expires_at > NOW()
     LIMIT 1`,
    [url]
  );
  return res.rows.length > 0;
}

const PENDING_TTL_SECONDS = 60 * 30;

export function expiresAt() {
  return new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString();
}

// Known chats: every group/channel the bot has seen, for /smessage -all.
export async function rememberChat(chatId, chatType, title) {
  await getPool().query(
    `INSERT INTO known_chats (chat_id, chat_type, title) VALUES ($1, $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET chat_type = EXCLUDED.chat_type, title = EXCLUDED.title, last_seen = NOW()`,
    [String(chatId), chatType || "group", title || null]
  );
}

export async function knownChatIds() {
  const res = await getPool().query(
    `SELECT chat_id FROM known_chats WHERE chat_type <> 'private' ORDER BY last_seen`
  );
  return res.rows.map((r) => r.chat_id);
}
