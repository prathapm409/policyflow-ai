require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const https = require("https");
const { v4: uuid } = require("uuid");
const { stringify } = require("csv-stringify/sync");
const pool = require("./db");
const {
  calculateRiskScore,
  assignRiskTierFromScore,
  determineKycDecision,
  monitoringFrequencyForTier,
} = require("./rules");
const { generateContractPDF } = require("./pdf");
const { requireEnv, signSumsubRequest } = require("./sumsub");
const { verifySumsubWebhook } = require("./sumsubWebhook");
const path = require("path");

const app = express();
app.use(cors());

// IMPORTANT: raw body for Sumsub real webhook (needed for signature verification)
app.use("/api/webhook/sumsub/real", express.raw({ type: "*/*" }));
app.use(express.json());

// Debug endpoint
app.get("/api/debug/env", (req, res) => {
  res.json({
    ok: true,
    allowUnsigned: process.env.SUMSUB_WEBHOOK_ALLOW_UNSIGNED,
    nodeEnv: process.env.NODE_ENV,
  });
});

async function handleSumsubWebhook(payload) {
  const {
    applicantId,
    status,
    fullName,
    email,
    pepMatch,
    sanctionsMatch,
    adverseMedia,
    documentFraudDetected,
    faceMismatch,
    highRiskCountry,
    deviceOrIpMismatch,
    manualReviewRequired,
  } = payload;

  const verificationStatus = String(status || "pending").toUpperCase();

  await pool.query(
    "INSERT INTO webhooks (applicant_id, status, raw_payload) VALUES ($1,$2,$3)",
    [applicantId, verificationStatus, payload]
  );

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "WEBHOOK_RECEIVED",
    payload,
  ]);

  const { score: riskScore, signals } = calculateRiskScore({
    pepMatch,
    sanctionsMatch,
    adverseMedia,
    documentFraudDetected,
    faceMismatch,
    highRiskCountry,
    deviceOrIpMismatch,
    manualReviewRequired,
  });

  const riskTier = assignRiskTierFromScore(riskScore);
  const decisionStatus = determineKycDecision({ verificationStatus, riskTier });
  const monitoring = monitoringFrequencyForTier(riskTier);

  const appRes = await pool.query(
    "SELECT id, kyc_status, customer_id, contract_id FROM applications WHERE external_applicant_id=$1 LIMIT 1",
    [applicantId]
  );

  const application = appRes.rows[0] || null;

  if (application) {
    await pool.query(
      `UPDATE applications
       SET kyc_status=$1,
           risk_score=$2,
           risk_tier=$3,
           decision_status=$4,
           monitoring_frequency=$5,
           updated_at=NOW()
       WHERE external_applicant_id=$6`,
      [verificationStatus, riskScore, riskTier, decisionStatus, monitoring, applicantId]
    );
  }

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "RISK_ASSESSED",
    {
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      signals,
    },
  ]);

  // REJECTED
  if (verificationStatus === "REJECTED") {
    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "KYC_REJECTED",
      { applicantId, verificationStatus, riskScore, riskTier, signals },
    ]);

    if (application) {
      await pool.query(
        `UPDATE applications
         SET compliance_status='REJECTED',
             policy_status='REJECTED',
             updated_at=NOW()
         WHERE id=$1`,
        [application.id]
      );
    }

    return {
      ok: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      message: "Application rejected from KYC review.",
    };
  }

  // PENDING / REVIEW
  if (verificationStatus === "PENDING" || verificationStatus === "REVIEW") {
    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "KYC_PENDING_OR_REVIEW",
      { applicantId, verificationStatus, riskScore, riskTier, signals },
    ]);

    if (application && verificationStatus === "REVIEW") {
      await pool.query(
        `INSERT INTO compliance_reviews (application_id, applicant_id, risk_score, risk_tier, status, reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [application.id, applicantId, riskScore, riskTier, "PENDING_REVIEW", "Manual review required"]
      );

      await pool.query(
        `UPDATE applications
         SET compliance_status='IN_REVIEW',
             policy_status='ON_HOLD',
             updated_at=NOW()
         WHERE id=$1`,
        [application.id]
      );
    }

    return {
      ok: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      message: "No downstream automation yet.",
    };
  }

  // APPROVED + CRITICAL
  if (verificationStatus === "APPROVED" && riskTier === "CRITICAL") {
    if (application) {
      await pool.query(
        `INSERT INTO compliance_reviews (application_id, applicant_id, risk_score, risk_tier, status, reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [application.id, applicantId, riskScore, riskTier, "ESCALATED", "Critical risk score"]
      );

      await pool.query(
        `UPDATE applications
         SET compliance_status='ESCALATED',
             policy_status='REJECTED',
             updated_at=NOW()
         WHERE id=$1`,
        [application.id]
      );
    }

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "CRITICAL_RISK_ESCALATED",
      { applicantId, riskScore, riskTier, signals },
    ]);

    return {
      ok: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      message: "Critical risk detected. Rejected / escalated.",
    };
  }

  // APPROVED + HIGH
  if (verificationStatus === "APPROVED" && riskTier === "HIGH") {
    if (application) {
      await pool.query(
        `INSERT INTO compliance_reviews (application_id, applicant_id, risk_score, risk_tier, status, reason)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [application.id, applicantId, riskScore, riskTier, "PENDING_REVIEW", "High-risk approved applicant"]
      );

      await pool.query(
        `UPDATE applications
         SET compliance_status='IN_REVIEW',
             policy_status='ON_HOLD',
             updated_at=NOW()
         WHERE id=$1`,
        [application.id]
      );
    }

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "HIGH_RISK_SENT_TO_COMPLIANCE",
      { applicantId, riskScore, riskTier, signals },
    ]);

    return {
      ok: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      message: "High-risk case sent to compliance review. Policy issuance on hold.",
    };
  }

  // APPROVED + LOW/MEDIUM => create customer
  let customer;
  try {
    const customerRes = await pool.query(
      `INSERT INTO customers (external_id, full_name, email, risk_tier, risk_score)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [applicantId, fullName, email, riskTier, riskScore]
    );
    customer = customerRes.rows[0];
  } catch (e) {
    const existing = await pool.query("SELECT * FROM customers WHERE external_id=$1 LIMIT 1", [
      applicantId,
    ]);
    customer = existing.rows[0];
  }

  if (!application) {
    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "AUTOMATION_SKIPPED_NO_APPLICATION_LINK",
      { applicantId, riskScore, riskTier },
    ]);

    return {
      ok: true,
      skipped: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      message: "No linked application; customer created/fetched only.",
    };
  }

  // LOW => customer + policy + 12 months
  if (riskTier === "LOW") {
    const contractRes = await pool.query(
      "INSERT INTO contracts (customer_id, policy_number, status) VALUES ($1,$2,$3) RETURNING *",
      [customer.id, `POL-${uuid().slice(0, 8).toUpperCase()}`, "ISSUED"]
    );

    await pool.query(
      "INSERT INTO monitoring (customer_id, frequency) VALUES ($1,$2)",
      [customer.id, "12_MONTHS"]
    );

    await pool.query(
      `UPDATE applications
       SET customer_id=$1,
           contract_id=$2,
           compliance_status='CLEARED',
           policy_status='ISSUED',
           updated_at=NOW()
       WHERE id=$3`,
      [customer.id, contractRes.rows[0].id, application.id]
    );

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "LOW_RISK_POLICY_ISSUED",
      { applicantId, customer, contract: contractRes.rows[0], riskScore, riskTier },
    ]);

    return {
      ok: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      customer,
      contract: contractRes.rows[0],
      monitoring: "12_MONTHS",
    };
  }

  // MEDIUM => customer + monitoring only
  if (riskTier === "MEDIUM") {
    await pool.query(
      "INSERT INTO monitoring (customer_id, frequency) VALUES ($1,$2)",
      [customer.id, "6_MONTHS"]
    );

    await pool.query(
      `UPDATE applications
       SET customer_id=$1,
           compliance_status='CLEARED',
           policy_status='PENDING_POLICY',
           updated_at=NOW()
       WHERE id=$2`,
      [customer.id, application.id]
    );

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "MEDIUM_RISK_CUSTOMER_CREATED",
      { applicantId, customer, riskScore, riskTier, monitoring: "6_MONTHS" },
    ]);

    return {
      ok: true,
      applicantId,
      verificationStatus,
      riskScore,
      riskTier,
      decisionStatus,
      customer,
      monitoring: "6_MONTHS",
      message: "Medium-risk customer created with standard monitoring.",
    };
  }

  return {
    ok: true,
    applicantId,
    verificationStatus,
    riskScore,
    riskTier,
    decisionStatus,
    message: "Processed.",
  };
}

/**
 * POC webhook receiver (simulated)
 */
app.post("/api/webhook/sumsub", async (req, res) => {
  try {
    const out = await handleSumsubWebhook(req.body);
    res.json(out);
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * REAL webhook receiver
 */
app.post("/api/webhook/sumsub/real", async (req, res) => {
  try {
    const sig = verifySumsubWebhook(req);
    if (!sig.ok) {
      return res.status(401).json({ ok: false, error: "Invalid webhook signature", details: sig });
    }

    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!raw) return res.status(400).json({ ok: false, error: "Empty body" });

    const payload = JSON.parse(raw);

    const type = payload.type || payload.eventType || payload.webhookType || "unknown";
    const applicantId =
      payload.applicantId || payload.applicant?.id || payload.applicant?.applicantId || null;

    const eventId =
      payload.eventId ||
      payload.webhookId ||
      payload.id ||
      payload.externalId ||
      `${type}:${applicantId || "na"}:${payload.createdAt || Date.now()}`;

    try {
      await pool.query(
        "INSERT INTO sumsub_webhook_events (event_id, applicant_id, event_type) VALUES ($1,$2,$3)",
        [String(eventId), applicantId ? String(applicantId) : null, String(type)]
      );
    } catch (e) {
      return res.json({ ok: true, skipped: true, reason: "duplicate_event", eventId });
    }

    const reviewAnswer = payload.reviewResult?.reviewAnswer || payload.reviewResult?.reviewStatus;
    const rejectLabels = payload.reviewResult?.rejectLabels || [];
    const typeLower = String(type || "").toLowerCase();

    let mappedStatus = "pending";
    if (String(reviewAnswer || "").toUpperCase() === "GREEN") mappedStatus = "approved";
    if (String(reviewAnswer || "").toUpperCase() === "RED") mappedStatus = "rejected";
    if (typeLower.includes("pending")) mappedStatus = "pending";
    if (typeLower.includes("review")) mappedStatus = "review";

    const labelsText = Array.isArray(rejectLabels) ? rejectLabels.join(" ").toLowerCase() : "";

    const internalPayload = {
      applicantId,
      status: mappedStatus,
      fullName: payload.externalUserId || payload.applicant?.info?.firstName || "Unknown",
      email: payload.applicant?.email || "unknown@example.com",

      pepMatch:
        labelsText.includes("pep") ||
        labelsText.includes("politically exposed") ||
        Boolean(payload.pepMatch),

      sanctionsMatch:
        labelsText.includes("sanction") ||
        labelsText.includes("watchlist") ||
        Boolean(payload.sanctionsMatch),

      adverseMedia:
        labelsText.includes("adverse media") ||
        Boolean(payload.adverseMedia),

      documentFraudDetected:
        labelsText.includes("tamper") ||
        labelsText.includes("fraud") ||
        labelsText.includes("forg") ||
        Boolean(payload.documentFraudDetected),

      faceMismatch:
        labelsText.includes("face") ||
        labelsText.includes("selfie") ||
        Boolean(payload.faceMismatch),

      highRiskCountry:
        labelsText.includes("country risk") ||
        labelsText.includes("high risk country") ||
        Boolean(payload.highRiskCountry),

      deviceOrIpMismatch:
        labelsText.includes("device") ||
        labelsText.includes("ip mismatch") ||
        Boolean(payload.deviceOrIpMismatch),

      manualReviewRequired:
        mappedStatus === "review" ||
        typeLower.includes("review") ||
        Boolean(payload.manualReviewRequired),

      sumsubType: type,
      sumsubReviewAnswer: reviewAnswer,
      sumsubRejectLabels: rejectLabels,
      sumsubEventId: eventId,
      rawSumsub: payload,
      sumsubSig: sig,
    };

    const out = await handleSumsubWebhook(internalPayload);

    return res.json({
      ok: true,
      skippedVerification: Boolean(sig.skippedVerification),
      eventId,
      applicantId,
      type,
      reviewAnswer,
      mappedStatus: internalPayload.status,
      ...out,
    });
  } catch (e) {
    console.error("Real webhook error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Create Sumsub applicant
 */
app.post("/api/sumsub/applicant", async (req, res) => {
  try {
    const { applicationId } = req.body || {};
    if (!applicationId) return res.status(400).json({ ok: false, error: "applicationId required" });

    const appRow = await pool.query(
      "SELECT id, full_name, email FROM applications WHERE id=$1 LIMIT 1",
      [Number(applicationId)]
    );
    if (appRow.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    const appToken = requireEnv("SUMSUB_APP_TOKEN");
    const baseUrl = "https://api.sumsub.com";

    const ts = Math.floor(Date.now() / 1000);
    const method = "POST";
    const apiPath = "/resources/applicants?levelName=id-and-liveness";

    const bodyObj = {
      externalUserId: `application_${applicationId}`,
      email: appRow.rows[0].email,
    };
    const body = JSON.stringify(bodyObj);

    const sig = signSumsubRequest({ ts, method, path: apiPath, body });

    const resp = await axios.post(`${baseUrl}${apiPath}`, bodyObj, {
      headers: {
        "X-App-Token": appToken,
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": sig,
        "Content-Type": "application/json",
      },
    });

    const applicantId = resp.data?.id || resp.data?.applicantId;
    if (!applicantId)
      return res.status(500).json({ ok: false, error: "No applicantId returned by Sumsub" });

    await pool.query(
      `UPDATE applications
       SET kyc_status='IN_PROGRESS',
           external_applicant_id=$1,
           updated_at=NOW()
       WHERE id=$2`,
      [applicantId, Number(applicationId)]
    );

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "SUMSUB_APPLICANT_CREATED",
      { applicationId, applicantId },
    ]);

    res.json({ ok: true, applicantId });
  } catch (e) {
    console.error("Sumsub applicant error:", e?.response?.data || e);
    res.status(500).json({
      ok: false,
      error: "Sumsub applicant create failed",
      details: e?.response?.data || e.message,
    });
  }
});

/**
 * Create Sumsub WebSDK access token
 */
app.post("/api/sumsub/access-token", async (req, res) => {
  try {
    const { applicationId } = req.body || {};
    if (!applicationId) return res.status(400).json({ ok: false, error: "applicationId required" });

    const userId = `application_${Number(applicationId)}`;
    const appToken = requireEnv("SUMSUB_APP_TOKEN");

    const ts = Math.floor(Date.now() / 1000);
    const method = "POST";

    const apiPath =
      `/resources/accessTokens?userId=${encodeURIComponent(userId)}` +
      `&levelName=${encodeURIComponent("id-and-liveness")}` +
      `&ttlInSecs=1800`;

    const body = "";
    const sig = signSumsubRequest({ ts, method, path: apiPath, body });

    const options = {
      method: "POST",
      hostname: "api.sumsub.com",
      path: apiPath,
      headers: {
        "X-App-Token": appToken,
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": sig,
        "Content-Length": "0",
      },
    };

    const respData = await new Promise((resolve, reject) => {
      const r = https.request(options, (resp) => {
        let data = "";
        resp.setEncoding("utf8");
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => resolve({ statusCode: resp.statusCode, data }));
      });
      r.on("error", reject);
      r.end();
    });

    if (respData.statusCode < 200 || respData.statusCode >= 300) {
      let details = respData.data;
      try {
        details = JSON.parse(respData.data);
      } catch {}
      console.error("Sumsub token error:", details);
      return res.status(500).json({ ok: false, error: "Sumsub access token failed", details });
    }

    let parsed = {};
    try {
      parsed = JSON.parse(respData.data);
    } catch {}

    const token = parsed?.token || parsed?.accessToken;
    if (!token)
      return res.status(500).json({ ok: false, error: "No token returned by Sumsub", details: parsed });

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "SUMSUB_ACCESS_TOKEN_CREATED",
      { applicationId, userId },
    ]);

    res.json({ ok: true, token, userId });
  } catch (e) {
    console.error("Sumsub token error:", e);
    res.status(500).json({ ok: false, error: "Sumsub access token failed", details: e.message });
  }
});

/**
 * Demo trigger
 */
app.post("/api/demo/trigger", async (req, res) => {
  try {
    const sample = {
      applicantId: `SUMSUB-${uuid().slice(0, 6)}`,
      status: "approved",
      fullName: "Jane Carter",
      email: "jane.carter@example.com",
      pepMatch: false,
      sanctionsMatch: false,
      adverseMedia: false,
      documentFraudDetected: false,
      faceMismatch: false,
      highRiskCountry: false,
      deviceOrIpMismatch: false,
      manualReviewRequired: false,
    };
    const out = await handleSumsubWebhook(sample);
    res.json(out);
  } catch (e) {
    console.error("Demo trigger error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Applications API
 */
app.post("/api/applications", async (req, res) => {
  try {
    const { fullName, email } = req.body || {};
    if (!fullName || !email) {
      return res.status(400).json({ ok: false, error: "fullName and email required" });
    }

    const out = await pool.query(
      "INSERT INTO applications (full_name, email) VALUES ($1,$2) RETURNING *",
      [fullName, email]
    );
    res.json({ ok: true, application: out.rows[0] });
  } catch (e) {
    console.error("Create application error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/applications", async (req, res) => {
  try {
    const out = await pool.query(
      `SELECT id, full_name, email, kyc_status, external_applicant_id, risk_score, risk_tier, decision_status, compliance_status, policy_status, monitoring_frequency, created_at
       FROM applications
       ORDER BY id DESC`
    );
    res.json({ ok: true, applications: out.rows });
  } catch (e) {
    console.error("List applications error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/applications/:id/start-kyc", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const applicantId = `SUMSUB-${uuid().slice(0, 10)}`;

    await pool.query(
      `UPDATE applications
       SET kyc_status='IN_PROGRESS',
           external_applicant_id=$1,
           updated_at=NOW()
       WHERE id=$2`,
      [applicantId, id]
    );

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "KYC_STARTED",
      { applicationId: id, applicantId },
    ]);

    res.json({ ok: true, applicantId });
  } catch (e) {
    console.error("Start KYC error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Customers list
 */
app.get("/api/customers", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT id, external_id, full_name, email, risk_tier, risk_score, created_at
         FROM customers
         ORDER BY id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM customers`),
    ]);

    res.json({
      ok: true,
      customers: dataRes.rows,
      page: { limit, offset, total: countRes.rows[0]?.total || 0 },
    });
  } catch (e) {
    console.error("List customers error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Contracts list
 */
app.get("/api/contracts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 100), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT c.id,
                c.customer_id,
                c.policy_number,
                c.status,
                c.created_at,
                cu.full_name AS customer_name,
                cu.email AS customer_email
         FROM contracts c
         JOIN customers cu ON cu.id = c.customer_id
         ORDER BY c.id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM contracts`),
    ]);

    res.json({
      ok: true,
      contracts: dataRes.rows,
      page: { limit, offset, total: countRes.rows[0]?.total || 0 },
    });
  } catch (e) {
    console.error("List contracts error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Contract PDF
 */
app.get("/api/contracts/:id/pdf", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const contractRes = await pool.query(
      `SELECT c.id, c.customer_id, c.policy_number, c.status, c.created_at
       FROM contracts c
       WHERE c.id=$1`,
      [id]
    );

    if (contractRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Contract not found" });
    }

    const contract = contractRes.rows[0];

    const customerRes = await pool.query(
      `SELECT id, full_name, email, risk_tier, risk_score
       FROM customers
       WHERE id=$1`,
      [contract.customer_id]
    );

    if (customerRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Customer not found for contract" });
    }

    const customer = customerRes.rows[0];
    const pdfBuffer = generateContractPDF({ customer, contract });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="contract_${contract.policy_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error("Contract PDF error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Summary
 */
app.get("/api/summary", async (req, res) => {
  try {
    const customers = await pool.query(
      "SELECT id, full_name, email, risk_tier, risk_score, created_at FROM customers ORDER BY id DESC LIMIT 5"
    );
    const audits = await pool.query(
      "SELECT id, event_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10"
    );
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM customers) AS customers,
        (SELECT COUNT(*)::int FROM contracts) AS contracts,
        (SELECT COUNT(*)::int FROM audit_logs) AS audits
    `);

    res.json({
      ok: true,
      customers: customers.rows,
      audits: audits.rows,
      counts: counts.rows[0],
    });
  } catch (e) {
    console.error("Summary error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Paginated audits
 */
app.get("/api/audits", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 25), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const q = String(req.query.q || "").trim();

    const where = q ? "WHERE event_type ILIKE $3" : "";
    const params = q ? [limit, offset, `%${q}%`] : [limit, offset];

    const dataSql = `
      SELECT id, event_type, payload, created_at
      FROM audit_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM audit_logs
      ${q ? "WHERE event_type ILIKE $1" : ""}
    `;

    const [dataRes, countRes] = await Promise.all([
      pool.query(dataSql, params),
      q ? pool.query(countSql, [`%${q}%`]) : pool.query(countSql),
    ]);

    res.json({
      ok: true,
      audits: dataRes.rows,
      page: { limit, offset, total: countRes.rows[0]?.total || 0 },
    });
  } catch (e) {
    console.error("List audits error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Audit export
 */
app.get("/api/audit/export", async (req, res) => {
  try {
    const out = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC");
    const records = out.rows.map((r) => ({
      id: r.id,
      event_type: r.event_type,
      created_at: r.created_at,
      payload: JSON.stringify(r.payload || {}),
    }));

    const csv = stringify(records, { header: true });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="audit_logs.csv"');
    res.send(csv);
  } catch (e) {
    console.error("Export error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Serve client build
 */
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`PolicyFlow AI running on ${port}`);
});
