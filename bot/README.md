# svault-bot

Self-hosted Node Telegram bot for selenevault. Webhook at
`https://svault.jzadl.xyz/bot`, runs as the `svault-bot` systemd service,
stores dialog state in local Postgres (`pending_ops`), reads/writes `.sman`
files directly via git.

## Commands

| Command | Who | What it does |
|---------|-----|--------------|
| `/vault` | anyone | Open the Mini App (inline button) |
| `/slatest [category]` | anyone | Newest addition |
| `/sstats [category] [filters]` | anyone | Entry counts |
| `/ssearch [category] [filters] query` | anyone | Search entries |
| `/isthisonsv` (reply) | anyone | Is this build in the vault? |
| `/schannels` | anyone | Community channels |
| `/snews` | anyone | Latest update message |
| `/sping` | anyone | Responsiveness check |
| `/sadd` (reply to a post) | admins | Add entry (Groq-assisted parsing) |
| `/supdate [category] [name]` | admins | Update an entry field |
| `/sremove [category] [name] [creator]` | admins | Remove an entry |
| `/schecklinks` | owner | Check all download links, report with Keep/Delete buttons |

Filters: `by:name vendor:x date:2026 android:14 gapps:gapps`.
Example: `/ssearch rom by:hasan android:14 lineage`.

Categories: `rom`, `kernel`, `recovery`, `firmware`, `port`, `tool`, `guide`.

Extras: guest mode (`@selenevaultbot /slatest` in any chat) and inline mode
(`@selenevaultbot <query>` anywhere).

## Setup (this server)

Secrets live ONLY in `bot/.env` (see `.env.example`). Never commit them.

```bash
npm install
sudo cp svault-bot.service.example /etc/systemd/system/svault-bot.service
sudo systemctl daemon-reload && sudo systemctl enable --now svault-bot
```

Point the Telegram webhook at the server:

```bash
set -a; source bot/.env; set +a
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://svault.jzadl.xyz/bot&secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

## Layout

* `server.js` — HTTP entrypoint, loads `bot/.env`, daily linkcheck timer.
* `src/index.js` — webhook handler (commands, callbacks, guest/inline).
* `src/db.js` — Postgres helpers (`pending_ops`).
* `src/github.js` — `.sman` read/write + `git commit/push` (auth via `gh` CLI).
* `src/entrymeta.js` — Android/GApps/issues metadata + `field:value` filters.
* `src/linkcheck.js` — dead-link checker with Keep/Delete buttons.
* `src/groq.js` — post parsing for `/sadd`.

## Notes

* The bot only reacts to `/` commands, @mentions, replies it waits for
  (`pending_ops`), inline queries, and its own callback buttons.
* `notify-telegram.yml` relays GitHub `svault-notify` issues to Telegram chats.
