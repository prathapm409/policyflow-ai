import React, { useEffect, useMemo, useState } from "react";
import {
  getSummary,
  triggerDemo,
  createApplication,
  listApplications,
  startKyc,
  sendSumsubWebhook,
  listAudits,
  listCustomers,
  listContracts,
  contractPdfUrl,
  createSumsubApplicant,
  getSumsubAccessToken,
} from "./api";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getSumsubSdk() {
  // Your browser shows this exists: window.snsWebSdk
  return window.SNSWebSDK || window.snsWebSdk || null;
}

async function waitForSumsubSdk({ timeoutMs = 8000, stepMs = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getSumsubSdk()) return true;
    await sleep(stepMs);
  }
  return Boolean(getSumsubSdk());
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const bg =
    toast.type === "error"
      ? "rgba(239,68,68,0.92)"
      : toast.type === "success"
      ? "rgba(34,197,94,0.92)"
      : "rgba(37,99,235,0.92)";
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        background: bg,
        color: "white",
        padding: "10px 12px",
        borderRadius: 14,
        boxShadow: "0 16px 50px rgba(0,0,0,0.35)",
        maxWidth: 560,
        zIndex: 999999,
        display: "flex",
        gap: 10,
        alignItems: "center",
        border: "1px solid rgba(255,255,255,0.25)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.3 }}>{toast.message}</div>
      <button className="secondary" onClick={onClose} style={{ padding: "8px 10px" }}>
        Close
      </button>
    </div>
  );
}

function StatCard({ title, value, hint }) {
  return (
    <div
      style={{
        flex: "1 1 220px",
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 16,
        padding: 14,
        boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ fontSize: 12, color: "rgba(234,240,255,0.75)", fontWeight: 800 }}>
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "rgba(234,240,255,0.65)" }}>{hint}</div> : null}
    </div>
  );
}

function PillTab({ active, children, onClick }) {
  return (
    <button
      type="button"
      className={active ? "" : "secondary"}
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 999,
        fontWeight: 900,
        border: active ? "1px solid rgba(255,255,255,0.28)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

function renderKycProgress(status) {
  const pct =
    status === "PENDING_KYC"
      ? 0
      : status === "IN_PROGRESS"
      ? 50
      : status === "APPROVED"
      ? 100
      : status === "REJECTED"
      ? 100
      : 0;

  const color =
    status === "APPROVED"
      ? "rgba(34,197,94,0.95)"
      : status === "REJECTED"
      ? "rgba(239,68,68,0.95)"
      : "rgba(37,99,235,0.95)";

  return (
    <div style={{ minWidth: 160 }}>
      <div
        style={{
          height: 10,
          background: "rgba(255,255,255,0.12)",
          borderRadius: 999,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div style={{ width: `${pct}%`, height: 10, background: color }} />
      </div>
      <div style={{ fontSize: 12, marginTop: 6, color: "rgba(234,240,255,0.75)" }}>{pct}%</div>
    </div>
  );
}

function SumsubModal({ open, applicationId, onClose }) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.20)",
          backdropFilter: "blur(10px)",
          width: "min(1100px, 100%)",
          borderRadius: 18,
          boxShadow: "0 26px 90px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(255,255,255,0.08)",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div style={{ fontWeight: 900 }}>Sumsub KYC (App #{applicationId})</div>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div id="sumsub-websdk-container" style={{ height: "80vh", background: "white" }} />
      </div>
    </div>
  );
}

function DashboardPage({ summary, busy, setBusy, showToast, refreshAll }) {
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <StatCard title="Customers" value={summary.counts.customers} hint="Approved KYC users" />
        <StatCard title="Contracts" value={summary.counts.contracts} hint="Generated policies" />
        <StatCard title="Audit Logs" value={summary.counts.audits} hint="Latest compliance entries" />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          disabled={busy}
          className="success"
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              await triggerDemo();
              await refreshAll();
              showToast("Demo automation executed", "success");
            } catch (e) {
              console.error(e);
              showToast("Demo failed", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working..." : "Simulate Sumsub Approved"}
        </button>

        <a className="link" href="/api/audit/export">
          Download Audit CSV
        </a>
      </div>
    </>
  );
}

function ApplicationsPage({
  apps,
  busy,
  setBusy,
  showToast,
  loadApplications,
  refreshAll,
  openSumsub,
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [appError, setAppError] = useState("");

  async function onCreateApplication(e) {
    e.preventDefault();
    setAppError("");

    if (!fullName.trim() || !email.trim()) {
      setAppError("Full name and email are required");
      return;
    }

    setBusy(true);
    try {
      const res = await createApplication({ fullName, email });
      if (!res.ok) {
        setAppError(res.error || "Failed to create application");
        showToast(res.error || "Failed to create application", "error");
        return;
      }

      setFullName("");
      setEmail("");
      await loadApplications();
      showToast("Application created", "success");
    } finally {
      setBusy(false);
    }
  }

  async function onCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied Applicant ID", "success");
    } catch (e) {
      console.error(e);
      showToast("Copy failed. Please copy manually.", "error");
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Applications</h2>

      <form onSubmit={onCreateApplication} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <button disabled={busy} type="submit">
            {busy ? "Creating..." : "Create Application"}
          </button>
        </div>
        {appError ? (
          <div style={{ color: "rgba(255,120,120,0.95)", marginTop: 8 }}>{appError}</div>
        ) : null}
      </form>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Full Name</th>
              <th>Email</th>
              <th>KYC Status</th>
              <th>Progress</th>
              <th>Risk Tier</th>
              <th>Monitoring</th>
              <th>Applicant ID</th>
              <th>Actions</th>
              <th>Created</th>
            </tr>
          </thead>

          <tbody>
            {apps.map((a) => {
              const applicantId = a.external_applicant_id || "";
              const hasApplicantId = Boolean(applicantId);

              return (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.full_name}</td>
                  <td>{a.email}</td>
                  <td>{a.kyc_status}</td>
                  <td>{renderKycProgress(a.kyc_status)}</td>
                  <td>{a.risk_tier || "-"}</td>
                  <td>{a.monitoring_frequency || "-"}</td>

                  <td style={{ fontFamily: "monospace" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>{hasApplicantId ? applicantId : "-"}</span>
                      {hasApplicantId ? (
                        <button
                          className="secondary"
                          disabled={busy}
                          type="button"
                          onClick={() => onCopy(applicantId)}
                          style={{ padding: "8px 10px" }}
                        >
                          Copy
                        </button>
                      ) : null}
                    </div>
                  </td>

                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {a.kyc_status === "PENDING_KYC" ? (
                        <button
                          className="secondary"
                          disabled={busy}
                          type="button"
                          onClick={async () => {
                            if (busy) return;
                            setBusy(true);
                            try {
                              await startKyc(a.id);
                              await loadApplications();
                              await refreshAll();
                              showToast("KYC started", "success");
                            } catch (e) {
                              console.error(e);
                              showToast("Start KYC failed", "error");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Start KYC
                        </button>
                      ) : null}

                      <button
                        className="success"
                        disabled={busy}
                        type="button"
                        onClick={async () => {
                          if (busy) return;
                          setBusy(true);
                          try {
                            await openSumsub(a.id);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Open KYC
                      </button>

                      {hasApplicantId ? (
                        <>
                          <button
                            className="success"
                            disabled={busy}
                            type="button"
                            onClick={async () => {
                              if (busy) return;
                              setBusy(true);
                              try {
                                await sendSumsubWebhook({
                                  applicantId,
                                  status: "approved",
                                  fullName: a.full_name,
                                  email: a.email,
                                  pep: false,
                                  amlScore: 42,
                                });
                                await loadApplications();
                                await refreshAll();
                                showToast("Set status: APPROVED", "success");
                              } catch (e) {
                                console.error(e);
                                showToast("Set APPROVED failed", "error");
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Set Approved
                          </button>

                          <button
                            className="danger"
                            disabled={busy}
                            type="button"
                            onClick={async () => {
                              if (busy) return;
                              setBusy(true);
                              try {
                                await sendSumsubWebhook({
                                  applicantId,
                                  status: "rejected",
                                  fullName: a.full_name,
                                  email: a.email,
                                  pep: false,
                                  amlScore: 42,
                                  reason: "DOCUMENT_MISMATCH",
                                });
                                await loadApplications();
                                await refreshAll();
                                showToast("Set status: REJECTED", "success");
                              } catch (e) {
                                console.error(e);
                                showToast("Set REJECTED failed", "error");
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Set Rejected
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>

                  <td>{new Date(a.created_at).toLocaleString()}</td>
                </tr>
              );
            })}

            {apps.length === 0 ? (
              <tr>
                <td colSpan="10" style={{ textAlign: "center", padding: 12 }}>
                  No applications yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AuditLogsPage({ showToast }) {
  const [q, setQ] = useState("");
  const [limit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ limit: 25, offset: 0, total: 0 });
  const [audits, setAudits] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await listAudits({ limit, offset, q });
      if (!res.ok) {
        showToast(res.error || "Failed to load audits", "error");
        return;
      }
      setAudits(res.audits || []);
      setPage(res.page || { limit, offset, total: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const canPrev = offset > 0;
  const canNext = offset + limit < (page.total || 0);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Audit Logs</h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Search event type (e.g., KYC_REJECTED)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 320 }}
          />
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={async () => {
              setOffset(0);
              await load();
            }}
          >
            {loading ? "Loading..." : "Search"}
          </button>
        </div>
      </div>

      <div style={{ color: "rgba(234,240,255,0.75)", fontSize: 13, margin: "8px 0 12px" }}>
        Showing {Math.min(page.total, offset + 1)}–{Math.min(page.total, offset + limit)} of{" "}
        {page.total}
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th style={{ width: 260 }}>Event</th>
            <th style={{ width: 230 }}>Time</th>
            <th>Payload</th>
          </tr>
        </thead>
        <tbody>
          {audits.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td>
              <td>{a.event_type}</td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
              <td style={{ maxWidth: 680 }}>
                <details>
                  <summary style={{ cursor: "pointer" }}>View</summary>
                  <pre style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                    {JSON.stringify(a.payload, null, 2)}
                  </pre>
                </details>
              </td>
            </tr>
          ))}
          {audits.length === 0 ? (
            <tr>
              <td colSpan="4" style={{ padding: 12, textAlign: "center" }}>
                No results
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className="secondary"
          type="button"
          disabled={!canPrev || loading}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Prev
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!canNext || loading}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </button>
      </div>
    </>
  );
}

function CustomersPage({ showToast }) {
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ limit: 50, offset: 0, total: 0 });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await listCustomers({ limit, offset });
      if (!res.ok) {
        showToast(res.error || "Failed to load customers", "error");
        return;
      }
      setRows(res.customers || []);
      setPage(res.page || { limit, offset, total: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const canPrev = offset > 0;
  const canNext = offset + limit < (page.total || 0);

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Customers</h2>

      <div style={{ color: "rgba(234,240,255,0.75)", fontSize: 13, margin: "8px 0 12px" }}>
        Showing {Math.min(page.total, offset + 1)}–{Math.min(page.total, offset + limit)} of{" "}
        {page.total}
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th>Name</th>
            <th>Email</th>
            <th style={{ width: 130 }}>Risk Tier</th>
            <th style={{ width: 230 }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.full_name}</td>
              <td>{c.email}</td>
              <td>{c.risk_tier}</td>
              <td>{new Date(c.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ padding: 12, textAlign: "center" }}>
                No customers
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className="secondary"
          type="button"
          disabled={!canPrev || loading}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Prev
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!canNext || loading}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </button>
      </div>
    </>
  );
}

function ContractsPage({ showToast }) {
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ limit: 50, offset: 0, total: 0 });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await listContracts({ limit, offset });
      if (!res.ok) {
        showToast(res.error || "Failed to load contracts", "error");
        return;
      }
      setRows(res.contracts || []);
      setPage(res.page || { limit, offset, total: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  const canPrev = offset > 0;
  const canNext = offset + limit < (page.total || 0);

  return (
    <>
      <h2 style={{ marginTop: 0 }}>Contracts</h2>

      <div style={{ color: "rgba(234,240,255,0.75)", fontSize: 13, margin: "8px 0 12px" }}>
        Showing {Math.min(page.total, offset + 1)}–{Math.min(page.total, offset + limit)} of{" "}
        {page.total}
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th style={{ width: 160 }}>Policy #</th>
            <th>Status</th>
            <th>Customer</th>
            <th style={{ width: 230 }}>Created</th>
            <th style={{ width: 120 }}>PDF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td style={{ fontFamily: "monospace" }}>{c.policy_number}</td>
              <td>{c.status}</td>
              <td>
                {c.customer_name}
                <div style={{ color: "rgba(234,240,255,0.65)", fontSize: 12 }}>
                  {c.customer_email}
                </div>
              </td>
              <td>{new Date(c.created_at).toLocaleString()}</td>
              <td>
                <a href={contractPdfUrl(c.id)} target="_blank" rel="noreferrer">
                  View PDF
                </a>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ padding: 12, textAlign: "center" }}>
                No contracts
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          className="secondary"
          type="button"
          disabled={!canPrev || loading}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Prev
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!canNext || loading}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </button>
      </div>
    </>
  );
}

export default function App() {
  const [summary, setSummary] = useState(null);
  const [apps, setApps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [tab, setTab] = useState("applications");

  const [sdkOpen, setSdkOpen] = useState(false);
  const [sdkAppId, setSdkAppId] = useState(null);

  const [sdkReady, setSdkReady] = useState(Boolean(getSumsubSdk()));

  function showToast(message, type = "info") {
    setToast({ message, type });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2800);
  }

  async function loadSummary() {
    const data = await getSummary();
    setSummary(data);
  }

  async function loadApplications() {
    const res = await listApplications();
    if (res.ok) setApps(res.applications);
  }

  async function refreshAll() {
    await Promise.all([loadSummary(), loadApplications()]);
  }

  useEffect(() => {
    refreshAll();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await waitForSumsubSdk({ timeoutMs: 8000, stepMs: 200 });
      if (!cancelled) setSdkReady(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const appCount = useMemo(() => apps.length, [apps.length]);

  async function openSumsub(applicationId) {
    const ok = await waitForSumsubSdk({ timeoutMs: 8000, stepMs: 200 });
    setSdkReady(ok);

    const SDK = getSumsubSdk();
    if (!ok || !SDK) {
      showToast("Sumsub SDK not ready. Found only window.snsWebSdk? Refresh once and retry.", "error");
      return;
    }

    // Ensure applicant exists (ignore 409)
    try {
      await createSumsubApplicant(applicationId);
    } catch {}

    const tokenRes = await getSumsubAccessToken(applicationId);
    if (!tokenRes.ok || !tokenRes.token) {
      showToast(tokenRes.error || "Failed to get Sumsub token", "error");
      return;
    }

    setSdkAppId(applicationId);
    setSdkOpen(true);

    const el = document.getElementById("sumsub-websdk-container");
    if (!el) return;
    el.innerHTML = "";

    if (typeof SDK.init !== "function") {
      showToast("Sumsub SDK loaded but init() is missing on window.snsWebSdk.", "error");
      return;
    }

    const sdkInstance = SDK.init(tokenRes.token, async () => {
      const refresh = await getSumsubAccessToken(applicationId);
      return refresh.token;
    })
      .withConf({ lang: "en", theme: "light" })
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on("idCheck.onReady", () => console.log("Sumsub ready"))
      .on("idCheck.onError", (e) => console.error("Sumsub error", e))
      .build();

    sdkInstance.launch("#sumsub-websdk-container");
    showToast("Opened Sumsub KYC", "success");
  }

  function closeSumsub() {
    setSdkOpen(false);
    setSdkAppId(null);
    const el = document.getElementById("sumsub-websdk-container");
    if (el) el.innerHTML = "";
  }

  if (!summary) return <div style={{ padding: 18 }}>Loading...</div>;

  return (
    <div>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <SumsubModal open={sdkOpen} applicationId={sdkAppId} onClose={closeSumsub} />

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>PolicyFlow AI</h1>
            <div style={{ color: "rgba(234,240,255,0.75)", fontSize: 13, marginTop: 4 }}>
              KYC-to-Revenue Automation Engine (POC) • SDK:{" "}
              <b>{sdkReady ? "READY" : "NOT READY"}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "rgba(234,240,255,0.75)", fontSize: 13 }}>
              Applications: <b style={{ color: "white" }}>{appCount}</b>
            </div>

            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                  await refreshAll();
                  showToast("Refreshed", "success");
                } catch (e) {
                  console.error(e);
                  showToast("Refresh failed", "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, marginTop: 12 }}>
          <PillTab active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
            Dashboard
          </PillTab>
          <PillTab active={tab === "applications"} onClick={() => setTab("applications")}>
            Applications
          </PillTab>
          <PillTab active={tab === "customers"} onClick={() => setTab("customers")}>
            Customers
          </PillTab>
          <PillTab active={tab === "contracts"} onClick={() => setTab("contracts")}>
            Contracts
          </PillTab>
          <PillTab active={tab === "audits"} onClick={() => setTab("audits")}>
            Audit Logs
          </PillTab>
        </div>

        <div
          style={{
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 18,
            padding: 16,
            boxShadow: "0 22px 70px rgba(0,0,0,0.30)",
          }}
        >
          {tab === "dashboard" ? (
            <DashboardPage
              summary={summary}
              busy={busy}
              setBusy={setBusy}
              showToast={showToast}
              refreshAll={refreshAll}
            />
          ) : null}

          {tab === "applications" ? (
            <ApplicationsPage
              apps={apps}
              busy={busy}
              setBusy={setBusy}
              showToast={showToast}
              loadApplications={loadApplications}
              refreshAll={refreshAll}
              openSumsub={openSumsub}
            />
          ) : null}

          {tab === "customers" ? <CustomersPage showToast={showToast} /> : null}
          {tab === "contracts" ? <ContractsPage showToast={showToast} /> : null}
          {tab === "audits" ? <AuditLogsPage showToast={showToast} /> : null}
        </div>
      </div>
    </div>
  );
}
