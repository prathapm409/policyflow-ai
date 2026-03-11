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
  return jsonFetch(`/api/applications/${id}/start-kyc`, {
    method: "POST",
  });
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

export async function listContracts() {
  return jsonFetch("/api/contracts");
}

export async function listComplianceReviews() {
  return jsonFetch("/api/compliance-reviews");
}

export async function listVerifiedResults() {
  return jsonFetch("/api/verified-results");
}

export async function overrideRiskTier(applicationId, riskTier) {
  return jsonFetch(`/api/applications/${applicationId}/risk-tier`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ riskTier }),
  });
}

export function contractPdfUrl(id) {
  return `/api/contracts/${id}/pdf`;
}