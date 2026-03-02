function assignRiskTier({ pep, amlScore }) {
  if (pep || amlScore >= 80) return "High";
  if (amlScore >= 50) return "Medium";
  return "Low";
}

function monitoringFrequency(tier) {
  if (tier === "High") return "Daily";
  if (tier === "Medium") return "Weekly";
  return "Monthly";
}

module.exports = { assignRiskTier, monitoringFrequency };
