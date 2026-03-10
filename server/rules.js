function normalizeSignals(input = {}) {
  return {
    pepMatch: Boolean(input.pepMatch),
    sanctionsMatch: Boolean(input.sanctionsMatch),
    adverseMedia: Boolean(input.adverseMedia),
    documentFraudDetected: Boolean(input.documentFraudDetected),
    faceMismatch: Boolean(input.faceMismatch),
    highRiskCountry: Boolean(input.highRiskCountry),
    deviceOrIpMismatch: Boolean(input.deviceOrIpMismatch),
    manualReviewRequired: Boolean(input.manualReviewRequired),
  };
}

function calculateRiskScore(signalsInput = {}) {
  const signals = normalizeSignals(signalsInput);
  let score = 0;
  const reasons = [];

  if (signals.pepMatch) {
    score += 50;
    reasons.push("PEP match detected (+50)");
  }
  if (signals.sanctionsMatch) {
    score += 100;
    reasons.push("Sanctions/watchlist match detected (+100)");
  }
  if (signals.adverseMedia) {
    score += 40;
    reasons.push("Adverse media match detected (+40)");
  }
  if (signals.documentFraudDetected) {
    score += 60;
    reasons.push("Document fraud/tampering detected (+60)");
  }
  if (signals.faceMismatch) {
    score += 40;
    reasons.push("Face mismatch detected (+40)");
  }
  if (signals.highRiskCountry) {
    score += 30;
    reasons.push("High-risk country detected (+30)");
  }
  if (signals.deviceOrIpMismatch) {
    score += 20;
    reasons.push("Device/IP mismatch detected (+20)");
  }
  if (signals.manualReviewRequired) {
    score += 20;
    reasons.push("Manual review required (+20)");
  }

  if (reasons.length === 0) {
    reasons.push("No material risk signals detected (0)");
  }

  return { score, signals, reasons };
}

function assignRiskTierFromScore(score) {
  if (score >= 81) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 21) return "MEDIUM";
  return "LOW";
}

function determineKycDecision({ verificationStatus, riskTier }) {
  const status = String(verificationStatus || "").toUpperCase();

  if (status === "REJECTED") return "REJECTED";
  if (status === "PENDING") return "PENDING";
  if (status === "REVIEW") return "MANUAL_REVIEW";

  if (status === "APPROVED") {
    if (riskTier === "LOW") return "AUTO_APPROVED";
    if (riskTier === "MEDIUM") return "STANDARD_MONITORING";
    if (riskTier === "HIGH") return "MANUAL_REVIEW";
    if (riskTier === "CRITICAL") return "REJECT_ESCALATE";
  }

  return "PENDING";
}

function monitoringFrequencyForTier(riskTier) {
  if (riskTier === "LOW") return "12_MONTHS";
  if (riskTier === "MEDIUM") return "6_MONTHS";
  if (riskTier === "HIGH") return "QUARTERLY";
  return null;
}

module.exports = {
  normalizeSignals,
  calculateRiskScore,
  assignRiskTierFromScore,
  determineKycDecision,
  monitoringFrequencyForTier,
};