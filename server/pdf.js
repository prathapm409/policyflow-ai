// server/pdf.js
// PDF generator that renders an Insurance Policy Agreement (two pages like screenshot)
const PDFDocument = require("pdfkit");

function generateContractPDF({ customer = {}, contract = {} }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 48 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const formatDate = (d) => {
        if (!d) return "-";
        const dt = new Date(d);
        return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      };
      const nl = (s) => (s ? String(s) : "-");

      // Header
      doc.fontSize(20).font("Helvetica-Bold").text("Insurance Policy Agreement", { align: "center" });
      doc.moveDown(1.2);

      // Two-column area
      const leftX = doc.page.margins.left;
      const rightX = 260;
      let y = doc.y;
      const rowGap = 18;
      const writeRow = (label, value) => {
        doc.font("Helvetica").fontSize(11).text(label, leftX, y);
        doc.font("Helvetica").fontSize(11).text(value, rightX, y);
        y += rowGap;
      };

      writeRow("Policy Number:", nl(contract.policy_number || contract.policyNumber || `POL-${Math.floor(Math.random()*900000)+100000}`));
      writeRow("Policy Issue Date:", formatDate(contract.created_at || contract.issue_date || new Date()));
      writeRow("Insurer:", nl(contract.insurer || "Northern Shield Insurance Ltd"));
      writeRow("Insurer Address:", nl(contract.insurer_address || "42 Bishopsgate, London, UK"));
      writeRow("Policyholder:", nl(customer.full_name || contract.policyholder || "-"));
      writeRow("Address:", nl(contract.policyholder_address || customer.address || "-"));
      writeRow("Date of Birth:", formatDate(contract.dob || contract.date_of_birth));
      doc.moveDown(2);

      // Policy Details
      doc.font("Helvetica-Bold").fontSize(16).text("Policy Details");
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(11);
      doc.text(`Policy Type: ${nl(contract.policy_type || "Motor Insurance")}`);
      doc.moveDown(0.3);
      doc.text(`Coverage Start Date: ${formatDate(contract.coverage_start || contract.coverageStart || contract.created_at)}`);
      doc.text(`Coverage End Date: ${formatDate(contract.coverage_end || contract.coverageEnd)}`);
      doc.moveDown(0.6);
      doc.fontSize(11).text("Coverage Description:");
      doc.moveDown(0.3);
      doc.fontSize(11).text(nl(contract.coverage_description || "Comprehensive coverage for private motor vehicle including accidental damage, theft, and third-party liability."), { align: "left" });
      doc.moveDown(0.6);
      doc.fontSize(11);
      doc.text(`Coverage Limit: ${nl(contract.coverage_limit || "£50,000")}`);
      doc.text(`Deductible: ${nl(contract.deductible || "£500")}`);
      doc.text(`Annual Premium: ${nl(contract.premium || "£820")}`);
      doc.text(`Payment Frequency: ${nl(contract.payment_frequency || "Monthly")}`);

      // New page for verification & risk etc.
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(18).text("Identity Verification");
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(11);
      doc.text(`Verification Provider: Sumsub`);
      doc.text(`Verification ID: ${nl(contract.sumsub_verification_id || contract.sumsubId || contract.verification_id)}`);
      doc.text(`Verification Status: ${nl(contract.sumsub_status || contract.verification_status || "Approved")}`);
      doc.text(`Verification Date: ${formatDate(contract.sumsub_verified_at || contract.verified_at || contract.created_at)}`);
      doc.moveDown(1);

      doc.font("Helvetica-Bold").fontSize(16).text("Risk Classification");
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(11);
      doc.text(`Risk Tier Assigned: ${nl(customer.risk_tier || contract.risk_tier || "Medium")}`);
      doc.text(`Monitoring Frequency: ${nl(contract.monitoring_frequency || customer.monitoring_frequency || "Quarterly")}`);
      doc.moveDown(1.2);

      doc.font("Helvetica-Bold").fontSize(16).text("Policyholder Responsibilities");
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(11);
      doc.text("The policyholder agrees to provide accurate and truthful information during the application process and notify the insurer of any material changes affecting the risk profile.");
      doc.moveDown(1.2);

      doc.font("Helvetica-Bold").fontSize(18).text("Claims");
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(11);
      doc.text("Claims must be reported within 30 days of the incident.");
      doc.moveDown(0.3);
      doc.text("Claims may be subject to investigation if anomalies or fraud indicators are detected.");
      doc.moveDown(1.2);

      doc.font("Helvetica-Bold").fontSize(18).text("Agreement");
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(11);
      doc.text(`Insurer Representative: ${nl(contract.insurer_representative || "Sarah Bennett – Senior Underwriter")}`);
      doc.moveDown(0.6);
      doc.text(`Policyholder: ${nl(customer.full_name || contract.policyholder || "-")}`);
      doc.moveDown(0.6);
      doc.text(`Date: ${formatDate(contract.created_at || new Date())}`);
      doc.moveDown(2);

      doc.text("_______________________________", { continued: false });
      doc.text("Insurer Representative Signature", { align: "left" });
      doc.moveUp(1);
      doc.text("_______________________________", { align: "right" });
      doc.text("Policyholder Signature", { align: "right" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generateContractPDF };
