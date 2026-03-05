const crypto = require("crypto");
const { requireEnv } = require("./sumsub");

/**
 * Sumsub webhook signature verification.
 * Sumsub sends headers like:
 * - x-payload-digest / x-sumsub-payload-digest (digest of raw body)
 * - x-signature / x-sumsub-signature (HMAC signature)
 *
 * NOTE: Header names differ by Sumsub product/version.
 * This helper supports a few common variants. We will log missing headers.
 */
function getHeader(req, name) {
  const v = req.headers?.[name];
  if (!v) return "";
  return Array.isArray(v) ? v[0] : String(v);
}

function verifySumsubWebhook(req) {
  const secret = requireEnv("SUMSUB_SECRET_KEY");

  // Raw body is required for verification
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("", "utf8");

  // Common header variants (one of these will exist)
  const digestHeader =
    getHeader(req, "x-payload-digest") ||
    getHeader(req, "x-sumsub-payload-digest") ||
    getHeader(req, "x-sns-payload-digest");

  const signatureHeader =
    getHeader(req, "x-signature") ||
    getHeader(req, "x-sumsub-signature") ||
    getHeader(req, "x-sns-signature");

  // If Sumsub in your account uses different header names, we’ll adjust quickly.
  if (!digestHeader || !signatureHeader) {
    return {
      ok: false,
      reason: "Missing signature headers",
      details: { digestHeader: Boolean(digestHeader), signatureHeader: Boolean(signatureHeader) },
    };
  }

  // 1) verify digest matches raw payload
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  if (digest !== digestHeader) {
    return { ok: false, reason: "Digest mismatch", details: { computed: digest, received: digestHeader } };
  }

  // 2) verify signature (HMAC-SHA256 of digest using secret)
  const expectedSig = crypto.createHmac("sha256", secret).update(digestHeader).digest("hex");
  if (expectedSig !== signatureHeader) {
    return { ok: false, reason: "Signature mismatch", details: { expected: expectedSig, received: signatureHeader } };
  }

  return { ok: true };
}

module.exports = { verifySumsubWebhook };
