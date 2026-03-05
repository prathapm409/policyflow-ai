const PDFDocument = require("pdfkit");

function generateContractPDF({ customer, contract }) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  // Header
  doc.fontSize(20).text("PolicyFlow AI - Insurance Contract", { align: "center" });
  doc.moveDown(1);

  // Contract Info
  doc.fontSize(12);
  doc.text(`Policy Number: ${contract.policy_number || "-"}`);
  doc.text(`Contract Status: ${contract.status || "-"}`);
  doc.text(`Created At: ${contract.created_at ? new Date(contract.created_at).toLocaleString() : "-"}`);
  doc.moveDown(1);

  // Customer Info
  doc.fontSize(14).text("Customer Details", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12);
  doc.text(`Name: ${customer.full_name || "-"}`);
  doc.text(`Email: ${customer.email || "-"}`);
  doc.text(`Risk Tier: ${customer.risk_tier || "-"}`);
  doc.moveDown(1);

  // Terms (sample text)
  doc.fontSize(14).text("Terms & Conditions", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).text(
    "This is a proof-of-concept contract generated automatically after KYC approval. " +
      "It confirms that the customer passed verification and a policy was generated. " +
      "For production use, replace this section with real legal text.",
    { align: "left" }
  );

  doc.moveDown(2);
  doc.fontSize(12).text("Authorized Signature: ____________________", { align: "right" });

  doc.end();

  return Buffer.concat(chunks);
}

module.exports = { generateContractPDF };
