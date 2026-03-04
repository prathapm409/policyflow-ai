import React, { useEffect, useMemo, useState } from "react";
import {
  getSummary,
  triggerDemo,
  createApplication,
  listApplications,
  startKyc,
  sendSumsubWebhook,
  listAudits,
} from "./api";

function Toast({ toast, onClose }) {
  if (!toast) return null;
  const bg =
    toast.type === "error" ? "#dc2626" : toast.type === "success" ? "#16a34a" : "#2563eb";
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        background: bg,
        color: "white",
        padding: "10px 12px",
        borderRadius: 10,
        boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
        maxWidth: 420,
        zIndex: 9999,
        display: "flex",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: 14, lineHeight: 1.3 }}>{toast.message}</div>
      <button
        onClick={onClose}
        style={{
          border: "1px solid rgba(255,255,255,0.35)",
          background: "transparent",
          color: "white",
          borderRadius: 8,
          padding: "4px 8px",
          cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 14,
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280" }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: active ? "1px solid #2563eb" : "1px solid #e5e7eb",
        background: active ? "#eff6ff" : "white",
        cursor: "pointer",
        fontWeight: active ? 700 : 600,
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
    status === "APPROVED" ? "#16a34a" : status === "REJECTED" ? "#dc2626" : "#2563eb";

  return (
    <div style={{ minWidth: 140 }}>
      <div
        style={{
          height: 8,
          background: "#e5e7eb",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: 8, background: color }} />
      </div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{pct}%</div>
    </div>
  );
}

function DashboardPage({ summary, busy, setBusy, showToast, refreshAll }) {
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Card title="Customers" value={summary.counts.customers} />
        <Card title="Contracts" value={summary.counts.contracts} />
        <Card title="Audit Logs (latest)" value={summary.counts.audits} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          disabled={busy}
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

        <a className="link" href="/api/audit/export" style={{ marginLeft: 8 }}>
          Download Audit CSV
        </a>
      </div>

      <h2 style={{ marginTop: 18 }}>Latest Customers</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Risk Tier</th>
          </tr>
        </thead>
        <tbody>
          {summary.customers.map((c) => (
            <tr key={c.id}>
              <td>{c.full_name}</td>
              <td>{c.email}</td>
              <td>{c.risk_tier}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ marginTop: 18 }}>Latest Audit Logs (Top 10)</h2>
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {summary.audits.map((a) => (
            <tr key={a.id}>
              <td>{a.event_type}</td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ color: "#6b7280", fontSize: 13, marginTop: 8 }}>
        Tip: Go to <b>Audit Logs</b> tab to search and view all.
      </div>
    </>
  );
}

function ApplicationsPage({ apps, busy, setBusy, showToast, loadApplications, refreshAll }) {
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
      <h2>Applications</h2>

      <form onSubmit={onCreateApplication} style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={{ padding: 10, minWidth: 240 }}
          />
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, minWidth: 240 }}
          />
          <button disabled={busy} type="submit">
            {busy ? "Creating..." : "Create Application"}
          </button>
        </div>
        {appError ? <div style={{ color: "crimson", marginTop: 8 }}>{appError}</div> : null}
      </form>

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
                        disabled={busy}
                        type="button"
                        onClick={() => onCopy(applicantId)}
                        style={{ padding: "6px 10px" }}
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

                    {hasApplicantId ? (
                      <>
                        <button
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
            style={{ padding: 10, minWidth: 300 }}
          />
          <button
            type="button"
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

      <div style={{ color: "#6b7280", fontSize: 13, margin: "8px 0 12px" }}>
        Showing {Math.min(page.total, offset + 1)}–{Math.min(page.total, offset + limit)} of{" "}
        {page.total}
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th style={{ width: 240 }}>Event</th>
            <th style={{ width: 220 }}>Time</th>
            <th>Payload</th>
          </tr>
        </thead>
        <tbody>
          {audits.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td>
              <td>{a.event_type}</td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
              <td style={{ maxWidth: 640 }}>
                <details>
                  <summary>View</summary>
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
          type="button"
          disabled={!canPrev || loading}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Prev
        </button>
        <button type="button" disabled={!canNext || loading} onClick={() => setOffset(offset + limit)}>
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
  const [tab, setTab] = useState("dashboard"); // dashboard | applications | audits

  function showToast(message, type = "info") {
    setToast({ message, type });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2500);
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

  const appCount = useMemo(() => apps.length, [apps.length]);

  if (!summary) return <div style={{ padding: 18 }}>Loading...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6" }}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>PolicyFlow AI</h1>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
              KYC-to-Revenue Automation Engine (POC)
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ color: "#6b7280", fontSize: 13 }}>
              Applications: <b>{appCount}</b>
            </div>
            <button
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

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
            Dashboard
          </TabButton>
          <TabButton active={tab === "applications"} onClick={() => setTab("applications")}>
            Applications
          </TabButton>
          <TabButton active={tab === "audits"} onClick={() => setTab("audits")}>
            Audit Logs
          </TabButton>
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 16,
            marginTop: 12,
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
            />
          ) : null}

          {tab === "audits" ? <AuditLogsPage showToast={showToast} /> : null}
        </div>
      </div>
    </div>
  );
}
