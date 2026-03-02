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
