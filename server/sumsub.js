// server/sumsub.js
const crypto = require("crypto");

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

/**
 * Sign Sumsub API requests (X-App-Access-Sig)
 */
function signSumsubRequest({ ts, method, path, body, secret }) {
  // ts: integer timestamp seconds
  // method: GET/POST etc
  // path: request path + query
  // body: raw string
  secret = secret || process.env.SUMSUB_APP_SECRET || "";
  const bodyHash = crypto.createHash("sha256").update(body || "", "utf8").digest("hex");
  const payload = `${ts}.${method}.${path}.${bodyHash}`;
  const sig = crypto.createHmac("sha256", String(secret)).update(payload, "utf8").digest("hex");
  return sig;
}

module.exports = { requireEnv, signSumsubRequest };