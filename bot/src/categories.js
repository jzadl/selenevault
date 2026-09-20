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

export const CATEGORY_FIELDS = {
  rom: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  kernel: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  recovery: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  firmware: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  port: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  tool: ["name", "version", "maintainer", "size", "date", "url", "note"],
  guide: ["name", "url", "note"],
  channel: ["name", "url", "note"],
};

export const CATEGORY_REQUIRED = {
  rom: ["name", "maintainer", "url", "size", "vendor"],
  kernel: ["name", "maintainer", "url", "size", "vendor"],
  recovery: ["name", "maintainer", "url", "size", "vendor"],
  firmware: ["name", "maintainer", "url", "size", "vendor"],
  port: ["name", "maintainer", "url", "size", "vendor"],
  tool: ["name", "maintainer", "url"],
  guide: ["name", "url"],
  channel: ["name", "url"],
};

export const CATEGORY_TARGET_FILES = { ...CATEGORY_FILES };

export const FILE_LIST = Object.values(CATEGORY_FILES);

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
