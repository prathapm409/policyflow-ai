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
