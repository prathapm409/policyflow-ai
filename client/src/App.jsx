import React, { useEffect, useState } from "react";
import {
  getSummary,
  triggerDemo,
  createApplication,
  listApplications,
  startKyc,
  sendSumsubWebhook,
} from "./api";

export default function App() {
  const [summary, setSummary] = useState(null);

  const [apps, setApps] = useState([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [appError, setAppError] = useState("");

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

    const res = await createApplication({ fullName, email });
    if (!res.ok) {
      setAppError(res.error || "Failed to create application");
      return;
    }

    setFullName("");
    setEmail("");
    await loadApplications();
  }

  async function onCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied Applicant ID!");
    } catch (e) {
      console.error(e);
      alert("Copy failed. Please copy manually.");
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
          <div
            style={{
              width: `${pct}%`,
              height: 8,
              background: color,
            }}
          />
        </div>
        <div style={{ fontSize: 12, marginTop: 4 }}>{pct}%</div>
      </div>
    );
  }

  if (!summary) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <h1>PolicyFlow AI Dashboard</h1>

      <div className="cards">
        <div className="card">Customers: {summary.counts.customers}</div>
        <div className="card">Contracts: {summary.counts.contracts}</div>
        <div className="card">Audit Logs: {summary.counts.audits}</div>
      </div>

      <button
        onClick={async () => {
          await triggerDemo();
          await load();
          await loadApplications();
        }}
      >
        Simulate Sumsub Approved
      </button>

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
          <button type="submit">Create Application</button>
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
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{hasApplicantId ? applicantId : "-"}</span>
                    {hasApplicantId ? (
                      <button
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
                        type="button"
                        onClick={async () => {
                          await startKyc(a.id);
                          await loadApplications();
                          await load();
                        }}
                      >
                        Start KYC
                      </button>
                    ) : null}

                    {hasApplicantId ? (
                      <button
                        type="button"
                        onClick={async () => {
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
                        }}
                      >
                        Simulate Approved
                      </button>
                    ) : null}

                    {!hasApplicantId && a.kyc_status !== "PENDING_KYC" ? "-" : null}
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
