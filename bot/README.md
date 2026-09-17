# svault-bot

Cloudflare Worker powering the svault Telegram bot. Handles slash commands over a webhook and reads live data from the .sman files via jsDelivr.

## Commands

- `/latest [category]` - newest addition, optionally filtered by category
- `/stats [category]` - entry counts, optionally filtered by category
- `/search [category] query` - search entries by name
- `/channels` - list known community channels
- `/help` - list commands

Categories: `rom`, `kernel`, `recovery`, `firmware`, `port`, `tool`, `guide`

## Setup

1. Install wrangler and log in to Cloudflare.

```
npm install -g wrangler
wrangler login
```

2. Set the bot token as a secret.

```
wrangler secret put TELEGRAM_BOT_TOKEN
```

3. Deploy.

```
wrangler deploy
```

4. Point the Telegram webhook at the deployed Worker URL.

```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>"
```

## Notes

- `CDN_BASE` and `SITE_URL` are set in `wrangler.toml` under `[vars]`.
- The bot only reacts to messages starting with `/`. Everything else is ignored.
- `/add` with Groq parsing is not implemented yet.
