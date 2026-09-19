import { sendMessage, answerCallbackQuery, editMessageText, isGroupAdmin, escapeMd } from "./telegram.js";
import { cmdLatest, cmdStats, cmdSearch, cmdChannels, cmdIsThisOnSv } from "./commands.js";
import { parsePostWithGroq, mergeWithGroq, toSmanBlock, missingFieldsMessage } from "./groq.js";
import { appendSmanEntry, createNotifyIssue } from "./github.js";

const HELP_TEXT = [
  "*svault bot commands:*",
  "",
  "/slatest \\[category\\] \\- newest addition",
  "/sstats \\[category\\] \\- entry counts",
  "/ssearch \\[category\\] query \\- find an entry",
  "/schannels \\- community channels",
  "",
  "Categories: rom, kernel, recovery, firmware, port, tool, guide",
].join("\n");

async function handleCommand(env, command, arg) {
  switch (command) {
    case "/sstart":
    case "/shelp":
      return HELP_TEXT;
    case "/slatest":
      return cmdLatest(env, arg ? arg.toLowerCase() : null);
    case "/sstats":
      return cmdStats(env, arg ? arg.toLowerCase() : null);
    case "/ssearch":
      return cmdSearch(env, arg);
    case "/schannels":
      return cmdChannels(env);
    default:
      return null;
  }
}

const TELEGRAM_MAX_LENGTH = 4096;

function splitMessage(text) {
  if (text.length <= TELEGRAM_MAX_LENGTH) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > TELEGRAM_MAX_LENGTH) {
    let cut = remaining.lastIndexOf("\n\n", TELEGRAM_MAX_LENGTH);
    if (cut <= 0) cut = TELEGRAM_MAX_LENGTH;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.includes("debug")) {
      const value = await env.SVM.get("debug:last_update");
      return new Response(`path=${url.pathname}\n\n${value || "no data yet"}`, { status: 200 });
    }

    if (request.method !== "POST") {
      return new Response("svault bot is alive v3", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const msg = update.message;
    const callback = update.callback_query;

    try {
      await env.SVM.put(
        "debug:last_update",
        JSON.stringify({
          time: new Date().toISOString(),
          has_msg: !!msg,
          text: msg ? msg.text : null,
          chat_type: msg ? msg.chat.type : null,
          has_callback: !!callback,
        })
      );
    } catch {}

    if (msg && msg.text && msg.text.trim().toLowerCase().startsWith("/sadd")) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        "5722152704",
        `DEBUG /sadd received\\. chat\\_type=${escapeMdSafe(msg.chat.type)} has\\_reply=${msg.reply_to_message ? "yes" : "no"} from\\_id=${msg.from.id}`
      ).catch(() => {});
    }

    if (callback) {
      try {
        await handleCallback(env, callback);
      } catch (err) {
        await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callback.id, `Error: ${String(err.message || err).slice(0, 180)}`);
      }
      return new Response("ok", { status: 200 });
    }

    if (!msg || !msg.text) {
      return new Response("ok", { status: 200 });
    }

    const text = msg.text.trim();

    if (msg.chat.type !== "private") {
      const pendingKey = `pending:${msg.chat.id}:${msg.from.id}`;
      let pending;
      try {
        pending = await env.SVM.get(pendingKey, "json");
      } catch {
        pending = null;
      }
      if (pending && !text.startsWith("/")) {
        try {
          await handleFollowUp(env, msg, pending, pendingKey);
        } catch (err) {
          await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `Something broke: \`${String(err.message || err).slice(0, 200)}\``, {
            replyToMessageId: msg.message_id,
          });
        }
        return new Response("ok", { status: 200 });
      }
    }

    const isCommand = text.startsWith("/s") || text.toLowerCase().startsWith("/isthisonsv");
    if (!isCommand) {
      return new Response("ok", { status: 200 });
    }

    const spaceIdx = text.indexOf(" ");
    let command = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    const arg = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

    command = command.split("@")[0].toLowerCase();

    if (command === "/sid") {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `Your chat ID: \`${msg.chat.id}\``, {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/isthisonsv") {
      const replyMsg = msg.reply_to_message;
      const replyText = replyMsg ? (replyMsg.text || replyMsg.caption || "") : "";
      let isReply;
      try {
        isReply = await cmdIsThisOnSv(env, replyText);
      } catch (err) {
        isReply = "Something broke on my end, try again in a bit\\.";
      }
      if (!replyMsg) {
        isReply = "Reply to a message with a ROM/kernel/port name to use this\\.";
      }
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, isReply, {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/sadd") {
      try {
        await handleAdd(env, msg);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `Something broke: \`${escapeMdSafe(String(err.message || err))}\``, {
          replyToMessageId: msg.message_id,
        });
      }
      return new Response("ok", { status: 200 });
    }

    let reply;
    try {
      reply = await handleCommand(env, command, arg);
    } catch (err) {
      reply = `Something broke on my end, try again in a bit\\.\n\`${escapeMdSafe(String(err))}\``;
    }

    if (reply) {
      const chunks = splitMessage(reply);
      for (let i = 0; i < chunks.length; i++) {
        const result = await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, chunks[i], {
          replyToMessageId: i === 0 ? msg.message_id : undefined,
        });
        if (!result.ok) {
          await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "I found something but could not send it properly\\.", {
            replyToMessageId: msg.message_id,
          });
          break;
        }
      }
    }

    return new Response("ok", { status: 200 });
  },
};

function escapeMdSafe(text) {
  return (text || "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c).slice(0, 300);
}

const PENDING_TTL_SECONDS = 60 * 30;

async function handleAdd(env, msg) {
  const chatId = msg.chat.id;

  if (msg.chat.type === "private") {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "This only works in a group, replying to the post you want to add\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const admin = await isGroupAdmin(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id);
  if (!admin) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Only group admins can use this\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const replyMsg = msg.reply_to_message;
  if (!replyMsg) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Reply to the post you want to add with /sadd\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const postText = replyMsg.text || replyMsg.caption || "";
  if (!postText) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "That message has no text I can parse\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  let parsed;
  try {
    parsed = await parsePostWithGroq(env.GROQ_API_KEY, postText);
  } catch (err) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `Couldn't parse that: ${escapeMdSafe(String(err.message || err))}`, {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const { file, block } = toSmanBlock(parsed);
  const confirmKey = `confirm:${chatId}:${msg.from.id}:${Date.now()}`;
  await env.SVM.put(confirmKey, JSON.stringify({ parsed, file, block }), { expirationTtl: PENDING_TTL_SECONDS });

  const preview = [
    "Is this correct?:",
    "",
    `File: \`${escapeMd(file)}\``,
    "```",
    block,
    "```",
  ].join("\n");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, preview, {
    replyToMessageId: msg.message_id,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "Yes", callback_data: `sadd_yes:${confirmKey}` },
          { text: "No", callback_data: `sadd_no:${confirmKey}` },
        ],
      ],
    },
  });
}

async function handleCallback(env, callback) {
  const data = callback.data || "";
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;

  const admin = await isGroupAdmin(env.TELEGRAM_BOT_TOKEN, chatId, callback.from.id);
  if (!admin) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callback.id, "Only group admins can do this.");
    return;
  }

  if (data.startsWith("sadd_no:")) {
    const key = data.slice("sadd_no:".length);
    const stored = await env.SVM.get(key, "json");
    await env.SVM.delete(key);
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callback.id);
    if (!stored) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, "This has expired, run /sadd again\\.", { replyMarkup: null });
      return;
    }
    await pushEntry(env, chatId, messageId, stored.file, stored.block, stored.parsed);
    return;
  }

  if (data.startsWith("sadd_yes:")) {
    const key = data.slice("sadd_yes:".length);
    const stored = await env.SVM.get(key, "json");
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callback.id);
    if (!stored) {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, "This has expired, run /sadd again\\.", { replyMarkup: null });
      return;
    }

    const missingText = missingFieldsMessage(stored.parsed);
    const prompt = missingText ? `> ${escapeMd(missingText)}` : "What's missing?";
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, prompt, { replyMarkup: null });

    const pendingKey = `pending:${chatId}:${callback.from.id}`;
    await env.SVM.put(
      pendingKey,
      JSON.stringify({ confirmKey: key, parsed: stored.parsed, file: stored.file, chatId, sourceMessageId: messageId }),
      { expirationTtl: PENDING_TTL_SECONDS }
    );
    await env.SVM.delete(key);
    return;
  }
}

async function handleFollowUp(env, msg, pending, pendingKey) {
  await env.SVM.delete(pendingKey);

  let merged;
  try {
    merged = await mergeWithGroq(env.GROQ_API_KEY, pending.parsed, msg.text);
  } catch (err) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, `Couldn't merge that: ${escapeMdSafe(String(err.message || err))}`, {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const { file, block } = toSmanBlock(merged);
  await pushEntry(env, msg.chat.id, msg.message_id, file, block, merged, true);
}

async function pushEntry(env, chatId, messageId, file, block, parsed, isNewMessage) {
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const maintainerMatch = block.match(/^maintainer:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : "Unknown";
  const maintainer = maintainerMatch ? maintainerMatch[1].trim() : "Unknown";

  try {
    await appendSmanEntry(env, file, block, `ADD: ${name} by ${maintainer} to ${file}`);
  } catch (err) {
    const text = `Failed to push: ${escapeMdSafe(String(err.message || err))}`;
    if (isNewMessage) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, { replyToMessageId: messageId });
    } else {
      await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, text, { replyMarkup: null });
    }
    return;
  }

  const notifyText = `*${escapeMd(name)}* by ${escapeMd(maintainer)} was added to \`${escapeMd(file)}\` and its live on svault\\.jzadl\\.xyz\\!`;
  try {
    await createNotifyIssue(env, notifyText);
  } catch {
    // notify failure is not critical, entry is already pushed
  }

  const doneText = `Added\\! ${escapeMd(name)} is live on svault\\.jzadl\\.xyz`;
  if (isNewMessage) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, doneText, { replyToMessageId: messageId });
  } else {
    await editMessageText(env.TELEGRAM_BOT_TOKEN, chatId, messageId, doneText, { replyMarkup: null });
  }
}
