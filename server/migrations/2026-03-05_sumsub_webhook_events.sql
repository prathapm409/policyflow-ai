CREATE TABLE IF NOT EXISTS sumsub_webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  applicant_id TEXT,
  event_type TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);