// server/index.js (full webhook + API + PDF + automation)
// Save this entire file as server/index.js (it contains routes used by the client)
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
const { detectDocumentFraud, detectFaceMismatch, detectSanctionsOrPep } = require("./sumsubHelpers");
const path = require("path");

const app = express();
app.use(cors());

// IMPORTANT: raw body for Sumsub real webhook (needed for signature verification)
app.use("/api/webhook/sumsub/real", express.raw({ type: "*/*" }));
app.use(express.json());

// simple health
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Demo trigger (simulate incoming mapped payload)
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
    sumsubEventId,
  } = payload;

  const verificationStatus = String(status || "pending").toUpperCase();

  // log event (non blocking)
  try {
    await pool.query("INSERT INTO sumsub_webhook_events (event_id, applicant_id, event_type) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING", [
      sumsubEventId || uuid(),
      applicantId || null,
      "sumsub_review",
    ]);
  } catch (e) {
    console.error("sumsub event insert failed", e.message || e);
  }

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "WEBHOOK_RECEIVED",
    { payload },
  ]);

  // scoring
  const { score: riskScore, flags } = calculateRiskScore({ pepMatch, sanctionsMatch, adverseMedia, documentFraudDetected, faceMismatch, highRiskCountry, deviceOrIpMismatch, manualReviewRequired });
  const riskTier = assignRiskTierFromScore(riskScore);
  const decisionStatus = determineKycDecision({ verificationStatus, riskTier });
  const monitoring = monitoringFrequencyForTier(riskTier);

  // find application if linked
  const appRes = await pool.query("SELECT id FROM applications WHERE external_applicant_id=$1 LIMIT 1", [applicantId]);
  const application = appRes.rows[0] || null;

  // update application
  if (application) {
    await pool.query(
      `UPDATE applications SET kyc_status=$1, risk_score=$2, risk_tier=$3, decision_status=$4, monitoring_frequency=$5, updated_at=NOW() WHERE external_applicant_id=$6`,
      [verificationStatus, riskScore, riskTier, decisionStatus, monitoring, applicantId]
    );
  }

  // Business logic
  if (verificationStatus === "REJECTED") {
    if (application) {
      await pool.query("UPDATE applications SET compliance_status='REJECTED', policy_status='REJECTED', updated_at=NOW() WHERE id=$1", [application.id]);
    }
    return { ok: true, applicantId, verificationStatus, riskScore, riskTier, message: "Rejected" };
  }

  if (verificationStatus === "PENDING" || verificationStatus === "REVIEW") {
    if (application && verificationStatus === "REVIEW") {
      await pool.query(
        "INSERT INTO compliance_reviews (application_id, applicant_id, risk_score, risk_tier, status, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())",
        [application.id, applicantId, riskScore, riskTier, "PENDING_REVIEW", "Manual review required"]
      );
      await pool.query("UPDATE applications SET compliance_status='IN_REVIEW', policy_status='ON_HOLD', updated_at=NOW() WHERE id=$1", [application.id]);
    }
    return { ok: true, applicantId, verificationStatus, riskScore, riskTier, message: "Pending / Review" };
  }

  // APPROVED branches
  if (verificationStatus === "APPROVED" && (riskTier === "HIGH" || riskTier === "CRITICAL")) {
    if (application) {
      await pool.query("INSERT INTO compliance_reviews (application_id, applicant_id, risk_score, risk_tier, status, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())",
        [application.id, applicantId, riskScore, riskTier, "ESCALATED", "High/Critical risk"]);
      await pool.query("UPDATE applications SET compliance_status='IN_REVIEW', policy_status='ON_HOLD', updated_at=NOW() WHERE id=$1", [application.id]);
    }
    return { ok: true, applicantId, verificationStatus, riskScore, riskTier, message: "Escalated to compliance" };
  }

  // APPROVED + LOW or MEDIUM -> create customer & maybe contract
  const client = await pool.connect();
  let customer = null;
  let createdContract = null;
  try {
    await client.query("BEGIN");
    const upsertCust = `
      INSERT INTO customers (external_id, full_name, email, risk_tier, risk_score, created_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (external_id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            risk_tier = EXCLUDED.risk_tier,
            risk_score = EXCLUDED.risk_score
      RETURNING *;
    `;
    const custRes = await client.query(upsertCust, [applicantId, fullName || "Unknown", email || "unknown@example.com", riskTier, riskScore]);
    customer = custRes.rows[0];

    if (application) {
      await client.query("UPDATE applications SET customer_id=$1, risk_score=$2, risk_tier=$3, updated_at=NOW() WHERE id=$4", [customer.id, riskScore, riskTier, application.id]);
    }

    if (riskTier === "LOW") {
      const policyNo = `POL-UK-2026-${Math.floor(100000 + Math.random()*900000)}`;
      const insertContract = `
        INSERT INTO contracts (customer_id, policy_number, status, created_at, coverage_start, coverage_end, coverage_description, coverage_limit, deductible, premium, payment_frequency, insurer, insurer_address, policyholder_address, dob, sumsub_verification_id, sumsub_status, sumsub_verified_at, monitoring_frequency)
        VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING *;
      `;
      const coverageStart = new Date().toISOString();
      const coverageEnd = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString();
      const contractRes = await client.query(insertContract, [
        customer.id,
        policyNo,
        "ISSUED",
        coverageStart,
        coverageEnd,
        "Comprehensive coverage for private motor vehicle including accidental damage, theft, and third-party liability.",
        "£50,000",
        "£500",
        "£820",
        "Monthly",
        "Northern Shield Insurance Ltd",
        "42 Bishopsgate, London, UK",
        "14 Kingsway Avenue, Manchester, UK",
        "1985-07-21",
        payload?.sumsubEventId || null,
        "Approved",
        new Date().toISOString(),
        monitoring
      ]);
      createdContract = contractRes.rows[0];

      await client.query("INSERT INTO monitoring (customer_id, frequency, created_at) VALUES ($1,$2,NOW())", [customer.id, "12_MONTHS"]);

      if (application) {
        await client.query("UPDATE applications SET contract_id=$1, compliance_status='CLEARED', policy_status='ISSUED', updated_at=NOW() WHERE id=$2", [createdContract.id, application.id]);
      }
    }

    if (riskTier === "MEDIUM") {
      await client.query("INSERT INTO monitoring (customer_id, frequency, created_at) VALUES ($1,$2,NOW())", [customer.id, "6_MONTHS"]);

      if (application) {
        await client.query("UPDATE applications SET compliance_status='CLEARED', policy_status='PENDING_POLICY', updated_at=NOW() WHERE id=$1", [application.id]);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Transaction error:", err);
    throw err;
  } finally {
    client.release();
  }

  // optionally generate PDF for created contract
  if (createdContract) {
    try {
      const custRow = (await pool.query("SELECT id, full_name, email, risk_tier, risk_score FROM customers WHERE id=$1", [customer.id])).rows[0];
      const pdf = await generateContractPDF({ customer: custRow, contract: createdContract });
      // optionally store/upload PDF
    } catch (e) {
      console.error("PDF generation error:", e);
    }
  }

  return {
    ok: true,
    applicantId,
    verificationStatus,
    riskScore,
    riskTier,
    customer,
    contract: createdContract,
  };
}

/**
 * POC webhook endpoint (unsigned test)
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
 * REAL signed webhook receiver
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

    // map payload to normalized internal format
    const type = payload.type || payload.eventType || "review";
    const reviewAnswer = payload.reviewResult?.reviewAnswer || payload.reviewResult?.reviewStatus;
    let mappedStatus = "pending";
    if (String(reviewAnswer || "").toUpperCase() === "GREEN") mappedStatus = "approved";
    if (String(reviewAnswer || "").toUpperCase() === "RED") mappedStatus = "rejected";
    if ((type || "").toLowerCase().includes("review")) mappedStatus = "review";

    const rejectLabels = payload.reviewResult?.rejectLabels || [];
    const labelsText = Array.isArray(rejectLabels) ? rejectLabels.join(" ").toLowerCase() : "";

    const internalPayload = {
      applicantId: payload.applicantId || payload.applicant?.id || payload.externalUserId || null,
      status: mappedStatus,
      fullName: payload.applicant?.info?.firstName || payload.externalUserId || "Unknown",
      email: payload.applicant?.email || "unknown@example.com",
      pepMatch: labelsText.includes("pep") || Boolean(payload.pepMatch),
      sanctionsMatch: labelsText.includes("sanction") || Boolean(payload.sanctionsMatch),
      adverseMedia: labelsText.includes("adverse media") || Boolean(payload.adverseMedia),
      documentFraudDetected: labelsText.includes("tamper") || labelsText.includes("fraud") || Boolean(payload.documentFraudDetected),
      faceMismatch: labelsText.includes("face") || labelsText.includes("selfie") || Boolean(payload.faceMismatch),
      highRiskCountry: labelsText.includes("country risk") || Boolean(payload.highRiskCountry),
      deviceOrIpMismatch: labelsText.includes("device") || labelsText.includes("ip mismatch") || Boolean(payload.deviceOrIpMismatch),
      manualReviewRequired: mappedStatus === "review" || Boolean(payload.manualReviewRequired),
      sumsubEventId: payload.eventId || payload.webhookId || `${type}:${Date.now()}`,
      raw: payload,
    };

    const fraudCheck = detectDocumentFraud(payload);
    const faceCheck = detectFaceMismatch(payload);
    const pepSanctions = detectSanctionsOrPep(payload);

    internalPayload.documentFraudDetected = internalPayload.documentFraudDetected || fraudCheck.isFraud;
    internalPayload.faceMismatch = internalPayload.faceMismatch || faceCheck.isMismatch;
    internalPayload.pepMatch = internalPayload.pepMatch || pepSanctions.details.pep;
    internalPayload.sanctionsMatch = internalPayload.sanctionsMatch || pepSanctions.details.sanctions;

    if (internalPayload.documentFraudDetected) internalPayload.status = "rejected";
    if (internalPayload.sanctionsMatch) internalPayload.status = "rejected";
    if (internalPayload.faceMismatch && String(internalPayload.status).toLowerCase() === "approved") internalPayload.status = "review";

    const out = await handleSumsubWebhook(internalPayload);
    return res.json({ ok: true, eventId: internalPayload.sumsubEventId, ...out });
  } catch (e) {
    console.error("Real webhook error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Create Sumsub applicant (helper)
 */
app.post("/api/sumsub/applicant", async (req, res) => {
  try {
    const { applicationId } = req.body || {};
    if (!applicationId) return res.status(400).json({ ok: false, error: "applicationId required" });
    const row = await pool.query("SELECT id, full_name, email FROM applications WHERE id=$1 LIMIT 1", [Number(applicationId)]);
    if (row.rows.length === 0) return res.status(404).json({ ok: false, error: "Application not found" });
    const applicantId = `SUMSUB-${Math.floor(Math.random()*900000)+100000}`;
    await pool.query("UPDATE applications SET kyc_status='IN_PROGRESS', external_applicant_id=$1, updated_at=NOW() WHERE id=$2", [applicantId, applicationId]);
    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", ["SUMSUB_APPLICANT_CREATED", { applicationId, applicantId }]);
    res.json({ ok: true, applicantId });
  } catch (e) {
    console.error("Sumsub applicant error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Contracts PDF endpoint
 */
app.get("/api/contracts/:id/pdf", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const contractRes = await pool.query("SELECT c.*, cu.full_name AS customer_name, cu.email AS customer_email FROM contracts c JOIN customers cu ON cu.id = c.customer_id WHERE c.id=$1", [id]);
    if (contractRes.rows.length === 0) return res.status(404).json({ ok: false, error: "Contract not found" });
    const contract = contractRes.rows[0];
    const customer = { id: contract.customer_id, full_name: contract.customer_name, email: contract.customer_email, risk_tier: contract.risk_tier, risk_score: contract.risk_score };
    const pdfBuffer = await generateContractPDF({ customer, contract });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="contract_${contract.policy_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error("Contract PDF error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Minimal apps: create application, list customers/contracts/compliance
 */
app.post("/api/applications", async (req, res) => {
  try {
    const { fullName, email } = req.body || {};
    if (!fullName || !email) return res.status(400).json({ ok: false, error: "fullName and email required" });
    const out = await pool.query("INSERT INTO applications (full_name, email, created_at) VALUES ($1,$2,NOW()) RETURNING *", [fullName, email]);
    res.json({ ok: true, application: out.rows[0] });
  } catch (e) {
    console.error("Create application error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/contracts", async (req, res) => {
  try {
    const { customerId } = req.query;
    const where = customerId ? "WHERE customer_id = $1" : "";
    const params = customerId ? [Number(customerId)] : [];
    const out = await pool.query(`SELECT * FROM contracts ${where} ORDER BY created_at DESC`, params);
    res.json({ ok: true, contracts: out.rows });
  } catch (e) {
    console.error("List contracts error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const out = await pool.query("SELECT * FROM customers ORDER BY id DESC");
    res.json({ ok: true, customers: out.rows });
  } catch (e) {
    console.error("List customers error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/compliance/reviews", async (req, res) => {
  try {
    const out = await pool.query("SELECT * FROM compliance_reviews ORDER BY created_at DESC");
    res.json({ ok: true, reviews: out.rows });
  } catch (e) {
    console.error("List compliance reviews error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// serve static client if exists
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ ok: false, error: "Not found" });
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`PolicyFlow AI running on ${port}`);
});

