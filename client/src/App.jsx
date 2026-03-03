import React, { useEffect, useState } from "react";
import {
  getSummary,
  triggerDemo,
  createApplication,
  listApplications,
  startKyc,
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
            <th>Risk Tier</th>
            <th>Monitoring</th>
            <th>Applicant ID</th>
            <th>Action</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.id}>
              <td>{a.id}</td>
              <td>{a.full_name}</td>
              <td>{a.email}</td>
              <td>{a.kyc_status}</td>
              <td>{a.risk_tier || "-"}</td>
              <td>{a.monitoring_frequency || "-"}</td>
              <td style={{ fontFamily: "monospace" }}>
                {a.external_applicant_id || "-"}
              </td>
              <td>
                {a.kyc_status === "PENDING_KYC" ? (
                  <button
                    onClick={async () => {
                      await startKyc(a.id);
                      await loadApplications();
                    }}
                  >
                    Start KYC
                  </button>
                ) : (
                  "-"
                )}
              </td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
            </tr>
          ))}

          {apps.length === 0 ? (
            <tr>
              <td colSpan="9" style={{ textAlign: "center", padding: 12 }}>
                No applications yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
