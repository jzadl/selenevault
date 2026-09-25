-- Every chat the bot has seen (for /smessage -all broadcast targets).
-- Populated in real time from incoming messages; lets the owner DM
-- /smessage -all and reach all groups the bot is a member of.

CREATE TABLE IF NOT EXISTS known_chats (
  chat_id BIGINT NOT NULL PRIMARY KEY,
  chat_type TEXT NOT NULL,
  title TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS known_chats_type_idx ON known_chats (chat_type);