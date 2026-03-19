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
  risk_score INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_external_id_unique ON customers(external_id);

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  policy_number TEXT UNIQUE,
  status TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  coverage_start TIMESTAMPTZ,
  coverage_end TIMESTAMPTZ,
  coverage_description TEXT,
  coverage_limit TEXT,
  deductible TEXT,
  premium TEXT,
  payment_frequency TEXT,
  insurer TEXT,
  insurer_address TEXT,
  policyholder_address TEXT,
  dob DATE,
  sumsub_verification_id TEXT,
  sumsub_status TEXT,
  sumsub_verified_at TIMESTAMPTZ,
  monitoring_frequency TEXT
);

CREATE TABLE IF NOT EXISTS monitoring (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  frequency TEXT,
  status TEXT DEFAULT 'ACTIVE',
  next_review_at TIMESTAMPTZ,
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
  external_applicant_id TEXT,
  updated_at TIMESTAMP DEFAULT NOW(),
  risk_tier TEXT,
  risk_override_tier TEXT,
  monitoring_frequency TEXT,
  customer_id INTEGER,
  contract_id INTEGER,
  risk_score INTEGER DEFAULT 0,
  decision_status TEXT,
  compliance_status TEXT,
  policy_status TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

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