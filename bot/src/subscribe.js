// Category subscriptions for new-build announcements.

import { getPool } from "./db.js";

export async function subAdd(chatId, category) {
  await getPool().query(
    `INSERT INTO subscriptions (chat_id, category) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [chatId, category]
  );
}

export async function subRemove(chatId, category) {
  if (category) {
    await getPool().query(`DELETE FROM subscriptions WHERE chat_id = $1 AND category = $2`, [chatId, category]);
  } else {
    await getPool().query(`DELETE FROM subscriptions WHERE chat_id = $1`, [chatId]);
  }
}

export async function subList(chatId) {
  const res = await getPool().query(
    `SELECT category FROM subscriptions WHERE chat_id = $1 ORDER BY category`,
    [chatId]
  );
  return res.rows.map((r) => r.category);
}

export async function subChats(category) {
  const res = await getPool().query(
    `SELECT chat_id FROM subscriptions WHERE category = $1`,
    [category]
  );
  return res.rows.map((r) => String(r.chat_id));
}
