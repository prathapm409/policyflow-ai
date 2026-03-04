const crypto = require("crypto");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Sumsub signature:
 * HMAC_SHA256(secret, ts + method + pathWithQuery + body)
 * IMPORTANT: body must be EXACT string used for request.
 * For requests with empty JSON body, use "{}" (not "").
 */
function signSumsubRequest({ ts, method, path, body }) {
  const secret = requireEnv("SUMSUB_SECRET_KEY");
  const normalizedBody = body === undefined || body === null ? "" : body;
  const prehash = `${ts}${method.toUpperCase()}${path}${normalizedBody}`;
  return crypto.createHmac("sha256", secret).update(prehash).digest("hex");
}

module.exports = { requireEnv, signSumsubRequest };
