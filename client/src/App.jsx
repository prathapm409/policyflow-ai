import React, { useEffect, useMemo, useState } from "react";
import {
  getSummary,
  listApplications,
  listContracts,
  listCustomers,
  listComplianceReviews,
  listVerifiedResults,
  contractPdfUrl,
  createApplication,
  startKyc,
  sendSumsubWebhook,
  overrideRiskTier,
  listMonitoring,
  actOnMonitoring,
  actOnComplianceReview,
  regenerateContract,
  getCustomer,
} from "./api";

const STATUS_COLORS = {
  APPROVED: "#16a34a",
  REJECTED: "#dc2626",
  PENDING: "#eab308",
  REVIEW: "#7c3aed",
  IN_PROGRESS: "#2563eb",
  PENDING_KYC: "#64748b",
  NOT_REQUIRED: "#475569",
  GENERATED: "#16a34a",
  MONITORING_ONLY: "#0ea5e9",
  ON_HOLD: "#f59e0b",
};

const TIER_COLORS = {
  LOW: "#16a34a",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
  CRITICAL: "#7f1d1d",
};

const SIGNAL_OPTIONS = [
  { key: "pepMatch", label: "PEP match" },
  { key: "sanctionsMatch", label: "Sanctions match" },
  { key: "adverseMedia", label: "Adverse media" },
  { key: "documentFraudDetected", label: "Document tampering" },
  { key: "faceMismatch", label: "Face mismatch" },
  { key: "deviceOrIpMismatch", label: "Device/IP mismatch" },
  { key: "highRiskCountry", label: "Country risk" },
  { key: "manualReviewRequired", label: "Manual review required" },
];

function prettyStatus(value) {
  return String(value || "").replaceAll("_", " ");
}

function calcRisk(signals) {
  let score = 0;
  if (signals.pepMatch) score += 50;
  if (signals.sanctionsMatch) score += 100;
  if (signals.adverseMedia) score += 40;
  if (signals.documentFraudDetected) score += 60;
  if (signals.faceMismatch) score += 40;
  if (signals.highRiskCountry) score += 30;
  if (signals.deviceOrIpMismatch) score += 20;
  if (signals.manualReviewRequired) score += 20;

  let tier = "LOW";
  let action = "Auto approve";
  if (score >= 80) { tier = "CRITICAL"; action = "Reject / escalate"; }
  else if (score >= 51) { tier = "HIGH"; action = "Manual review"; }
  else if (score >= 21) { tier = "MEDIUM"; action = "Standard monitoring"; }

  return { score, tier, action };
}

function getProcessSteps(riskTier) {
  const tier = String(riskTier || "").toUpperCase();

  if (tier === "LOW") {
    return [
      "Create customer",
      "Generate contract",
      "Go to customer page",
      "Contracts screen",
    ];
  }

  if (tier === "MEDIUM") {
    return [
      "Create customer",
      "Send to compliance review",
      "Go to compliance review to-do page",
    ];
  }

  if (tier === "HIGH" || tier === "CRITICAL") {
    return [
      "Send to compliance review",
      "Go to compliance review to-do page",
    ];
  }

  return ["Verification completed"];
}

function Badge({ children, bg = "#1e293b", color = "#fff" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "6px 10px", borderRadius: 999, background: bg, color, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Section({ title, subtitle, children, right }) {
  return (
    <section style={{ background: "#122041", borderRadius: 18, padding: 20, marginBottom: 20, boxShadow: "0 10px 24px rgba(0,0,0,0.18)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28 }}>{title}</h2>
          {subtitle ? <div style={{ opacity: 0.8, marginTop: 6 }}>{subtitle}</div> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, subtitle }) {
  return (
    <div style={{ padding: 24, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", textAlign: "center", color: "#cbd5e1" }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ opacity: 0.85 }}>{subtitle}</div>
    </div>
  );
}

function ProcessFlowCard({ result }) {
  if (!result?.riskTier) return null;
  const steps = getProcessSteps(result.riskTier);

  return (
    <Section
      title="Process Result"
      subtitle={`Exact process shown for ${result.riskTier} risk tier.`}
      right={<Badge bg={TIER_COLORS[result.riskTier] || "#334155"}>{result.riskTier}</Badge>}
    >
      <div style={{ display: "grid", gap: 12 }}>
        {steps.map((step, index) => (
          <div
            key={step}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: 14,
              borderRadius: 14,
              background: "#0f1b39",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#7c5cff",
              fontWeight: 900
            }}>
              {index + 1}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{step}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function KycModal({ open, onClose, title }) {
  if (!open) return null;
  return (
    <div style={modalBackdrop}>
      <div style={modalCard}>
        <div style={modalHeader}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{title}</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>
              Complete document verification and selfie/liveness in this window.
            </div>
          </div>
          <button style={closeBtn} onClick={onClose}>✕</button>
        </div>
        <div id="sumsub-websdk-container" style={{ minHeight: "78vh", borderRadius: 12, overflow: "hidden", background: "#fff" }} />
      </div>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState({ counts: {}, customers: [], audits: [], contracts: [] });
  const [applications, setApplications] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [verifiedResults, setVerifiedResults] = useState([]);
  const [monitoring, setMonitoring] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [processResult, setProcessResult] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [tab, setTab] = useState("workflow");

  const [form, setForm] = useState({ fullName: "", email: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [signals, setSignals] = useState({
    pepMatch: false,
    sanctionsMatch: false,
    adverseMedia: false,
    documentFraudDetected: false,
    faceMismatch: false,
    deviceOrIpMismatch: false,
    highRiskCountry: false,
    manualReviewRequired: false,
  });
  const [simStatus, setSimStatus] = useState("APPROVED");

  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [kycTitle, setKycTitle] = useState("Sumsub Verification");

  async function loadAll() {
    setLoading(true);
    try {
      const [summaryRes, appsRes, contractsRes, customersRes, reviewsRes, verifiedRes, monitoringRes] =
        await Promise.all([
          getSummary(),
          listApplications(),
          listContracts(),
          listCustomers(),
          listComplianceReviews(),
          listVerifiedResults(),
          listMonitoring(),
        ]);

      setSummary({
        counts: summaryRes?.counts || {},
        customers: summaryRes?.customers || [],
        audits: summaryRes?.audits || [],
        contracts: summaryRes?.contracts || [],
      });
      setApplications(appsRes?.applications || []);
      setContracts(contractsRes?.contracts || []);
      setCustomers(customersRes?.customers || []);
      setReviews(reviewsRes?.reviews || []);
      setVerifiedResults(verifiedRes?.results || []);
      setMonitoring(monitoringRes?.monitoring || []);
    } catch (e) {
      console.error(e);
      setError("Failed to load application data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!selectedId && applications.length) setSelectedId(applications[0].id);
  }, [applications, selectedId]);

  const selectedApplication = useMemo(
    () => applications.find((a) => a.id === selectedId) || null,
    [applications, selectedId]
  );

  const riskPreview = useMemo(() => calcRisk(signals), [signals]);

  async function openLatestCustomerDetail(customerIdFromResponse = null) {
    const customersRes = await listCustomers();
    const targetCustomer = customerIdFromResponse
      ? { id: customerIdFromResponse }
      : customersRes?.customers?.[0];

    if (!targetCustomer?.id) {
      setTab("customers");
      return false;
    }

    const customerRes = await getCustomer(targetCustomer.id);
    if (customerRes?.ok) {
      setSelectedCustomer(customerRes);
      setTab("customer-detail");
      return true;
    }
    setTab("customers");
    return false;
  }

  async function onCreateApplication(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await createApplication(form);
      if (!res?.ok) return setError(res?.error || "Failed to create application");
      setInfo("Application created successfully.");
      setForm({ fullName: "", email: "" });
      await loadAll();
      setTab("applications");
    } catch {
      setError("Create application failed");
    } finally {
      setBusy(false);
    }
  }

  async function onStartKyc(app) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await startKyc(app.id);
      if (!res?.ok) return setError(res?.error || "Failed to start Sumsub");
      if (!res?.sumsubToken) return setError("Sumsub token was not returned by backend.");
      if (!window?.snsWebSdk) return setError("Sumsub WebSDK script not loaded.");

      setKycTitle(`Sumsub Verification — ${app.full_name}`);
      setKycModalOpen(true);

      setTimeout(() => {
        try {
          window
            .snsWebSdk
            .init(res.sumsubToken, () => Promise.resolve(res.sumsubToken))
            .withConf({ lang: "en" })
            .withOptions({ addViewportTag: false, adaptIframeHeight: true })
            .on("idCheck.onApplicantStatusChanged", async () => {
              await loadAll();
            })
            .build()
            .launch("#sumsub-websdk-container");
          setInfo("Sumsub verification opened.");
        } catch {
          setError("Sumsub popup failed to open.");
          setKycModalOpen(false);
        }
      }, 100);
    } catch {
      setError("Start Sumsub failed");
    } finally {
      setBusy(false);
    }
  }

  async function onOverrideTier(applicationId, riskTier) {
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await overrideRiskTier(applicationId, riskTier);
      if (!res?.ok) return setError(res?.error || "Failed to override risk tier");
      setInfo(`Risk tier updated to ${riskTier}.`);
      await loadAll();
    } catch {
      setError("Risk tier override failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSimulateVerification() {
    if (!selectedApplication?.external_applicant_id) {
      return setError("Start KYC first so an applicant ID exists.");
    }

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const res = await sendSumsubWebhook({
        applicantId: selectedApplication.external_applicant_id,
        status: simStatus.toLowerCase(),
        ...signals,
      });

      const fallbackTier = calcRisk(signals).tier;
      const finalTier = String(res?.riskTier || fallbackTier || "").toUpperCase();

      setProcessResult({
        riskTier: finalTier,
        customerId: res?.customer?.id || null,
      });

      await loadAll();

      if (finalTier === "LOW") {
        setInfo("LOW flow: opening customer page...");
        const opened = await openLatestCustomerDetail(res?.customer?.id || null);
        if (opened) {
          setTimeout(() => {
            setInfo("LOW flow: opening contracts screen...");
            setTab("contracts");
          }, 1500);
        }
      } else if (finalTier === "MEDIUM") {
        setInfo("MEDIUM flow: opening compliance review to-do page...");
        setTab("reviews");
      } else if (finalTier === "HIGH" || finalTier === "CRITICAL") {
        setInfo(`${finalTier} flow: opening compliance review to-do page...`);
        setTab("reviews");
      } else {
        setTab("workflow");
      }
    } catch {
      const fallbackTier = calcRisk(signals).tier;
      setProcessResult({ riskTier: fallbackTier, customerId: null });

      if (fallbackTier === "LOW") {
        setInfo("LOW process preview shown.");
      } else if (fallbackTier === "MEDIUM") {
        setInfo("MEDIUM process preview shown.");
      } else {
        setInfo(`${fallbackTier} process preview shown.`);
      }

      setTab("workflow");
    } finally {
      setBusy(false);
    }
  }

  async function onReviewAction(id, action) {
    setBusy(true);
    setError("");
    setInfo("");
    const res = await actOnComplianceReview(id, action);
    if (!res?.ok) setError(res?.error || "Failed compliance action");
    else {
      setInfo(`Compliance review ${action.toLowerCase()} completed.`);
      await loadAll();
      setTab("reviews");
    }
    setBusy(false);
  }

  async function onMonitoringAction(id, action) {
    setBusy(true);
    setError("");
    setInfo("");
    const res = await actOnMonitoring(id, action);
    if (!res?.ok) setError(res?.error || "Failed monitoring action");
    else {
      setInfo(`Monitoring ${action.toLowerCase()} completed.`);
      await loadAll();
      setTab("monitoring");
    }
    setBusy(false);
  }

  async function onRegenerateContract(id) {
    setBusy(true);
    setError("");
    setInfo("");
    const res = await regenerateContract(id);
    if (!res?.ok) setError(res?.error || "Failed to regenerate contract");
    else {
      setInfo("Contract regenerated.");
      await loadAll();
      setTab("contracts");
    }
    setBusy(false);
  }

  async function onOpenCustomer(id) {
    setBusy(true);
    setError("");
    setInfo("");
    const res = await getCustomer(id);
    if (!res?.ok) setError(res?.error || "Failed to load customer");
    else {
      setSelectedCustomer(res);
      setTab("customer-detail");
    }
    setBusy(false);
  }

  function toggleSignal(key) {
    setSignals((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const latestContract = contracts[0] || null;

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #031133 0%, #081634 30%, #0d1730 100%)", color: "#fff", fontFamily: "Inter, Arial, sans-serif", padding: 18 }}>
      <h1 style={{ margin: "8px 0 18px", fontSize: 38, fontWeight: 900 }}>PolicyFlow AI Dashboard</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          ["workflow", "WORKFLOW"],
          ["dashboard", "DASHBOARD"],
          ["applications", "APPLICATIONS"],
          ["verified", "VERIFIED RESULTS"],
          ["reviews", "COMPLIANCE REVIEW"],
          ["monitoring", "MONITORING"],
          ["customers", "CUSTOMERS"],
          ["contracts", "CONTRACTS"],
          ["audits", "AUDITS"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{ border: "none", borderRadius: 12, background: tab === key || (key === "customers" && tab === "customer-detail") ? "#7c5cff" : "#192857", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div style={{ background: "#521323", color: "#fecdd3", padding: 14, borderRadius: 12, marginBottom: 14 }}>{error}</div> : null}
      {info ? <div style={{ background: "#123f2b", color: "#bbf7d0", padding: 14, borderRadius: 12, marginBottom: 14 }}>{info}</div> : null}
      {loading ? <div>Loading...</div> : null}

      {!loading && tab === "workflow" && (
        <>
          <Section title="KYC Workflow" subtitle="Create an application, launch Sumsub, review risk signals, and simulate verification outcomes.">
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
              <div style={panelStyle}>
                <h3 style={h3Style}>Create application</h3>
                <form onSubmit={onCreateApplication} style={{ display: "grid", gap: 12 }}>
                  <input placeholder="Full name" value={form.fullName} onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))} style={inputStyle} />
                  <input placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} style={inputStyle} />
                  <button type="submit" style={primaryBtn} disabled={busy}>Create Application</button>
                </form>
              </div>

              <div style={panelStyle}>
                <h3 style={h3Style}>Risk signals and verification</h3>

                <select value={selectedId || ""} onChange={(e) => setSelectedId(Number(e.target.value))} style={inputStyle}>
                  <option value="">Select application</option>
                  {applications.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.full_name} — {app.email}
                    </option>
                  ))}
                </select>

                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Select risk labels / flags</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {SIGNAL_OPTIONS.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => toggleSignal(s.key)}
                        style={{
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 999,
                          background: signals[s.key] ? "#a78bfa" : "#1e2c56",
                          color: "#fff",
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                      >
                        {signals[s.key] ? "✓ " : ""}{s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Verification status</div>
                  <select value={simStatus} onChange={(e) => setSimStatus(e.target.value)} style={inputStyle}>
                    <option value="APPROVED">approved</option>
                    <option value="REJECTED">rejected</option>
                    <option value="PENDING">pending</option>
                    <option value="REVIEW">review</option>
                  </select>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                  <Badge bg="#0f172a">Risk score: {riskPreview.score}</Badge>
                  <Badge bg={TIER_COLORS[riskPreview.tier]}>{riskPreview.tier}</Badge>
                  <Badge bg="#334155">{riskPreview.action}</Badge>
                </div>

                <button style={{ ...primaryBtn, marginTop: 16 }} disabled={busy || !selectedApplication} onClick={onSimulateVerification}>
                  Apply Verification Result
                </button>
              </div>
            </div>
          </Section>

          <ProcessFlowCard result={processResult} />
        </>
      )}

      {!loading && tab === "reviews" && (
        <Section title="Compliance Review To-Do Page" subtitle="Medium, high and critical review queue.">
          {!reviews.length ? <EmptyState title="No compliance review items" subtitle="Use medium/high/critical process in Workflow tab." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead><tr><th style={thtd}>Applicant ID</th><th style={thtd}>Risk Tier</th><th style={thtd}>Status</th><th style={thtd}>Reason</th><th style={thtd}>Actions</th></tr></thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td style={thtd}>{r.applicant_id}</td>
                      <td style={thtd}>{r.risk_tier}</td>
                      <td style={thtd}>{r.status}</td>
                      <td style={thtd}>{r.reason}</td>
                      <td style={thtd}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button style={smallBtn} onClick={() => onReviewAction(r.id, "START")}>Start</button>
                          <button style={smallBtn} onClick={() => onReviewAction(r.id, "APPROVE")}>Approve</button>
                          <button style={smallBtn} onClick={() => onReviewAction(r.id, "DONE")}>Done</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {!loading && tab === "customer-detail" && (
        <Section title="Customer Detail Page" subtitle="Latest customer on top by default." right={<button style={smallBtn} onClick={() => setTab("contracts")}>Go To Contracts Screen</button>}>
          {!selectedCustomer?.customer ? <EmptyState title="No customer selected" subtitle="Open from Customers tab." /> : (
            <>
              <div style={{ ...panelStyle, marginBottom: 16 }}>
                <h3 style={h3Style}>{selectedCustomer.customer.full_name}</h3>
                <div>{selectedCustomer.customer.email}</div>
                <div style={{ marginTop: 10 }}>
                  <Badge bg={TIER_COLORS[String(selectedCustomer.customer.risk_tier || "").toUpperCase()] || "#334155"}>
                    {prettyStatus(selectedCustomer.customer.risk_tier)}
                  </Badge>
                </div>
              </div>

              <Section title="Customer Contracts" subtitle="Generated contract list for this customer.">
                {!selectedCustomer.contracts?.length ? <EmptyState title="No contracts" subtitle="No contracts available for this customer." /> : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={tableStyle}>
                      <thead><tr><th style={thtd}>Policy Number</th><th style={thtd}>Status</th><th style={thtd}>PDF</th></tr></thead>
                      <tbody>
                        {selectedCustomer.contracts.map((c) => (
                          <tr key={c.id}>
                            <td style={thtd}>{c.policy_number}</td>
                            <td style={thtd}>{c.status}</td>
                            <td style={thtd}><a href={contractPdfUrl(c.id)} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontWeight: 700 }}>Open PDF</a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
        </Section>
      )}

      {!loading && tab === "contracts" && (
        <Section title="Contracts Screen" subtitle="Generated contracts list." right={latestContract ? <Badge bg="#dbeafe" color="#1e3a8a">{latestContract.policy_number}</Badge> : null}>
          {!contracts.length ? <EmptyState title="No contracts yet" subtitle="Low-risk path creates contracts." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead><tr><th style={thtd}>Policy Number</th><th style={thtd}>Customer</th><th style={thtd}>PDF</th><th style={thtd}>Action</th></tr></thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id}>
                      <td style={thtd}>{c.policy_number}</td>
                      <td style={thtd}>{c.full_name}</td>
                      <td style={thtd}><a href={contractPdfUrl(c.id)} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontWeight: 700 }}>Open PDF</a></td>
                      <td style={thtd}><button style={smallBtn} onClick={() => onRegenerateContract(c.id)}>Regenerate</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {!loading && tab === "applications" && (
        <Section title="Applications" subtitle="Manage application status, start KYC, and override risk tier manually.">
          {!applications.length ? <EmptyState title="No applications found" subtitle="Create from Workflow tab." /> : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead><tr><th style={thtd}>Name</th><th style={thtd}>Email</th><th style={thtd}>KYC</th><th style={thtd}>Risk Tier</th><th style={thtd}>Decision</th><th style={thtd}>Compliance</th><th style={thtd}>Policy</th><th style={thtd}>Override Tier</th><th style={thtd}>Actions</th></tr></thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td style={thtd}>{a.full_name}</td>
                      <td style={thtd}>{a.email}</td>
                      <td style={thtd}><Badge bg={STATUS_COLORS[a.kyc_status] || "#475569"}>{prettyStatus(a.kyc_status)}</Badge></td>
                      <td style={thtd}><Badge bg={TIER_COLORS[a.risk_tier] || "#334155"}>{prettyStatus(a.risk_tier)}</Badge></td>
                      <td style={thtd}>{prettyStatus(a.decision_status)}</td>
                      <td style={thtd}>{prettyStatus(a.compliance_status)}</td>
                      <td style={thtd}>{prettyStatus(a.policy_status)}</td>
                      <td style={thtd}>
                        <select defaultValue="" style={{ ...inputStyle, minWidth: 130 }} onChange={(e) => e.target.value && onOverrideTier(a.id, e.target.value)}>
                          <option value="">Select</option>
                          <option value="LOW">LOW</option>
                          <option value="MEDIUM">MEDIUM</option>
                          <option value="HIGH">HIGH</option>
                          <option value="CRITICAL">CRITICAL</option>
                        </select>
                      </td>
                      <td style={thtd}><button style={secondaryBtn} onClick={() => onStartKyc(a)} disabled={busy}>Start Sumsub</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {!loading && tab === "verified" && <Section title="Verified Results" subtitle="Verification results list."><EmptyState title="Optional for demo" subtitle="Main demo is the one-by-one flow transition." /></Section>}
      {!loading && tab === "monitoring" && <Section title="Monitoring" subtitle="Monitoring queue."><EmptyState title="Optional for demo" subtitle="Main demo is the one-by-one flow transition." /></Section>}
      {!loading && tab === "customers" && <Section title="Customers" subtitle="Created customers."><EmptyState title="Use Customer Detail Page" subtitle="Customer page is opened automatically in LOW flow." /></Section>}
      {!loading && tab === "dashboard" && <Section title="Dashboard" subtitle="Summary."><div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><MetricCard label="Applications" value={summary.counts.applications || 0} /><MetricCard label="Customers" value={summary.counts.customers || 0} /><MetricCard label="Contracts" value={summary.counts.contracts || 0} /></div></Section>}
      {!loading && tab === "audits" && <Section title="Audit Logs" subtitle="Traceability."><EmptyState title="Available" subtitle="Not required for this demo flow." /></Section>}

      <KycModal open={kycModalOpen} onClose={() => setKycModalOpen(false)} title={kycTitle} />
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div style={{ background: "#122041", borderRadius: 16, padding: 18, minWidth: 180 }}>
      <div style={{ opacity: 0.8, marginBottom: 10, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

const panelStyle = { background: "#0f1b39", borderRadius: 16, padding: 18 };
const h3Style = { marginTop: 0, marginBottom: 12 };
const inputStyle = { width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "#0b1631", color: "#fff", outline: "none" };
const primaryBtn = { border: "none", borderRadius: 12, background: "#7c5cff", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: "pointer" };
const secondaryBtn = { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "#192857", color: "#fff", padding: "10px 12px", fontWeight: 700, cursor: "pointer" };
const smallBtn = { border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, background: "#243a72", color: "#fff", padding: "8px 10px", fontWeight: 700, cursor: "pointer" };
const tableStyle = { width: "100%", borderCollapse: "collapse", color: "#fff", background: "#24355f", borderRadius: 14, overflow: "hidden" };
const thtd = { padding: "14px 12px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" };
const modalBackdrop = { position: "fixed", inset: 0, background: "rgba(2, 8, 23, 0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 9999 };
const modalCard = { width: "min(1100px, 96vw)", height: "min(900px, 92vh)", background: "#0f172a", borderRadius: 18, boxShadow: "0 30px 100px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column", overflow: "hidden" };
const modalHeader = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#111c39", color: "#fff" };
const closeBtn = { border: "none", background: "#22325d", color: "#fff", width: 40, height: 40, borderRadius: 10, cursor: "pointer", fontSize: 18, fontWeight: 800 };