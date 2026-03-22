import React, { useEffect, useMemo, useState } from "react";
import {
  getSummary,
  listApplications,
  listCustomers,
  listMonitoring,
  createApplication,
  startKyc,
  sendSumsubWebhook,
  overrideRiskTier,
  getCustomer,
} from "./api";
import VerifiedKycList from "./pages/VerifiedKycList";
import ComplianceQueue from "./pages/ComplianceQueue";
import ContractList from "./pages/ContractList";

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
  ACTIVE: "#16a34a",
  COMPLETED: "#2563eb",
  SNOOZED: "#f59e0b",
  IN_REVIEW: "#7c3aed",
  NOT_STARTED: "#475569",
  ESCALATED: "#dc2626",
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
  { key: "deviceRisk", label: "Device risk" },
  { key: "ipMismatch", label: "IP mismatch" },
  { key: "highRiskCountry", label: "Country risk" },
  { key: "manualReviewRequired", label: "Manual review required" },
];

function prettyStatus(value) {
  return String(value || "").replaceAll("_", " ");
}

function calcRisk(signals) {
  let score = 0;
  const reasons = [];

  if (signals.pepMatch) {
    score += 50;
    reasons.push("PEP");
  }
  if (signals.sanctionsMatch) {
    score += 100;
    reasons.push("Sanctions");
  }
  if (signals.adverseMedia) {
    score += 40;
    reasons.push("Adverse media");
  }
  if (signals.documentFraudDetected) {
    score += 60;
    reasons.push("Document fraud");
  }
  if (signals.faceMismatch) {
    score += 40;
    reasons.push("Face mismatch");
  }
  if (signals.highRiskCountry) {
    score += 30;
    reasons.push("Country risk");
  }
  if (signals.deviceRisk) {
    score += 20;
    reasons.push("Device risk");
  }
  if (signals.ipMismatch) {
    score += 20;
    reasons.push("IP mismatch");
  }
  if (signals.manualReviewRequired) {
    score += 20;
    reasons.push("Manual review");
  }

  let tier = "LOW";
  if (score >= 81) tier = "CRITICAL";
  else if (score >= 51) tier = "HIGH";
  else if (score >= 21) tier = "MEDIUM";

  return { score, tier, reasons };
}

function Badge({ children, bg = "#1e293b", color = "#fff" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        background: bg,
        color,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Section({ title, subtitle, right, children }) {
  return (
    <section
      style={{
        background: "#122041",
        borderRadius: 18,
        padding: 20,
        marginBottom: 20,
        boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
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
    <div
      style={{
        padding: 24,
        borderRadius: 16,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        textAlign: "center",
        color: "#cbd5e1",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{title}</div>
      <div style={{ opacity: 0.85 }}>{subtitle}</div>
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

function ProcessFlowCard({ result }) {
  if (!result) return null;

  const stepsMap = {
    LOW: [
      "Successful KYC verified",
      "Auto risk score calculated",
      "Customer created",
      "Contract generated",
      "Monitoring created",
    ],
    MEDIUM: [
      "Successful KYC verified",
      "Auto risk score calculated",
      "Customer created",
      "Monitoring created",
      "Compliance review opened",
    ],
    HIGH: [
      "Verification result received",
      "High risk assigned",
      "Compliance review queue triggered",
      "Policy held",
    ],
    CRITICAL: [
      "Verification result received",
      "Critical risk assigned",
      "Escalated to compliance",
      "Policy blocked",
    ],
  };

  const steps = stepsMap[result.riskTier] || [];

  return (
    <Section
      title="Automated Process Result"
      subtitle={`POC path for ${result.riskTier} risk tier.`}
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
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#7c5cff",
                fontWeight: 900,
              }}
            >
              {index + 1}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{step}</div>
          </div>
        ))}
      </div>

      {result.reasons?.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Risk reasons</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {result.reasons.map((r) => (
              <Badge key={r} bg="#334155">
                {r}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
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
              Complete Sumsub verification in this window.
            </div>
          </div>
          <button style={closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>
        <div
          id="sumsub-websdk-container"
          style={{ minHeight: "78vh", borderRadius: 12, overflow: "hidden", background: "#fff" }}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState({ counts: {}, audits: [] });
  const [applications, setApplications] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [monitoring, setMonitoring] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [tab, setTab] = useState("workflow");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [form, setForm] = useState({ fullName: "", email: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [simStatus, setSimStatus] = useState("APPROVED");
  const [signals, setSignals] = useState({
    pepMatch: false,
    sanctionsMatch: false,
    adverseMedia: false,
    documentFraudDetected: false,
    faceMismatch: false,
    deviceRisk: false,
    ipMismatch: false,
    highRiskCountry: false,
    manualReviewRequired: false,
  });

  const [processResult, setProcessResult] = useState(null);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [kycTitle, setKycTitle] = useState("Sumsub Verification");

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, appsRes, customersRes, monitoringRes] = await Promise.all([
        getSummary(),
        listApplications(),
        listCustomers(),
        listMonitoring(),
      ]);

      if (!summaryRes?.ok) {
        setError(summaryRes?.error || "Failed to load summary");
      }

      setSummary({
        counts: summaryRes?.counts || {},
        audits: summaryRes?.audits || [],
      });
      setApplications(appsRes?.applications || []);
      setCustomers(customersRes?.customers || []);
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

  async function onCreateApplication(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const res = await createApplication(form);
      if (!res?.ok) {
        setError(res?.error || "Failed to create application");
        return;
      }
      setInfo("Application created successfully.");
      setForm({ fullName: "", email: "" });
      await loadAll();
      setTab("applications");
    } catch (e) {
      console.error(e);
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
      if (!res?.ok) {
        setError(res?.error || "Failed to start Sumsub");
        return;
      }
      if (!res?.sumsubToken) {
        setError("Sumsub token was not returned by backend.");
        return;
      }
      if (!window?.snsWebSdk) {
        setError("Sumsub WebSDK script not loaded.");
        return;
      }

      setKycTitle(`Sumsub Verification — ${app.full_name}`);
      setKycModalOpen(true);

      setTimeout(() => {
        try {
          window.snsWebSdk
            .init(res.sumsubToken, () => Promise.resolve(res.sumsubToken))
            .withConf({ lang: "en" })
            .withOptions({ addViewportTag: false, adaptIframeHeight: true })
            .build()
            .launch("#sumsub-websdk-container");
        } catch (err) {
          console.error(err);
          setError("Sumsub popup failed to open.");
          setKycModalOpen(false);
        }
      }, 100);
    } catch (e) {
      console.error(e);
      setError("Start Sumsub failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSimulateVerification() {
    if (!selectedApplication?.external_applicant_id) {
      setError("Start KYC first so an applicant ID exists.");
      return;
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

      if (!res?.ok) {
        setError(res?.error || "Failed to apply verification result");
        return;
      }

      setProcessResult({
        riskTier: String(res?.riskTier || riskPreview.tier || "").toUpperCase(),
        reasons: res?.reasons || riskPreview.reasons,
      });

      setInfo("Verification result processed.");
      await loadAll();
    } catch (e) {
      console.error(e);
      setError("Verification simulation failed");
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
      if (!res?.ok) {
        setError(res?.error || "Failed to override risk tier");
        return;
      }
      setInfo(`Risk tier updated to ${riskTier}.`);
      await loadAll();
    } catch (e) {
      console.error(e);
      setError("Risk tier override failed");
    } finally {
      setBusy(false);
    }
  }

  async function onOpenCustomer(id) {
    try {
      const res = await getCustomer(id);
      if (!res?.ok) {
        setError(res?.error || "Failed to load customer");
        return;
      }
      setSelectedCustomer(res);
      setTab("customers");
    } catch (e) {
      console.error(e);
      setError("Failed to load customer");
    }
  }

  function toggleSignal(key) {
    setSignals((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div style={{ minHeight: "100vh", padding: 18 }}>
      <h1 style={{ margin: "8px 0 18px", fontSize: 38, fontWeight: 900 }}>
        PolicyFlow AI Dashboard
      </h1>

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
            className={tab === key ? "" : "secondary"}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <div
          style={{
            background: "#521323",
            color: "#fecdd3",
            padding: 14,
            borderRadius: 12,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      ) : null}

      {info ? (
        <div
          style={{
            background: "#123f2b",
            color: "#bbf7d0",
            padding: 14,
            borderRadius: 12,
            marginBottom: 14,
          }}
        >
          {info}
        </div>
      ) : null}

      {loading ? <div>Loading...</div> : null}

      {!loading && tab === "workflow" && (
        <>
          <Section
            title="KYC Workflow"
            subtitle="KYC result comes from Sumsub, successful cases are filtered and viewed, risk is automatically scored with reasons, and cases are routed to contract generation or compliance review."
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div>
                <h3>Create application</h3>
                <form onSubmit={onCreateApplication} style={{ display: "grid", gap: 12 }}>
                  <input
                    placeholder="Full name"
                    value={form.fullName}
                    onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                  />
                  <input
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  />
                  <button type="submit" disabled={busy}>
                    Create Application
                  </button>
                </form>
              </div>

              <div>
                <h3>Verification and risk flow</h3>
                <select
                  value={selectedId || ""}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                  style={{ width: "100%", marginBottom: 12 }}
                >
                  <option value="">Select application</option>
                  {applications.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.full_name} — {app.email}
                    </option>
                  ))}
                </select>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {SIGNAL_OPTIONS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={!signals[s.key] ? "secondary" : ""}
                      onClick={() => toggleSignal(s.key)}
                    >
                      {signals[s.key] ? "✓ " : ""}
                      {s.label}
                    </button>
                  ))}
                </div>

                <select
                  value={simStatus}
                  onChange={(e) => setSimStatus(e.target.value)}
                  style={{ width: "100%", marginBottom: 12 }}
                >
                  <option value="APPROVED">approved</option>
                  <option value="REJECTED">rejected</option>
                  <option value="PENDING">pending</option>
                  <option value="REVIEW">review</option>
                </select>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  <Badge bg="#0f172a">Risk score: {riskPreview.score}</Badge>
                  <Badge bg={TIER_COLORS[riskPreview.tier]}>{riskPreview.tier}</Badge>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {riskPreview.reasons.map((r) => (
                    <Badge key={r} bg="#334155">
                      {r}
                    </Badge>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={busy || !selectedApplication}
                    onClick={() => selectedApplication && onStartKyc(selectedApplication)}
                  >
                    Start Sumsub
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selectedApplication}
                    onClick={onSimulateVerification}
                  >
                    Apply Verified Result
                  </button>
                </div>
              </div>
            </div>
          </Section>

          <ProcessFlowCard result={processResult} />
        </>
      )}

      {!loading && tab === "dashboard" && (
        <Section title="Dashboard" subtitle="Internal operations summary.">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <MetricCard label="Applications" value={summary.counts.applications || 0} />
            <MetricCard label="Customers" value={summary.counts.customers || 0} />
            <MetricCard label="Contracts" value={summary.counts.contracts || 0} />
            <MetricCard label="Audit Logs" value={summary.counts.audits || 0} />
            <MetricCard label="Open Reviews" value={summary.counts.open_reviews || 0} />
            <MetricCard label="Monitoring" value={summary.counts.monitoring || 0} />
          </div>
        </Section>
      )}

      {!loading && tab === "applications" && (
        <Section
          title="Applications"
          subtitle="Application list with verification status, risk, and routing status."
        >
          {!applications.length ? (
            <EmptyState title="No applications found" subtitle="Create one from Workflow." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>KYC</th>
                  <th>Risk Score</th>
                  <th>Risk Tier</th>
                  <th>Decision</th>
                  <th>Compliance</th>
                  <th>Policy</th>
                  <th>Monitoring</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td>{a.full_name}</td>
                    <td>{a.email}</td>
                    <td>
                      <Badge bg={STATUS_COLORS[a.kyc_status] || "#475569"}>
                        {prettyStatus(a.kyc_status)}
                      </Badge>
                    </td>
                    <td>{a.risk_score ?? 0}</td>
                    <td>
                      <Badge bg={TIER_COLORS[a.risk_tier] || "#334155"}>
                        {prettyStatus(a.risk_tier)}
                      </Badge>
                    </td>
                    <td>{prettyStatus(a.decision_status)}</td>
                    <td>{prettyStatus(a.compliance_status)}</td>
                    <td>{prettyStatus(a.policy_status)}</td>
                    <td>{a.monitoring_frequency || "-"}</td>
                    <td>
                      <select
                        defaultValue=""
                        onChange={(e) => e.target.value && onOverrideTier(a.id, e.target.value)}
                      >
                        <option value="">Select</option>
                        <option value="LOW">LOW</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="HIGH">HIGH</option>
                        <option value="CRITICAL">CRITICAL</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {!loading && tab === "verified" && (
        <Section
          title="Verified Results"
          subtitle="Verified results screen showing actual Sumsub outcome, successful KYC filter, risk score, and send-to-compliance action."
        >
          <VerifiedKycList />
        </Section>
      )}

      {!loading && tab === "reviews" && (
        <Section title="Compliance Review Queue" subtitle="High and critical risk review handling.">
          <ComplianceQueue />
        </Section>
      )}

      {!loading && tab === "contracts" && (
        <Section
          title="Contracts"
          subtitle="Generated contracts with regenerate/edit flow visible in the UI."
        >
          <ContractList />
        </Section>
      )}

      {!loading && tab === "monitoring" && (
        <Section title="Monitoring" subtitle="Monitoring records visible in the UI.">
          {!monitoring.length ? (
            <EmptyState title="No monitoring records" subtitle="They will appear after processing." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Email</th>
                  <th>Risk Tier</th>
                  <th>Frequency</th>
                  <th>Status</th>
                  <th>Next Review</th>
                </tr>
              </thead>
              <tbody>
                {monitoring.map((m) => (
                  <tr key={m.id}>
                    <td>{m.full_name}</td>
                    <td>{m.email}</td>
                    <td>{m.risk_tier}</td>
                    <td>{m.frequency}</td>
                    <td>{m.status}</td>
                    <td>{m.next_review_at ? new Date(m.next_review_at).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {!loading && tab === "customers" && (
        <Section title="Customers" subtitle="Customer records visible in the UI.">
          {!customers.length ? (
            <EmptyState title="No customers" subtitle="Customers will appear after approved flows." />
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Risk Tier</th>
                    <th>Risk Score</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.full_name}</td>
                      <td>{c.email}</td>
                      <td>{c.risk_tier}</td>
                      <td>{c.risk_score}</td>
                      <td>
                        <button onClick={() => onOpenCustomer(c.id)}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {selectedCustomer?.customer ? (
                <div style={{ marginTop: 20 }}>
                  <h3>{selectedCustomer.customer.full_name}</h3>
                  <p>{selectedCustomer.customer.email}</p>
                  <p>Risk Tier: {selectedCustomer.customer.risk_tier}</p>
                </div>
              ) : null}
            </>
          )}
        </Section>
      )}

      {!loading && tab === "audits" && (
        <Section title="Audit Logs" subtitle="Traceability of workflow actions.">
          {!summary.audits?.length ? (
            <EmptyState title="No audit logs" subtitle="Workflow events will appear here." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Event Type</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {summary.audits.map((a) => (
                  <tr key={a.id}>
                    <td>{a.event_type}</td>
                    <td>{new Date(a.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}

      <KycModal open={kycModalOpen} onClose={() => setKycModalOpen(false)} title={kycTitle} />
    </div>
  );
}

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 8, 23, 0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 9999,
};

const modalCard = {
  width: "min(1100px, 96vw)",
  height: "min(900px, 92vh)",
  background: "#0f172a",
  borderRadius: 18,
  boxShadow: "0 30px 100px rgba(0,0,0,0.45)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const modalHeader = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "18px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  background: "#111c39",
  color: "#fff",
};

const closeBtn = {
  border: "none",
  background: "#22325d",
  color: "#fff",
  width: 40,
  height: 40,
  borderRadius: 10,
  cursor: "pointer",
  fontSize: 18,
  fontWeight: 800,
};