import { sendMessage, sendEphemeral, sendMessageDraft, sendChatAction, sendRichMessage, setMyCommands, setChatMenuButton, isBotAdmin, getChatMember, escapeMd, setMessageReaction, deleteMessage, sendPhoto, editMessageText, answerCallbackQuery, answerInlineQuery, answerGuestQuery } from "./telegram.js";
import { cmdLatest, cmdStats, cmdStatsRich, cmdSearch, cmdChannels, cmdIsThisOnSv, cmdPing, fetchRawSman, buildInlineResults } from "./commands.js";
import { parsePostWithGroq, mergeWithGroq, toSmanBlock, missingFieldsMessage } from "./groq.js";
import { appendSmanEntry, updateSmanEntry, removeSmanEntry, entryToRawBlock, listTrash, restoreTrashEntry, getFileContent } from "./github.js";
import { upsertPending, getPending, deletePending, deletePendingByUser, expiresAt, rememberChat, knownChatIds } from "./db.js";
import { CATEGORY_FILES, CATEGORY_FIELDS, fileToCategory } from "./categories.js";
import { findEntriesByFile, buildMatchList, parseEntryFields, buildDiff, parseFileFromArgs } from "./supdate.js";
import { findEntryByCreator, generateRandomEmoji, buildRemovePreview, parseRemoveArgs } from "./sremove.js";
import { runLinkCheck, handleLinkCallback, probeUrl } from "./linkcheck.js";
import { parseSman } from "./sman.js";
import { subAdd, subRemove, subList, subChats } from "./subscribe.js";
import { listLinkcheck } from "./db.js";

const HELP_TEXT = [
  "*svault bot commands*",
  "",
  "/start \\- open the vault",
  "/slatest \\[category\\] \\- newest addition",
  "/sstats \\[category\\] \\[filters\\] \\- entry counts",
  "/ssearch \\[category\\] \\[filters\\] query \\- find an entry",
  "/ssubscribe \\[categories\\.\\.\\.\\] \\- new\\-build notifications",
  "/ssubs \\- list subscriptions",
  "/sunsub \\[categories\\.\\.\\.\\] \\- drop subscriptions",
  "",
  "Filters: by:name vendor:x date:2026 android:14 gapps:gapps",
"/vault \\- open the vault browser",
  "/isthisonsv \\- reply to a message \\(is it in the vault?\\)",
  "/schannels \\- community channels",
  "/sping \\- check responsiveness",
  "",
  "*Admin commands* \\(group admins only\\)",
  "",
  "/sadd \\- add an entry \\(reply to a post\\)",
  "/supdate \\[category\\] \\[name\\] \\- update an entry",
  "/sremove \\[category\\] \\[name\\] \\[creator\\] \\- remove an entry",
  "/schecklinks \\- check all download links \\(owner only\\)",
  "/slinkqueue \\- pending dead\\-link reports \\(owner only\\)",
  "/strash \\- recently deleted entries",
  "/srestore \\[name\\] \\- restore an entry from trash",
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

function welcomeText() {
  return [
    "*Welcome to selenevault\\!*",
    "",
    "Index of ROMs, kernels, recoveries, firmware, ports, tools and guides for Xiaomi Redmi 10 \\(selene\\)\\.",
    "",
    "Tap the button below to open the vault, or use /shelp for commands\\.",
  ].join("\n");
}

function vaultButton(env) {
  const vaultUrl = (env.SITE_URL || "https://svault.jzadl.xyz") + "/app";
  return { inline_keyboard: [[{ text: "Open Vault", web_app: { url: vaultUrl } }]] };
}

// Direct channel notifications (replaces the GitHub-issues relay).
// Sends MarkdownV2 to every TELEGRAM_CHAT_IDS entry, plain-text fallback.
async function notifyChats(env, text) {
  const ids = String(env.TELEGRAM_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const cid of ids) {
    const res = await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, text).catch(() => null);
    if (!res || !res.ok) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, text, { parseMode: null }).catch(() => {});
    }
  }
}

// Local text files (help.txt / update.txt) live in the repo root on this server.
async function readLocalText(env, file) {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = env.REPO_ROOT || "/home/main/projects/selenevault";
    return await readFile(join(root, file), "utf-8");
  } catch {
    return null;
  }
}

function isGroupChat(chatType) {
  return chatType === "group" || chatType === "supergroup";
}

// Deletes a "status" message (Parsing/Merging with Groq...). sendEphemeral
// falls back to a normal message when Telegram rejects ephemeral params, so
// the id may be ephemeral_message_id (ephemeral) or message_id (fallback).
async function deleteStatus(env, chatId, userId, status) {
  if (!status || !status.ok || !status.result) return;
  const r = status.result;
  if (r.ephemeral_message_id) {
    await deleteEphemeralMessage(env.TELEGRAM_BOT_TOKEN, chatId, userId, r.ephemeral_message_id).catch(() => {});
  } else if (r.message_id) {
    await deleteMessage(env.TELEGRAM_BOT_TOKEN, chatId, r.message_id).catch(() => {});
  }
}

// OWNER_ID may hold a comma-separated list (multi-owner).
function isOwner(env, userId) {
  const ids = String(env.OWNER_ID || "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}

// YYYY-MM-DD from a Telegram message date (fallback when Groq finds no date).
function msgDateStr(msg) {
  if (!msg || !msg.date) return null;
  try {
    return new Date(msg.date * 1000).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function replyTo(env, msg, text, options = {}) {
  if (msg && isGroupChat(msg.chat.type)) {
    return sendEphemeral(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id, text, { fallback: true, ...options });
  }
  return sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, text, options);
}

const DEFAULT_COMMANDS = [
  { command: "start", description: "Start the bot and open the vault" },
  { command: "shelp", description: "Show all bot commands" },
  { command: "vault", description: "Open the vault mini app" },
  { command: "snews", description: "Latest update message" },
  { command: "slatest", description: "Newest addition to the vault" },
  { command: "sstats", description: "Entry counts per category" },
  { command: "ssearch", description: "Search entries: /ssearch [category] query" },
  { command: "ssubscribe", description: "Get notified of new builds: /ssubscribe rom" },
  { command: "ssubs", description: "List your subscriptions" },
  { command: "schannels", description: "Community channels" },
  { command: "sping", description: "Check bot responsiveness" },
];

const ADMIN_COMMANDS = [
  { command: "sadd", description: "Add an entry (reply to a post)", is_ephemeral: true },
  { command: "schecklinks", description: "Check download links (owner only)" },
  { command: "slinkqueue", description: "Pending dead-link reports (owner only)" },
  { command: "strash", description: "Recently deleted entries" },
  { command: "srestore", description: "Restore an entry from trash: /srestore name" },
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

    if (update.inline_query) {
      try {
        const query = update.inline_query.query || "";
        let results = query.trim().startsWith("/")
          ? await buildInlineCommandResults(env, query)
          : await buildInlineResults(env, query);
        let res = await answerInlineQuery(env.TELEGRAM_BOT_TOKEN, update.inline_query.id, results);
        if (!res.ok) {
          for (const r of results) {
            if (r.input_message_content && r.input_message_content.parse_mode) {
              delete r.input_message_content.parse_mode;
            }
          }
          res = await answerInlineQuery(env.TELEGRAM_BOT_TOKEN, update.inline_query.id, results);
        }
      } catch {
        await answerInlineQuery(env.TELEGRAM_BOT_TOKEN, update.inline_query.id, []);
      }
      return new Response("ok", { status: 200 });
    }

    if (update.callback_query) {
      try {
        const q = update.callback_query;
        if (String(q.data || "").startsWith("linkkeep:") || String(q.data || "").startsWith("linkdel:")) {
          if (!isOwner(env, q.from?.id)) {
            await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, q.id, "Admins only.").catch(() => {});
          } else {
            await handleLinkCallback(env, q);
          }
        } else {
          await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, q.id).catch(() => {});
        }
      } catch {}
      return new Response("ok", { status: 200 });
    }

    if (update.guest_message) {
      try {
        await handleGuestMessage(env, update.guest_message);
      } catch {
        try {
          await answerGuestQuery(env.TELEGRAM_BOT_TOKEN, update.guest_message.guest_query_id, {
            type: "article",
            id: "err",
            title: "svault bot",
            input_message_content: { message_text: "Something broke\\, try again in a bit\\." },
          });
        } catch {}
      }
      return new Response("ok", { status: 200 });
    }

    const msg = update.message || update.edited_message;

    if (!msg || !msg.text) {
      return new Response("ok", { status: 200 });
    }

        let text = msg.text.trim();

        // Remember every chat the bot sees, so the owner can DM /smessage -all
        // and reach all groups this bot is a member of.
        try {
          await rememberChat(msg.chat.id, msg.chat.type, msg.chat.title);
        } catch {}

        // Group usage: "@selenevaultbot /sadd ..." — strip a leading mention
        // of this bot so the rest parses as a normal command.
        const selfMention = "@" + String(env.BOT_USERNAME || "").toLowerCase();
        if (selfMention !== "@" && text.toLowerCase().startsWith(selfMention)) {
          text = text.slice(selfMention.length).trim();
        }

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

const isCommand = text.startsWith("/s") || text.toLowerCase().startsWith("/isthisonsv") || text.toLowerCase().startsWith("/vault") || text.toLowerCase().startsWith("/p") || text.toLowerCase().startsWith("/c");
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
          let isAdmin = false;
          let ownerFlag = false;
          if (isOwner(env, msg.from.id)) {
            isAdmin = true;
            ownerFlag = true;
          } else {
            try {
              const member = await getChatMember(env.TELEGRAM_BOT_TOKEN, msg.chat.id, msg.from.id);
              isAdmin = member.ok && (member.result.status === "administrator" || member.result.status === "creator");
            } catch {}
          }
          const threshold = ownerFlag ? 0.85 : isAdmin ? 0.65 : 0.35;
          const roll = Math.random();
          if (roll < threshold) {
            if (roll < threshold / 2) {
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

    if (command === "/p" || command === "/c") {
      const photoUrl =
        command === "/p"
          ? "https://raw.githubusercontent.com/jzadl/selenevault/main/bot/assets/p.jpg"
          : "https://raw.githubusercontent.com/jzadl/selenevault/main/bot/assets/preview.webp";
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, msg.chat.id, photoUrl, {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/start") {
      await replyTo(env, msg, welcomeText(), {
        replyToMessageId: msg.message_id,
        replyMarkup: vaultButton(env),
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/vault") {
      const vaultUrl = (env.SITE_URL || "https://svault.jzadl.xyz") + "/app";
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Tap below to open the vault mini app\\.", {
        replyToMessageId: msg.message_id,
        replyMarkup: { inline_keyboard: [[{ text: "Open Vault", web_app: { url: vaultUrl } }]] },
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/schecklinks") {
      if (!isOwner(env, msg.from.id)) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Only the owner can use this\\.", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Checking all links, I'll report personally when done\\.", {
        replyToMessageId: msg.message_id,
      });
      let statusId = null;
      try {
        const statusSend = await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Checking links: starting…", { parseMode: null });
        statusId = statusSend && statusSend.result ? statusSend.result.message_id : null;
      } catch {}
      let lastEdit = 0;
      const onProgress = async (done, total) => {
        const now = Date.now();
        if (!statusId || now - lastEdit < 5000) return;
        lastEdit = now;
        await editMessageText(env.TELEGRAM_BOT_TOKEN, msg.chat.id, statusId,
          `Checking links: ${done}/${total}…`, { parseMode: null }).catch(() => {});
      };
      runLinkCheck(env, null, { onProgress }).then(
        (res) => {
          console.log(`linkcheck done: ${res.checked} checked, ${res.problems} problems`);
          const text = `Checked ${res.checked} links: ${res.problems} need attention.`;
          if (statusId) {
            editMessageText(env.TELEGRAM_BOT_TOKEN, msg.chat.id, statusId, text, { parseMode: null }).catch(() => {});
          } else {
            sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, text, { parseMode: null }).catch(() => {});
          }
        },
        (err) => {
          console.error("linkcheck failed:", err?.message || err);
          sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Link check failed.", { parseMode: null }).catch(() => {});
        }
      );
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

    if (command === "/shelp" || command === "/sstart") {
      let helpText;
      try {
        helpText = await handleCommand(env, command, "");
      } catch {}
      helpText = helpText || "Something broke on my end, try again in a bit\\.";
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, helpText, {
        replyToMessageId: msg.message_id,
      });
      return new Response("ok", { status: 200 });
    }

    if (command === "/isthisonsv") {
      const replyMsg = msg.reply_to_message;
      const replyText = replyMsg ? (replyMsg.text || replyMsg.caption || "") : "";
      if (replyText) {
        if (msg.chat.type === "private") {
          try {
            await sendMessageDraft(env.TELEGRAM_BOT_TOKEN, msg.chat.id, 1, "Searching svault...");
          } catch {}
        } else {
          try {
            await sendChatAction(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "typing");
          } catch {}
        }
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
      if (!isOwner(env, msg.from.id)) {
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
      if (!isOwner(env, msg.from.id)) {
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
        // Every group/channel the bot has seen, plus any explicit IDs in env.
        let known = [];
        try {
          known = await knownChatIds();
        } catch {}
        const envIds = String(env.TELEGRAM_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
        const ids = [...new Set([...known.map(String), ...envIds])];
        if (ids.length === 0) {
          await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id,
            "I haven't seen any group chats yet, so `-all` has nowhere to send\\. Use the bot in a group once, or set `TELEGRAM_CHAT_IDS`\\.", {
              replyToMessageId: msg.message_id,
            });
          return new Response("ok", { status: 200 });
        }
        let sent = 0;
        for (const cid of ids) {
          const res = await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, rest).catch(() => null);
          if (res && res.ok) {
            sent++;
          } else {
            const retry = await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, rest, { parseMode: null }).catch(() => null);
            if (retry && retry.ok) sent++;
          }
        }
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id,
          "Sent to " + sent + "/" + ids.length + " chats\\.", {
            replyToMessageId: msg.message_id,
          });
        return new Response("ok", { status: 200 });
      }
      const messageSend = await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, arg);
      if (!messageSend.ok) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, arg, { parseMode: null });
      }
      return new Response("ok", { status: 200 });
    }

    if (command === "/ssubscribe" || command === "/sunsub" || command === "/ssubs") {
      try {
        await handleSubscribe(env, msg, command, arg);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
          replyToMessageId: msg.message_id,
        });
      }
      return new Response("ok", { status: 200 });
    }

    const needsAdmin = ["/sadd", "/supdate", "/sremove", "/strash", "/srestore"];
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

    if (command === "/slinkqueue") {
      if (!isOwner(env, msg.from.id)) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Only the owner can use this\\.", {
          replyToMessageId: msg.message_id,
        });
        return new Response("ok", { status: 200 });
      }
      try {
        await handleLinkQueue(env, msg);
      } catch (err) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Something broke: `" + escapeMdSafe(String(err.message || err)) + "`", {
          replyToMessageId: msg.message_id,
        });
      }
      return new Response("ok", { status: 200 });
    }

    if (command === "/strash" || command === "/srestore") {
      try {
        await handleTrash(env, msg, command, arg);
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
    if (streamable.includes(command)) {
      if (msg.chat.type === "private") {
        try {
          await sendMessageDraft(env.TELEGRAM_BOT_TOKEN, msg.chat.id, 1, "Searching svault...");
        } catch {}
      } else {
        try {
          await sendChatAction(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "typing");
        } catch {}
      }
    }

    let reply;
    try {
      if (command === "/sstats") {
        const rich = await cmdStatsRich(env, arg);
        const result = await sendRichMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, rich, {
          replyToMessageId: msg.message_id,
        });
        if (result.ok) return new Response("ok", { status: 200 });
      }
      reply = await handleCommand(env, command, arg);
    } catch (err) {
      reply = "Something broke on my end, try again in a bit\\.\n`" + escapeMdSafe(String(err)) + "`";
    }

    if (reply) {
      const chunks = splitMessage(reply);
      for (let i = 0; i < chunks.length; i++) {
        let result = await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, chunks[i], {
          replyToMessageId: i === 0 ? msg.message_id : undefined,
        });
        if (!result.ok) {
          result = await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, chunks[i], {
            replyToMessageId: i === 0 ? msg.message_id : undefined,
            parseMode: null,
          });
        }
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
    case "/shelp": {
      try {
        const local = await readLocalText(env, "help.txt");
        if (local) return local;
        const res = await fetch(env.CDN_BASE + "/help.txt");
        if (res.ok) return await res.text();
      } catch {}
      return HELP_TEXT;
    }
    case "/snews": {
      try {
        const local = await readLocalText(env, "update.txt");
        if (local) return local;
        const res = await fetch(env.CDN_BASE + "/update.txt");
        if (res.ok) return await res.text();
      } catch {}
      return "SNews cannot be reached, it might be the CDN lag\\.";
    }
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

const GUEST_COMMANDS = ["/start", "/shelp", "/sstart", "/snews", "/slatest", "/sstats", "/ssearch", "/schannels", "/sping", "/isthisonsv"];

async function replyForCommand(env, command, arg, ctxMsg) {
  if (command === "/start") {
    const vaultUrl = (env.SITE_URL || "https://svault.jzadl.xyz") + "/app";
    return welcomeText() + "\n\nOpen the vault: " + vaultUrl;
  }
  if (command === "/sping") {
    return await cmdPing(env, null, ctxMsg);
  }
  if (command === "/isthissonsv") {
    const replyMsg = ctxMsg ? ctxMsg.reply_to_message : null;
    const replyText = replyMsg ? (replyMsg.text || replyMsg.caption || "") : "";
    return replyText ? await cmdIsThisOnSv(env, replyText) : "Reply to a message with a ROM\\/kernel\\/port name, then mention the bot: `@selenevaultbot /isthissonsv`\\.";
  }
  return handleCommand(env, command, arg);
}

async function buildInlineCommandResults(env, query) {
  const tokens = query.split(/\s+/);
  const command = (tokens[0] || "").split("@")[0].toLowerCase();
  const arg = tokens.slice(1).join(" ");

  if (!command || !GUEST_COMMANDS.includes(command)) {
    const lines = [];
    if (!command) {
      lines.push("Mention the bot with a command in any chat\\, e\\.g\\. `@selenevaultbot /slatest`\\.");
    } else {
      lines.push("`" + escapeMdSafe(command) + "` is not supported inline\\.");
    }
    lines.push("", "Try: " + GUEST_COMMANDS.map((c) => "`" + c + "`").join(" "));
    return [{
      type: "article",
      id: "inline-unknown",
      title: command ? command : "svault commands",
      description: command ? "Not supported inline" : "Search or run a command",
      input_message_content: { message_text: lines.join("\n"), parse_mode: "MarkdownV2" },
    }];
  }

  let reply;
  try {
    reply = await replyForCommand(env, command, arg, null);
  } catch (err) {
    reply = "Something broke on my end, try again in a bit\\.";
  }
  if (!reply) return [];

  return [{
    type: "article",
    id: "inline-cmd",
    title: command,
    description: (reply || "").replace(/[*_`\\[\]()]/g, "").slice(0, 100),
    input_message_content: { message_text: reply, parse_mode: "MarkdownV2" },
  }];
}

async function handleGuestMessage(env, gmsg) {
  const queryId = gmsg.guest_query_id;
  if (!queryId) return;

  let text = (gmsg.text || "").trim();
  const mention = "@" + (env.BOT_USERNAME || "selenevaultbot");
  if (text.toLowerCase().startsWith(mention.toLowerCase())) {
    text = text.slice(mention.length).trim();
  }

  const tokens = text.split(/\s+/);
  let command = (tokens[0] || "").split("@")[0].toLowerCase();
  const arg = tokens.slice(1).join(" ");

  const sendReply = async (reply) => {
    const result = {
      type: "article",
      id: "guest",
      title: command || "svault bot",
      input_message_content: {
        message_text: reply,
        parse_mode: "MarkdownV2",
      },
    };
    let res = await answerGuestQuery(env.TELEGRAM_BOT_TOKEN, queryId, result);
    if (!res.ok) {
      delete result.input_message_content.parse_mode;
      res = await answerGuestQuery(env.TELEGRAM_BOT_TOKEN, queryId, result);
    }
    return res;
  };

  if (!command || !GUEST_COMMANDS.includes(command)) {
    const lines = [];
    if (!command) {
      lines.push("Mention the bot with a command in any chat\\, e\\.g\\. `@selenevaultbot /slatest`\\.");
    } else if (["/sadd", "/supdate", "/sremove"].includes(command)) {
      // Entry management needs the bot inside the chat (reply context + dialog).
      lines.push("`" + escapeMdSafe(command) + "` doesn't work in guest chats\\ — I'm not in this chat\\.");
      lines.push("", "Add @" + escapeMd(env.BOT_USERNAME || "selenevaultbot") + " to the group as a member, then reply to a post with `" + escapeMdSafe(command) + "`\\.");
      return sendReply(lines.join("\n"));
    } else {
      lines.push("`" + escapeMdSafe(command) + "` is not supported in guest chats\\.");
    }
    lines.push("", "Try: " + GUEST_COMMANDS.map((c) => "`" + c + "`").join(" "));
    return sendReply(lines.join("\n"));
  }

  let reply;
  try {
    reply = await replyForCommand(env, command, arg, gmsg);
  } catch (err) {
    reply = "Something broke on my end, try again in a bit\\.";
  }
  if (!reply) return;
  return sendReply(reply);
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
    await deleteStatus(env, chatId, msg.from.id, status);
    await replyTo(env, msg, "Couldn't parse that: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
    return;
  }
  if (!parsed.date) {
    const fallback = msgDateStr(msg);
    if (fallback) parsed.date = fallback;
  }
  await deleteStatus(env, chatId, msg.from.id, status);

  const { file, block } = toSmanBlock(parsed);

  let linkVerdict = "";
  if (parsed.url && /^https?:\/\//i.test(parsed.url)) {
    try {
      const probe = await probeUrl(parsed.url);
      linkVerdict = probe.state === "alive"
        ? "\nLink check: alive \\(HTTP " + escapeMd(probe.reason.replace(/^HTTP /, "")) + "\\)"
        : "\nLink check: *" + escapeMd(probe.state === "dead" ? "DEAD" : "UNCLEAR") + "* \\(`" + escapeMd(probe.reason) + "`\\) — double\\-check the URL before confirming\\.";
    } catch {
      linkVerdict = "";
    }
  }

  let dupeWarning = "";
  try {
    dupeWarning = await findDuplicateWarning(env, file, parsed);
  } catch {}

  const preview = [
    "Is this correct?:",
    "",
    "File: `" + escapeMd(file) + "`",
    "```",
    block,
    "```",
    linkVerdict,
    dupeWarning,
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
    await deleteStatus(env, msg.chat.id, msg.from.id, status);
    await replyTo(env, msg, "Couldn't merge that: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
    return;
  }
  if (!merged.date) {
    const fallback = msgDateStr(msg);
    if (fallback) merged.date = fallback;
  }
  await deleteStatus(env, msg.chat.id, msg.from.id, status);

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
  await notifyChats(env, notifyText);
  await announceToSubscribers(env, msg, file, notifyText);

  const doneText = "Added\\! " + escapeMd(name) + " is live on svault\\.jzadl\\.xyz";
  await replyTo(env, msg, doneText, { replyToMessageId: isNewMessage ? msg.message_id : undefined });
}

async function handleSubscribe(env, msg, command, arg) {
  const chatId = msg.chat.id;
  const validCats = Object.keys(CATEGORY_FILES);

  if (command === "/ssubs") {
    const subs = await subList(chatId).catch(() => []);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      subs.length
        ? "Subscriptions in this chat:\n" + subs.map((c) => "`" + c + "`").join(" ")
        : "No subscriptions in this chat\\. Use /ssubscribe \\[categories\\.\\.\\.\\] or /ssubscribe all\\.",
      { replyToMessageId: msg.message_id });
    return;
  }

  const wants = String(arg || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (command === "/sunsub" && wants.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      "Usage: /sunsub \\[category\\.\\.\\.\\] or /sunsub all",
      { replyToMessageId: msg.message_id });
    return;
  }
  const cats = (wants.length === 0 || wants.includes("all")) ? validCats : wants;
  const unknown = cats.filter((c) => !CATEGORY_FILES[c]);
  if (unknown.length > 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      "Unknown categor" + (unknown.length > 1 ? "ies" : "y") + ": " + unknown.map((c) => "`" + escapeMdSafe(c) + "`").join(" ") +
      "\nValid: " + validCats.join(" "),
      { replyToMessageId: msg.message_id });
    return;
  }

  for (const cat of cats) {
    if (command === "/ssubscribe") await subAdd(chatId, cat).catch(() => {});
    else await subRemove(chatId, cat).catch(() => {});
  }
  const verb = command === "/ssubscribe" ? "Subscribed" : "Unsubscribed";
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    verb + ": " + cats.map((c) => "`" + c + "`").join(" "),
    { replyToMessageId: msg.message_id });
}

// New-build announcements to subscribed chats (skips the origin chat and
// the broadcast channels, which already got the message).
async function announceToSubscribers(env, msg, file, text) {
  try {
    const cat = Object.entries(CATEGORY_FILES).find(([, v]) => v === file)?.[0];
    if (!cat) return;
    const channels = new Set(String(env.TELEGRAM_CHAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean));
    const chats = await subChats(cat);
    for (const cid of chats) {
      if (String(cid) === String(msg.chat.id) || channels.has(String(cid))) continue;
      await sendMessage(env.TELEGRAM_BOT_TOKEN, cid, text).catch(() => {});
    }
    } catch {}
}

// Warn when the parsed entry looks like a duplicate: same name+maintainer
// in the target file, or the same URL anywhere in the vault.
async function findDuplicateWarning(env, file, parsed) {
  const norm = (s) => (s || "").trim().toLowerCase();
  const name = norm(parsed.name);
  const maintainer = norm(parsed.maintainer);
  const url = (parsed.url || "").trim();
  if (!name && !url) return "";

  const files = [...new Set([...Object.values(CATEGORY_FILES), file])];
  const hits = [];
  for (const f of files) {
    let content;
    try {
      ({ content } = await getFileContent(env, f));
    } catch {
      continue;
    }
    const { entries } = parseSman(content);
    for (const e of entries) {
      if (name && norm(e.name) === name && maintainer && norm(e.maintainer) === maintainer && f === file) {
        hits.push(`Possible duplicate of *${escapeMd(e.name)}*${e.date ? ` \\(${escapeMd(e.date)}\\)` : ""} in \`${escapeMd(f)}\``);
        break;
      }
      if (url && (e.url || "").trim() === url) {
        hits.push("Same URL already listed in `" + escapeMd(f) + "`: *" + escapeMd(e.name || "entry") + "*");
        break;
      }
    }
    if (hits.length >= 2) break;
  }
  if (hits.length === 0) return "";
  return "\n⚠ " + hits.join("\n⚠ ");
}

async function handleLinkQueue(env, msg) {
  const rows = await listLinkcheck(null, null).catch(() => []);
  if (rows.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Link queue is empty\\. Nothing awaits action\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }
  let dead = 0;
  const perFile = {};
  for (const row of rows) {
    let d = {};
    try {
      d = JSON.parse(row.data);
    } catch {}
    if (d.state === "dead") dead++;
    perFile[row.file] = (perFile[row.file] || 0) + 1;
  }
  const lines = [
    `*Link queue:* ${rows.length} pending`,
    "",
    `Dead: ${dead} \\- needs review: ${rows.length - dead}`,
    "",
    ...Object.entries(perFile).map(([f, n]) => "`" + escapeMd(f) + "`: " + n),
  ];
  await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, lines.join("\n"), {
    replyToMessageId: msg.message_id,
  });
}

async function handleTrash(env, msg, command, arg) {
  if (command === "/strash") {
    const items = await listTrash(env).catch(() => []);
    if (items.length === 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Trash is empty\\.", {
        replyToMessageId: msg.message_id,
      });
      return;
    }
    const n = Math.min(parseInt(String(arg).trim(), 10) || 10, 30);
    const lines = [`*Trash \\(last ${Math.min(n, items.length)}\\):*`, ""];
    items.slice(-n).reverse().forEach((it, i) => {
      const when = it.removedAt ? ", " + it.removedAt : "";
      lines.push(i + 1 + "\\. *" + escapeMd(it.name) + "* (" + escapeMd(it.file) + escapeMd(when) + ")");
    });
    lines.push("", "Restore with /srestore \\[name\\]\\.");
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, lines.join("\n"), {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  // /srestore
  const query = String(arg || "").trim().toLowerCase();
  if (!query) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Usage: /srestore \\[name\\]", {
      replyToMessageId: msg.message_id,
    });
    return;
  }
  const items = await listTrash(env).catch(() => []);
  const matches = items.filter((it) => it.name.toLowerCase().includes(query));
  if (matches.length === 0) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, "Nothing matching *" + escapeMd(query) + "* in trash\\.", {
      replyToMessageId: msg.message_id,
    });
    return;
  }
  if (matches.length > 1) {
    const lines = ["*Multiple matches, be more specific:*", ""];
    matches.slice(0, 10).forEach((it) => {
      lines.push(`*${escapeMd(it.name)}* \\(${escapeMd(it.file)}\\)`);
    });
    await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, lines.join("\n"), {
      replyToMessageId: msg.message_id,
    });
    return;
  }
  const it = matches[0];
  try {
    await restoreTrashEntry(env, it.file, it.block, "RESTORE: " + it.name + " to " + it.file);
  } catch (err) {
    await replyTo(env, msg, "Restore failed: " + escapeMdSafe(String(err.message || err)), { replyToMessageId: msg.message_id });
    return;
  }
  await replyTo(env, msg, "Restored\\! *" + escapeMd(it.name) + "* is back in `" + escapeMd(it.file) + "`", { replyToMessageId: msg.message_id });
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
    await notifyChats(env, notifyText);

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
  await notifyChats(env, notifyText);

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
    await notifyChats(env, notifyText);

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
