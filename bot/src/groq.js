import { CATEGORY_FILES, CATEGORY_FIELDS, CATEGORY_REQUIRED } from "./categories.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

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
  const required = CATEGORY_REQUIRED[category] || CATEGORY_REQUIRED.rom;
  return required.filter((field) => {
    const value = parsed[field];
    return value === null || value === undefined || value === "";
  });
}

const SYSTEM_PROMPT = `You extract structured data from Telegram posts about Android ROM/kernel/port/recovery releases for the Xiaomi Redmi 10 (selene).

Output ONLY a JSON object, no markdown, no explanation, no code fences. The JSON must have these exact keys:

{
  "category": one of "rom", "kernel", "recovery", "firmware", "port", "tool", "guide". Judge it by where the build comes from:
    - "rom": a full operating system release built or packaged for THIS device (Xiaomi Redmi 10 / selene). If the post calls it a "Custom ROM", "ROM", or "build" for selene, it is "rom" - even if it is MIUI-, HyperOS-, or Android-flavoured. From-source builds (LineageOS, CherishOS, AOSP, crDroid, etc) are always "rom".
    - "port": an operating system release taken from a DIFFERENT device and adapted to selene. Signals: the post literally says "ported", "port", or names another device as the source (e.g. "HyperOS port from Redmi Note 13", "MIUI 14 port", "brought from POCO X3"). Do NOT mark a build as "port" merely because it is MIUI- or HyperOS-based; check whether it actually came from another device.
    - "firmware": raw baseband/modem/bootloader or flashable firmware component files, not full OS builds. Never use "firmware" for HyperOS or MIUI releases.
    - "kernel": a standalone kernel release.
    - "recovery": a standalone recovery (TWRP, OrangeFox, etc).
    - "tool": tools, installers, utilities, root tools.
    - "guide": how-to guides or tutorials.,,
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

const MERGE_SYSTEM_PROMPT = `You are given a partially filled JSON object describing an Android ROM/kernel/port release, plus a follow-up message from the person adding it that supplies missing details (like a download link or file size) or corrects a field.

The follow-up message may also reference a release category or a file name such as "rom.sman", "roms.sman", "ports.sman", "kernels.sman", "recovery.sman", "firmware.sman", "tools.sman", "guides.sman", or "channels.sman". If it does, set "category" to the matching category: rom, kernel, recovery, firmware, port, tool, guide, or channel. A .sman file name with an extra s (like "roms.sman") still means the singular category.

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
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("Groq " + res.status + ": " + body.slice(0, 500));
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

export async function parsePostWithGroq(apiKey, postText) {
  const raw = await callGroq(apiKey, SYSTEM_PROMPT, postText);
  return JSON.parse(raw);
}

export async function mergeWithGroq(apiKey, existingParsed, followUpText) {
  const userContent = "Existing data:\n" + JSON.stringify(existingParsed) + "\n\nFollow-up message:\n" + followUpText;
  const raw = await callGroq(apiKey, MERGE_SYSTEM_PROMPT, userContent);
  return JSON.parse(raw);
}

export function toSmanBlock(parsed) {
  const category = parsed.category || "rom";
  const fields = CATEGORY_FIELDS[category] || CATEGORY_FIELDS.rom;
  const lines = [];
  for (const field of fields) {
    const value = parsed[field];
    if (value === null || value === undefined || value === "") continue;
    lines.push(field + ": " + value);
  }
  return { category, file: CATEGORY_FILES[category] || "rom.sman", block: lines.join("\n") };
}

export function summarizeParsed(parsed) {
  const { file, block } = toSmanBlock(parsed);
  return "File: " + file + "\n\n" + block;
}

export function missingFieldsMessage(parsed) {
  const missing = findMissingFields(parsed);
  if (missing.length === 0) return null;
  const labels = missing.map((f) => FIELD_LABELS[f] || f);
  const joined = labels.length === 1 ? labels[0] : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
  return joined + " " + (labels.length === 1 ? "is" : "are") + " missing, please write " + (labels.length === 1 ? "it" : "them") + "!";
}
