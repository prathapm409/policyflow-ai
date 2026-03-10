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

export async function triggerDemo() {
  return jsonFetch("/api/demo/trigger", { method: "POST" });
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

export async function listAudits({ limit = 25, offset = 0, q = "" } = {}) {
  const qs = new URLSearchParams({ limit, offset, q });
  return jsonFetch(`/api/audits?${qs.toString()}`);
}

export async function listCustomers({ limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams({ limit, offset });
  return jsonFetch(`/api/customers?${qs.toString()}`);
}

export async function listContracts({ limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams({ limit, offset });
  return jsonFetch(`/api/contracts?${qs.toString()}`);
}

export async function listComplianceReviews() {
  return jsonFetch("/api/compliance-reviews");
}

export async function listVerifiedResults() {
  return jsonFetch("/api/verified-results");
}

export function contractPdfUrl(id) {
  return `/api/contracts/${id}/pdf`;
}

export async function createSumsubApplicant(applicationId) {
  return jsonFetch("/api/sumsub/applicant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId }),
  });
}

export async function getSumsubAccessToken(applicationId) {
  return jsonFetch("/api/sumsub/access-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId }),
  });
}