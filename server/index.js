require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuid } = require("uuid");
const { stringify } = require("csv-stringify/sync");
const pool = require("./db");
const { assignRiskTier, monitoringFrequency } = require("./rules");
const { generateContractPDF } = require("./pdf");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

async function handleSumsubWebhook(payload) {
  const { applicantId, status, fullName, email, pep, amlScore } = payload;

  await pool.query(
    "INSERT INTO webhooks (applicant_id, status, raw_payload) VALUES ($1,$2,$3)",
    [applicantId, status, payload]
  );

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "WEBHOOK_RECEIVED",
    payload
  ]);

  if (status !== "approved") {
    return { ok: true, message: "No automation for non-approved status." };
  }

  const riskTier = assignRiskTier({ pep, amlScore });
  const monitoring = monitoringFrequency(riskTier);

  const customerRes = await pool.query(
    "INSERT INTO customers (external_id, full_name, email, risk_tier) VALUES ($1,$2,$3,$4) RETURNING *",
    [applicantId, fullName, email, riskTier]
  );

  const customer = customerRes.rows[0];

  const contractRes = await pool.query(
    "INSERT INTO contracts (customer_id, policy_number, status) VALUES ($1,$2,$3) RETURNING *",
    [customer.id, `POL-${uuid().slice(0, 8).toUpperCase()}`, "Generated"]
  );

  await pool.query("INSERT INTO monitoring (customer_id, frequency) VALUES ($1,$2)", [
    customer.id,
    monitoring
  ]);

  const result = { customer, contract: contractRes.rows[0], monitoring };

  await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
    "AUTOMATION_EXECUTED",
    result
  ]);

  return { ok: true, ...result };
}

app.post("/api/webhook/sumsub", async (req, res) => {
  try {
    const out = await handleSumsubWebhook(req.body);
    res.json(out);
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/api/demo/trigger", async (req, res) => {
  try {
    const sample = {
      applicantId: `SUMSUB-${uuid().slice(0, 6)}`,
      status: "approved",
      fullName: "Jane Carter",
      email: "jane.carter@example.com",
      pep: false,
      amlScore: 42
    };
    const out = await handleSumsubWebhook(sample);
    res.json(out);
  } catch (e) {
    console.error("Demo trigger error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.post("/api/applications", async (req, res) => {
  try {
    const { fullName, email } = req.body;
    if (!fullName || !email) {
      return res.status(400).json({ ok: false, error: "fullName and email are required" });
    }

    const out = await pool.query(
      "INSERT INTO applications (full_name, email) VALUES ($1,$2) RETURNING *",
      [fullName, email]
    );

    await pool.query("INSERT INTO audit_logs (event_type, payload) VALUES ($1,$2)", [
      "APPLICATION_CREATED",
      out.rows[0]
    ]);

    res.json({ ok: true, application: out.rows[0] });
  } catch (e) {
    console.error("Create application error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/applications", async (req, res) => {
  try {
    const apps = await pool.query(
      "SELECT * FROM applications ORDER BY created_at DESC LIMIT 50"
    );
    res.json({ ok: true, applications: apps.rows });
  } catch (e) {
    console.error("List applications error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.get("/api/summary", async (req, res) => {
  const customers = await pool.query("SELECT * FROM customers ORDER BY created_at DESC LIMIT 10");
  const audits = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10");
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM contracts) AS contracts,
      (SELECT COUNT(*) FROM audit_logs) AS audits
  `);

  res.json({
    counts: counts.rows[0],
    customers: customers.rows,
    audits: audits.rows
  });
});

app.get("/api/contracts/:id/pdf", async (req, res) => {
  const contractRes = await pool.query("SELECT * FROM contracts WHERE id=$1", [req.params.id]);
  if (!contractRes.rows[0]) return res.status(404).send("Not found");

  const customerRes = await pool.query(
    "SELECT * FROM customers WHERE id=$1",
    [contractRes.rows[0].customer_id]
  );

  const pdf = generateContractPDF({
    customer: customerRes.rows[0],
    contract: contractRes.rows[0]
  });

  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
});

app.get("/api/audit/export", async (req, res) => {
  const logs = await pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC");
  const csv = stringify(logs.rows, { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=audit_export.csv");
  res.send(csv);
});
// ...rest unchanged
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PolicyFlow AI running on ${PORT}`));
