function toUpperStr(x) {
  return String(x || "").toUpperCase();
}
function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function extractSignalsFromSumsub(rawSumsub) {
  const p = rawSumsub || {};

  const labels = []
    .concat(p?.reviewResult?.reviewRejectType)
    .concat(p?.reviewResult?.reviewRejectLabels || [])
    .concat(p?.reviewResult?.rejectLabels || [])
    .concat(p?.labels || [])
    .concat(p?.tags || [])
    .concat(p?.riskLabels || []);

  const flat = uniq(labels.map((x) => toUpperStr(x)));
  const has = (needle) => flat.some((x) => x.includes(needle));

  return {
    pepMatch: has("PEP"),
    sanctionsMatch: has("SANCTION"),
    adverseMedia: has("ADVERSE"),
    documentFraud: has("TAMPER") || has("FRAUD") || has("DOCUMENT"),
    faceMismatch: has("FACE") || has("MISMATCH"),
    highRiskCountry: has("COUNTRY_RISK") || has("HIGH_RISK_COUNTRY"),
    deviceIpMismatch: has("IP_MISMATCH") || has("DEVICE_RISK") || has("DEVICE"),
    manualReviewRequired: has("MANUAL_REVIEW") || toUpperStr(p?.reviewStatus) === "PENDING",
    rawLabels: flat,
  };
}

function computeRiskScore(signals) {
  let score = 0;
  const flags = [];

  const add = (cond, impact, name) => {
    if (!cond) return;
    score += impact;
    flags.push({ signal: name, impact });
  };

  add(signals.pepMatch, 50, "PEP_MATCH");
  add(signals.sanctionsMatch, 100, "SANCTIONS_MATCH");
  add(signals.adverseMedia, 40, "ADVERSE_MEDIA");
  add(signals.documentFraud, 60, "DOCUMENT_FRAUD_DETECTED");
  add(signals.faceMismatch, 40, "FACE_MISMATCH");
  add(signals.highRiskCountry, 30, "HIGH_RISK_COUNTRY");
  add(signals.deviceIpMismatch, 20, "DEVICE_OR_IP_MISMATCH");
  add(signals.manualReviewRequired, 20, "MANUAL_REVIEW_REQUIRED");

  return { score, flags };
}

function riskTierFromScore(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 21) return "MEDIUM";
  return "LOW";
}

function monitoringMonthsForTier(tier) {
  if (tier === "LOW") return 12;
  if (tier === "MEDIUM") return 6;
  return null;
}

module.exports = {
  extractSignalsFromSumsub,
  computeRiskScore,
  riskTierFromScore,
  monitoringMonthsForTier,
};