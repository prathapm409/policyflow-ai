const PDFDocument = require("pdfkit");

function generateContractPDF({ customer, contract }) {
  const doc = new PDFDocument();
  const chunks = [];

  doc.on("data", (c) => chunks.push(c));
  doc.on("end", () => {});

  doc.fontSize(18).text("Policy Contract", { align: "center" });
  doc.moveDown();
  doc.fontSize(12).text(`Policy Number: ${contract.policy_number}`);
  doc.text(`Customer: ${customer.full_name}`);
  doc.text(`Email: ${customer.email}`);
  doc.text(`Risk Tier: ${customer.risk_tier}`);
  doc.text(`Contract Status: ${contract.status}`);
  doc.moveDown();
  doc.text("This contract was generated automatically by PolicyFlow AI.");

  doc.end();

  return Buffer.concat(chunks);
}

module.exports = { generateContractPDF };
