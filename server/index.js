require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const https = require("https");
const { v4: uuid } = require("uuid");
const { stringify } = require("csv-stringify/sync");
const pool = require("./db");
const { assignRiskTier, monitoringFrequency } = require("./rules");
const { generateContractPDF } = require("./pdf");
const { requireEnv, signSumsubRequest } = require("./sumsub");
const { verifySumsubWebhook } = require("./sumsubWebhook");
const path = require("path");

const app = express();
app.use(cors());

// IMPORTANT: raw body for Sumsub real webhook (needed for signature verification)
app.use("/api/webhook/sumsub/real", express.raw({ type: "*/*" }));
app.use(express.json());

async function handleSumsubWebhook(payload) {
  const { applicantId, status, fullName, email, pep, amlScore } = payload;

  await pool.query(
    "INSERT INTO webhooks (applicant_id, status, raw_payload) VALUES ($1,$2,$3)",
    [applicantId, status, payload]
  );

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "WEBHOOK_RECEIVED",
    payload,
  ]);

  if (status !== "approved") {
    const normalized = String(status || "unknown").toLowerCase();

    await pool.query(
      `UPDATE applications
       SET kyc_status=$1, updated_at=NOW()
       WHERE external_applicant_id=$2`,
      [normalized.toUpperCase(), applicantId]
    );

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      normalized === "rejected" ? "KYC_REJECTED" : "KYC_STATUS_UPDATED",
      payload,
    ]);

    return { ok: true, message: `No automation for status=${normalized}.` };
  }

  // Idempotency guard (existing logic)
  const appRes = await pool.query(
    "SELECT id, kyc_status, customer_id, contract_id FROM applications WHERE external_applicant_id=$1 LIMIT 1",
    [applicantId]
  );

  if (appRes.rows.length > 0) {
    const a = appRes.rows[0];
    const alreadyApproved = String(a.kyc_status || "").toUpperCase() === "APPROVED";
    const alreadyLinked = Boolean(a.customer_id) || Boolean(a.contract_id);

    if (alreadyApproved && alreadyLinked) {
      await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
        "AUTOMATION_SKIPPED_ALREADY_PROCESSED",
        { applicantId, applicationId: a.id },
      ]);
      return { ok: true, skipped: true, message: "Already processed for this application." };
    }
  }

  const riskTier = assignRiskTier({ pep, amlScore });
  const monitoring = monitoringFrequency(riskTier);

  // Customer insert (or fetch existing if unique constraint exists)
  let customer;
  try {
    const customerRes = await pool.query(
      "INSERT INTO customers (external_id, full_name, email, risk_tier) VALUES ($1,$2,$3,$4) RETURNING *",
      [applicantId, fullName, email, riskTier]
    );
    customer = customerRes.rows[0];
  } catch (e) {
    const existing = await pool.query("SELECT * FROM customers WHERE external_id=$1 LIMIT 1", [
      applicantId,
    ]);
    customer = existing.rows[0];
  }

  // If webhook isn't tied to an application, don't keep minting contracts
  if (appRes.rows.length === 0 && customer) {
    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "AUTOMATION_SKIPPED_NO_APPLICATION_LINK",
      { applicantId },
    ]);
    return {
      ok: true,
      skipped: true,
      message: "No linked application; skipping contract generation.",
    };
  }

  const contractRes = await pool.query(
    "INSERT INTO contracts (customer_id, policy_number, status) VALUES ($1,$2,$3) RETURNING *",
    [customer.id, `POL-${uuid().slice(0, 8).toUpperCase()}`, "Generated"]
  );

  await pool.query("INSERT INTO monitoring (customer_id, frequency) VALUES ($1,$2)", [
    customer.id,
    monitoring,
  ]);

  const result = { customer, contract: contractRes.rows[0], monitoring };

  await pool.query(
    `UPDATE applications
     SET kyc_status='APPROVED',
         risk_tier=$1,
         monitoring_frequency=$2,
         customer_id=$3,
         contract_id=$4,
         updated_at=NOW()
     WHERE external_applicant_id=$5`,
    [riskTier, monitoring, customer.id, contractRes.rows[0].id, applicantId]
  );

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "AUTOMATION_EXECUTED",
    result,
  ]);

  return { ok: true, ...result };
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
 * REAL webhook receiver (Sumsub sends type like applicantReviewed etc.)
 * Adds:
 * - signature verification
 * - DB idempotency via sumsub_webhook_events
 * - mapping only automates on applicantReviewed
 */
app.post("/api/webhook/sumsub/real", async (req, res) => {
  try {
    // 1) signature verify
    const sig = verifySumsubWebhook(req);
    if (!sig.ok) {
      return res.status(401).json({
        ok: false,
        error: "Invalid webhook signature",
        details: sig,
      });
    }

    // 2) parse JSON from raw
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!raw) return res.status(400).json({ ok: false, error: "Empty body" });
    const payload = JSON.parse(raw);

    // 3) extract metadata
    const type = payload.type || payload.eventType || payload.webhookType || "unknown";
    const applicantId =
      payload.applicantId || payload.applicant?.id || payload.applicant?.applicantId || null;

    const eventId =
      payload.eventId ||
      payload.webhookId ||
      payload.id ||
      payload.externalId ||
      `${type}:${applicantId || "na"}:${payload.createdAt || Date.now()}`;

    // 4) idempotency (requires DB table)
    try {
      await pool.query(
        "INSERT INTO sumsub_webhook_events (event_id, applicant_id, event_type) VALUES ($1,$2,$3)",
        [String(eventId), applicantId ? String(applicantId) : null, String(type)]
      );
    } catch (e) {
      return res.json({ ok: true, skipped: true, reason: "duplicate_event", eventId });
    }

    // 5) map review
    const reviewAnswer = payload.reviewResult?.reviewAnswer || payload.reviewResult?.reviewStatus;
    const isGreen = String(reviewAnswer || "").toUpperCase() === "GREEN";
    const isRed = String(reviewAnswer || "").toUpperCase() === "RED";
    const status = isGreen ? "approved" : isRed ? "rejected" : "pending";

    // automate only on applicantReviewed
    const shouldAutomate = String(type).toLowerCase() === "applicantreviewed";

    const internalPayload = {
      applicantId,
      status: shouldAutomate ? status : "pending",
      fullName: payload.externalUserId || payload.applicant?.info?.firstName || "Unknown",
      email: payload.applicant?.email || "unknown@example.com",
      pep: false,
      amlScore: 42,
      sumsubType: type,
      sumsubReviewAnswer: reviewAnswer,
      sumsubEventId: eventId,
      rawSumsub: payload,
    };

    const out = await handleSumsubWebhook(internalPayload);

    return res.json({
      ok: true,
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
 * Step 7B: Create Sumsub applicant (levelName=id-and-liveness)
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
 * Step 7B: Create Sumsub WebSDK access token
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
 * Demo trigger (POC)
 */
app.post("/api/demo/trigger", async (req, res) => {
  try {
    const sample = {
      applicantId: `SUMSUB-${uuid().slice(0, 6)}`,
      status: "approved",
      fullName: "Jane Carter",
      email: "jane.carter@example.com",
      pep: false,
      amlScore: 42,
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
      `SELECT id, full_name, email, kyc_status, external_applicant_id, risk_tier, monitoring_frequency, created_at
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
        `SELECT id, external_id, full_name, email, risk_tier, created_at
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
      `SELECT id, full_name, email, risk_tier
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
 * Summary (Top 10 audits)
 */
app.get("/api/summary", async (req, res) => {
  try {
    const customers = await pool.query(
      "SELECT id, full_name, email, risk_tier, created_at FROM customers ORDER BY id DESC LIMIT 5"
    );
    const audits = await pool.query(
      "SELECT id, event_type, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 10"
    );
    const contracts = await pool.query("SELECT id FROM contracts");

    res.json({
      ok: true,
      customers: customers.rows,
      audits: audits.rows,
      counts: {
        customers: Number(customers.rowCount || 0),
        audits: Number(audits.rowCount || 0),
        contracts: Number(contracts.rowCount || 0),
      },
    });
  } catch (e) {
    console.error("Summary error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Paginated audits (search by event_type)
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
