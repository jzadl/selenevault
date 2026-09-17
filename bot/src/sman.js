export function parseSman(text) {
  const lines = text.split("\n");
  let about = "";
  const entries = [];
  let entry = null;
  let inContent = false;
  let contentLines = [];
  let lastKey = null;

  function flushContent() {
    if (entry && inContent) {
      entry.content = contentLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    inContent = false;
    contentLines = [];
  }
  function push() {
    flushContent();
    if (entry && entry.name) entries.push(entry);
    entry = null;
    lastKey = null;
  }

  for (const raw of lines) {
    if (inContent) {
      if (raw.match(/^\s+\S/) || raw.trim() === "") {
        contentLines.push(raw.replace(/^  /, ""));
        continue;
      }
      flushContent();
    }
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) {
      if (raw.match(/^\s+\S/) && entry && lastKey) {
        entry[lastKey] += " " + line;
      }
      continue;
    }
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    if (key === "about" && !entry) { about = val; continue; }
    if (key === "name") { push(); entry = { name: val }; lastKey = "name"; continue; }
    if (key === "content") { inContent = true; contentLines = []; lastKey = "content"; continue; }
    if (entry) { entry[key] = val; lastKey = key; }
  }
  push();
  return { about, entries };
}

export const CATEGORY_FILES = {
  rom: "rom.sman",
  kernel: "kernels.sman",
  recovery: "recovery.sman",
  firmware: "firmware.sman",
  port: "ports.sman",
  tool: "tools.sman",
  guide: "guides.sman",
  channel: "channels.sman",
};

export const CATEGORY_LABELS = {
  rom: "ROM",
  kernel: "Kernel",
  recovery: "Recovery",
  firmware: "Firmware",
  port: "Port",
  tool: "Tool",
  guide: "Guide",
  channel: "Channel",
};
