export function escapeMd(text) {
  return (text || "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c);
}

export async function sendMessage(token, chatId, text, options = {}) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || "MarkdownV2",
    disable_web_page_preview: options.disablePreview !== false,
  };
  if (options.replyToMessageId) {
    body.reply_parameters = { message_id: options.replyToMessageId };
  }
  if (options.replyMarkup) {
    body.reply_markup = options.replyMarkup;
  }
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function answerCallbackQuery(token, callbackQueryId, text) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || undefined }),
  });
  return res.json();
}

export async function editMessageText(token, chatId, messageId, text, options = {}) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: options.parseMode || "MarkdownV2",
  };
  if (options.replyMarkup !== undefined) {
    body.reply_markup = options.replyMarkup;
  }
  const res = await fetch("https://api.telegram.org/bot" + token + "/editMessageText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getChatMember(token, chatId, userId) {
  const res = await fetch(
    "https://api.telegram.org/bot" + token + "/getChatMember?chat_id=" + encodeURIComponent(chatId) + "&user_id=" + userId
  );
  return res.json();
}

export async function isGroupAdmin(token, chatId, userId) {
  const result = await getChatMember(token, chatId, userId);
  if (!result.ok) return false;
  const status = result.result.status;
  return status === "administrator" || status === "creator";
}

export async function isBotAdmin(token, chatId, userId, ownerId) {
  if (String(userId) === String(ownerId)) return true;
  return isGroupAdmin(token, chatId, userId);
}

export async function setMessageReaction(token, chatId, messageId, emoji) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/setMessageReaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    }),
  });
  return res.json();
}

export function replyToMessage(update) {
  const msg = update.message;
  if (!msg) return null;
  return {
    chatId: msg.chat.id,
    text: msg.text || "",
    from: msg.from,
    replyTo: msg.reply_to_message || null,
  };
}
