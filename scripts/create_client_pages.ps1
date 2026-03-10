# Run from repo root (PowerShell)
# Creates client/src/pages and four page files.

$pagesDir = "client\src\pages"
if (-not (Test-Path $pagesDir)) { New-Item -ItemType Directory -Path $pagesDir | Out-Null }

@'
import React, { useEffect, useState } from "react";
import { postJson } from "../api";

export default function VerifiedKycList() {
  const [items, setItems] = useState([]);
  const [runningId, setRunningId] = useState(null);

  useEffect(() => {
    const sample = [
      { applicantId: "TEST-LOW-1", name: "James Carter", email: "james.carter@example.com", status: "approved" },
      { applicantId: "TEST-MED-1", name: "A. Medium", email: "med@example.com", status: "approved" },
      { applicantId: "TEST-HIGH-1", name: "B. High", email: "high@example.com", status: "approved" },
    ];
    setItems(sample);
  }, []);

  async function runAssignment(applicantId) {
    setRunningId(applicantId);
    try {
      const payload = { applicantId, status: "approved", fullName: applicantId === "TEST-LOW-1" ? "James Carter" : "User", email: `${applicantId}@example.com` };
      const out = await postJson("/api/webhook/sumsub", payload);
      if (out?.contract?.id) {
        window.open(`/api/contracts/${out.contract.id}/pdf`, "_blank");
      } else {
        alert("Processed: " + JSON.stringify(out));
      }
    } catch (err) {
      console.error(err);
      alert("Run failed: " + (err?.body?.error || err.message || JSON.stringify(err)));
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div>
      <h2>Verified KYC results</h2>
      <p>Click Run to execute risk assignment & automation for a test case.</p>

      <table>
        <thead>
          <tr>
            <th>Applicant</th>
            <th>Email</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.applicantId}>
              <td>{it.name} <small>({it.applicantId})</small></td>
              <td>{it.email}</td>
              <td>{it.status}</td>
              <td>
                <button className="small" disabled={runningId === it.applicantId} onClick={() => runAssignment(it.applicantId)}>
                  {runningId === it.applicantId ? "Running..." : "Run"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
'@ > "$pagesDir\VerifiedKycList.jsx"

@'
import React, { useEffect, useState } from "react";
import { getJson } from "../api";

export default function ContractList() {
  const [contracts, setContracts] = useState([]);
  useEffect(() => {
    async function load() {
      try {
        const res = await getJson("/api/contracts");
        setContracts(res.contracts || []);
      } catch (e) {
        console.error(e);
        alert("Failed to load contracts");
      }
    }
    load();
  }, []);
  return (
    <div>
      <h2>Contracts</h2>
      <table>
        <thead><tr><th>ID</th><th>Policy Number</th><th>Status</th><th>Customer</th><th>Actions</th></tr></thead>
        <tbody>
          {contracts.map(c => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.policy_number}</td>
              <td>{c.status}</td>
              <td>{c.customer_id}</td>
              <td><a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer">View PDF</a></td>
            </tr>
          ))}
          {contracts.length === 0 && <tr><td colSpan="5">No contracts</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
'@ > "$pagesDir\ContractList.jsx"

@'
import React from "react";
import { useParams } from "react-router-dom";

export default function ContractPdfView() {
  const { id } = useParams();
  const url = `/api/contracts/${id}/pdf`;
  return (
    <div>
      <h2>Contract PDF (id: {id})</h2>
      <iframe src={url} title="contract" style={{ width: "100%", height: "800px", border: "1px solid #ddd" }} />
    </div>
  );
}
'@ > "$pagesDir\ContractPdfView.jsx"

@'
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
'@ > "$pagesDir\ComplianceQueue.jsx"

Write-Host "Created client/src/pages and 4 page files."
