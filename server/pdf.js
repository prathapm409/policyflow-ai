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

function generateContractPDF({ customer = {}, contract = {}, application = {} }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 40,
        size: "A4",
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const insurerName = contract?.insurer || "Northern Shield Insurance Ltd";
      const insurerAddress = contract?.insurer_address || "42 Bishopsgate, London, UK";

      const policyNumber = contract?.policy_number || "POL-UK-2026-000384";
      const policyIssueDate = formatDate(contract?.created_at || new Date());

      const policyholderName =
        customer?.full_name || application?.full_name || "James Carter";
      const policyholderAddress =
        contract?.policyholder_address ||
        application?.address ||
        "14 Kingsway Avenue, Manchester, UK";
      const policyholderDob = contract?.dob || application?.date_of_birth || "21 July 1985";

      const coverageStartDate =
        formatDate(contract?.coverage_start) || "15 March 2026";
      const coverageEndDate =
        formatDate(contract?.coverage_end) || "14 March 2027";
      const coverageDescription =
        contract?.coverage_description ||
        "Comprehensive coverage for private motor vehicle including accidental damage, theft, and third-party liability.";

      const coverageLimit = contract?.coverage_limit || "£50,000";
      const deductible = contract?.deductible || "£500";
      const annualPremium = contract?.premium || "£820";
      const paymentFrequency = contract?.payment_frequency || "Monthly";

      const verificationId =
        contract?.sumsub_verification_id ||
        customer?.external_id ||
        application?.external_applicant_id ||
        "SUM-93840294";
      const verificationStatus =
        contract?.sumsub_status || application?.kyc_status || "Approved";
      const verificationDate = formatDate(
        contract?.sumsub_verified_at || application?.updated_at || contract?.created_at || new Date()
      );

      const riskTier =
        customer?.risk_tier || application?.risk_tier || contract?.risk_tier || "Medium";
      const monitoringFrequency =
        contract?.monitoring_frequency || application?.monitoring_frequency || "Quarterly";

      const representative = "Sarah Bennett – Senior Underwriter";
      const agreementDate = formatDate(contract?.created_at || new Date());

      function drawPageBackground() {
        doc.rect(0, 0, doc.page.width, doc.page.height).fill("#e9e9e9");
        doc.fillColor("black");
        doc.rect(28, 28, doc.page.width - 56, doc.page.height - 56).fill("#f7f7f7");
        doc.fillColor("black");
      }

      drawPageBackground();

      let y = 80;
      doc.font("Helvetica-Bold").fontSize(22).text("Insurance Policy Agreement", 0, y, {
        align: "center",
      });

      y += 70;
      const leftX = 70;
      const rightX = 330;
      const labelGap = 36;

      function twoCol(label, value) {
        doc.font("Helvetica").fontSize(12).text(label, leftX, y);
        doc.text(String(value ?? "-"), rightX, y);
        y += labelGap;
      }

      twoCol("Policy Number:", policyNumber);
      twoCol("Policy Issue Date:", policyIssueDate);
      twoCol("Insurer:", insurerName);
      twoCol("Insurer Address:", insurerAddress);
      twoCol("Policyholder:", policyholderName);
      twoCol("Address:", policyholderAddress);
      twoCol("Date of Birth:", policyholderDob);

      y += 40;
      doc.font("Helvetica-Bold").fontSize(17).text("Policy Details", leftX, y);
      y += 34;

      doc.font("Helvetica").fontSize(12).text("Policy Type: Motor Insurance", leftX, y);
      y += 28;
      doc.text(`Coverage Start Date: ${coverageStartDate}`, leftX, y);
      y += 28;
      doc.text(`Coverage End Date: ${coverageEndDate}`, leftX, y);
      y += 38;

      doc.text("Coverage Description:", leftX, y);
      y += 24;
      doc.text(coverageDescription, leftX, y, {
        width: 450,
        lineGap: 3,
      });
      y += 64;

      doc.text(`Coverage Limit: ${coverageLimit}`, leftX, y);
      y += 28;
      doc.text(`Deductible: ${deductible}`, leftX, y);
      y += 28;
      doc.text(`Annual Premium: ${annualPremium}`, leftX, y);
      y += 28;
      doc.text(`Payment Frequency: ${paymentFrequency}`, leftX, y);
      y += 58;

      doc.font("Helvetica-Bold").fontSize(17).text("Identity Verification", leftX, y);
      y += 34;
      doc.font("Helvetica").fontSize(12).text(`Verification Provider: Sumsub`, leftX, y);
      y += 28;
      doc.text(`Verification ID: ${verificationId}`, leftX, y);
      y += 28;
      doc.text(`Verification Status: ${verificationStatus}`, leftX, y);
      y += 28;
      doc.text(`Verification Date: ${verificationDate}`, leftX, y);
      y += 58;

      doc.font("Helvetica-Bold").fontSize(17).text("Risk Classification", leftX, y);
      y += 34;
      doc.font("Helvetica").fontSize(12).text(`Risk Tier Assigned: ${riskTier}`, leftX, y);
      y += 28;
      doc.text(`Monitoring Frequency: ${monitoringFrequency}`, leftX, y);

      doc.addPage();
      drawPageBackground();

      y = 110;
      doc.font("Helvetica-Bold").fontSize(17).text("Policyholder Responsibilities", 70, y);
      y += 40;
      doc.font("Helvetica").fontSize(12).text(
        "The policyholder agrees to provide accurate and truthful information during the application process and notify the insurer of any material changes affecting the risk profile.",
        70,
        y,
        { width: 450, lineGap: 6 }
      );

      y += 120;
      doc.font("Helvetica-Bold").fontSize(17).text("Claims", 70, y);
      y += 40;
      doc.font("Helvetica").fontSize(12).text(
        "Claims must be reported within 30 days of the incident.",
        70,
        y,
        { width: 450, lineGap: 6 }
      );
      y += 34;
      doc.text(
        "Claims may be subject to investigation if anomalies or fraud indicators are detected.",
        70,
        y,
        { width: 450, lineGap: 6 }
      );

      y += 120;
      doc.font("Helvetica-Bold").fontSize(17).text("Agreement", 70, y);
      y += 40;
      doc.font("Helvetica").fontSize(12).text(`Insurer Representative: ${representative}`, 70, y);
      y += 44;
      doc.text(`Policyholder: ${policyholderName}`, 70, y);
      y += 44;
      doc.text(`Date: ${agreementDate}`, 70, y);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { generateContractPDF };