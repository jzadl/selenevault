import json
import os
import sys
import urllib.request

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MODEL = "llama-3.1-8b-instant"

CATEGORY_FIELDS = {
    "rom": ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
    "kernel": ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
    "recovery": ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
    "firmware": ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
    "port": ["name", "version", "maintainer", "size", "date", "url", "note", "vendor"],
    "tool": ["name", "version", "maintainer", "size", "date", "url", "note"],
    "guide": ["name", "url", "note"],
    "channel": ["name", "url", "note"],
}

SYSTEM_PROMPT = """You extract structured data from Telegram posts about Android ROM/kernel/port/recovery releases for the Xiaomi Redmi 10 (selene).

Output ONLY a JSON object, no markdown, no explanation, no code fences. The JSON must have these exact keys:

{
  "category": one of "rom", "kernel", "recovery", "firmware", "port", "tool", "guide",
  "name": the release name, without version numbers or dates,
  "version": the version string as written in the post,
  "maintainer": the author's name or Telegram handle, without the @ symbol,
  "size": file size as written (e.g. "1.5G", "13.9mb"), or null if not mentioned,
  "date": ISO format YYYY-MM-DD, converted from whatever date format the post uses,
  "url": the download link, or null if not present,
  "note": a short one or two sentence summary of the changelog or key details, plain text, no markdown,
  "vendor": "rvendor" for Android 11-12 / MIUI 12.5, "svendor" for Android 13+ / MIUI 13+ / HyperOS, or null if not determinable
}

If a field cannot be determined, use null. Never invent data. Keep "note" concise, focused on what changed or what is notable, not a full changelog dump."""


def call_groq(post_text):
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": post_text},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        GROQ_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"]


def to_sman_block(parsed):
    category = parsed.pop("category", "rom")
    fields = CATEGORY_FIELDS.get(category, CATEGORY_FIELDS["rom"])
    lines = []
    for field in fields:
        value = parsed.get(field)
        if value is None:
            continue
        lines.append(f"{field}: {value}")
    return category, "\n".join(lines)


def main():
    if not GROQ_API_KEY:
        print("Set GROQ_API_KEY environment variable first.")
        sys.exit(1)

    print("Paste the Telegram post text, then press Ctrl+D (or Ctrl+Z on Windows) when done:\n")
    post_text = sys.stdin.read().strip()
    if not post_text:
        print("No input given.")
        sys.exit(1)

    print("\nSending to Groq...\n")
    raw = call_groq(post_text)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        print("Groq did not return valid JSON:")
        print(raw)
        sys.exit(1)

    category, block = to_sman_block(dict(parsed))

    print(f"Target file: {category}.sman" if category != "port" else "Target file: ports.sman")
    print("-" * 40)
    print(block)
    print("-" * 40)


if __name__ == "__main__":
    main()
