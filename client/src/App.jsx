import React, { useEffect, useState } from "react";
import { getSummary, triggerDemo } from "./api";

export default function App() {
  const [summary, setSummary] = useState(null);

  async function load() {
    const data = await getSummary();
    setSummary(data);
  }

  useEffect(() => {
    load();
  }, []);

  if (!summary) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <h1>PolicyFlow AI Dashboard</h1>

      <div className="cards">
        <div className="card">Customers: {summary.counts.customers}</div>
        <div className="card">Contracts: {summary.counts.contracts}</div>
        <div className="card">Audit Logs: {summary.counts.audits}</div>
      </div>

      <button onClick={async () => { await triggerDemo(); await load(); }}>
        Simulate Sumsub Approved
      </button>

      <h2>Latest Customers</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Risk Tier</th></tr>
        </thead>
        <tbody>
          {summary.customers.map(c => (
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
          <tr><th>Event</th><th>Time</th></tr>
        </thead>
        <tbody>
          {summary.audits.map(a => (
            <tr key={a.id}>
              <td>{a.event_type}</td>
              <td>{new Date(a.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <a className="link" href="/api/audit/export">Download Audit CSV</a>
    </div>
  );
}
