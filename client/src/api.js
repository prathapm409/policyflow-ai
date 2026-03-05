export async function getSummary() {
  const res = await fetch("/api/summary");
  return res.json();
}

export async function triggerDemo() {
  const res = await fetch("/api/demo/trigger", { method: "POST" });
  return res.json();
}

export async function createApplication({ fullName, email }) {
  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email }),
  });
  return res.json();
}

export async function listApplications() {
  const res = await fetch("/api/applications");
  return res.json();
}

export async function startKyc(applicationId) {
  const res = await fetch(`/api/applications/${applicationId}/start-kyc`, { method: "POST" });
  return res.json();
}

export async function sendSumsubWebhook(payload) {
  const res = await fetch(`/api/webhook/sumsub`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function listAudits({ limit = 25, offset = 0, q = "" } = {}) {
  const url = `/api/audits?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(
    offset
  )}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  return res.json();
}

export async function listCustomers({ limit = 50, offset = 0 } = {}) {
  const url = `/api/customers?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  const res = await fetch(url);
  return res.json();
}

export async function listContracts({ limit = 50, offset = 0 } = {}) {
  const url = `/api/contracts?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
  const res = await fetch(url);
  return res.json();
}

export function contractPdfUrl(contractId) {
  return `/api/contracts/${encodeURIComponent(contractId)}/pdf`;
}

export async function createSumsubApplicant(applicationId) {
  const res = await fetch("/api/sumsub/applicant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId }),
  });
  return res.json();
}

export async function getSumsubAccessToken(applicationId) {
  const res = await fetch("/api/sumsub/access-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationId }),
  });
  return res.json();
}
