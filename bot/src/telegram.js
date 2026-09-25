export function escapeMd(text) {
  return (text || "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c);
}

export async function sendMessage(token, chatId, text, options = {}) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disablePreview !== false,
  };
  if (options.parseMode !== null) {
    body.parse_mode = options.parseMode || "MarkdownV2";
  }
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

export async function sendEphemeral(token, chatId, userId, text, options = {}) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disablePreview !== false,
  };
  if (options.parseMode !== null) {
    body.parse_mode = options.parseMode || "MarkdownV2";
  }
  if (options.replyToMessageId) {
    body.reply_parameters = { message_id: options.replyToMessageId };
  }
  if (options.replyMarkup !== undefined) {
    body.reply_markup = options.replyMarkup;
  }
  body.ephemeral_message_parameters = { receiver_user_id: userId };
  let res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = await res.json();
  if (!json.ok) {
    delete body.ephemeral_message_parameters;
    body.receiver_user_id = userId;
    res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    json = await res.json();
  }
  if (!json.ok && options.fallback) {
    delete body.receiver_user_id;
    res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }
  return json;
}

export async function deleteEphemeralMessage(token, chatId, userId, ephemeralMessageId) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/deleteEphemeralMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      receiver_user_id: userId,
      ephemeral_message_id: ephemeralMessageId,
    }),
  });
  return res.json();
}

export async function sendChatAction(token, chatId, action) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendChatAction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: action || "typing" }),
  });
  return res.json();
}

export async function sendRichMessage(token, chatId, richMessage, options = {}) {
  const body = { chat_id: chatId, rich_message: richMessage };
  if (options.replyToMessageId) {
    body.reply_parameters = { message_id: options.replyToMessageId };
  }
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendRichMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function sendMessageDraft(token, chatId, draftId, text) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessageDraft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, draft_id: draftId, text }),
  });
  return res.json();
}

export async function editEphemeralMessageText(token, chatId, userId, ephemeralMessageId, text, options = {}) {
  const body = {
    chat_id: chatId,
    receiver_user_id: userId,
    ephemeral_message_id: ephemeralMessageId,
    text,
  };
  if (options.parseMode !== null) {
    body.parse_mode = options.parseMode || "MarkdownV2";
  }
  const res = await fetch("https://api.telegram.org/bot" + token + "/editEphemeralMessageText", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function setMyCommands(token, commands, scope) {
  const body = { commands };
  if (scope) body.scope = scope;
  const res = await fetch("https://api.telegram.org/bot" + token + "/setMyCommands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function setChatMenuButton(token, menuButton) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/setChatMenuButton", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_button: menuButton || { type: "commands" } }),
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

export async function answerInlineQuery(token, inlineQueryId, results) {
  const body = {
    inline_query_id: inlineQueryId,
    results: results || [],
  };
  const res = await fetch("https://api.telegram.org/bot" + token + "/answerInlineQuery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function answerGuestQuery(token, guestQueryId, result) {
  const body = {
    guest_query_id: guestQueryId,
    result: result || {},
  };
  const res = await fetch("https://api.telegram.org/bot" + token + "/answerGuestQuery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  const owners = String(ownerId || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (owners.includes(String(userId))) return true;
  return isGroupAdmin(token, chatId, userId);
}

export async function deleteMessage(token, chatId, messageId) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/deleteMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
  return res.json();
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

export async function sendPhoto(token, chatId, photoUrl, options = {}) {
  const body = {
    chat_id: chatId,
    photo: photoUrl,
  };
  if (options.caption) body.caption = options.caption;
  if (options.replyToMessageId) {
    body.reply_parameters = { message_id: options.replyToMessageId };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
