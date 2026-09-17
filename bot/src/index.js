import { sendMessage } from "./telegram.js";
import { cmdLatest, cmdStats, cmdSearch, cmdChannels } from "./commands.js";

const HELP_TEXT = [
  "*svault bot commands:*",
  "",
  "/latest \\[category\\] \\- newest addition",
  "/stats \\[category\\] \\- entry counts",
  "/search \\[category\\] query \\- find an entry",
  "/channels \\- community channels",
  "",
  "Categories: rom, kernel, recovery, firmware, port, tool, guide",
].join("\n");

async function handleCommand(env, command, arg) {
  switch (command) {
    case "/start":
    case "/help":
      return HELP_TEXT;
    case "/latest":
      return cmdLatest(env, arg ? arg.toLowerCase() : null);
    case "/stats":
      return cmdStats(env, arg ? arg.toLowerCase() : null);
    case "/search":
      return cmdSearch(env, arg);
    case "/channels":
      return cmdChannels(env);
    default:
      return null;
  }
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

    const text = msg.text.trim();
    if (!text.startsWith("/")) {
      return new Response("ok", { status: 200 });
    }

    const spaceIdx = text.indexOf(" ");
    let command = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
    const arg = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();

    command = command.split("@")[0].toLowerCase();

    let reply;
    try {
      reply = await handleCommand(env, command, arg);
    } catch (err) {
      reply = "Something broke on my end, try again in a bit\\.";
    }

    if (reply) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, msg.chat.id, reply);
    }

    return new Response("ok", { status: 200 });
  },
};
