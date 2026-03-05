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
 * verifySumsubWebhook(req)
 *
 * Strict by default.
 * If SUMSUB_WEBHOOK_ALLOW_UNSIGNED=true, then missing signature headers are allowed
 * (useful for Sumsub Sandbox "Test webhook" UI that may not send signature headers).
 */
function verifySumsubWebhook(req) {
  const allowUnsigned =
    String(process.env.SUMSUB_WEBHOOK_ALLOW_UNSIGNED || "false").toLowerCase() === "true";

  const secret = requireEnv("SUMSUB_SECRET_KEY");
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("", "utf8");

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
    if (allowUnsigned) {
      return {
        ok: true,
        skippedVerification: true,
        warning: "Signature headers missing; accepted because SUMSUB_WEBHOOK_ALLOW_UNSIGNED=true",
        details: {
          digestHeaderFound: Boolean(digestHeader.value),
          signatureHeaderFound: Boolean(signatureHeader.value),
          digestHeaderName: digestHeader.name,
          signatureHeaderName: signatureHeader.name,
        },
      };
    }

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
      details: {
        digestHeaderName: digestHeader.name,
        computed: digest,
        received: digestHeader.value,
      },
    };
  }

  // 2) verify signature (HMAC-SHA256 of digestHeader using secret)
  const expectedSig = crypto.createHmac("sha256", secret).update(digestHeader.value).digest("hex");
  if (expectedSig !== signatureHeader.value) {
    return {
      ok: false,
      reason: "Signature mismatch",
      details: {
        signatureHeaderName: signatureHeader.name,
        expected: expectedSig,
        received: signatureHeader.value,
      },
    };
  }

  return {
    ok: true,
    verified: true,
    digestHeaderName: digestHeader.name,
    signatureHeaderName: signatureHeader.name,
  };
}

module.exports = { verifySumsubWebhook };
