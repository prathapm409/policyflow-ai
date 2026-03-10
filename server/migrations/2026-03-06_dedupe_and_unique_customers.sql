-- 1) Find duplicates (review before delete)
SELECT external_id, COUNT(*) AS count
FROM customers
WHERE external_id IS NOT NULL
GROUP BY external_id
HAVING COUNT(*) > 1;

-- 2) Create unique index after duplicates removed
CREATE UNIQUE INDEX IF NOT EXISTS customers_external_id_unique ON customers(external_id);

-- Create compliance_reviews if missing
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

-- Ensure monitoring table exists
CREATE TABLE IF NOT EXISTS monitoring (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  frequency TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
