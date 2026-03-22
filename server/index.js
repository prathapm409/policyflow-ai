require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { v4: uuid } = require("uuid");
const { stringify } = require("csv-stringify/sync");
const pool = require("./db");
const {
  assignRiskTierFromScore,
  determineKycDecision,
} = require("./rules");
const { generateContractPDF } = require("./pdf");
const { sumsubRequest, verifyWebhookSignature } = require("./sumsub");

const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

function getSumsubLevelName() {
  return process.env.SUMSUB_LEVEL_NAME || "id-and-liveness";
}

function mapDbError(error) {
  return {
    ok: false,
    error: error?.response?.data?.description || error?.message || "Server error",
    details: error?.response?.data || null,
  };
}

async function safeQuery(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (e) {
    console.error("DB error:", e);
    throw e;
  }
}

function normalizeVerificationStatus(input) {
  const value = String(input || "").trim().toUpperCase();

  if (["APPROVED", "REJECTED", "PENDING", "REVIEW"].includes(value)) return value;
  if (["GREEN", "COMPLETED"].includes(value)) return "APPROVED";
  if (["RED", "FAILED"].includes(value)) return "REJECTED";
  if (["ON_HOLD", "ONHOLD"].includes(value)) return "REVIEW";

  return "PENDING";
}

function normalizeTier(input) {
  const value = String(input || "").trim().toUpperCase();
  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value)) return value;
  return null;
}

function extractApplicantId(payload = {}) {
  return payload.applicantId || payload.externalApplicantId || payload.applicant_id || null;
}

function extractVerificationStatus(payload = {}) {
  const direct =
    payload.status ||
    payload.reviewStatus ||
    payload.verificationStatus ||
    payload.reviewResult?.reviewAnswer ||
    null;

  if (direct) return normalizeVerificationStatus(direct);

  const type = String(payload.type || "").trim();
  if (type === "applicantPending") return "PENDING";
  if (type === "applicantOnHold") return "REVIEW";
  if (type === "applicantReviewed" || type === "applicantWorkflowCompleted") {
    return normalizeVerificationStatus(payload.reviewResult?.reviewAnswer || "PENDING");
  }

  return "PENDING";
}

function getRejectLabels(payload = {}) {
  return []
    .concat(payload?.reviewResult?.rejectLabels || [])
    .concat(payload?.sumsubRejectLabels || [])
    .map((x) => String(x).toUpperCase());
}

function buildSignalPayload(payload = {}) {
  const labels = getRejectLabels(payload);
  const hasLabel = (needle) => labels.some((x) => x.includes(needle));

  return {
    pepMatch: Boolean(payload.pepMatch) || hasLabel("PEP"),
    sanctionsMatch: Boolean(payload.sanctionsMatch) || hasLabel("SANCTION") || hasLabel("WATCHLIST"),
    adverseMedia: Boolean(payload.adverseMedia) || hasLabel("ADVERSE"),
    documentFraudDetected:
      Boolean(payload.documentFraudDetected) ||
      hasLabel("TAMPER") ||
      hasLabel("FRAUD") ||
      hasLabel("FORGERY") ||
      hasLabel("PRINTED") ||
      hasLabel("COPY") ||
      hasLabel("SCREEN"),
    faceMismatch:
      Boolean(payload.faceMismatch) ||
      hasLabel("FACE") ||
      hasLabel("MISMATCH") ||
      hasLabel("LIVENESS") ||
      hasLabel("SELFIE"),
    highRiskCountry:
      Boolean(payload.highRiskCountry) ||
      hasLabel("COUNTRY") ||
      hasLabel("HIGH_RISK_COUNTRY"),
    deviceRisk: Boolean(payload.deviceRisk) || hasLabel("DEVICE"),
    ipMismatch:
      Boolean(payload.ipMismatch) ||
      Boolean(payload.deviceOrIpMismatch) ||
      hasLabel("IP"),
    manualReviewRequired:
      Boolean(payload.manualReviewRequired) ||
      String(payload.reviewStatus || "").toLowerCase() === "pending" ||
      String(payload.reviewStatus || "").toLowerCase() === "onhold",
  };
}

function deriveStrictVerification(payload = {}, baseStatus) {
  const labels = getRejectLabels(payload);
  const rejectType = String(payload?.reviewResult?.reviewRejectType || "").toUpperCase();

  const hardRejectKeywords = [
    "FORGERY",
    "FRAUD",
    "TAMPER",
    "PRINTED",
    "COPY",
    "SCREEN",
    "SELFIE_MISMATCH",
    "FACE_MISMATCH",
    "THIRD_PARTY",
    "DOCUMENT_DAMAGED",
    "BAD_QUALITY",
  ];

  const hasHardReject = labels.some((l) =>
    hardRejectKeywords.some((k) => l.includes(k))
  );

  if (hasHardReject || rejectType === "FINAL") return "REJECTED";
  if (String(baseStatus).toUpperCase() === "APPROVED" && labels.length > 0) return "REVIEW";

  return baseStatus;
}

function buildReasonLines(signals) {
  const reasons = [];
  if (signals.pepMatch) reasons.push("PEP");
  if (signals.sanctionsMatch) reasons.push("Sanctions");
  if (signals.adverseMedia) reasons.push("Adverse media");
  if (signals.documentFraudDetected) reasons.push("Document fraud");
  if (signals.faceMismatch) reasons.push("Face mismatch");
  if (signals.highRiskCountry) reasons.push("Country risk");
  if (signals.deviceRisk) reasons.push("Device risk");
  if (signals.ipMismatch) reasons.push("IP mismatch");
  if (signals.manualReviewRequired) reasons.push("Manual review");
  return reasons;
}

function calculateSignalScore(signals) {
  return [
    signals.pepMatch ? 50 : 0,
    signals.sanctionsMatch ? 100 : 0,
    signals.adverseMedia ? 40 : 0,
    signals.documentFraudDetected ? 60 : 0,
    signals.faceMismatch ? 40 : 0,
    signals.highRiskCountry ? 30 : 0,
    signals.deviceRisk ? 20 : 0,
    signals.ipMismatch ? 20 : 0,
    signals.manualReviewRequired ? 20 : 0,
  ].reduce((a, b) => a + b, 0);
}

async function ensureCustomer(application, applicantId, riskTier, score) {
  const existingCustomer = await safeQuery(
    `SELECT * FROM customers WHERE external_id = $1 ORDER BY id DESC LIMIT 1`,
    [applicantId]
  );

  if (existingCustomer.rows.length) {
    const updated = await safeQuery(
      `UPDATE customers SET risk_tier = $2, risk_score = $3 WHERE id = $1 RETURNING *`,
      [existingCustomer.rows[0].id, riskTier, score]
    );
    await safeQuery(`UPDATE applications SET customer_id = $2 WHERE id = $1`, [
      application.id,
      updated.rows[0].id,
    ]);
    return updated.rows[0];
  }

  const customerRes = await safeQuery(
    `
    INSERT INTO customers (external_id, full_name, email, risk_tier, risk_score)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [applicantId, application.full_name, application.email, riskTier, score]
  );

  await safeQuery(`UPDATE applications SET customer_id = $2 WHERE id = $1`, [
    application.id,
    customerRes.rows[0].id,
  ]);

  return customerRes.rows[0];
}

async function ensureContract(
  application,
  customer,
  applicantId,
  verificationStatus,
  monitoringFrequency
) {
  const existingContract = await safeQuery(
    `SELECT * FROM contracts WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
    [customer.id]
  );

  if (existingContract.rows.length) {
    await safeQuery(`UPDATE applications SET contract_id = $2 WHERE id = $1`, [
      application.id,
      existingContract.rows[0].id,
    ]);
    return existingContract.rows[0];
  }

  const contractRes = await safeQuery(
    `
    INSERT INTO contracts (
      customer_id,
      policy_number,
      status,
      coverage_start,
      coverage_end,
      coverage_description,
      coverage_limit,
      deductible,
      premium,
      payment_frequency,
      insurer,
      insurer_address,
      policyholder_address,
      dob,
      sumsub_verification_id,
      sumsub_status,
      sumsub_verified_at,
      monitoring_frequency
    )
    VALUES (
      $1, $2, $3,
      NOW(),
      NOW() + INTERVAL '1 year',
      $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15
    )
    RETURNING *
    `,
    [
      customer.id,
      `POL-UK-${new Date().getFullYear()}-${String(customer.id).padStart(6, "0")}`,
      "Generated",
      "Comprehensive coverage for private motor vehicle including accidental damage, theft, and third-party liability.",
      "£50,000",
      "£500",
      "£820",
      "Monthly",
      "Northern Shield Insurance Ltd",
      "42 Bishopsgate, London, UK",
      "14 Kingsway Avenue, Manchester, UK",
      "1985-07-21",
      applicantId,
      verificationStatus,
      monitoringFrequency,
    ]
  );

  await safeQuery(`UPDATE applications SET contract_id = $2 WHERE id = $1`, [
    application.id,
    contractRes.rows[0].id,
  ]);

  return contractRes.rows[0];
}

async function upsertMonitoring(customerId, frequency) {
  const existing = await safeQuery(
    `SELECT * FROM monitoring WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
    [customerId]
  );

  const intervalMap = {
    "12_MONTHS": "365 days",
    "6_MONTHS": "180 days",
    "3_MONTHS": "90 days",
  };
  const interval = intervalMap[frequency] || "365 days";

  if (existing.rows.length) {
    const updated = await safeQuery(
      `UPDATE monitoring
       SET frequency = $2, status = 'ACTIVE', next_review_at = NOW() + ($3)::interval
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, frequency, interval]
    );
    return updated.rows[0];
  }

  const inserted = await safeQuery(
    `INSERT INTO monitoring (customer_id, frequency, status, next_review_at)
     VALUES ($1, $2, 'ACTIVE', NOW() + ($3)::interval)
     RETURNING *`,
    [customerId, frequency, interval]
  );

  return inserted.rows[0];
}

async function createComplianceReview(applicationId, applicantId, score, riskTier, reason) {
  const existing = await safeQuery(
    `SELECT * FROM compliance_reviews WHERE application_id = $1 ORDER BY id DESC LIMIT 1`,
    [applicationId]
  );

  if (
    existing.rows.length &&
    ["PENDING_REVIEW", "IN_PROGRESS"].includes(existing.rows[0].status)
  ) {
    return existing.rows[0];
  }

  const inserted = await safeQuery(
    `
    INSERT INTO compliance_reviews (
      application_id,
      applicant_id,
      risk_score,
      risk_tier,
      status,
      reason
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [applicationId, applicantId, score, riskTier, "PENDING_REVIEW", reason]
  );

  return inserted.rows[0];
}

app.get("/api/debug/env", async (req, res) => {
  res.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV || "development",
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasSumsubAppToken: Boolean(process.env.SUMSUB_APP_TOKEN),
    hasSumsubSecretKey: Boolean(process.env.SUMSUB_SECRET_KEY),
    hasSumsubWebhookSecret: Boolean(process.env.SUMSUB_WEBHOOK_SECRET),
    sumsubLevelName: getSumsubLevelName(),
  });
});

app.get("/api/summary", async (req, res) => {
  try {
    const counts = await safeQuery(`
      SELECT
        (SELECT COUNT(*) FROM applications) AS applications,
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM contracts) AS contracts,
        (SELECT COUNT(*) FROM audit_logs) AS audits,
        (SELECT COUNT(*) FROM compliance_reviews WHERE status IN ('PENDING_REVIEW','IN_PROGRESS')) AS open_reviews,
        (SELECT COUNT(*) FROM monitoring) AS monitoring
    `);

    const audits = await safeQuery(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20`);

    res.json({
      ok: true,
      counts: counts.rows[0] || {},
      audits: audits.rows || [],
    });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/applications", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT
        id,
        full_name,
        email,
        kyc_status,
        external_applicant_id,
        risk_score,
        risk_tier,
        decision_status,
        compliance_status,
        policy_status,
        monitoring_frequency,
        customer_id,
        contract_id,
        created_at,
        updated_at,
        risk_override_tier
      FROM applications
      ORDER BY id DESC
    `);

    res.json({ ok: true, applications: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications", async (req, res) => {
  try {
    const { fullName, email } = req.body || {};
    if (!fullName || !email) {
      return res.status(400).json({ ok: false, error: "fullName and email are required" });
    }

    const result = await safeQuery(
      `
      INSERT INTO applications (
        full_name,
        email,
        kyc_status,
        risk_score,
        risk_tier,
        decision_status,
        compliance_status,
        policy_status,
        updated_at
      )
      VALUES ($1, $2, 'PENDING_KYC', 0, 'LOW', 'PENDING', 'NOT_REQUIRED', 'NOT_STARTED', NOW())
      RETURNING *
      `,
      [fullName, email]
    );

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "APPLICATION_CREATED",
      { applicationId: result.rows[0].id, fullName, email },
    ]);

    res.json({ ok: true, application: result.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications/:id/risk-tier", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const overrideTier = normalizeTier(req.body?.riskTier);

    if (!overrideTier) {
      return res
        .status(400)
        .json({ ok: false, error: "riskTier must be one of LOW, MEDIUM, HIGH, CRITICAL" });
    }

    const updated = await safeQuery(
      `
      UPDATE applications
      SET risk_override_tier = $2, risk_tier = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id, overrideTier]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "RISK_TIER_OVERRIDDEN",
      { applicationId: id, riskTier: overrideTier },
    ]);

    res.json({ ok: true, application: updated.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications/:id/send-to-compliance", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const appRes = await safeQuery(`SELECT * FROM applications WHERE id = $1`, [id]);

    if (!appRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    const application = appRes.rows[0];
    const applicantId = application.external_applicant_id || `manual-${application.id}`;
    const riskTier = normalizeTier(application.risk_tier) || "HIGH";
    const score = Number(application.risk_score || 0);

    const review = await createComplianceReview(
      application.id,
      applicantId,
      score,
      riskTier,
      "Manually sent to compliance review"
    );

    const updated = await safeQuery(
      `
      UPDATE applications
      SET compliance_status = 'IN_REVIEW',
          policy_status = CASE
            WHEN COALESCE(policy_status, '') IN ('', 'NOT_STARTED') THEN 'ON_HOLD'
            ELSE policy_status
          END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "APPLICATION_SENT_TO_COMPLIANCE",
      { applicationId: id, reviewId: review.id },
    ]);

    res.json({ ok: true, application: updated.rows[0], review });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications/:id/start-kyc", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await safeQuery(`SELECT * FROM applications WHERE id = $1`, [id]);

    if (!existing.rows.length) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    let application = existing.rows[0];

    if (!application.external_applicant_id) {
      const externalUserId = `policyflow-${application.id}-${uuid()}`;
      const applicant = await sumsubRequest({
        method: "POST",
        path: `/resources/applicants?levelName=${encodeURIComponent(getSumsubLevelName())}`,
        body: {
          externalUserId,
          email: application.email,
          fixedInfo: {
            firstName: application.full_name,
          },
        },
      });

      const applicantId = applicant?.id;
      if (!applicantId) {
        return res.status(500).json({ ok: false, error: "Failed to create Sumsub applicant" });
      }

      const updatedApplicant = await safeQuery(
        `
        UPDATE applications
        SET external_applicant_id = $2, kyc_status = 'IN_PROGRESS', updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id, applicantId]
      );
      application = updatedApplicant.rows[0];
    } else {
      const updatedApplicant = await safeQuery(
        `UPDATE applications SET kyc_status = 'IN_PROGRESS', updated_at = NOW() WHERE id = $1 RETURNING *`,
        [id]
      );
      application = updatedApplicant.rows[0];
    }

    const tokenData = await sumsubRequest({
      method: "POST",
      path: "/resources/accessTokens/sdk",
      body: {
        userId: String(application.id),
        applicantIdentifiers: { email: application.email },
        ttlInSecs: 1800,
        levelName: getSumsubLevelName(),
      },
    });

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "KYC_STARTED",
      { applicationId: id, externalApplicantId: application.external_applicant_id },
    ]);

    res.json({
      ok: true,
      application,
      applicantId: application.external_applicant_id,
      sumsubToken: tokenData?.token || null,
      userId: tokenData?.userId || String(application.id),
    });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/webhook/sumsub", async (req, res) => {
  try {
    const isLikelySimulation =
      process.env.NODE_ENV !== "production" &&
      (!req.headers["x-payload-digest"] || req.headers["x-simulated-webhook"] === "true");

    if (!isLikelySimulation && !verifyWebhookSignature(req)) {
      return res.status(401).json({ ok: false, error: "Invalid webhook signature" });
    }

    const payload = req.body || {};
    const applicantId = extractApplicantId(payload);

    if (!applicantId) {
      return res.status(400).json({ ok: false, error: "applicantId is required" });
    }

    const eventId =
      payload.eventId ||
      payload.correlationId ||
      payload.inspectionId ||
      `${applicantId}:${payload.type || payload.status || Date.now()}`;

    const duplicateCheck = await safeQuery(
      `SELECT id FROM sumsub_webhook_events WHERE event_id = $1`,
      [String(eventId)]
    );
    if (duplicateCheck.rows.length) {
      return res.json({ ok: true, duplicate: true });
    }

    await safeQuery(
      `INSERT INTO sumsub_webhook_events (event_id, applicant_id, event_type) VALUES ($1, $2, $3)`,
      [String(eventId), applicantId, String(payload.type || payload.status || "unknown")]
    );

    let verificationStatus = extractVerificationStatus(payload);
    verificationStatus = deriveStrictVerification(payload, verificationStatus);

    const signals = buildSignalPayload(payload);
    const traceReasons = buildReasonLines(signals);
    const score = calculateSignalScore(signals);

    const appRes = await safeQuery(
      `SELECT * FROM applications WHERE external_applicant_id = $1 ORDER BY id DESC LIMIT 1`,
      [applicantId]
    );

    if (!appRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Application not found for applicantId" });
    }

    const application = appRes.rows[0];
    const riskTier = normalizeTier(application.risk_override_tier) || assignRiskTierFromScore(score);

    let decisionStatus = determineKycDecision({ verificationStatus, riskTier });
    let complianceStatus = "NOT_REQUIRED";
    let policyStatus = "NOT_STARTED";
    let monitoringFrequency = null;
    let customer = null;
    let contract = null;
    let monitoringRecord = null;
    let complianceReview = null;

    if (verificationStatus === "APPROVED") {
      if (riskTier === "LOW") {
        decisionStatus = "AUTO_APPROVED";
        complianceStatus = "NOT_REQUIRED";
        policyStatus = "GENERATED";
        monitoringFrequency = "12_MONTHS";

        customer = await ensureCustomer(application, applicantId, riskTier, score);
        contract = await ensureContract(
          application,
          customer,
          applicantId,
          verificationStatus,
          monitoringFrequency
        );
        monitoringRecord = await upsertMonitoring(customer.id, monitoringFrequency);
      } else if (riskTier === "MEDIUM") {
        decisionStatus = "STANDARD_MONITORING";
        complianceStatus = "IN_REVIEW";
        policyStatus = "MONITORING_ONLY";
        monitoringFrequency = "6_MONTHS";

        customer = await ensureCustomer(application, applicantId, riskTier, score);
        monitoringRecord = await upsertMonitoring(customer.id, monitoringFrequency);
        complianceReview = await createComplianceReview(
          application.id,
          applicantId,
          score,
          riskTier,
          traceReasons.join(", ") || "Medium risk standard monitoring"
        );
      } else if (riskTier === "HIGH") {
        decisionStatus = "MANUAL_REVIEW";
        complianceStatus = "IN_REVIEW";
        policyStatus = "ON_HOLD";
        complianceReview = await createComplianceReview(
          application.id,
          applicantId,
          score,
          riskTier,
          traceReasons.join(", ") || "High risk manual review"
        );
      } else {
        decisionStatus = "REJECT_ESCALATE";
        complianceStatus = "ESCALATED";
        policyStatus = "REJECTED";
        complianceReview = await createComplianceReview(
          application.id,
          applicantId,
          score,
          "CRITICAL",
          traceReasons.join(", ") || "Critical risk reject / escalate"
        );
      }
    } else if (verificationStatus === "REJECTED") {
      decisionStatus = "REJECT_ESCALATE";
      complianceStatus = "REJECTED";
      policyStatus = "REJECTED";
      complianceReview = await createComplianceReview(
        application.id,
        applicantId,
        score,
        riskTier,
        traceReasons.join(", ") || "KYC rejected"
      );
    } else if (verificationStatus === "REVIEW") {
      decisionStatus = "MANUAL_REVIEW";
      complianceStatus = "IN_REVIEW";
      policyStatus = "ON_HOLD";
      complianceReview = await createComplianceReview(
        application.id,
        applicantId,
        score,
        riskTier,
        traceReasons.join(", ") || "Sent to review"
      );
    } else {
      decisionStatus = "PENDING";
      complianceStatus = "PENDING";
      policyStatus = "PENDING";
    }

    const updatedApp = await safeQuery(
      `
      UPDATE applications
      SET
        kyc_status = $2,
        risk_score = $3,
        risk_tier = $4,
        decision_status = $5,
        compliance_status = $6,
        policy_status = $7,
        monitoring_frequency = $8,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        application.id,
        verificationStatus,
        score,
        riskTier,
        decisionStatus,
        complianceStatus,
        policyStatus,
        monitoringFrequency,
      ]
    );

    if (customer) {
      await safeQuery(`UPDATE applications SET customer_id = $2 WHERE id = $1`, [
        application.id,
        customer.id,
      ]);
    }

    if (contract) {
      await safeQuery(`UPDATE applications SET contract_id = $2 WHERE id = $1`, [
        application.id,
        contract.id,
      ]);
    }

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "SUMSUB_WEBHOOK_PROCESSED",
      {
        applicationId: application.id,
        applicantId,
        verificationStatus,
        score,
        riskTier,
        traceReasons,
        decisionStatus,
      },
    ]);

    res.json({
      ok: true,
      application: updatedApp.rows[0],
      customer,
      contract,
      monitoring: monitoringRecord,
      complianceReview,
      score,
      riskTier,
      verificationStatus,
      reasons: traceReasons,
    });
  } catch (e) {
    console.error("Sumsub webhook error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const result = await safeQuery(`SELECT * FROM customers ORDER BY created_at DESC`);
    res.json({ ok: true, customers: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/customers/:id", async (req, res) => {
  try {
    const customerRes = await safeQuery(`SELECT * FROM customers WHERE id = $1`, [req.params.id]);
    if (!customerRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Customer not found" });
    }

    const contracts = await safeQuery(
      `SELECT * FROM contracts WHERE customer_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    const monitoring = await safeQuery(
      `SELECT * FROM monitoring WHERE customer_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      ok: true,
      customer: customerRes.rows[0],
      contracts: contracts.rows || [],
      monitoring: monitoring.rows || [],
    });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/contracts", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT c.*, cu.full_name, cu.email, cu.risk_tier
      FROM contracts c
      LEFT JOIN customers cu ON cu.id = c.customer_id
      ORDER BY c.created_at DESC
    `);
    res.json({ ok: true, contracts: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.put("/api/contracts/:id", async (req, res) => {
  try {
    const {
      premium,
      deductible,
      payment_frequency,
      coverage_description,
      coverage_limit,
      insurer,
      insurer_address,
      policyholder_address,
      monitoring_frequency,
      status,
    } = req.body || {};

    const updated = await safeQuery(
      `
      UPDATE contracts
      SET
        premium = COALESCE($2, premium),
        deductible = COALESCE($3, deductible),
        payment_frequency = COALESCE($4, payment_frequency),
        coverage_description = COALESCE($5, coverage_description),
        coverage_limit = COALESCE($6, coverage_limit),
        insurer = COALESCE($7, insurer),
        insurer_address = COALESCE($8, insurer_address),
        policyholder_address = COALESCE($9, policyholder_address),
        monitoring_frequency = COALESCE($10, monitoring_frequency),
        status = COALESCE($11, status)
      WHERE id = $1
      RETURNING *
      `,
      [
        req.params.id,
        premium ?? null,
        deductible ?? null,
        payment_frequency ?? null,
        coverage_description ?? null,
        coverage_limit ?? null,
        insurer ?? null,
        insurer_address ?? null,
        policyholder_address ?? null,
        monitoring_frequency ?? null,
        status ?? null,
      ]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: "Contract not found" });
    }

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "CONTRACT_UPDATED",
      { contractId: req.params.id },
    ]);

    res.json({ ok: true, contract: updated.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/contracts/:id/regenerate", async (req, res) => {
  try {
    const result = await safeQuery(
      `UPDATE contracts SET created_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: "Contract not found" });
    }

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "CONTRACT_REGENERATED",
      { contractId: req.params.id },
    ]);

    res.json({ ok: true, contract: result.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/compliance-reviews", async (req, res) => {
  try {
    const result = await safeQuery(`SELECT * FROM compliance_reviews ORDER BY created_at DESC`);
    res.json({ ok: true, reviews: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/compliance-reviews/:id/action", async (req, res) => {
  try {
    const action = String(req.body?.action || "").toUpperCase();
    const allowed = ["APPROVE", "REJECT", "DONE", "ESCALATE", "START"];

    if (!allowed.includes(action)) {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    const reviewRes = await safeQuery(`SELECT * FROM compliance_reviews WHERE id = $1`, [
      req.params.id,
    ]);

    if (!reviewRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Review not found" });
    }

    const review = reviewRes.rows[0];
    let reviewStatus = review.status;
    let appCompliance = null;
    let appPolicy = null;

    if (action === "START") reviewStatus = "IN_PROGRESS";
    if (action === "DONE") reviewStatus = "DONE";
    if (action === "ESCALATE") {
      reviewStatus = "ESCALATED";
      appCompliance = "ESCALATED";
      appPolicy = "ON_HOLD";
    }
    if (action === "APPROVE") {
      reviewStatus = "APPROVED";
      appCompliance = "APPROVED";
      appPolicy = "MONITORING_ONLY";
    }
    if (action === "REJECT") {
      reviewStatus = "REJECTED";
      appCompliance = "REJECTED";
      appPolicy = "REJECTED";
    }

    const updatedReview = await safeQuery(
      `UPDATE compliance_reviews SET status = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, reviewStatus]
    );

    if (appCompliance || appPolicy) {
      await safeQuery(
        `UPDATE applications
         SET compliance_status = COALESCE($2, compliance_status),
             policy_status = COALESCE($3, policy_status),
             updated_at = NOW()
         WHERE id = $1`,
        [review.application_id, appCompliance, appPolicy]
      );
    }

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "COMPLIANCE_REVIEW_ACTION",
      { reviewId: req.params.id, action },
    ]);

    res.json({ ok: true, review: updatedReview.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/verified-results", async (req, res) => {
  try {
    const successfulOnly = String(req.query.successfulOnly || "").toLowerCase() === "true";

    const result = successfulOnly
      ? await safeQuery(
          `
          SELECT *
          FROM applications
          WHERE kyc_status = 'APPROVED'
          ORDER BY updated_at DESC NULLS LAST, id DESC
          `
        )
      : await safeQuery(
          `
          SELECT *
          FROM applications
          WHERE kyc_status IN ('APPROVED', 'REJECTED', 'PENDING', 'REVIEW')
             OR decision_status IN ('AUTO_APPROVED', 'STANDARD_MONITORING', 'MANUAL_REVIEW', 'REJECT_ESCALATE')
          ORDER BY updated_at DESC NULLS LAST, id DESC
          `
        );

    res.json({ ok: true, results: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/monitoring", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT m.*, c.full_name, c.email, c.risk_tier
      FROM monitoring m
      LEFT JOIN customers c ON c.id = m.customer_id
      ORDER BY m.created_at DESC
    `);
    res.json({ ok: true, monitoring: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/monitoring/:id/action", async (req, res) => {
  try {
    const action = String(req.body?.action || "").toUpperCase();
    const allowed = ["COMPLETE", "SNOOZE"];

    if (!allowed.includes(action)) {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    const sql =
      action === "COMPLETE"
        ? `UPDATE monitoring SET status = 'COMPLETED', next_review_at = NOW() + INTERVAL '180 days' WHERE id = $1 RETURNING *`
        : `UPDATE monitoring SET status = 'SNOOZED', next_review_at = NOW() + INTERVAL '30 days' WHERE id = $1 RETURNING *`;

    const updated = await safeQuery(sql, [req.params.id]);

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: "Monitoring record not found" });
    }

    await safeQuery(`INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`, [
      "MONITORING_ACTION",
      { monitoringId: req.params.id, action },
    ]);

    res.json({ ok: true, monitoring: updated.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/audits", async (req, res) => {
  try {
    const result = await safeQuery(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`);
    res.json({ ok: true, audits: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/contracts/:id/pdf", async (req, res) => {
  try {
    const contractRes = await safeQuery(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);

    if (!contractRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Contract not found" });
    }

    const contract = contractRes.rows[0];
    const customerRes = await safeQuery(`SELECT * FROM customers WHERE id = $1`, [
      contract.customer_id,
    ]);
    const customer = customerRes.rows[0] || {};

    let application = {};
    if (customer?.id) {
      const appRes = await safeQuery(
        `SELECT * FROM applications WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
        [customer.id]
      );
      application = appRes.rows[0] || {};
    }

    const pdfBuffer = await generateContractPDF({ customer, contract, application });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${contract.policy_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error("Contract PDF error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/audit/export", async (req, res) => {
  try {
    const logs = await safeQuery(`SELECT * FROM audit_logs ORDER BY created_at DESC`);
    const csv = stringify(logs.rows || [], { header: true });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=audit_export.csv");
    res.send(csv);
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PolicyFlow AI server running on port ${PORT}`);
});