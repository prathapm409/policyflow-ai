import React, { useEffect, useState } from "react";
import { listVerifiedResults, sendToComplianceReview } from "../api";

export default function VerifiedKycList() {
  const [items, setItems] = useState([]);
  const [successfulOnly, setSuccessfulOnly] = useState(true);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    const res = await listVerifiedResults(successfulOnly);
    setItems(res.results || []);
  }

  useEffect(() => {
    load();
  }, [successfulOnly]);

  async function handleSendToCompliance(applicationId) {
    setBusyId(applicationId);
    try {
      const res = await sendToComplianceReview(applicationId);
      if (!res?.ok) {
        alert(res?.error || "Failed to send to compliance");
        return;
      }
      await load();
      alert("Sent to compliance review");
    } catch (e) {
      console.error(e);
      alert("Failed to send to compliance");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2>Verified KYC results</h2>
      <p>Show actual Sumsub outcome and only successful KYC cases when filter is active.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          className={!successfulOnly ? "secondary" : ""}
          onClick={() => setSuccessfulOnly(false)}
        >
          All
        </button>
        <button
          className={successfulOnly ? "" : "secondary"}
          onClick={() => setSuccessfulOnly(true)}
        >
          Successful KYC only
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Application ID</th>
            <th>Name</th>
            <th>Email</th>
            <th>KYC</th>
            <th>Risk Score</th>
            <th>Risk Tier</th>
            <th>Decision</th>
            <th>Monitoring</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const highRisk = ["HIGH", "CRITICAL"].includes(String(it.risk_tier || "").toUpperCase());
            const lowMedium = ["LOW", "MEDIUM"].includes(String(it.risk_tier || "").toUpperCase());

            return (
              <tr key={it.id}>
                <td>{it.id}</td>
                <td>{it.full_name}</td>
                <td>{it.email}</td>
                <td>{it.kyc_status}</td>
                <td>{it.risk_score ?? 0}</td>
                <td>{it.risk_tier || "-"}</td>
                <td>{it.decision_status || "-"}</td>
                <td>{it.monitoring_frequency || "-"}</td>
                <td>
                  {highRisk ? (
                    <button
                      className="danger"
                      disabled={busyId === it.id}
                      onClick={() => handleSendToCompliance(it.id)}
                    >
                      {busyId === it.id ? "Sending..." : "Send to Compliance Review"}
                    </button>
                  ) : lowMedium ? (
                    <span>Proceed to Contract Creation</span>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan="9">No items</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}