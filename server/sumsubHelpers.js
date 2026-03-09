// server/sumsubHelpers.js
// Helper functions to detect fraud / face mismatch / sanctions/pep from Sumsub payload

function getLabelsText(payload) {
  const labels = payload?.reviewResult?.rejectLabels || payload?.sumsubRejectLabels || [];
  return Array.isArray(labels) ? labels.join(" ").toLowerCase() : String(labels || "").toLowerCase();
}

function hasLabelKeyword(payload, keywords) {
  const text = getLabelsText(payload);
  return keywords.some((k) => text.includes(k));
}

function detectDocumentFraud(payload) {
  const fraudKeywords = ["tamper", "fraud", "forg", "forge", "fake", "photoshop", "tampered", "manipulated"];
  const isLabelFraud = hasLabelKeyword(payload, fraudKeywords);
  const explicitFraud =
    Boolean(payload.documentFraudDetected) ||
    Boolean(payload.document_fraud_detected) ||
    Boolean(payload.document?.fraudDetected);
  return { isFraud: isLabelFraud || explicitFraud, details: { isLabelFraud, explicitFraud } };
}

function detectFaceMismatch(payload) {
  const faceKeywords = ["face", "selfie", "mismatch", "face_mismatch", "no_face"];
  const isLabelFace = hasLabelKeyword(payload, faceKeywords);
  const explicit = Boolean(payload.faceMismatch) || Boolean(payload.face_mismatch) || Boolean(payload.face?.match === false);
  return { isMismatch: isLabelFace || explicit, details: { isLabelFace, explicit } };
}

function detectSanctionsOrPep(payload) {
  const pepKeywords = ["pep", "politically exposed", "sanction", "watchlist"];
  const isMatchLabel = hasLabelKeyword(payload, pepKeywords);
  const explicitPep = Boolean(payload.pepMatch) || Boolean(payload.sanctionsMatch);
  return { isMatch: isMatchLabel || explicitPep, details: { isLabel: isMatchLabel, pep: Boolean(payload.pepMatch), sanctions: Boolean(payload.sanctionsMatch) } };
}

module.exports = {
  detectDocumentFraud,
  detectFaceMismatch,
  detectSanctionsOrPep,
  getLabelsText,
};