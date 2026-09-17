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
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
