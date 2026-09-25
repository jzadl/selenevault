# selenevault

Community index of ROMs, kernels, recoveries, firmware, ports, tools, guides,
and Telegram channels for the **Xiaomi Redmi 10** (codename `selene`).

Live at **https://svault.jzadl.xyz** — landing page, searchable catalog, and
Telegram Mini App (`/app`) served straight from this repo. No build step,
no framework: static files plus a Telegram bot.

## Frontends

| URL | What it is |
|-----|------------|
| `/` | Landing + full searchable catalog |
| `/app` | Telegram Mini App (theme-aware, opens from the bot) |
| `/*.sman` | Raw data files, fetched by both frontends |

Search supports text query plus category / creator / vendor filters, shareable
via URL params (`?q=lineage&category=rom.sman`).

## Telegram bot — `@selenevaultbot`

Runs on our own server (Node + systemd, webhook at `/bot`), stores dialog
state in local Postgres, reads/writes `.sman` files directly via git.

| Command | Who | What it does |
|---------|-----|--------------|
| `/vault` | anyone | Open the Mini App (inline button) |
| `/slatest [category]` | anyone | Newest addition |
| `/sstats [category]` | anyone | Entry counts |
| `/ssearch [category] query` | anyone | Search (8+ hits → telegra.ph page) |
| `/isthisonsv` (reply) | anyone | Is this build in the vault? |
| `/schannels` | anyone | Community channels |
| `/snews` | anyone | Latest update message |
| `/sping` | anyone | Responsiveness check |
| `/sadd` (reply to a post) | admins | Add entry (Groq-assisted parsing) |
| `/supdate [category] [name]` | admins | Update an entry field |
| `/sremove [category] [name] [creator]` | admins | Remove an entry |

Categories: `rom`, `kernel`, `recovery`, `firmware`, `port`, `tool`, `guide`.

Extras: **guest mode** (`@selenevaultbot /slatest` in any chat, no need to add
the bot) and **inline mode** (`@selenevaultbot <query>` anywhere).

## Format: `.sman`

Plain-text blocks separated by a blank line. First line may carry
`about: <description>`, every entry starts with `name:`:

```
about: Full Android OS builds for selene.

name: LineageOS 20.0
version: 20.0-20250905
maintainer: jzadl
size: 1.3G
date: 2025-09-05
url: https://url.to.downlo.ad/thefile/
note: Android 13. R Vendor
```

Fields vary per category (`guide`/`channel` entries only use
`name`/`url`/`note`; the rest also use `version`, `maintainer`, `size`,
`date`, `vendor`). Lines starting with `#` are comments.

| File | What's in it |
|------|--------------|
| `rom.sman` | Full Android OS builds |
| `kernels.sman` | Custom kernels |
| `recovery.sman` | Custom recoveries (TWRP, PBRP, OrangeFox…) |
| `firmware.sman` | Stock/engineering firmware |
| `ports.sman` | Ports from other devices |
| `tools.sman` | Utilities and MIUI mods |
| `guides.sman` | How-tos and tutorials |
| `channels.sman` | Telegram channels and groups |

## Parser

`sman-parser.js` exposes `parseSman(text)` and `esc(str)`. Works in-browser
or under Node:

```js
const { parseSman } = require('./sman-parser.js');
const { about, entries } = parseSman(fs.readFileSync('rom.sman', 'utf-8'));
```

## Running locally

`fetch()` can't read local files over `file://`, so serve the folder instead
of opening `index.html` directly:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Contributing

* Found something missing? Open a PR adding a block to the relevant `.sman`
  file, or drop it in the Telegram group — an admin can add it via `/sadd`.
* See `AGENTS.md` for the mandatory sync/commit/push ritual and server notes.
