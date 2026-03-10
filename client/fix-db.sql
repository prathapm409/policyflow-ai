-- 1) Check duplicate customer external_ids
SELECT external_id, COUNT(*) AS count
FROM customers
WHERE external_id IS NOT NULL
GROUP BY external_id
HAVING COUNT(*) > 1;

-- 2) Delete duplicate customers, keep the first row per external_id
DELETE FROM customers
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY id) AS rn
    FROM customers
    WHERE external_id IS NOT NULL
  ) t
  WHERE t.rn > 1
);

-- 3) Create unique index after duplicates are removed
CREATE UNIQUE INDEX IF NOT EXISTS customers_external_id_unique
ON customers(external_id);

-- 4) Ensure latest schema columns/tables exist
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