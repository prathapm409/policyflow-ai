// scripts/send_signed_webhook.js
// Test script that signs payloads and posts to real endpoint. Use SUMSUB_SECRET_KEY env var.
const crypto = require("crypto");
const axios = require("axios");

const scenarios = [
  {
    name: "LOW",
    payload: {
      type: "review",
      eventId: `evt-LOW-${Date.now()}`,
      applicantId: "TEST-LOW-1",
      createdAt: new Date().toISOString(),
      reviewResult: { reviewStatus: "GREEN" },
      applicant: { email: "low@example.com", info: { firstName: "James Carter" } },
    },
  },
  {
    name: "MEDIUM_PEP",
    payload: {
      type: "review",
      eventId: `evt-MED-${Date.now()}`,
      applicantId: "TEST-MED-1",
      createdAt: new Date().toISOString(),
      reviewResult: { reviewStatus: "GREEN", rejectLabels: ["pep"] },
      pepMatch: true,
      applicant: { email: "med@example.com", info: { firstName: "Med" } },
    },
  },
  {
    name: "HIGH_FACE+COUNTRY",
    payload: {
      type: "review",
      eventId: `evt-HIGH-${Date.now()}`,
      applicantId: "TEST-HIGH-1",
      createdAt: new Date().toISOString(),
      reviewResult: { reviewStatus: "GREEN", rejectLabels: ["face_mismatch", "country risk"] },
      faceMismatch: true,
      highRiskCountry: true,
      applicant: { email: "high@example.com", info: { firstName: "High" } },
    },
  },
  {
    name: "CRITICAL_SANCTIONS",
    payload: {
      type: "review",
      eventId: `evt-CRIT-${Date.now()}`,
      applicantId: "TEST-CRIT-1",
      createdAt: new Date().toISOString(),
      reviewResult: { reviewStatus: "GREEN", rejectLabels: ["sanction"] },
      sanctionsMatch: true,
      applicant: { email: "crit@example.com", info: { firstName: "Crit" } },
    },
  },
];

async function sendOne(url, secret, payload) {
  const raw = JSON.stringify(payload);
  const digest = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  const signature = crypto.createHmac("sha256", String(secret)).update(digest, "utf8").digest("hex");

  try {
    const resp = await axios.post(url, raw, {
      headers: {
        "Content-Type": "application/json",
        "x-payload-digest": digest,
        "x-signature": signature,
      },
      timeout: 15000,
    });
    return resp.data;
  } catch (e) {
    if (e.response) return { error: true, status: e.response.status, body: e.response.data };
    return { error: true, message: e.message };
  }
}

async function run() {
  const url = process.argv[2] || "http://localhost:3000/api/webhook/sumsub/real";
  const secret = process.env.SUMSUB_SECRET_KEY;
  if (!secret) {
    console.error("Set SUMSUB_SECRET_KEY environment variable before running.");
    process.exit(1);
  }

  for (const s of scenarios) {
    console.log("=== SCENARIO:", s.name, "applicantId=", s.payload.applicantId);
    const out = await sendOne(url, secret, s.payload);
    console.log(JSON.stringify(out, null, 2));
    console.log("");
  }
}

run();
