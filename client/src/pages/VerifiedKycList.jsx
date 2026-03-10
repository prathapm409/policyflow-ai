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
