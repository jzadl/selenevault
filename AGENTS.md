# AGENTS.md — selenevault

## ОБЯЗАТЕЛЬНЫЙ РИТУАЛ (каждый раз, без исключений)

Перед ЛЮБЫМ изменением кода/конфигов:

```bash
git pull --rebase origin main
```

После ЛЮБОГО изменения:

```bash
git add -A
git commit -m "<что сделано>"
git push origin main
```

Без «потом залью», без накопления изменений в worktree. Сделал → закоммитил → запушил → сообщил.

## Что где лежит

* `/` — лендинг (`index.html`), `/app` — Telegram WebApp (`app/index.html`),
  `*.sman` — данные (читаются обоими фронтами).
* `bot/server.js` — Node-обёртка над webhook-хендлером (`src/index.js`).
* `bot/src/db.js` — Postgres (`pending_ops`), замена Supabase.
* `bot/src/github.js` — чтение/запись `.sman` + `git commit/push`.
  Git-авторизация — через `gh auth git-credential` (не PAT!).
* Секреты — ТОЛЬКО в `bot/.env` (gitignored). Никуда не копировать,
  в код/коммиты/логи не печатать.

## Инфраструктура (этот сервер)

* Caddy: `/etc/caddy/Caddyfile`, сайт `svault.jzadl.xyz`
  (`/bot*` → `127.0.0.1:8087`, остальное — `file_server` из корня репо).
  После правок: `caddy validate` + `systemctl reload caddy`.
  Без `X-Frame-Options` — иначе Telegram WebApp не откроется во фрейме.
* Бот: `svault-bot.service` (`EnvironmentFile=bot/.env`).
  После правок кода бота: `systemctl restart svault-bot` + проверка
  `journalctl -u svault-bot`.
* Postgres 17: БД `svault`, таблица `pending_ops` (см. `supabase-migrations/`).
* Cloudflare Worker и Supabase НЕ используются. Workflow деплоя отключён
  (`deploy-bot.yml.disabled`).

## Проверки после изменений

* Статика: `curl https://svault.jzadl.xyz/app/` → 200.
* Бот: `curl https://svault.jzadl.xyz/bot` → `alive`, в Telegram — `/sping`.
* Webhook: `getWebhookInfo` → `pending_update_count: 0`, без `last_error`.
