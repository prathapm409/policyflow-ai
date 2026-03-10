const crypto = require("crypto");
const axios = require("axios");

const SUMSUB_BASE_URL = "https://api.sumsub.com";

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

function signSumsubRequest({ ts, method, path, body, secret }) {
  const signingSecret = secret || process.env.SUMSUB_SECRET_KEY || "";
  const rawBody = body || "";
  const payload = `${ts}${method.toUpperCase()}${path}${rawBody}`;
  return crypto
    .createHmac("sha256", signingSecret)
    .update(payload)
    .digest("hex");
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

  const url = `${SUMSUB_BASE_URL}${path}`;

  const response = await axios({
    method,
    url,
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

module.exports = {
  requireEnv,
  signSumsubRequest,
  sumsubRequest,
};