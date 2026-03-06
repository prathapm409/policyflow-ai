CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY,
  applicant_id TEXT,
  status TEXT,
  raw_payload JSONB,
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  external_id TEXT,
  full_name TEXT,
  email TEXT,
  risk_tier TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  policy_number TEXT,
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  frequency TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  event_type TEXT,
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applications (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  kyc_status TEXT NOT NULL DEFAULT 'PENDING_KYC',
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS external_applicant_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE applications ADD COLUMN IF NOT EXISTS risk_tier TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS monitoring_frequency TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS customer_id INTEGER;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS contract_id INTEGER;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS decision_status TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS compliance_status TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS policy_status TEXT;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_customer_id_fkey'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES customers(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_contract_id_fkey'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_contract_id_fkey
      FOREIGN KEY (contract_id) REFERENCES contracts(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS compliance_reviews (
  id SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES applications(id),
  applicant_id TEXT,
  risk_score INTEGER,
  risk_tier TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sumsub_webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  applicant_id TEXT,
  event_type TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW()
);
