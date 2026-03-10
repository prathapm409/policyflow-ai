import React, { useEffect, useState } from "react";
import {
  getSummary,
  triggerDemo,
  listApplications,
  listContracts,
  listCustomers,
  listComplianceReviews,
  listVerifiedResults,
  contractPdfUrl,
} from "./api";

export default function App() {
  const [summary, setSummary] = useState({
    counts: {},
    customers: [],
    audits: [],
    contracts: [],
  });
  const [applications, setApplications] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [verifiedResults, setVerifiedResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("dashboard");

  async function loadAll() {
    setLoading(true);
    setError("");

    const [
      summaryRes,
      appsRes,
      contractsRes,
      customersRes,
      reviewsRes,
      verifiedRes,
    ] = await Promise.all([
      getSummary(),
      listApplications(),
      listContracts(),
      listCustomers(),
      listComplianceReviews(),
      listVerifiedResults(),
    ]);

    if (!summaryRes?.ok) {
      setError(summaryRes?.error || "Failed to load dashboard");
    }

    setSummary({
      counts: summaryRes?.counts || {},
      customers: summaryRes?.customers || [],
      audits: summaryRes?.audits || [],
      contracts: summaryRes?.contracts || [],
    });

    setApplications(appsRes?.applications || []);
    setContracts(contractsRes?.contracts || []);
    setCustomers(customersRes?.customers || []);
    setReviews(reviewsRes?.reviews || []);
    setVerifiedResults(verifiedRes?.results || []);

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function onTriggerDemo() {
    await triggerDemo();
    await loadAll();
    setTab("contracts");
  }

  const latestContract = contracts[0];

  return (
    <div style={{ fontFamily: "Arial, sans-serif", background: "#08122b", minHeight: "100vh", color: "#fff", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>PolicyFlow AI Dashboard</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        {["dashboard", "applications", "verified", "reviews", "customers", "contracts", "audits"].map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            style={{
              background: tab === item ? "#7c5cff" : "#1a2547",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 14px",
              cursor: "pointer",
            }}
          >
            {item.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <div>Loading...</div>}

      {error && (
        <div style={{ background: "#3b1220", color: "#ffb3c1", padding: 14, borderRadius: 8, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {!loading && tab === "dashboard" && (
        <div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={cardStyle}>Applications: {summary.counts.applications || 0}</div>
            <div style={cardStyle}>Customers: {summary.counts.customers || 0}</div>
            <div style={cardStyle}>Contracts: {summary.counts.contracts || 0}</div>
            <div style={cardStyle}>Audit Logs: {summary.counts.audits || 0}</div>
          </div>

          <button onClick={onTriggerDemo} style={primaryBtn}>
            Simulate Approved KYC Flow
          </button>

          {latestContract && (
            <div style={{ ...panelStyle, marginTop: 20 }}>
              <h2>Latest Contract</h2>
              <p><strong>Policy Number:</strong> {latestContract.policy_number}</p>
              <p><strong>Customer:</strong> {latestContract.full_name}</p>
              <p><strong>Status:</strong> {latestContract.status}</p>
              <a
                href={contractPdfUrl(latestContract.id)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#9ecbff" }}
              >
                View Contract PDF
              </a>
            </div>
          )}
        </div>
      )}

      {!loading && tab === "applications" && (
        <div style={panelStyle}>
          <h2>Applications</h2>
          {applications.length === 0 ? <p>No applications found.</p> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>KYC</th>
                  <th>Risk Tier</th>
                  <th>Decision</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td>{a.full_name}</td>
                    <td>{a.email}</td>
                    <td>{a.kyc_status}</td>
                    <td>{a.risk_tier}</td>
                    <td>{a.decision_status}</td>
                    <td>{a.policy_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === "verified" && (
        <div style={panelStyle}>
          <h2>Verified Results</h2>
          {verifiedResults.length === 0 ? <p>No verified results yet.</p> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>KYC Status</th>
                  <th>Risk Tier</th>
                  <th>Compliance</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {verifiedResults.map((r) => (
                  <tr key={r.id}>
                    <td>{r.full_name}</td>
                    <td>{r.kyc_status}</td>
                    <td>{r.risk_tier}</td>
                    <td>{r.compliance_status}</td>
                    <td>{r.policy_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === "reviews" && (
        <div style={panelStyle}>
          <h2>Compliance Reviews</h2>
          {reviews.length === 0 ? <p>No compliance reviews.</p> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Applicant ID</th>
                  <th>Risk Score</th>
                  <th>Risk Tier</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r.id}>
                    <td>{r.applicant_id}</td>
                    <td>{r.risk_score}</td>
                    <td>{r.risk_tier}</td>
                    <td>{r.status}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === "customers" && (
        <div style={panelStyle}>
          <h2>Customers</h2>
          {customers.length === 0 ? <p>No customers created yet.</p> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Risk Tier</th>
                  <th>Risk Score</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>{c.full_name}</td>
                    <td>{c.email}</td>
                    <td>{c.risk_tier}</td>
                    <td>{c.risk_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === "contracts" && (
        <div style={panelStyle}>
          <h2>Contracts</h2>
          {contracts.length === 0 ? <p>No contracts generated.</p> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Policy Number</th>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Risk Tier</th>
                  <th>Status</th>
                  <th>PDF</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.policy_number}</td>
                    <td>{c.full_name}</td>
                    <td>{c.email}</td>
                    <td>{c.risk_tier}</td>
                    <td>{c.status}</td>
                    <td>
                      <a
                        href={contractPdfUrl(c.id)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#9ecbff" }}
                      >
                        Open PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!loading && tab === "audits" && (
        <div style={panelStyle}>
          <h2>Audit Logs</h2>
          {summary.audits.length === 0 ? <p>No audit logs found.</p> : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Created At</th>
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
          )}
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  background: "#121f3d",
  padding: 18,
  borderRadius: 12,
  minWidth: 180,
};

const panelStyle = {
  background: "#121f3d",
  padding: 20,
  borderRadius: 12,
  overflowX: "auto",
};

const primaryBtn = {
  background: "#7c5cff",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "12px 18px",
  cursor: "pointer",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  color: "#fff",
};