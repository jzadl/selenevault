-- Subscriptions for new-build announcements (one row per chat+category)

CREATE TABLE IF NOT EXISTS subscriptions (
  chat_id BIGINT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chat_id, category)
);
