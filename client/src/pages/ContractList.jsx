import React, { useEffect, useState } from "react";
import { listContracts, regenerateContract, updateContract } from "../api";

export default function ContractList() {
  const [contracts, setContracts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    premium: "",
    deductible: "",
    payment_frequency: "",
    coverage_description: "",
  });

  async function load() {
    try {
      const res = await listContracts();
      setContracts(res.contracts || []);
    } catch (e) {
      console.error(e);
      alert("Failed to load contracts");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(c) {
    setEditingId(c.id);
    setForm({
      premium: c.premium || "",
      deductible: c.deductible || "",
      payment_frequency: c.payment_frequency || "",
      coverage_description: c.coverage_description || "",
    });
  }

  async function saveEdit(id) {
    const res = await updateContract(id, form);
    if (!res?.ok) {
      alert(res?.error || "Failed to update contract");
      return;
    }
    setEditingId(null);
    await load();
  }

  async function doRegenerate(id) {
    const res = await regenerateContract(id);
    if (!res?.ok) {
      alert(res?.error || "Failed to regenerate contract");
      return;
    }
    const updated = res.contract;
    if (updated) startEdit(updated);
    await load();
  }

  return (
    <div>
      <h2>Contracts</h2>
      <p>Low and Medium risk cases should proceed here for contract editing and regeneration.</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Policy Number</th>
            <th>Status</th>
            <th>Customer</th>
            <th>PDF</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => (
            <React.Fragment key={c.id}>
              <tr>
                <td>{c.id}</td>
                <td>{c.policy_number}</td>
                <td>{c.status}</td>
                <td>{c.full_name || c.customer_id}</td>
                <td><a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer">View PDF</a></td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => startEdit(c)}>Edit</button>
                  <button className="secondary" onClick={() => doRegenerate(c.id)}>Regenerate</button>
                </td>
              </tr>
              {editingId === c.id && (
                <tr>
                  <td colSpan="6">
                    <div style={{ display: "grid", gap: 10 }}>
                      <input
                        placeholder="Premium"
                        value={form.premium}
                        onChange={(e) => setForm((p) => ({ ...p, premium: e.target.value }))}
                      />
                      <input
                        placeholder="Deductible"
                        value={form.deductible}
                        onChange={(e) => setForm((p) => ({ ...p, deductible: e.target.value }))}
                      />
                      <input
                        placeholder="Payment frequency"
                        value={form.payment_frequency}
                        onChange={(e) => setForm((p) => ({ ...p, payment_frequency: e.target.value }))}
                      />
                      <input
                        placeholder="Coverage description"
                        value={form.coverage_description}
                        onChange={(e) => setForm((p) => ({ ...p, coverage_description: e.target.value }))}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="success" onClick={() => saveEdit(c.id)}>Save</button>
                        <button className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
          {contracts.length === 0 && <tr><td colSpan="6">No contracts</td></tr>}
        </tbody>
      </table>
    </div>
  );
}