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