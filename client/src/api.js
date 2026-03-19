async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    return { ok: false, error: data.error || `Request failed: ${res.status}`, ...data };
  }
  return data;
}

export async function getSummary() {
  return jsonFetch("/api/summary");
}

export async function createApplication(payload) {
  return jsonFetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listApplications() {
  return jsonFetch("/api/applications");
}

export async function startKyc(id) {
  return jsonFetch(`/api/applications/${id}/start-kyc`, { method: "POST" });
}

export async function sendSumsubWebhook(payload) {
  return jsonFetch("/api/webhook/sumsub", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listAudits() {
  return jsonFetch("/api/audits");
}

export async function listCustomers() {
  return jsonFetch("/api/customers");
}

export async function getCustomer(id) {
  return jsonFetch(`/api/customers/${id}`);
}

export async function listContracts() {
  return jsonFetch("/api/contracts");
}

export async function regenerateContract(id) {
  return jsonFetch(`/api/contracts/${id}/regenerate`, { method: "POST" });
}

export async function updateContract(id, payload) {
  return jsonFetch(`/api/contracts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listComplianceReviews() {
  return jsonFetch("/api/compliance-reviews");
}

export async function actOnComplianceReview(id, action) {
  return jsonFetch(`/api/compliance-reviews/${id}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export async function listVerifiedResults(successfulOnly = false) {
  const qs = successfulOnly ? "?successfulOnly=true" : "";
  return jsonFetch(`/api/verified-results${qs}`);
}

export async function overrideRiskTier(applicationId, riskTier) {
  return jsonFetch(`/api/applications/${applicationId}/risk-tier`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ riskTier }),
  });
}

export async function listMonitoring() {
  return jsonFetch("/api/monitoring");
}

export async function actOnMonitoring(id, action) {
  return jsonFetch(`/api/monitoring/${id}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export async function sendToComplianceReview(applicationId) {
  return jsonFetch(`/api/applications/${applicationId}/send-to-compliance`, {
    method: "POST",
  });
}

export function contractPdfUrl(id) {
  return `/api/contracts/${id}/pdf`;
}