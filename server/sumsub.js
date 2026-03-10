// server/sumsub.js
// Helpers for Sumsub API signing (used when creating applicants/access tokens) and requireEnv.

const crypto = require("crypto");

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

/**
 * Sign Sumsub API requests (X-App-Access-Sig) per their API:
 * Signature = HMAC_SHA256(secret, timestamp + '.' + method + '.' + path + '.' + bodyHash)
 * where bodyHash is SHA256(body) hex (empty string => '').
 *
 * This function returns the signature string to set in header X-App-Access-Sig
 */
function signSumsubRequest({ ts, method, path, body, secret }) {
  // ts: integer timestamp seconds
  // method: GET/POST etc
  // path: request path + query
  // body: raw string
  secret = secret || process.env.SUMSUB_APP_SECRET || ""; // replace if needed
  const bodyHash = crypto.createHash("sha256").update(body || "", "utf8").digest("hex");
  const payload = `${ts}.${method}.${path}.${bodyHash}`;
  const sig = crypto.createHmac("sha256", String(secret)).update(payload, "utf8").digest("hex");
  return sig;
}

module.exports = { requireEnv, signSumsubRequest };
