import React, { useEffect, useMemo, useState } from "react";
import {
  getSummary,
  triggerDemo,
  createApplication,
  listApplications,
  startKyc,
  sendSumsubWebhook,
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
        maxWidth: 360,
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

export default function App() {
  const [summary, setSummary] = useState(null);

  const [apps, setApps] = useState([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [appError, setAppError] = useState("");

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  function showToast(message, type = "info") {
    setToast({ message, type });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2500);
  }

  async function load() {
    const data = await getSummary();
    setSummary(data);
  }

  async function loadApplications() {
    const res = await listApplications();
    if (res.ok) setApps(res.applications);
  }

  useEffect(() => {
    load();
    loadApplications();
  }, []);

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

  function renderKycProgress(a) {
    const status = a.kyc_status;

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
        ? "#16a34a"
        : status === "REJECTED"
        ? "#dc2626"
        : "#2563eb";

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

  const appCount = useMemo(() => apps.length, [apps.length]);

  if (!summary) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <h1>PolicyFlow AI Dashboard</h1>

      <div className="cards">
        <div className="card">Customers: {summary.counts.customers}</div>
        <div className="card">Contracts: {summary.counts.contracts}</div>
        <div className="card">Audit Logs: {summary.counts.audits}</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              await triggerDemo();
              await load();
              await loadApplications();
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

        <div style={{ color: "#6b7280", fontSize: 13 }}>
          Applications: <b>{appCount}</b>
        </div>
      </div>

      <h2>Latest Customers</h2>
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

      <h2>Latest Audit Logs</h2>
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

      <a className="link" href="/api/audit/export">
        Download Audit CSV
      </a>

      <hr style={{ margin: "24px 0" }} />

      <h2>Applications (POC)</h2>

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
        {appError ? (
          <div style={{ color: "crimson", marginTop: 8 }}>{appError}</div>
        ) : null}
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
            <th>Action</th>
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
                <td>{renderKycProgress(a)}</td>
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
                            await load();
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

                    {hasApplicantId && a.kyc_status !== "APPROVED" ? (
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
                            await load();
                            showToast("Webhook: approved processed", "success");
                          } catch (e) {
                            console.error(e);
                            showToast("Simulate approved failed", "error");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Simulate Approved
                      </button>
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
  );
}
