require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
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

const app = express();
app.use(cors());
app.use(express.json());

function mapDbError(error) {
  return { ok: false, error: error.message || "Server error" };
}

async function safeQuery(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (e) {
    console.error("DB error:", e);
    throw e;
  }
}

app.get("/api/debug/env", async (req, res) => {
  res.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV || "development",
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
  });
});

app.get("/api/summary", async (req, res) => {
  try {
    const customers = await safeQuery(
      "SELECT * FROM customers ORDER BY created_at DESC LIMIT 10"
    );
    const audits = await safeQuery(
      "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10"
    );
    const contracts = await safeQuery(
      "SELECT * FROM contracts ORDER BY created_at DESC LIMIT 10"
    );

    const counts = await safeQuery(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM contracts) AS contracts,
        (SELECT COUNT(*) FROM audit_logs) AS audits,
        (SELECT COUNT(*) FROM applications) AS applications
    `);

    res.json({
      ok: true,
      counts: counts.rows[0] || {},
      customers: customers.rows || [],
      audits: audits.rows || [],
      contracts: contracts.rows || [],
    });
  } catch (e) {
    console.error("Summary error:", e);
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
        updated_at
      FROM applications
      ORDER BY id DESC
    `);

    res.json({
      ok: true,
      applications: result.rows || [],
    });
  } catch (e) {
    console.error("Applications list error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications", async (req, res) => {
  try {
    const { fullName, email } = req.body;

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

    await safeQuery(
      "INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)",
      [
        "APPLICATION_CREATED",
        {
          applicationId: result.rows[0].id,
          fullName,
          email,
        },
      ]
    );

    res.json({
      ok: true,
      application: result.rows[0],
    });
  } catch (e) {
    console.error("Create application error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications/:id/start-kyc", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const existing = await safeQuery("SELECT * FROM applications WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    const externalApplicantId = `SUMSUB-${uuid().slice(0, 8)}`;

    const updated = await safeQuery(
      `
      UPDATE applications
      SET kyc_status = 'IN_PROGRESS',
          external_applicant_id = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id, externalApplicantId]
    );

    await safeQuery(
      "INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)",
      [
        "KYC_STARTED",
        {
          applicationId: id,
          externalApplicantId,
        },
      ]
    );

    res.json({
      ok: true,
      application: updated.rows[0],
    });
  } catch (e) {
    console.error("Start KYC error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/webhook/sumsub", async (req, res) => {
  try {
    const payload = req.body || {};

    const applicantId = payload.applicantId || payload.externalApplicantId || payload.applicant_id;
    const statusRaw = payload.status || payload.reviewStatus || "approved";
    const verificationStatus = String(statusRaw).toUpperCase();

    const signalsInput = {
      pepMatch: Boolean(payload.pepMatch),
      sanctionsMatch: Boolean(payload.sanctionsMatch),
      adverseMedia: Boolean(payload.adverseMedia),
      documentFraudDetected: Boolean(payload.documentFraudDetected),
      faceMismatch: Boolean(payload.faceMismatch),
      highRiskCountry: Boolean(payload.highRiskCountry),
      deviceOrIpMismatch: Boolean(payload.deviceOrIpMismatch),
      manualReviewRequired: Boolean(payload.manualReviewRequired),
    };

    const { score, reasons } = calculateRiskScore(signalsInput);
    const riskTier = assignRiskTierFromScore(score);
    const decision = determineKycDecision({
      verificationStatus,
      riskTier,
    });
    const monitoringFrequency = monitoringFrequencyForTier(riskTier);

    const appRes = await safeQuery(
      `
      SELECT *
      FROM applications
      WHERE external_applicant_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [applicantId]
    );

    if (appRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Application not found for applicantId" });
    }

    const application = appRes.rows[0];

    let complianceStatus = "NOT_REQUIRED";
    let policyStatus = "NOT_STARTED";
    let customer = null;
    let contract = null;

    if (verificationStatus === "APPROVED") {
      if (riskTier === "LOW") {
        complianceStatus = "NOT_REQUIRED";
        policyStatus = "GENERATED";
      } else if (riskTier === "MEDIUM") {
        complianceStatus = "REVIEW_REQUIRED";
        policyStatus = "PENDING_REVIEW";
      } else {
        complianceStatus = "IN_REVIEW";
        policyStatus = "ON_HOLD";
      }
    } else if (verificationStatus === "REJECTED") {
      complianceStatus = "REJECTED";
      policyStatus = "DECLINED";
    } else {
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
        decision,
        complianceStatus,
        policyStatus,
        monitoringFrequency,
      ]
    );

    if (verificationStatus === "APPROVED" && (riskTier === "LOW" || riskTier === "MEDIUM")) {
      const customerRes = await safeQuery(
        `
        INSERT INTO customers (external_id, full_name, email, risk_tier, risk_score)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          applicantId,
          application.full_name,
          application.email,
          riskTier,
          score,
        ]
      );

      customer = customerRes.rows[0];

      await safeQuery(
        `
        UPDATE applications
        SET customer_id = $2
        WHERE id = $1
        `,
        [application.id, customer.id]
      );

      if (riskTier === "LOW") {
        const contractRes = await safeQuery(
          `
          INSERT INTO contracts (customer_id, policy_number, status)
          VALUES ($1, $2, $3)
          RETURNING *
          `,
          [
            customer.id,
            `POL-UK-${new Date().getFullYear()}-${String(customer.id).padStart(6, "0")}`,
            "Generated",
          ]
        );

        contract = contractRes.rows[0];

        await safeQuery(
          `
          UPDATE applications
          SET contract_id = $2
          WHERE id = $1
          `,
          [application.id, contract.id]
        );
      }

      if (monitoringFrequency) {
        await safeQuery(
          `
          INSERT INTO monitoring (customer_id, frequency)
          VALUES ($1, $2)
          `,
          [customer.id, monitoringFrequency]
        );
      }
    }

    if (riskTier === "HIGH" || riskTier === "CRITICAL" || complianceStatus === "REVIEW_REQUIRED" || complianceStatus === "IN_REVIEW") {
      await safeQuery(
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
        `,
        [
          application.id,
          applicantId,
          score,
          riskTier,
          "PENDING_REVIEW",
          reasons.join("; "),
        ]
      );
    }

    await safeQuery(
      "INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)",
      [
        "SUMSUB_WEBHOOK_PROCESSED",
        {
          applicationId: application.id,
          applicantId,
          verificationStatus,
          score,
          riskTier,
          decision,
          reasons,
        },
      ]
    );

    res.json({
      ok: true,
      application: updatedApp.rows[0],
      customer,
      contract,
      reasons,
    });
  } catch (e) {
    console.error("Webhook processing error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/demo/trigger", async (req, res) => {
  try {
    const fullName = "James Carter";
    const email = `james.carter.${Date.now()}@example.com`;

    const appCreate = await safeQuery(
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

    const createdApp = appCreate.rows[0];
    const applicantId = `SUMSUB-${uuid().slice(0, 8)}`;

    await safeQuery(
      `
      UPDATE applications
      SET external_applicant_id = $2, kyc_status = 'IN_PROGRESS', updated_at = NOW()
      WHERE id = $1
      `,
      [createdApp.id, applicantId]
    );

    req.body = {
      applicantId,
      status: "approved",
      pepMatch: false,
      sanctionsMatch: false,
      adverseMedia: false,
      documentFraudDetected: false,
      faceMismatch: false,
      highRiskCountry: false,
      deviceOrIpMismatch: false,
      manualReviewRequired: false,
    };

    app._router.handle(req, res, () => {});
  } catch (e) {
    console.error("Demo trigger error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const result = await safeQuery("SELECT * FROM customers ORDER BY created_at DESC");
    res.json({ ok: true, customers: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/contracts", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT
        c.*,
        cu.full_name,
        cu.email,
        cu.risk_tier
      FROM contracts c
      LEFT JOIN customers cu ON cu.id = c.customer_id
      ORDER BY c.created_at DESC
    `);
    res.json({ ok: true, contracts: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/compliance-reviews", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT *
      FROM compliance_reviews
      ORDER BY created_at DESC
    `);
    res.json({ ok: true, reviews: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/verified-results", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT *
      FROM applications
      WHERE kyc_status IN ('APPROVED', 'REVIEW', 'REJECTED')
      ORDER BY updated_at DESC NULLS LAST, id DESC
    `);
    res.json({ ok: true, results: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/audits", async (req, res) => {
  try {
    const result = await safeQuery(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ ok: true, audits: result.rows || [] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/contracts/:id/pdf", async (req, res) => {
  try {
    const contractRes = await safeQuery(
      "SELECT * FROM contracts WHERE id = $1",
      [req.params.id]
    );

    if (contractRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Contract not found" });
    }

    const contract = contractRes.rows[0];

    const customerRes = await safeQuery(
      "SELECT * FROM customers WHERE id = $1",
      [contract.customer_id]
    );

    const customer = customerRes.rows[0] || null;

    let application = null;
    if (customer) {
      const appRes = await safeQuery(
        `
        SELECT *
        FROM applications
        WHERE customer_id = $1
        ORDER BY id DESC
        LIMIT 1
        `,
        [customer.id]
      );
      application = appRes.rows[0] || null;
    }

    const pdf = generateContractPDF({
      customer,
      contract,
      application,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${contract.policy_number}.pdf"`
    );
    res.send(pdf);
  } catch (e) {
    console.error("PDF error:", e);
    res.status(500).json(mapDbError(e));
  }
});

app.get("/api/audit/export", async (req, res) => {
  try {
    const logs = await safeQuery("SELECT * FROM audit_logs ORDER BY created_at DESC");
    const csv = stringify(logs.rows, { header: true });
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
  console.log(`✅ PolicyFlow AI running on port ${PORT}`);
});