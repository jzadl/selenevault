# AGENTS.md — selenevault

## MANDATORY RITUAL (every time, no exceptions)

Before ANY code/config change:

```bash
git pull --rebase origin main
```

After ANY change:

```bash
git add -A
git commit -m "<what was done>"
git push origin main
```

No "I'll push later", no accumulating changes in the worktree.
Did it → committed it → pushed it → reported it.

## MANDATORY SERVICE RELOAD (after every push to git)

Pushing is not the last step. After `git push`, always reload what you changed
and verify it is alive:

```bash
# Bot code (bot/) changed:
sudo systemctl restart svault-bot
sudo systemctl is-active svault-bot
curl -s https://svault.jzadl.xyz/bot   # -> alive

# Caddyfile changed:
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
curl -sk -o /dev/null -w "%{http_code}\n" https://svault.jzadl.xyz/app/  # -> 200

# Static files (*.sman, index.html, app/) changed: no reload needed
# (Caddy serves them from disk), just curl-check the URL.
```

A change counts as done only when the running service serves it. Pushed but
not reloaded = not done.

## Language

All code comments and git commit messages — English only. No other languages
in comments or commits.

## Layout

* `/` — landing (`index.html`), `/app` — Telegram WebApp (`app/index.html`),
  `*.sman` — data (read by both frontends).
* `bot/server.js` — Node wrapper around the webhook handler (`src/index.js`).
* `bot/src/db.js` — Postgres (`pending_ops`), Supabase replacement.
* `bot/src/github.js` — `.sman` read/write + `git commit/push`.
  Git auth — via `gh auth git-credential` (not PAT!).
* Secrets — ONLY in `bot/.env` (gitignored). Never copy anywhere else,
  never print into code/commits/logs.

## Infrastructure (this server)

* Caddy: `/etc/caddy/Caddyfile`, site `svault.jzadl.xyz`
  (`/bot*` → `127.0.0.1:8087`, rest — `file_server` from repo root).
  After edits: `caddy validate` + `systemctl reload caddy`.
  No `X-Frame-Options` — otherwise the Telegram WebApp won't open in a frame.
* Bot: `svault-bot.service` (`EnvironmentFile=bot/.env`).
  After bot code edits: `systemctl restart svault-bot` + check
  `journalctl -u svault-bot`.
* Postgres 17: DB `svault`, table `pending_ops` (see `supabase-migrations/`).
* Cloudflare Worker and Supabase are NOT used. Deploy workflow is disabled
  (`deploy-bot.yml.disabled`).

## Checks after changes

* Static: `curl https://svault.jzadl.xyz/app/` → 200.
* Bot: `curl https://svault.jzadl.xyz/bot` → `alive`, in Telegram — `/sping`.
* Webhook: `getWebhookInfo` → `pending_update_count: 0`, no `last_error`.
