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

export const CATEGORY_PLURALS = {
  rom: "ROMs",
  kernel: "Kernels",
  recovery: "Recoveries",
  firmware: "Firmware",
  port: "Ports",
  tool: "Tools",
  guide: "Guides",
  channel: "Channels",
};

export const CATEGORY_FIELDS = {
  rom: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor", "android", "gapps", "issues"],
  kernel: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor", "android", "gapps", "issues"],
  recovery: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor", "android", "gapps", "issues"],
  firmware: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor", "android", "gapps", "issues"],
  port: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor", "android", "gapps", "issues"],
  tool: ["name", "version", "maintainer", "size", "date", "url", "note", "android", "gapps", "issues"],
  guide: ["name", "url", "note"],
  channel: ["name", "url", "note"],
};

export const CATEGORY_REQUIRED = {
  rom: ["name", "maintainer", "url", "size", "vendor", "android"],
  kernel: ["name", "maintainer", "url", "size", "vendor", "android"],
  recovery: ["name", "maintainer", "url", "size", "vendor", "android"],
  firmware: ["name", "maintainer", "url", "size", "vendor", "android"],
  port: ["name", "maintainer", "url", "size", "vendor", "android"],
  tool: ["name", "maintainer", "url"],
  guide: ["name", "url"],
  channel: ["name", "url"],
};

const FILE_NAME_PATTERNS = [
  ["rom", /roms?\.sman|^\s*rom\s*$/i],
  ["kernel", /kernels?\.sman|^\s*kernel\s*$/i],
  ["recovery", /recovery\.sman|^\s*recovery\s*$/i],
  ["firmware", /firmware\.sman|^\s*firmware\s*$/i],
  ["port", /ports?\.sman|^\s*port\s*$/i],
  ["tool", /tools?\.sman|^\s*tool\s*$/i],
  ["guide", /guides?\.sman|^\s*guide\s*$/i],
  ["channel", /channels?\.sman|^\s*channel\s*$/i],
];

export function fileToCategory(text) {
  if (!text) return null;
  for (const [category, pattern] of FILE_NAME_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return null;
}
