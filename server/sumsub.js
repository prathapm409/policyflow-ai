const crypto = require("crypto");
const axios = require("axios");

const SUMSUB_BASE_URL = "https://api.sumsub.com";

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

function signSumsubRequest({ ts, method, path, body, secret }) {
  const payload = `${ts}${method.toUpperCase()}${path}${body || ""}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function sumsubRequest({ method, path, body }) {
  const appToken = requireEnv("SUMSUB_APP_TOKEN");
  const secret = requireEnv("SUMSUB_SECRET_KEY");
  const ts = Math.floor(Date.now() / 1000).toString();
  const rawBody = body ? JSON.stringify(body) : "";
  const signature = signSumsubRequest({
    ts,
    method,
    path,
    body: rawBody,
    secret,
  });

  const response = await axios({
    method,
    url: `${SUMSUB_BASE_URL}${path}`,
    data: body,
    headers: {
      "X-App-Token": appToken,
      "X-App-Access-Ts": ts,
      "X-App-Access-Sig": signature,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  });

  return response.data;
}

function verifyWebhookSignature(req) {
  const secret = process.env.SUMSUB_WEBHOOK_SECRET;
  if (!secret) return true;

  const header =
    req.headers["x-payload-digest"] ||
    req.headers["x-signature"] ||
    req.headers["x-payload-digest-sha256"] ||
    "";

  if (!header) return false;

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  return header.includes(expected) || header === expected;
}

module.exports = {
  requireEnv,
  signSumsubRequest,
  sumsubRequest,
  verifyWebhookSignature,
};