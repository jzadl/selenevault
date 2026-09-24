function headers(supabaseKey) {
  return {
    apikey: supabaseKey,
    Authorization: "Bearer " + supabaseKey,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

export async function upsertPending(supabaseUrl, supabaseKey, row) {
  const res = await fetch(supabaseUrl + "/rest/v1/pending_ops", {
    method: "POST",
    headers: headers(supabaseKey),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Supabase upsert " + res.status + ": " + body.slice(0, 300));
  }
  return res.json();
}

export async function getPending(supabaseUrl, supabaseKey, chatId, userId, opType) {
  const params = new URLSearchParams({
    chat_id: "eq." + chatId,
    user_id: "eq." + userId,
    op_type: "eq." + opType,
    expires_at: "gt." + new Date().toISOString(),
    order: "created_at.desc",
    limit: "1",
  });
  const res = await fetch(supabaseUrl + "/rest/v1/pending_ops?" + params, {
    headers: headers(supabaseKey),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Supabase get " + res.status + ": " + body.slice(0, 300));
  }
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

export async function deletePending(supabaseUrl, supabaseKey, id) {
  const res = await fetch(supabaseUrl + "/rest/v1/pending_ops?id=eq." + id, {
    method: "DELETE",
    headers: headers(supabaseKey),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Supabase delete " + res.status + ": " + body.slice(0, 300));
  }
}

export async function deletePendingByUser(supabaseUrl, supabaseKey, chatId, userId, opType) {
  const params = new URLSearchParams({
    chat_id: "eq." + chatId,
    user_id: "eq." + userId,
    op_type: "eq." + opType,
  });
  const res = await fetch(supabaseUrl + "/rest/v1/pending_ops?" + params, {
    method: "DELETE",
    headers: headers(supabaseKey),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Supabase deleteByUser " + res.status + ": " + body.slice(0, 300));
  }
}

const PENDING_TTL_SECONDS = 60 * 30;

export function expiresAt() {
  return new Date(Date.now() + PENDING_TTL_SECONDS * 1000).toISOString();
}
