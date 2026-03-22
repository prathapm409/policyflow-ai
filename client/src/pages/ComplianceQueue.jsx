import React, { useEffect, useState } from "react";
import { listComplianceReviews, actOnComplianceReview } from "../api";

export default function ComplianceQueue() {
  const [reviews, setReviews] = useState([]);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const res = await listComplianceReviews();
      setReviews(res.reviews || []);
    } catch (e) {
      console.error(e);
      alert("Failed to load compliance reviews");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doAction(id, action) {
    setBusyId(id);
    try {
      const res = await actOnComplianceReview(id, action);
      if (!res?.ok) {
        alert(res?.error || "Failed action");
        return;
      }
      await load();
    } catch (e) {
      console.error(e);
      alert("Failed action");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h2>Compliance Queue</h2>
      <p>Compliance team reviews HIGH and CRITICAL risk cases here.</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Applicant ID</th>
            <th>Risk Tier</th>
            <th>Risk Score</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reviews.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.applicant_id}</td>
              <td>{r.risk_tier}</td>
              <td>{r.risk_score}</td>
              <td>{r.reason}</td>
              <td>{r.status}</td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td style={{ display: "flex", gap: 8 }}>
                <button disabled={busyId === r.id} onClick={() => doAction(r.id, "START")}>Start</button>
                <button className="success" disabled={busyId === r.id} onClick={() => doAction(r.id, "APPROVE")}>Approve</button>
                <button className="secondary" disabled={busyId === r.id} onClick={() => doAction(r.id, "DONE")}>Done</button>
              </td>
            </tr>
          ))}
          {reviews.length === 0 && <tr><td colSpan="8">No items</td></tr>}
        </tbody>
      </table>
    </div>
  );
}