// Node entrypoint: serves the Telegram webhook on this server.
// The Worker handler (src/index.js) is reused as-is via the fetch API
// (Node >= 20 provides global Request/Response).
//
// Secrets live ONLY in bot/.env (same directory). Real process env overrides.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import handler from "./src/index.js";
import { runLinkCheck } from "./src/linkcheck.js";

const BOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOTENV_PATH = path.join(BOT_DIR, ".env");

function parseDotenv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function loadEnv() {
  let fileEnv = {};
  try {
    fileEnv = parseDotenv(await readFile(DOTENV_PATH, "utf-8"));
  } catch (err) {
    console.error("cannot read bot/.env:", err.message);
  }
  const env = { ...fileEnv, ...process.env };
  env.PORT = env.PORT || "8087";
  env.REPO_ROOT = env.REPO_ROOT || "/home/main/projects/selenevault";
  env.SITE_URL = env.SITE_URL || "https://svault.jzadl.xyz";
  env.BOT_USERNAME = env.BOT_USERNAME || "selenevaultbot";
  env.GITHUB_API_BASE = env.GITHUB_API_BASE || "https://api.github.com/repos/jzadl/selenevault";
  return env;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const env = await loadEnv();
const PORT = Number(env.PORT) || 8087;
const SECRET = env.TELEGRAM_WEBHOOK_SECRET || "";

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const isBotPath = url.pathname === "/bot" || url.pathname.startsWith("/bot/");

    if (req.method === "GET" && !isBotPath) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("svault bot is alive (node)\n");
      return;
    }

    if (!isBotPath) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return;
    }

    if (SECRET && req.method === "POST") {
      const got = req.headers["x-telegram-bot-api-secret-token"];
      if (got !== SECRET) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("forbidden\n");
        return;
      }
    }

    const body = await readBody(req);
    const fetchReq = new Request(`http://local${url.pathname}${url.search}`, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] || "application/json" },
      body: body.length && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
    });

    const ctx = { waitUntil(p) { Promise.resolve(p).catch((e) => console.error("waitUntil:", e?.message || e)); } };
    const fetchRes = await handler.fetch(fetchReq, env, ctx);
    const outBody = Buffer.from(await fetchRes.arrayBuffer());
    res.writeHead(fetchRes.status, { "content-type": fetchRes.headers.get("content-type") || "text/plain" });
    res.end(outBody);
  } catch (err) {
    console.error("server error:", err?.message || err);
    try {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
    } catch {}
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`svault-bot listening on 127.0.0.1:${PORT}`);
});

// Daily dead-link check (all categories). Notifies owners only on problems.
const LINKCHECK_INTERVAL_MS = Number(env.LINKCHECK_INTERVAL_HOURS || 24) * 60 * 60 * 1000;
let linkcheckRunning = false;
setInterval(async () => {
  if (linkcheckRunning) return;
  linkcheckRunning = true;
  try {
    await webhookHealth(env);
    const res = await runLinkCheck(env, null);
    console.log(`scheduled linkcheck: ${res.checked} checked, ${res.problems} problems`);
  } catch (err) {
    console.error("scheduled linkcheck failed:", err?.message || err);
  } finally {
    linkcheckRunning = false;
  }
}, LINKCHECK_INTERVAL_MS);

// Daily webhook sanity check: surfaces delivery backlogs/errors in the log.
async function webhookHealth(env) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    const info = (await res.json()).result || {};
    console.log(`webhook health: pending=${info.pending_update_count ?? "?"} err=${info.last_error_message || "none"}`);
  } catch (err) {
    console.error("webhook health check failed:", err?.message || err);
  }
}
