-- Seed sample customer + contract that matches screenshot (idempotent)
INSERT INTO customers (external_id, full_name, email, risk_tier, risk_score, created_at)
VALUES ('TEST-LOW-1', 'James Carter', 'james.carter@example.com', 'MEDIUM', 45, NOW())
ON CONFLICT (external_id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      risk_tier = EXCLUDED.risk_tier,
      risk_score = EXCLUDED.risk_score;

INSERT INTO contracts (customer_id, policy_number, status, created_at, coverage_start, coverage_end, coverage_description, coverage_limit, deductible, premium, payment_frequency, insurer, insurer_address, policyholder_address, dob, sumsub_verification_id, sumsub_status, sumsub_verified_at, monitoring_frequency)
VALUES (
  (SELECT id FROM customers WHERE external_id='TEST-LOW-1' LIMIT 1),
  'POL-UK-2026-000384',
  'ISSUED',
  NOW(),
  '2026-03-15'::timestamptz,
  '2027-03-14'::timestamptz,
  'Comprehensive coverage for private motor vehicle including accidental damage, theft, and third-party liability.',
  '£50,000',
  '£500',
  '£820',
  'Monthly',
  'Northern Shield Insurance Ltd',
  '42 Bishopsgate, London, UK',
  '14 Kingsway Avenue, Manchester, UK',
  '1985-07-21'::date,
  'SUM-93840294',
  'Approved',
  '2026-03-11'::timestamptz,
  'Quarterly'
)
ON CONFLICT (policy_number) DO UPDATE
  SET status = EXCLUDED.status,
      coverage_start = EXCLUDED.coverage_start,
      coverage_end = EXCLUDED.coverage_end,
      coverage_description = EXCLUDED.coverage_description,
      coverage_limit = EXCLUDED.coverage_limit,
      deductible = EXCLUDED.deductible,
      premium = EXCLUDED.premium,
      payment_frequency = EXCLUDED.payment_frequency,
      insurer = EXCLUDED.insurer,
      insurer_address = EXCLUDED.insurer_address,
      policyholder_address = EXCLUDED.policyholder_address,
      dob = EXCLUDED.dob,
      sumsub_verification_id = EXCLUDED.sumsub_verification_id,
      sumsub_status = EXCLUDED.sumsub_status,
      sumsub_verified_at = EXCLUDED.sumsub_verified_at,
      monitoring_frequency = EXCLUDED.monitoring_frequency;