import { sendMessage } from "./telegram.js";
import { cmdLatest, cmdStats, cmdSearch, cmdChannels, cmdIsThisOnSv } from "./commands.js";

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
    if (request.method !== "POST") {
      return new Response("svault bot is alive", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    const msg = update.message;
    if (!msg || !msg.text) {
      return new Response("ok", { status: 200 });
    }

    if (msg.chat.type !== "private") {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        "5722152704",
        `DEBUG: got group message\\. chat\\_id=${escapeMdSafe(String(msg.chat.id))} chat\\_type=${escapeMdSafe(msg.chat.type)} text=${escapeMdSafe(msg.text.slice(0, 100))}`
      );
    }

    const text = msg.text.trim();
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
