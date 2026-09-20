-- Supabase migration: pending_ops table for ephemeral bot state
-- Run this in the Supabase SQL editor or via CLI

CREATE TABLE IF NOT EXISTS pending_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  op_type TEXT NOT NULL,
  file TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  message_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_ops_lookup ON pending_ops (chat_id, user_id, op_type);
CREATE INDEX IF NOT EXISTS idx_pending_ops_expires ON pending_ops (expires_at);

-- Auto-cleanup expired rows (runs every minute via Supabase pg_cron, optional)
-- Requires pg_cron extension enabled in Supabase
-- SELECT cron.schedule('cleanup-pending-ops', '* * * * *', $$DELETE FROM pending_ops WHERE expires_at < NOW()$$);
