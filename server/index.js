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
const { sumsubRequest } = require("./sumsub");

const app = express();
app.use(cors());
app.use(express.json());

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
  if (value === "GREEN") return "APPROVED";
  if (value === "RED") return "REJECTED";
  return "PENDING";
}

function buildSignalPayload(payload = {}) {
  return {
    pepMatch: Boolean(payload.pepMatch),
    sanctionsMatch: Boolean(payload.sanctionsMatch),
    adverseMedia: Boolean(payload.adverseMedia),
    documentFraudDetected: Boolean(payload.documentFraudDetected),
    faceMismatch: Boolean(payload.faceMismatch),
    highRiskCountry: Boolean(payload.highRiskCountry),
    deviceOrIpMismatch: Boolean(payload.deviceOrIpMismatch),
    manualReviewRequired: Boolean(payload.manualReviewRequired),
  };
}

app.get("/api/debug/env", async (req, res) => {
  res.json({
    ok: true,
    nodeEnv: process.env.NODE_ENV || "development",
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasSumsubAppToken: Boolean(process.env.SUMSUB_APP_TOKEN),
    hasSumsubSecretKey: Boolean(process.env.SUMSUB_SECRET_KEY),
  });
});

app.get("/api/summary", async (req, res) => {
  try {
    const counts = await safeQuery(`
      SELECT
        (SELECT COUNT(*) FROM applications) AS applications,
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM contracts) AS contracts,
        (SELECT COUNT(*) FROM audit_logs) AS audits
    `);

    const customers = await safeQuery(`
      SELECT *
      FROM customers
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const audits = await safeQuery(`
      SELECT *
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const contracts = await safeQuery(`
      SELECT c.*, cu.full_name, cu.email, cu.risk_tier
      FROM contracts c
      LEFT JOIN customers cu ON cu.id = c.customer_id
      ORDER BY c.created_at DESC
      LIMIT 10
    `);

    res.json({
      ok: true,
      counts: counts.rows[0] || {},
      customers: customers.rows || [],
      audits: audits.rows || [],
      contracts: contracts.rows || [],
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
        updated_at
      FROM applications
      ORDER BY id DESC
    `);

    res.json({
      ok: true,
      applications: result.rows || [],
    });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/applications", async (req, res) => {
  try {
    const { fullName, email } = req.body || {};

    if (!fullName || !email) {
      return res.status(400).json({
        ok: false,
        error: "fullName and email are required",
      });
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
      `INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`,
      ["APPLICATION_CREATED", { applicationId: result.rows[0].id, fullName, email }]
    );

    res.json({ ok: true, application: result.rows[0] });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/sumsub/applicant", async (req, res) => {
  try {
    const { applicationId } = req.body || {};
    if (!applicationId) {
      return res.status(400).json({ ok: false, error: "applicationId is required" });
    }

    const appRes = await safeQuery(`SELECT * FROM applications WHERE id = $1`, [applicationId]);
    if (!appRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    const application = appRes.rows[0];
    if (application.external_applicant_id) {
      return res.json({
        ok: true,
        applicantId: application.external_applicant_id,
        application,
      });
    }

    const externalUserId = `policyflow-${application.id}-${uuid()}`;

    const applicant = await sumsubRequest({
      method: "POST",
      path: "/resources/applicants?levelName=basic-kyc-level",
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

    const updated = await safeQuery(
      `
      UPDATE applications
      SET external_applicant_id = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [applicationId, applicantId]
    );

    await safeQuery(
      `INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`,
      ["SUMSUB_APPLICANT_CREATED", { applicationId, applicantId }]
    );

    res.json({
      ok: true,
      applicantId,
      application: updated.rows[0],
    });
  } catch (e) {
    res.status(500).json(mapDbError(e));
  }
});

app.post("/api/sumsub/access-token", async (req, res) => {
  try {
    const { applicationId } = req.body || {};
    if (!applicationId) {
      return res.status(400).json({ ok: false, error: "applicationId is required" });
    }

    const appRes = await safeQuery(`SELECT * FROM applications WHERE id = $1`, [applicationId]);
    if (!appRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Application not found" });
    }

    const application = appRes.rows[0];

    let applicantId = application.external_applicant_id;
    if (!applicantId) {
      return res.status(400).json({
        ok: false,
        error: "No Sumsub applicant exists. Create applicant first.",
      });
    }

    const tokenData = await sumsubRequest({
      method: "POST",
      path: "/resources/accessTokens/sdk",
      body: {
        userId: String(application.id),
        applicantIdentifiers: {
          email: application.email,
        },
        ttlInSecs: 1800,
        levelName: "basic-kyc-level",
      },
    });

    res.json({
      ok: true,
      applicantId,
      token: tokenData?.token,
      userId: tokenData?.userId,
    });
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
        path: "/resources/applicants?levelName=basic-kyc-level",
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
        SET
          external_applicant_id = $2,
          kyc_status = 'IN_PROGRESS',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id, applicantId]
      );
      application = updatedApplicant.rows[0];
    } else {
      const updatedApplicant = await safeQuery(
        `
        UPDATE applications
        SET
          kyc_status = 'IN_PROGRESS',
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [id]
      );
      application = updatedApplicant.rows[0];
    }

    const tokenData = await sumsubRequest({
      method: "POST",
      path: "/resources/accessTokens/sdk",
      body: {
        userId: String(application.id),
        applicantIdentifiers: {
          email: application.email,
        },
        ttlInSecs: 1800,
        levelName: "basic-kyc-level",
      },
    });

    await safeQuery(
      `INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`,
      [
        "KYC_STARTED",
        {
          applicationId: id,
          externalApplicantId: application.external_applicant_id,
        },
      ]
    );

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
    const payload = req.body || {};
    const applicantId =
      payload.applicantId || payload.externalApplicantId || payload.applicant_id || null;

    if (!applicantId) {
      return res.status(400).json({ ok: false, error: "applicantId is required" });
    }

    const verificationStatus = normalizeVerificationStatus(
      payload.status || payload.reviewStatus || payload.verificationStatus
    );

    const signals = buildSignalPayload(payload);
    const { score, reasons } = calculateRiskScore(signals);
    const riskTier = assignRiskTierFromScore(score);
    const decisionStatus = determineKycDecision({
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

    if (!appRes.rows.length) {
      return res.status(404).json({
        ok: false,
        error: "Application not found for applicantId",
      });
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
        complianceStatus = "NOT_REQUIRED";
        policyStatus = "MONITORING_ONLY";
      } else if (riskTier === "HIGH") {
        complianceStatus = "IN_REVIEW";
        policyStatus = "ON_HOLD";
      } else if (riskTier === "CRITICAL") {
        complianceStatus = "ESCALATED";
        policyStatus = "REJECTED";
      }
    } else if (verificationStatus === "REJECTED") {
      complianceStatus = "REJECTED";
      policyStatus = "REJECTED";
    } else if (verificationStatus === "REVIEW") {
      complianceStatus = "IN_REVIEW";
      policyStatus = "ON_HOLD";
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
        decisionStatus,
        complianceStatus,
        policyStatus,
        monitoringFrequency,
      ]
    );

    if (verificationStatus === "APPROVED" && (riskTier === "LOW" || riskTier === "MEDIUM")) {
      const existingCustomer = await safeQuery(
        `SELECT * FROM customers WHERE external_id = $1 ORDER BY id DESC LIMIT 1`,
        [applicantId]
      );

      if (existingCustomer.rows.length) {
        customer = existingCustomer.rows[0];
      } else {
        const customerRes = await safeQuery(
          `
          INSERT INTO customers (external_id, full_name, email, risk_tier, risk_score)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
          `,
          [applicantId, application.full_name, application.email, riskTier, score]
        );
        customer = customerRes.rows[0];
      }

      await safeQuery(
        `UPDATE applications SET customer_id = $2 WHERE id = $1`,
        [application.id, customer.id]
      );

      if (riskTier === "LOW") {
        const existingContract = await safeQuery(
          `SELECT * FROM contracts WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
          [customer.id]
        );

        if (existingContract.rows.length) {
          contract = existingContract.rows[0];
        } else {
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
              monitoringFrequency || "12_MONTHS",
            ]
          );
          contract = contractRes.rows[0];
        }

        await safeQuery(
          `UPDATE applications SET contract_id = $2 WHERE id = $1`,
          [application.id, contract.id]
        );
      }

      if (monitoringFrequency) {
        const monitoringCheck = await safeQuery(
          `SELECT * FROM monitoring WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
          [customer.id]
        );

        if (!monitoringCheck.rows.length) {
          await safeQuery(
            `INSERT INTO monitoring (customer_id, frequency) VALUES ($1, $2)`,
            [customer.id, monitoringFrequency]
          );
        }
      }
    }

    if (
      riskTier === "MEDIUM" ||
      riskTier === "HIGH" ||
      riskTier === "CRITICAL" ||
      verificationStatus === "REVIEW"
    ) {
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
        [application.id, applicantId, score, riskTier, "PENDING_REVIEW", reasons.join("; ")]
      );
    }

    await safeQuery(
      `INSERT INTO audit_logs (event_type, payload) VALUES ($1, $2)`,
      [
        "SUMSUB_WEBHOOK_PROCESSED",
        {
          applicationId: application.id,
          applicantId,
          verificationStatus,
          signals,
          score,
          riskTier,
          reasons,
          decisionStatus,
        },
      ]
    );

    res.json({
      ok: true,
      application: updatedApp.rows[0],
      customer,
      contract,
      score,
      riskTier,
      reasons,
      signals,
    });
  } catch (e) {
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

app.get("/api/compliance-reviews", async (req, res) => {
  try {
    const result = await safeQuery(`SELECT * FROM compliance_reviews ORDER BY created_at DESC`);
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
      WHERE kyc_status IN ('APPROVED', 'REJECTED', 'PENDING', 'REVIEW')
         OR decision_status IN ('AUTO_APPROVED', 'STANDARD_MONITORING', 'MANUAL_REVIEW', 'REJECT_ESCALATE')
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
    const contractRes = await safeQuery(`SELECT * FROM contracts WHERE id = $1`, [req.params.id]);

    if (!contractRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Contract not found" });
    }

    const contract = contractRes.rows[0];
    const customerRes = await safeQuery(`SELECT * FROM customers WHERE id = $1`, [contract.customer_id]);
    const customer = customerRes.rows[0] || null;

    let application = null;
    if (customer) {
      const appRes = await safeQuery(
        `SELECT * FROM applications WHERE customer_id = $1 ORDER BY id DESC LIMIT 1`,
        [customer.id]
      );
      application = appRes.rows[0] || null;
    }

    const pdfBuffer = await generateContractPDF({
      customer,
      contract,
      application,
    });

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