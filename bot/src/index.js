import { sendMessage, sendEphemeral, deleteEphemeralMessage, sendMessageDraft, setMyCommands, setChatMenuButton, isBotAdmin, escapeMd, setMessageReaction, deleteMessage, sendPhoto } from "./telegram.js";
import { cmdLatest, cmdStats, cmdSearch, cmdChannels, cmdIsThisOnSv, cmdPing, fetchRawSman } from "./commands.js";
import { parsePostWithGroq, mergeWithGroq, toSmanBlock, missingFieldsMessage } from "./groq.js";
import { appendSmanEntry, updateSmanEntry, removeSmanEntry, createNotifyIssue, findEntryBlock, findEntryBlocks, entryToRawBlock } from "./github.js";
import { upsertPending, getPending, deletePending, deletePendingByUser, expiresAt } from "./supabase.js";
import { CATEGORY_FILES, CATEGORY_FIELDS, fileToCategory } from "./categories.js";
import { findEntriesByFile, buildMatchList, parseEntryFields, buildDiff, parseFileFromArgs } from "./supdate.js";
import { findEntryByCreator, generateRandomEmoji, buildRemovePreview, parseRemoveArgs } from "./sremove.js";

const HELP_TEXT = [
  "*svault bot commands:*",
  "",
  "/slatest \\[category\\] \\- newest addition",
  "/sstats \\[category\\] \\- entry counts",
  "/ssearch \\[category\\] query \\- find an entry",
  "/vault \\- open the vault browser",
  "/isthisonsv \\- reply to a message \\(is it in the vault\\?)",
  "/schannels \\- community channels",
  "/sping \\- check bot responsiveness",
  "",
  "*Admin commands \\(group admins only\\):*",
  "/sadd \\- add an entry \\(reply to a post\\)",
  "/supdate \\[category\\] \\[name\\] \\- update an entry",
  "/sremove \\[category\\] \\[name\\] \\[creator\\] \\- remove an entry",
  "",
  "Categories: rom, kernel, recovery, firmware, port, tool, guide",
].join("\n");

const TELEGRAM_MAX_LENGTH = 4096;

const MENTION_RESPONSES = [
  "Im alive!", "bruh", "asdaksdhqwiueb", "lmao what",
  "hello there", "im busy", "ok", "no", "maybe", "...",
  "hire me", "01001000", "ping?", "whomst",
];

const MENTION_EMOJIS = ["\ud83d\udc4d", "\ud83d\ude02", "\ud83d\udd25", "\ud83d\udc80", "\ud83d\udc40", "\ud83e\udd14", "\u2764\ufe0f", "\ud83e\udee1"];

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

function escapeMdSafe(text) {
  return (text || "").replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c).slice(0, 300);
}

function isGroupChat(chatType) {
  return chatType === "group" || chatType === "supergroup";
}

async function replyTo(env, msg, text, options = {}) {
  if (msg && isGroupChat(msg.chat.type)) {
    return sendEphemeral(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, text, { fallback: true, ...options });
  }
  return sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, text, options);
}

const DEFAULT_COMMANDS = [
  { command: "shelp", description: "Show all bot commands" },
  { command: "slatest", description: "Newest addition to the vault" },
  { command: "sstats", description: "Entry counts per category" },
  { command: "ssearch", description: "Search entries: /ssearch [category] query" },
  { command: "vault", description: "Open the vault browser" },
  { command: "schannels", description: "Community channels" },
  { command: "sping", description: "Check bot responsiveness" },
];

const ADMIN_COMMANDS = [
  { command: "sadd", description: "Add an entry (reply to a post)", is_ephemeral: true },
  { command: "supdate", description: "Update an entry: /supdate [category] [name]" },
  { command: "sremove", description: "Remove an entry: /sremove [category] [name] [creator]" },
];

async function registerCommands(env) {
  await setMyCommands(env.TELEGRAM_BOT_TOKEN, DEFAULT_COMMANDS);
  await setMyCommands(env.TELEGRAM_BOT_TOKEN, ADMIN_COMMANDS, {
    type: "all_chat_administrators",
  });
  await setChatMenuButton(env.TELEGRAM_BOT_TOKEN, {
    type: "web_app",
    text: "Open Vault",
    web_app: { url: "https://svault.jzadl.xyz/app" },
  });
}

let commandsRegistered = false;

export default {
  async fetch(request, env, ctx) {
    try {
    if (request.method !== "POST") {
      if (!commandsRegistered) {
        commandsRegistered = true;
        ctx.waitUntil(registerCommands(env));
      }
      return new Response("svault bot is alive v5", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    if (update.message_reaction) {
      try {
        await handleReaction(env, update.message_reaction);
      } catch {}
      return new Response("ok", { status: 200 });
    }

    const msg = update.message || update.edited_message;

    if (!msg || !msg.text) {
      return new Response("ok", { status: 200 });
    }

        const text = msg.text.trim();

    try {
      const addConfirmPending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "add_confirm");
        if (addConfirmPending && !text.startsWith("/")) {
          try {
            await handleAddConfirm(env, msg, addConfirmPending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }

        const pending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "add_followup");
        if (pending && !text.startsWith("/")) {
          try {
            await handleFollowUp(env, msg, pending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }

        const updateValuePending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "update_value");
        if (updateValuePending && !text.startsWith("/")) {
          try {
            await handleUpdateValue(env, msg, updateValuePending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }

        const updateConfirmPending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "update_confirm");
        if (updateConfirmPending && !text.startsWith("/")) {
          try {
            await handleUpdateConfirm(env, msg, updateConfirmPending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }

        const removeConfirmPending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "remove_confirm");
        if (removeConfirmPending && !text.startsWith("/")) {
          try {
            await handleRemoveConfirmText(env, msg, removeConfirmPending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }

        const updateSelectPending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "update_select");
        if (updateSelectPending && !text.startsWith("/")) {
          try {
            await handleUpdateSelect(env, msg, updateSelectPending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }

        const updateFieldSelectPending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "update_field_select");
        if (updateFieldSelectPending && !text.startsWith("/")) {
          try {
            await handleUpdateFieldSelect(env, msg, updateFieldSelectPending);
          } catch (err) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
              replyToMessageId: msg.message_id,
            });
          }
          return new Response("ok", { status: 200 });
        }
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }

    const isCommand = text.startsWith("/s") || text.toLowerCase().startsWith("/isthisonsv") || text.toLowerCase().startsWith("/vault") || text.toLowerCase().startsWith("/p");
    if (!isCommand) {
      if (isGroupChat(msg.chat.type) && (msg.text || msg.caption)) {
        const postText = (msg.text || msg.caption || "").trim();
        if (/^(name|title)\s*:/.test(postText) && /url\s*:/.test(postText)) {
          try {
            await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
              chat_id: msg.chat.id,
              user_id: msg.from.id,
              op_type: "__last_entry",
              file: "cache",
              data: postText.slice(0, 6000),
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            });
          } catch {}
        }
      }
      if (msg.chat.type !== "private" && msg.text) {
        const botUsername = env.BOT_USERNAME || "";
        if (botUsername && text.includes("@" + botUsername)) {
          const roll = Math.random();
          if (roll < 0.2) {
            if (roll < 0.1) {
              const resp = MENTION_RESPONSES[Math.floor(Math.random() * MENTION_RESPONSES.length)];
              await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, resp, {
                replyToMessageId: msg.message_id,
              });
            } else {
              const emoji = MENTION_EMOJIS[Math.floor(Math.random() * MENTION_EMOJIS.length)];
              await setMessageReaction(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.message_id, emoji);
            }
          }
        }
      }
      return new Response("ok", { status: 200 });
    }

    const spaceIdx = text.indexOf(" ");
    let command = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    const arg = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

    command = command.split("@")[0].toLowerCase();

    if (command === "/sid") {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Your chat ID: `" + msg.chat.id + "`", {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/p") {
      const photoUrl = "https://raw.githubusercontent.com/jzadl/selenevault/main/bot/assets/p.jpg";
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, msg.chat.id, photoUrl, {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/sping") {
      let reply;
      try {
        reply = await cmdPing(env, request, msg);
      } catch (err) {
        reply = "Pong! (could not measure latency)";
      }
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, reply, {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/vault") {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Open the vault browser:", {
        replyToMessageId: msg.message_id,
        replyMarkup: {
          inline_keyboard: [[{ text: "Open Vault", web_app: { url: "https://svault.jzadl.xyz/app" } }]],
        },
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/isthisonsv") {
      const replyMsg = msg.reply_to_message;
      const replyText = replyMsg ? (replyMsg.text || replyMsg.caption || "") : "";
      if (msg.chat.type === "private" && replyText) {
        try {
          await sendMessageDraft(env.TELEGRAM_BOT_TOKEN, msg.chat.id, 1, "Searching svault...");
        } catch {}
      }
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

    if (command === "/sdel") {
      if (String(msg.from.id) !== String(env.OWNER_ID)) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Only the owner can use this\\.", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      if (!msg.reply_to_message) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Reply to a message for me to delete\\.", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      const result = await deleteMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.reply_to_message.message_id);
      if (!result.ok) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Couldn't delete that: " + escapeMdSafe(String(result.description || "unknown error")), {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      return new Response("ok", { status: 200 });
    }

    if (command === "/smessage") {
      if (String(msg.from.id) !== String(env.OWNER_ID)) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Only the owner can use this\\.", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      if (!arg) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Usage: /smessage \\[text\\] or /smessage \\-all \\[text\\]", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      if (String(arg).trim().toLowerCase().startsWith("-all")) {
        const rest = String(arg).trim().slice(4).trim();
        if (!rest) {
          await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Usage: /smessage \\-all \\[text\\]", {
            replyToMessageId: msg.message_id,
          });
          return new Response("ok", { status: 200 });
        }
        const rawIds = (env.TELEGRAM_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
        const ids = rawIds.length ? [...new Set(rawIds)] : [String(msg.chat.id)];
        let sent = 0;
        for (const cid of ids) {
          const res = await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, rest);
          if (res.ok) {
            sent++;
          } else {
            const retry = await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, rest, { parseMode: null });
            if (retry.ok) sent++;
          }
        }
        if (ids.length > 1) {
          await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Sent to " + sent + " chats\\.", {
            replyToMessageId: msg.message_id,
          });
        }
        return new Response("ok", { status: 200 });
      }
      const messageSend = await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, arg);
      if (!messageSend.ok) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, arg, { parseMode: null });
      }
      return new Response("ok", { status: 200 });
    }

    const needsAdmin = ["/sadd", "/supdate", "/sremove"];
    if (needsAdmin.includes(command)) {
      try {
        const admin = await isBotAdmin(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, env.OWNER_ID);
        if (!admin) {
          await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Only group admins can use this\\.", {
            replyToMessageId: msg.message_id,
          });
          return new Response("ok", { status: 200 });
        }
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Couldn't verify admin status\\.", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
    }

    if (command === "/sadd") {
      try {
        await handleAdd(env, msg, arg);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
          replyToMessageId: msg.message_id,
        });
      }
      return new Response("ok", { status: 200 });
    }

    if (command === "/supdate") {
      try {
        await handleUpdateStart(env, msg, arg);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
          replyToMessageId: msg.message_id,
        });
      }
      return new Response("ok", { status: 200 });
    }

    if (command === "/sremove") {
      try {
        await handleRemoveStart(env, msg, arg);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
          replyToMessageId: msg.message_id,
        });
      }
      return new Response("ok", { status: 200 });
    }

    const streamable = ["/slatest", "/sstats", "/ssearch", "/schannels"];
    if (msg.chat.type === "private" && streamable.includes(command)) {
      try {
        await sendMessageDraft(env.TELEGRAM_BOT_TOKEN, msg.chat.id, 1, "Searching svault...");
      } catch {}
    }

    let reply;
    try {
      reply = await handleCommand(env, command, arg);
    } catch (err) {
      reply = "Something broke on my end, try again in a bit\\.\n`" + escapeMdSafe(String(err)) + "`";
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
    } catch (err) {
      return new Response("ok", { status: 200 });
    }
  },
};

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

async function handleAdd(env, msg, arg) {
  const chatId = msg.chat.id;

  if (msg.chat.type === "private") {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "This only works in a group, replying to the post you want to add\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  const replyMsg = msg.reply_to_message;
  const postText = (replyMsg ? (replyMsg.text || replyMsg.caption || "") : "").trim() || (arg || "").trim();
  if (!replyMsg && !arg) {
    const cached = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, msg.chat.id, msg.from.id, "__last_entry").catch(() => null);
    if (cached && cached.data) {
      await handleAddParse(env, msg, cached.data);
      return;
    }
    await replyTo(env, msg, "Reply to the post you want to add with /sadd, or paste it right after the command\\.", { replyToMessageId: msg.message_id });
    return;
  }

  for (const staleType of ["add_confirm", "add_followup", "remove_confirm", "update_select", "update_field_select", "update_value", "update_confirm"]) {
    try {
      await deletePendingByUser(env.SUPABASE_URL, env.SUPABASE_KEY, chatId, msg.from.id, staleType);
    } catch {}
  }

  if (!postText) {
    await replyTo(env, msg, "That message has no text I can parse\\.", { replyToMessageId: msg.message_id });
    return;
  }

  await handleAddParse(env, msg, postText);
}

async function handleAddParse(env, msg, postText) {
  const chatId = msg.chat.id;

  const status = await sendEphemeral(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, "Parsing with Groq...", { parseMode: null }).catch(() => null);

  let parsed;
  try {
    parsed = await parsePostWithGroq(env.GROQ_API_KEY, postText);
  } catch (err) {
    try {
      if (status && status.ok && status.result && status.result.ephemeral_message_id) {
        await deleteEphemeralMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, status.result.ephemeral_message_id);
      }
    } catch {}
    await replyTo(env, msg, "Couldn't parse that: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
    return;
  }
  try {
    if (status && status.ok && status.result && status.result.ephemeral_message_id) {
      await deleteEphemeralMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, status.result.ephemeral_message_id);
    }
  } catch {}

  const { file, block } = toSmanBlock(parsed);

  const preview = [
    "Is this correct?:",
    "",
    "File: `" + escapeMd(file) + "`",
    "```",
    block,
    "```",
    "",
    "Reply *yes*, *no* \\(with missing fields\\), or *cancel*\\.",
  ].join("\n");

  const result = await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
    chat_id: chatId,
    user_id: msg.from.id,
    op_type: "add_confirm",
    file: file,
    data: JSON.stringify({ parsed, file, block }),
    expires_at: expiresAt(),
  });

  await replyTo(env, msg, preview, { replyToMessageId: msg.message_id });
}

async function handleAddConfirm(env, msg, pending) {
  const text = msg.text.trim().toLowerCase();
  const chatId = msg.chat.id;
  const d = JSON.parse(pending.data);

  if (text === "yes") {
    await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);
    await pushEntry(env, msg, d.file, d.block, d.parsed);
    return;
  }

  if (text === "cancel") {
    await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);
    await replyTo(env, msg, "Cancelled\\.", { replyToMessageId: msg.message_id });
    return;
  }

  if (text === "no") {
    await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);
    const missingText = missingFieldsMessage(d.parsed);
    const prompt = missingText ? "> " + escapeMd(missingText) : "What's missing?";
    await replyTo(env, msg, prompt, { replyToMessageId: msg.message_id });

    await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
      chat_id: chatId,
      user_id: msg.from.id,
      op_type: "add_followup",
      file: d.file,
      data: JSON.stringify({ parsed: d.parsed, file: d.file, chatId, sourceMessageId: msg.message_id }),
      expires_at: expiresAt(),
    });
    return;
  }

  await replyTo(env, msg, "That didn't match anything\\. I'm still waiting for your answer to /sadd\\.\nReply *yes*, *no* \\(with missing fields\\), or *cancel*\\.", { replyToMessageId: msg.message_id });
}

async function handleUpdateFieldSelect(env, msg, pending) {
  const chatId = msg.chat.id;
  const d = JSON.parse(pending.data);
  const field = msg.text.trim().toLowerCase();

  if (field === "cancel") {
    await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);
    await replyTo(env, msg, "Cancelled\\.", { replyToMessageId: msg.message_id });
    return;
  }

  const validFields = CATEGORY_FIELDS[d.category] || CATEGORY_FIELDS.rom;
  if (!validFields.includes(field)) {
    await replyTo(env, msg, "Invalid field\\. Pick one of: " + validFields.map((f) => "`" + f + "`").join(", ") + "\nor reply *cancel*\\.", { replyToMessageId: msg.message_id });
    return;
  }

  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);

  const fields = parseEntryFields(d.entryRaw);
  const label = field === "url" ? "download link" : field;
  await replyTo(env, msg,
    "\u270f\ufe0f *Changing " + label + "*\n`" + escapeMd(fields[field] || "(empty)") + "`\n\nSend the new " + label + "\\, or reply *cancel*\\.",
    { replyToMessageId: msg.message_id }
  );

  await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
    chat_id: chatId,
    user_id: msg.from.id,
    op_type: "update_value",
    file: d.file,
    data: JSON.stringify({ file: d.file, entry: d.entry, entryRaw: d.entryRaw, field, category: d.category }),
    expires_at: expiresAt(),
  });
}



async function handleFollowUp(env, msg, pending) {
  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);
  const d = JSON.parse(pending.data);

  const status = await sendEphemeral(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, "Merging with Groq...", { parseMode: null }).catch(() => null);

  let merged;
  try {
    merged = await mergeWithGroq(env.GROQ_API_KEY, d.parsed, msg.text);
  } catch (err) {
    try {
      if (status && status.ok && status.result && status.result.ephemeral_message_id) {
        await deleteEphemeralMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, status.result.ephemeral_message_id);
      }
    } catch {}
    await replyTo(env, msg, "Couldn't merge that: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
    return;
  }
  try {
    if (status && status.ok && status.result && status.result.ephemeral_message_id) {
      await deleteEphemeralMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, status.result.ephemeral_message_id);
    }
  } catch {}

  const categoryOverride = fileToCategory(msg.text);
  if (categoryOverride) {
    merged.category = categoryOverride;
    if (!/^https?:\/\//i.test(merged.url || "") && d.parsed.url) {
      merged.url = d.parsed.url;
    }
  }

  const { file, block } = toSmanBlock(merged);
  await pushEntry(env, msg, file, block, merged, true);
}

async function pushEntry(env, msg, file, block, parsed, isNewMessage) {
  const chatId = msg.chat.id;
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const maintainerMatch = block.match(/^maintainer:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : "Unknown";
  const maintainer = maintainerMatch ? maintainerMatch[1].trim() : "Unknown";

  try {
    await appendSmanEntry(env, file, block, "ADD: " + name + " by " + maintainer + " to " + file);
  } catch (err) {
    const text = "Failed to push: " + escapeMdSafe(String(err.message || err));
    await replyTo(env, msg, text, { replyToMessageId: isNewMessage ? msg.message_id : undefined });
    return;
  }

  const notifyText = "*" + escapeMd(name) + "* by " + escapeMd(maintainer) + " was added to `" + escapeMd(file) + "` and its live on svault\\.jzadl\\.xyz\\!";
  try {
    await createNotifyIssue(env, notifyText);
  } catch {}

  const doneText = "Added\\! " + escapeMd(name) + " is live on svault\\.jzadl\\.xyz";
  await replyTo(env, msg, doneText, { replyToMessageId: isNewMessage ? msg.message_id : undefined });
}

async function handleUpdateStart(env, msg, arg) {
  const chatId = msg.chat.id;
  if (!arg) {
    await replyTo(env, msg, "Usage: /supdate \\[category\\] \\[name\\]\nExample: /supdate port HyperOS", { replyToMessageId: msg.message_id });
    return;
  }

  const { file, query } = parseFileFromArgs(arg);
  if (!file || !query) {
    await replyTo(env, msg, "Usage: /supdate \\[category\\] \\[name\\]\nExample: /supdate port HyperOS", { replyToMessageId: msg.message_id });
    return;
  }

  for (const staleType of ["add_confirm", "add_followup", "remove_confirm", "update_select", "update_field_select", "update_value", "update_confirm"]) {
    try {
      await deletePendingByUser(env.SUPABASE_URL, env.SUPABASE_KEY, chatId, msg.from.id, staleType);
    } catch {}
  }

  const matches = await findEntriesByFile(env, file, query);
  if (matches.length === 0) {
    await replyTo(env, msg, "No entries matching *" + escapeMd(query) + "* found in `" + escapeMd(file) + "`\\.", { replyToMessageId: msg.message_id });
    return;
  }

  if (matches.length === 1) {
    const entryRaw = matches[0];
    const fields = parseEntryFields(entryRaw);
    const entry = { name: fields.name, version: fields.version, maintainer: fields.maintainer };
    const cat = Object.entries(CATEGORY_FILES).find(([, v]) => v === file)?.[0] || "rom";

    await sendEntryEditPrompt(env, msg, entryRaw, cat);

    await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
      chat_id: chatId,
      user_id: msg.from.id,
      op_type: "update_field_select",
      file: file,
      data: JSON.stringify({ file, entry, entryRaw, category: cat }),
      expires_at: expiresAt(),
    });
    return;
  }

  await replyTo(env, msg, buildMatchList(matches) + "\n\nReply with the number\\.", { replyToMessageId: msg.message_id });

  await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
    chat_id: chatId,
    user_id: msg.from.id,
    op_type: "update_select",
    file: file,
    data: JSON.stringify({ file, query, matches }),
    expires_at: expiresAt(),
  });
}

function sendEntryEditPrompt(env, msg, entryRaw, cat) {
  const fieldList = (CATEGORY_FIELDS[cat] || CATEGORY_FIELDS.rom).map((f) => "`" + f + "`").join(", ");
  const text = [
    "\ud83d\udee0\ufe0f *Update entry:*",
    "",
    "```",
    entryRaw,
    "```",
    "",
    "Reply with a field to edit: ",
    fieldList,
    "",
    "or reply *cancel*\\.",
  ].join("\n");
  return replyTo(env, msg, text, { replyToMessageId: msg.message_id });
}

async function handleUpdateSelect(env, msg, pending) {
  const chatId = msg.chat.id;
  const d = JSON.parse(pending.data);
  const text = msg.text.trim().toLowerCase();

  if (text === "cancel") {
    await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);
    await replyTo(env, msg, "Cancelled\\.", { replyToMessageId: msg.message_id });
    return;
  }

  const num = parseInt(text, 10);

  if (isNaN(num) || num < 1 || num > d.matches.length) {
    await replyTo(env, msg, "Please reply with a number between 1 and " + d.matches.length + "\\, or *cancel*\\.", { replyToMessageId: msg.message_id });
    return;
  }

  const entryRaw = d.matches[num - 1];
  const fields = parseEntryFields(entryRaw);
  const entry = { name: fields.name, version: fields.version, maintainer: fields.maintainer };
  const cat = Object.entries(CATEGORY_FILES).find(([, v]) => v === d.file)?.[0] || "rom";

  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);

  await sendEntryEditPrompt(env, msg, entryRaw, cat);

  await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
    chat_id: chatId,
    user_id: msg.from.id,
    op_type: "update_field_select",
    file: d.file,
    data: JSON.stringify({ file: d.file, entry, entryRaw, category: cat }),
    expires_at: expiresAt(),
  });
}

async function handleUpdateValue(env, msg, pending) {
  const chatId = msg.chat.id;
  const d = JSON.parse(pending.data);
  const newValue = msg.text.trim();

  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);

  const fields = parseEntryFields(d.entryRaw);
  const diff = buildDiff(fields, d.field, newValue);

  const result = await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
    chat_id: chatId,
    user_id: msg.from.id,
    op_type: "update_confirm",
    file: d.file,
    data: JSON.stringify({ file: d.file, entry: d.entry, entryRaw: d.entryRaw, field: d.field, newValue, category: d.category }),
    expires_at: expiresAt(),
  });

  await replyTo(env, msg, diff + "\n\nReply *yes* to confirm or *no* to cancel\\.", { replyToMessageId: msg.message_id });
}

async function handleUpdateConfirm(env, msg, pending) {
  const text = msg.text.trim().toLowerCase();
  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);

  if (text === "yes") {
    const d = JSON.parse(pending.data);
    const fields = parseEntryFields(d.entryRaw);
    fields[d.field] = d.newValue;
    const newBlock = entryToRawBlock(fields, CATEGORY_FIELDS[d.category] || CATEGORY_FIELDS.rom);

    try {
      await updateSmanEntry(env, d.file, d.entryRaw, newBlock, "UPDATE: " + (d.entry.name || "entry") + " " + d.field + " in " + d.file);
    } catch (err) {
      await replyTo(env, msg, "Failed to update: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
      return;
    }

    const notifyText = "*" + escapeMd(d.entry.name || "entry") + "* was updated in `" + escapeMd(d.file) + "` and its live on svault\\.jzadl\\.xyz\\!";
    try {
      await createNotifyIssue(env, notifyText);
    } catch {}

    await replyTo(env, msg, "Updated\\! " + escapeMd(d.entry.name || "Entry") + " is live on svault\\.jzadl\\.xyz", { replyToMessageId: msg.message_id });
  } else if (text === "no") {
    await replyTo(env, msg, "Cancelled\\.", { replyToMessageId: msg.message_id });
  }
}

async function handleRemoveStart(env, msg, arg) {
  const chatId = msg.chat.id;
  if (!arg) {
    await replyTo(env, msg, "Usage: /sremove \\[category\\] \\[name\\] \\[creator\\]\nExample: /sremove port HyperOS zelsta7", { replyToMessageId: msg.message_id });
    return;
  }

  const { file, name, creator } = parseRemoveArgs(arg);
  if (!file || !name) {
    await replyTo(env, msg, "Usage: /sremove \\[category\\] \\[name\\] \\[creator\\]\nExample: /sremove port HyperOS zelsta7", { replyToMessageId: msg.message_id });
    return;
  }

  for (const staleType of ["add_confirm", "add_followup", "remove_confirm", "update_select", "update_field_select", "update_value", "update_confirm"]) {
    try {
      await deletePendingByUser(env.SUPABASE_URL, env.SUPABASE_KEY, chatId, msg.from.id, staleType);
    } catch {}
  }

  const rawContent = await fetchRawSman(env, file);
  const match = findEntryByCreator(rawContent, name, creator || "");

  if (!match) {
    await replyTo(env, msg, "No matching entry found\\.", { replyToMessageId: msg.message_id });
    return;
  }

  const emoji = generateRandomEmoji();
  const previewText = buildRemovePreview(match) + "\n\nReply *yes* to confirm deletion or *cancel*\\.";
  let previewSend = await replyTo(env, msg, previewText, { replyToMessageId: msg.message_id });
  if (!previewSend.ok) {
    await replyTo(env, msg, previewText, { replyToMessageId: msg.message_id, parseMode: null });
  }

  await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
    chat_id: chatId,
    user_id: msg.from.id,
    op_type: "remove_confirm",
    file: file,
    data: JSON.stringify({ file, entryRaw: match, emoji }),
    expires_at: expiresAt(),
  });
  console.log("REMOVE previewed+upserted for file " + file + " name " + name);
}

async function handleReaction(env, reaction) {
  const chatId = reaction.chat.id;
  const userId = reaction.user.id;
  const emoji = reaction.new_reaction?.[0]?.emoji;
  if (!emoji) return;

  const pending = await getPending(env.SUPABASE_URL, env.SUPABASE_KEY, chatId, userId, "remove_confirm");
  if (!pending) return;

  const d = JSON.parse(pending.data);
  if (d.emoji !== emoji) return;

  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);

  const fields = parseEntryFields(d.entryRaw);
  const name = fields.name || "Unknown";
  const maintainer = fields.maintainer || "Unknown";

  try {
    await removeSmanEntry(env, d.file, d.entryRaw, "REMOVE: " + name + " by " + maintainer + " from " + d.file);
  } catch (err) {
    const text = "Failed to remove: " + escapeMdSafe(String(err.message || err));
    if (isGroupChat(reaction.chat.type)) {
      await sendEphemeral(env.TELEGRAM_BOT_TOKEN, chatId, userId, text, { fallback: true });
    } else {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
    }
    return;
  }

  const notifyText = "*" + escapeMd(name) + "* by " + escapeMd(maintainer) + " was removed from `" + escapeMd(d.file) + "`";
  try {
    await createNotifyIssue(env, notifyText);
  } catch {}

  const doneText = "Removed\\! " + escapeMd(name) + " is no longer on svault\\.jzadl\\.xyz";
  if (isGroupChat(reaction.chat.type)) {
    await sendEphemeral(env.TELEGRAM_BOT_TOKEN, chatId, userId, doneText, { fallback: true });
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, doneText);
  }
}

async function handleRemoveConfirmText(env, msg, pending) {
  const text = msg.text.trim().toLowerCase();
  const chatId = msg.chat.id;
  const d = JSON.parse(pending.data);

  await deletePending(env.SUPABASE_URL, env.SUPABASE_KEY, pending.id);

  if (text === "yes") {
    const fields = parseEntryFields(d.entryRaw);
    const name = fields.name || "Unknown";
    const maintainer = fields.maintainer || "Unknown";

    try {
      await removeSmanEntry(env, d.file, d.entryRaw, "REMOVE: " + name + " by " + maintainer + " from " + d.file);
    } catch (err) {
      await replyTo(env, msg, "Failed to remove: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
      return;
    }

    const notifyText = "*" + escapeMd(name) + "* by " + escapeMd(maintainer) + " was removed from `" + escapeMd(d.file) + "`";
    try {
      await createNotifyIssue(env, notifyText);
    } catch {}

    const confirmText = "Removed\\! " + escapeMd(name) + " is no longer on svault\\.jzadl\\.xyz";
    let confirmSend = await replyTo(env, msg, confirmText, { replyToMessageId: msg.message_id });
    if (!confirmSend.ok) {
      await replyTo(env, msg, confirmText, { replyToMessageId: msg.message_id, parseMode: null });
    }
  } else if (text === "cancel" || text === "no") {
    await replyTo(env, msg, "Cancelled\\.", { replyToMessageId: msg.message_id });
  } else {
    await replyTo(env, msg, "Reply *yes* to confirm or *cancel*\\.", { replyToMessageId: msg.message_id });
    await upsertPending(env.SUPABASE_URL, env.SUPABASE_KEY, {
      chat_id: chatId,
      user_id: msg.from.id,
      op_type: "remove_confirm",
      file: d.file,
      data: JSON.stringify(d),
      expires_at: expiresAt(),
    });
  }
}
