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
      const doc = new PDFDocument({
        margin: 36,
        size: "A4",
        bufferPages: true,
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const insurerName = contract.insurer || "Northern Shield Insurance Ltd";
      const insurerAddress = contract.insurer_address || "42 Bishopsgate, London, UK";
      const policyNumber = contract.policy_number || "POL-UK-2026-000384";
      const policyIssueDate = formatDate(contract.created_at || new Date());

      const policyholderName =
        customer.full_name || application.full_name || "James Carter";
      const policyholderAddress =
        contract.policyholder_address ||
        application.address ||
        "14 Kingsway Avenue, Manchester, UK";
      const policyholderDob = formatDate(contract.dob || application.date_of_birth || "1985-07-21");

      const coverageStartDate = formatDate(contract.coverage_start || new Date());
      const coverageEndDate = formatDate(
        contract.coverage_end || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      );
      const coverageDescription =
        contract.coverage_description ||
        "Comprehensive coverage for private motor vehicle including accidental damage, theft and third-party liability.";

      const coverageLimit = safe(contract.coverage_limit, "£50,000");
      const deductible = safe(contract.deductible, "£500");
      const annualPremium = safe(contract.premium, "£820");
      const paymentFrequency = safe(contract.payment_frequency, "Monthly");

      const verificationId =
        contract.sumsub_verification_id ||
        customer.external_id ||
        application.external_applicant_id ||
        "SUM-93840294";
      const verificationStatus =
        contract.sumsub_status || application.kyc_status || "Approved";
      const verificationDate = formatDate(
        contract.sumsub_verified_at || application.updated_at || contract.created_at || new Date()
      );

      const riskTier =
        customer.risk_tier || application.risk_tier || "Medium";
      const monitoringFrequency =
        contract.monitoring_frequency || application.monitoring_frequency || "Quarterly";

      const representative = "Sarah Bennett – Senior Underwriter";
      const agreementDate = formatDate(contract.created_at || new Date());

      function pageBg() {
        doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ececec");
        doc.fillColor("black");
        doc.rect(24, 24, doc.page.width - 48, doc.page.height - 48).fill("#f8f8f8");
        doc.fillColor("black");
      }

      function addHeader(title) {
        doc.font("Helvetica-Bold").fontSize(22).text(title, 0, 54, { align: "center" });
      }

      function addSectionTitle(title, y) {
        doc.font("Helvetica-Bold").fontSize(16).text(title, 56, y);
      }

      pageBg();
      addHeader("Insurance Policy Agreement");

      let y = 120;
      const leftX = 70;
      const rightX = 290;
      const rowGap = 28;

      function twoCol(label, value) {
        doc.font("Helvetica").fontSize(11.5).text(label, leftX, y);
        doc.text(safe(value), rightX, y, { width: 220 });
        y += rowGap;
      }

      twoCol("Policy Number:", policyNumber);
      twoCol("Policy Issue Date:", policyIssueDate);
      twoCol("Insurer:", insurerName);
      twoCol("Insurer Address:", insurerAddress);
      twoCol("Policyholder:", policyholderName);
      twoCol("Address:", policyholderAddress);
      twoCol("Date of Birth:", policyholderDob);

      y += 18;
      addSectionTitle("Policy Details", y);
      y += 28;

      doc.font("Helvetica").fontSize(11.5).text("Policy Type: Motor Insurance", leftX, y);
      y += 24;
      doc.text(`Coverage Start Date: ${coverageStartDate}`, leftX, y);
      y += 24;
      doc.text(`Coverage End Date: ${coverageEndDate}`, leftX, y);
      y += 28;

      doc.text("Coverage Description:", leftX, y);
      y += 20;
      doc.text(coverageDescription, leftX, y, {
        width: 450,
        lineGap: 2,
        height: 60,
        ellipsis: true,
      });
      y += 54;

      doc.text(`Coverage Limit: ${coverageLimit}`, leftX, y);
      y += 24;
      doc.text(`Deductible: ${deductible}`, leftX, y);
      y += 24;
      doc.text(`Annual Premium: ${annualPremium}`, leftX, y);
      y += 24;
      doc.text(`Payment Frequency: ${paymentFrequency}`, leftX, y);

      y += 42;
      addSectionTitle("Identity Verification", y);
      y += 28;
      doc.font("Helvetica").fontSize(11.5).text("Verification Provider: Sumsub", leftX, y);
      y += 24;
      doc.text(`Verification ID: ${verificationId}`, leftX, y);
      y += 24;
      doc.text(`Verification Status: ${verificationStatus}`, leftX, y);
      y += 24;
      doc.text(`Verification Date: ${verificationDate}`, leftX, y);

      y += 42;
      addSectionTitle("Risk Classification", y);
      y += 28;
      doc.font("Helvetica").fontSize(11.5).text(`Risk Tier Assigned: ${riskTier}`, leftX, y);
      y += 24;
      doc.text(`Monitoring Frequency: ${monitoringFrequency}`, leftX, y);

      doc.addPage();
      pageBg();

      y = 80;
      addSectionTitle("Policyholder Responsibilities", y);
      y += 34;
      doc.font("Helvetica").fontSize(11.5).text(
        "The policyholder agrees to provide accurate and truthful information during the application process and notify the insurer of any material changes affecting the risk profile.",
        56,
        y,
        { width: 470, lineGap: 4 }
      );

      y += 100;
      addSectionTitle("Claims", y);
      y += 34;
      doc.text("Claims must be reported within 30 days of the incident.", 56, y, {
        width: 470,
        lineGap: 4,
      });
      y += 28;
      doc.text(
        "Claims may be subject to investigation if anomalies or fraud indicators are detected.",
        56,
        y,
        { width: 470, lineGap: 4 }
      );

      y += 100;
      addSectionTitle("Agreement", y);
      y += 34;
      doc.text(`Insurer Representative: ${representative}`, 56, y);
      y += 34;
      doc.text(`Policyholder: ${policyholderName}`, 56, y);
      y += 34;
      doc.text(`Date: ${agreementDate}`, 56, y);

      const pageCount = doc.bufferedPageRange().count;
      if (pageCount > 3) {
        return reject(new Error(`Generated PDF exceeded 3 pages (${pageCount})`));
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateContractPDF };