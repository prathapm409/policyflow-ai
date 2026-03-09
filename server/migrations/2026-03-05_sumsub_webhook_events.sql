-- create sumsub_webhook_events idempotently
CREATE TABLE IF NOT EXISTS public.sumsub_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  applicant_id TEXT,
  event_type TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sumsub_webhook_events_applicant_id
  ON public.sumsub_webhook_events(applicant_id);

CREATE INDEX IF NOT EXISTS idx_sumsub_webhook_events_event_type
  ON public.sumsub_webhook_events(event_type);
  