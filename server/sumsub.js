const crypto = require("crypto");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// Sumsub signing: HMAC SHA256 of ts + method + path + body
function signSumsubRequest({ ts, method, path, body = "" }) {
  const secret = requireEnv("SUMSUB_SECRET_KEY");
  const prehash = `${ts}${method.toUpperCase()}${path}${body}`;
  return crypto.createHmac("sha256", secret).update(prehash).digest("hex");
}

module.exports = { requireEnv, signSumsubRequest };
