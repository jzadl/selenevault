# Groq parsing prototype

Standalone script to test parsing free-text Telegram posts into `.sman` entries using Groq.

## Setup

```
pip install --user requests  # not needed, uses urllib only
export GROQ_API_KEY="your-key-here"
python3 parse.py
```

## Usage

Run the script, paste the raw Telegram post text, then Ctrl+D (Ctrl+Z on Windows) to finish input. It sends the text to Groq, parses the JSON response, and prints the ready-to-paste `.sman` block plus which file it belongs in.

This is a prototype only, it does not write to the repo or commit anything. Next step once this is validated is wiring it into the bot's `/sadd` flow with a confirm/discard DM step.
