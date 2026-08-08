# selenevault

Community index of ROMs, kernels, recoveries, firmware, ports, tools, guides, and
Telegram channels for the **Xiaomi Redmi 10** (codename `selene`).

Built from years of pinned messages scattered across Telegram groups, put into one
searchable place.

Live at [selenevault.pages.dev](#)

## Format: `.sman`

Here is a example of how the .sman format works:

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

Each block is separated by a blank line. Fields are optional and vary a bit by
category (e.g. `guides.sman` and `channels.sman` skip `version`/`size`/`date`).

| File             | What's in it                              |
|------------------|--------------------------------------------|
| `rom.sman`       | Full Android OS builds                     |
| `kernels.sman`   | Custom kernels                             |
| `recovery.sman`  | Custom recoveries (TWRP, PBRP, OrangeFox…) |
| `firmware.sman`  | Stock/engineering firmware                 |
| `ports.sman`     | Ports from other devices                   |
| `tools.sman`     | Utilities and MIUI mods                    |
| `guides.sman`    | How-tos and tutorials                      |
| `channels.sman`  | Telegram channels and groups               |

## Parser

`sman-parser.js` exposes `parseSman(text)` and `esc(str)`. Works in-browser or
under Node (`require('./sman-parser.js')`).

```js
const { parseSman } = require('./sman-parser.js');
const { about, entries } = parseSman(fs.readFileSync('rom.sman', 'utf-8'));
```

## Running locally

`fetch()` can't read local files over `file://`, so serve the folder instead of
opening `index.html` directly:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Contributing

Found a ROM/kernel/recovery/etc that's missing? Open a PR adding a block to the
relevant `.sman` file, or drop it in the Telegram group and it'll get added.
