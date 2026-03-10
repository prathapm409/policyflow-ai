import React, { useEffect, useState } from "react";
import { getJson } from "../api";

export default function ComplianceQueue() {
  const [reviews, setReviews] = useState([]);
  useEffect(() => {
    async function load() {
      try {
        const res = await getJson("/api/compliance/reviews");
        setReviews(res.reviews || []);
      } catch (e) {
        console.error(e);
        alert("Failed to load compliance reviews");
      }
    }
    load();
  }, []);
  return (
    <div>
      <h2>Compliance Queue</h2>
      <table>
        <thead><tr><th>ID</th><th>Applicant ID</th><th>Risk Tier</th><th>Reason</th><th>Created</th></tr></thead>
        <tbody>
          {reviews.map(r => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.applicant_id}</td>
              <td>{r.risk_tier}</td>
              <td>{r.reason}</td>
              <td>{new Date(r.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {reviews.length === 0 && <tr><td colSpan="5">No items</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
