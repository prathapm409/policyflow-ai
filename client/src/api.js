// client/src/api.js
// Single place for client -> server API calls used by the app.

async function handleResponse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* ignore JSON parse error for non-JSON responses */
  }
  if (!res.ok) {
    const err = new Error(body?.error || body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function getJson(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  return handleResponse(res);
}

export async function postJson(path, data) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  return handleResponse(res);
}

/* ---- Concrete endpoints used by App.jsx ---- */

export const getSummary = () => getJson("/api/summary");

/* triggerDemo: calls /api/demo/trigger (used by Dashboard button) */
export const triggerDemo = () => postJson("/api/demo/trigger", {});

/* Applications */
export const createApplication = (payload) => postJson("/api/applications", payload);
export const listApplications = () => getJson("/api/applications");
export const startKyc = (id) => postJson(`/api/applications/${id}/start-kyc`, {});

/* Sumsub / webhook helpers */
export const sendSumsubWebhook = (payload) => postJson("/api/webhook/sumsub", payload);
export const createSumsubApplicant = (applicationId) => postJson("/api/sumsub/applicant", { applicationId });
export const getSumsubAccessToken = (applicationId) => postJson("/api/sumsub/access-token", { applicationId });

/* Audits, customers, contracts */
export const listAudits = (opts = {}) => {
  const q = opts.limit ? `?limit=${opts.limit}&offset=${opts.offset || 0}` : "";
  return getJson(`/api/audits${q}`);
};
export const listCustomers = (opts = {}) => {
  const q = opts.limit ? `?limit=${opts.limit}&offset=${opts.offset || 0}` : "";
  return getJson(`/api/customers${q}`);
};
export const listContracts = (opts = {}) => {
  const q = opts.limit ? `?limit=${opts.limit}&offset=${opts.offset || 0}` : "";
  return getJson(`/api/contracts${q}`);
};
export const contractPdfUrl = (id) => `/api/contracts/${id}/pdf`;

/* Small convenience wrappers */
export default {
  getJson,
  postJson,
  getSummary,
  triggerDemo,
  createApplication,
  listApplications,
  startKyc,
  sendSumsubWebhook,
  createSumsubApplicant,
  getSumsubAccessToken,
  listAudits,
  listCustomers,
  listContracts,
  contractPdfUrl,
};
