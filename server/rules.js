// server/rules.js - risk scoring and decision helpers

function calculateRiskScore({
  pepMatch,
  sanctionsMatch,
  adverseMedia,
  documentFraudDetected,
  faceMismatch,
  highRiskCountry,
  deviceOrIpMismatch,
  manualReviewRequired,
}) {
  let score = 0;
  const flags = [];

  const add = (cond, points, name) => {
    if (!cond) return;
    score += points;
    flags.push({ signal: name, impact: points });
  };

  add(Boolean(pepMatch), 50, "PEP_MATCH");
  add(Boolean(sanctionsMatch), 100, "SANCTIONS_MATCH");
  add(Boolean(adverseMedia), 40, "ADVERSE_MEDIA");
  add(Boolean(documentFraudDetected), 60, "DOCUMENT_FRAUD_DETECTED");
  add(Boolean(faceMismatch), 40, "FACE_MISMATCH");
  add(Boolean(highRiskCountry), 30, "HIGH_RISK_COUNTRY");
  add(Boolean(deviceOrIpMismatch), 20, "DEVICE_OR_IP_MISMATCH");
  add(Boolean(manualReviewRequired), 20, "MANUAL_REVIEW_REQUIRED");

  return { score, flags };
}

function assignRiskTierFromScore(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 21) return "MEDIUM";
  return "LOW";
}

function monitoringFrequencyForTier(tier) {
  if (tier === "LOW") return "12_MONTHS";
  if (tier === "MEDIUM") return "6_MONTHS";
  return null;
}

function determineKycDecision({ verificationStatus, riskTier }) {
  const status = String(verificationStatus || "").toUpperCase();
  if (status === "REJECTED") return "REJECTED";
  if (status === "PENDING") return "PENDING";
  if (status === "REVIEW") return "REVIEW";
  if (status === "APPROVED") {
    if (riskTier === "CRITICAL") return "ESCALATE";
    if (riskTier === "HIGH") return "REVIEW_REQUIRED";
    if (riskTier === "MEDIUM") return "APPROVE_WITH_MONITORING";
    return "APPROVE";
  }
  return "UNKNOWN";
}

module.exports = {
  calculateRiskScore,
  assignRiskTierFromScore,
  determineKycDecision,
  monitoringFrequencyForTier,
};
