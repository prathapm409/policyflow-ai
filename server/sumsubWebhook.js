const crypto = require("crypto");
const { requireEnv } = require("./sumsub");

function getHeader(req, name) {
  const v = req.headers?.[name];
  if (!v) return "";
  return Array.isArray(v) ? v[0] : String(v);
}

function findFirstHeader(req, names) {
  for (const n of names) {
    const v = getHeader(req, n);
    if (v) return { name: n, value: v };
  }
  return { name: "", value: "" };
}

/**
 * Sumsub webhooks can send different signature/digest header names depending on configuration.
 * This verifier tries a set of known header variants.
 *
 * If still failing, we log req.headers and update the list.
 */
function verifySumsubWebhook(req) {
  const secret = requireEnv("SUMSUB_SECRET_KEY");
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("", "utf8");

  // ✅ Add more header candidates
  const digestCandidates = [
    "x-payload-digest",
    "x-sumsub-payload-digest",
    "x-sns-payload-digest",
    "x-hook-payload-digest",
    "x-webhook-payload-digest",
  ];

  const signatureCandidates = [
    "x-signature",
    "x-sumsub-signature",
    "x-sns-signature",
    "x-hook-signature",
    "x-webhook-signature",
    "x-payload-signature",
    "x-sumsub-payload-signature",
  ];

  const digestHeader = findFirstHeader(req, digestCandidates);
  const signatureHeader = findFirstHeader(req, signatureCandidates);

  if (!digestHeader.value || !signatureHeader.value) {
    return {
      ok: false,
      reason: "Missing signature headers",
      details: {
        digestHeaderFound: Boolean(digestHeader.value),
        signatureHeaderFound: Boolean(signatureHeader.value),
        digestHeaderName: digestHeader.name,
        signatureHeaderName: signatureHeader.name,
        availableHeaderKeys: Object.keys(req.headers || {}),
      },
    };
  }

  // 1) verify digest matches raw payload
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  if (digest !== digestHeader.value) {
    return {
      ok: false,
      reason: "Digest mismatch",
      details: { computed: digest, received: digestHeader.value, digestHeaderName: digestHeader.name },
    };
  }

  // 2) verify signature (HMAC-SHA256 of digest using secret)
  const expectedSig = crypto.createHmac("sha256", secret).update(digestHeader.value).digest("hex");
  if (expectedSig !== signatureHeader.value) {
    return {
      ok: false,
      reason: "Signature mismatch",
      details: {
        expected: expectedSig,
        received: signatureHeader.value,
        signatureHeaderName: signatureHeader.name,
      },
    };
  }

  return { ok: true };
}

module.exports = { verifySumsubWebhook };
