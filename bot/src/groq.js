const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

export const CATEGORY_TARGET_FILES = {
  rom: "rom.sman",
  kernel: "kernels.sman",
  recovery: "recovery.sman",
  firmware: "firmware.sman",
  port: "ports.sman",
  tool: "tools.sman",
  guide: "guides.sman",
  channel: "channels.sman",
};

const CATEGORY_FIELD_ORDER = {
  rom: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  kernel: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  recovery: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  firmware: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  port: ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
  tool: ["name", "version", "maintainer", "size", "date", "url", "note"],
  guide: ["name", "url", "note"],
  channel: ["name", "url", "note"],
};

const REQUIRED_FIELDS = {
  rom: ["name", "maintainer", "url", "size", "vendor"],
  kernel: ["name", "maintainer", "url", "size", "vendor"],
  recovery: ["name", "maintainer", "url", "size", "vendor"],
  firmware: ["name", "maintainer", "url", "size", "vendor"],
  port: ["name", "maintainer", "url", "size", "vendor"],
  tool: ["name", "maintainer", "url"],
  guide: ["name", "url"],
  channel: ["name", "url"],
};

const FIELD_LABELS = {
  name: "name",
  version: "version",
  maintainer: "maintainer",
  size: "size",
  date: "date",
  url: "download link",
  note: "note",
  vendor: "vendor",
};

export function findMissingFields(parsed) {
  const category = parsed.category || "rom";
  const required = REQUIRED_FIELDS[category] || REQUIRED_FIELDS.rom;
  return required.filter((field) => {
    const value = parsed[field];
    return value === null || value === undefined || value === "";
  });
}

const SYSTEM_PROMPT = `You extract structured data from Telegram posts about Android ROM/kernel/port/recovery releases for the Xiaomi Redmi 10 (selene).

Output ONLY a JSON object, no markdown, no explanation, no code fences. The JSON must have these exact keys:

{
  "category": one of "rom", "kernel", "recovery", "firmware", "port", "tool", "guide". "firmware" means raw baseband/modem/bootloader firmware files, NOT HyperOS or MIUI builds. Any HyperOS, MIUI, or other modified/reskinned Android OS build is "port", never "firmware". A from-source custom ROM (LineageOS, CherishOS, etc) is "rom". A standalone kernel release is "kernel".,
  "name": the release name, without version numbers or dates,
  "version": the version string as written in the post,
  "maintainer": the author's name or Telegram handle, without the @ symbol,
  "size": file size as written (e.g. "1.5G", "13.9mb"), or null if not mentioned,
  "date": ISO format YYYY-MM-DD. If the post gives a date as DD/MM/YY (day/month/2-digit-year, common in these posts, e.g. "Build date:18/09/26"), convert it to 20YY-MM-DD, so "18/09/26" becomes "2026-09-18". Do not swap day and month, do not misread the year.,
  "url": the download link, or null if not present,
  "note": a short one or two sentence summary of the changelog or key details, plain text, no markdown,
  "vendor": "rvendor" for Android 11-12 / MIUI 12.5, "svendor" for Android 13+ / MIUI 13+ / HyperOS, or null if not determinable
}

If a field cannot be determined, use null. Never invent data. Keep "note" concise, focused on what changed or what is notable, not a full changelog dump. Use plain ASCII hyphens, never special unicode dashes.`;

const MERGE_SYSTEM_PROMPT = `You are given a partially filled JSON object describing an Android ROM/kernel/port release, plus a follow-up message from the person adding it that supplies missing details (like a download link or file size).

Update the JSON object with the new information. Keep every field that was already correct. Output ONLY the updated JSON object, same keys as before, no markdown, no explanation. Use plain ASCII hyphens, never special unicode dashes.`;

async function callGroq(apiKey, systemPrompt, userContent) {
  const payload = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

export async function parsePostWithGroq(apiKey, postText) {
  const raw = await callGroq(apiKey, SYSTEM_PROMPT, postText);
  return JSON.parse(raw);
}

export async function mergeWithGroq(apiKey, existingParsed, followUpText) {
  const userContent = `Existing data:\n${JSON.stringify(existingParsed)}\n\nFollow-up message:\n${followUpText}`;
  const raw = await callGroq(apiKey, MERGE_SYSTEM_PROMPT, userContent);
  return JSON.parse(raw);
}

export function toSmanBlock(parsed) {
  const category = parsed.category || "rom";
  const fields = CATEGORY_FIELD_ORDER[category] || CATEGORY_FIELD_ORDER.rom;
  const lines = [];
  for (const field of fields) {
    const value = parsed[field];
    if (value === null || value === undefined || value === "") continue;
    lines.push(`${field}: ${value}`);
  }
  return { category, file: CATEGORY_TARGET_FILES[category] || "rom.sman", block: lines.join("\n") };
}

export function summarizeParsed(parsed) {
  const { file, block } = toSmanBlock(parsed);
  return `File: ${file}\n\n${block}`;
}

export function missingFieldsMessage(parsed) {
  const missing = findMissingFields(parsed);
  if (missing.length === 0) return null;
  const labels = missing.map((f) => FIELD_LABELS[f] || f);
  const joined = labels.length === 1 ? labels[0] : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
  return `${joined} ${labels.length === 1 ? "is" : "are"} missing, please write ${labels.length === 1 ? "it" : "them"}!`;
}
