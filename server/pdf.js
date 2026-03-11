const PDFDocument = require("pdfkit");

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function safe(value, fallback = "-") {
  return value == null || value === "" ? fallback : String(value);
}

function generateContractPDF({ customer = {}, contract = {}, application = {} }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 36, size: "A4" });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const insurerName = safe(contract.insurer, "Northern Shield Insurance Ltd");
      const insurerAddress = safe(contract.insurer_address, "42 Bishopsgate, London, UK");
      const policyNumber = safe(contract.policy_number, "POL-UK-2026-000384");
      const policyIssueDate = formatDate(contract.created_at || new Date());

      const policyholderName = safe(customer.full_name || application.full_name, "Policyholder");
      const policyholderAddress = safe(contract.policyholder_address || application.address, "Address not provided");
      const policyholderDob = formatDate(contract.dob || application.date_of_birth || new Date());

      const coverageStartDate = formatDate(contract.coverage_start || new Date());
      const coverageEndDate = formatDate(contract.coverage_end || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
      const coverageDescription = safe(
        contract.coverage_description,
        "Comprehensive coverage for accidental damage, theft, and third-party liability."
      );

      const coverageLimit = safe(contract.coverage_limit, "£50,000");
      const deductible = safe(contract.deductible, "£500");
      const annualPremium = safe(contract.premium, "£820");
      const paymentFrequency = safe(contract.payment_frequency, "Monthly");

      const verificationId = safe(
        contract.sumsub_verification_id || customer.external_id || application.external_applicant_id,
        "N/A"
      );
      const verificationStatus = safe(contract.sumsub_status || application.kyc_status, "Pending");
      const verificationDate = formatDate(
        contract.sumsub_verified_at || application.updated_at || contract.created_at || new Date()
      );

      const riskTier = safe(customer.risk_tier || application.risk_tier, "Medium");
      const monitoringFrequency = safe(contract.monitoring_frequency || application.monitoring_frequency, "Quarterly");

      function pageBg() {
        doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ececec");
        doc.fillColor("black");
        doc.rect(24, 24, doc.page.width - 48, doc.page.height - 48).fill("#f8f8f8");
        doc.fillColor("black");
      }

      pageBg();
      doc.font("Helvetica-Bold").fontSize(20).text("Insurance Policy Agreement", 0, 50, { align: "center" });

      let y = 105;
      const leftX = 60;
      const rightX = 265;
      const rowGap = 24;

      function row(label, value) {
        doc.font("Helvetica").fontSize(10.5).text(label, leftX, y);
        doc.text(safe(value), rightX, y, { width: 250 });
        y += rowGap;
      }

      row("Policy Number:", policyNumber);
      row("Policy Issue Date:", policyIssueDate);
      row("Insurer:", insurerName);
      row("Insurer Address:", insurerAddress);
      row("Policyholder:", policyholderName);
      row("Address:", policyholderAddress);
      row("Date of Birth:", policyholderDob);

      y += 10;
      doc.font("Helvetica-Bold").fontSize(14).text("Policy Details", leftX, y);
      y += 22;
      doc.font("Helvetica").fontSize(10.5).text("Policy Type: Motor Insurance", leftX, y);
      y += 20;
      doc.text(`Coverage Start Date: ${coverageStartDate}`, leftX, y);
      y += 20;
      doc.text(`Coverage End Date: ${coverageEndDate}`, leftX, y);
      y += 22;
      doc.text("Coverage Description:", leftX, y);
      y += 18;
      doc.text(coverageDescription, leftX, y, { width: 470, height: 42, ellipsis: true, lineGap: 2 });
      y += 40;
      doc.text(`Coverage Limit: ${coverageLimit}`, leftX, y);
      y += 18;
      doc.text(`Deductible: ${deductible}`, leftX, y);
      y += 18;
      doc.text(`Annual Premium: ${annualPremium}`, leftX, y);
      y += 18;
      doc.text(`Payment Frequency: ${paymentFrequency}`, leftX, y);

      y += 26;
      doc.font("Helvetica-Bold").fontSize(14).text("Identity Verification", leftX, y);
      y += 22;
      doc.font("Helvetica").fontSize(10.5).text("Verification Provider: Sumsub", leftX, y);
      y += 18;
      doc.text(`Verification ID: ${verificationId}`, leftX, y);
      y += 18;
      doc.text(`Verification Status: ${verificationStatus}`, leftX, y);
      y += 18;
      doc.text(`Verification Date: ${verificationDate}`, leftX, y);

      y += 26;
      doc.font("Helvetica-Bold").fontSize(14).text("Risk Classification", leftX, y);
      y += 22;
      doc.font("Helvetica").fontSize(10.5).text(`Risk Tier Assigned: ${riskTier}`, leftX, y);
      y += 18;
      doc.text(`Monitoring Frequency: ${monitoringFrequency}`, leftX, y);

      doc.addPage();
      pageBg();

      y = 70;
      doc.font("Helvetica-Bold").fontSize(14).text("Policyholder Responsibilities", 60, y);
      y += 24;
      doc.font("Helvetica").fontSize(10.5).text(
        "The policyholder agrees to provide accurate and truthful information during the application process and notify the insurer of any material changes affecting the risk profile.",
        60,
        y,
        { width: 470, lineGap: 3 }
      );

      y += 75;
      doc.font("Helvetica-Bold").fontSize(14).text("Claims", 60, y);
      y += 24;
      doc.font("Helvetica").fontSize(10.5).text("Claims must be reported within 30 days of the incident.", 60, y, {
        width: 470,
        lineGap: 3,
      });
      y += 20;
      doc.text("Claims may be subject to investigation if anomalies or fraud indicators are detected.", 60, y, {
        width: 470,
        lineGap: 3,
      });

      y += 70;
      doc.font("Helvetica-Bold").fontSize(14).text("Agreement", 60, y);
      y += 24;
      doc.font("Helvetica").fontSize(10.5).text("Insurer Representative: Sarah Bennett – Senior Underwriter", 60, y);
      y += 26;
      doc.text(`Policyholder: ${policyholderName}`, 60, y);
      y += 26;
      doc.text(`Date: ${formatDate(contract.created_at || new Date())}`, 60, y);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateContractPDF };