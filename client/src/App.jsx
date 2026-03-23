import React, { useEffect, useMemo, useState } from "react";
import {
  getSummary,
  listApplications,
  listCustomers,
  listMonitoring,
  createApplication,
  startKyc,
  sendSumsubWebhook,
  getCustomer,
  listAudits,
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
  FAILED: "#dc2626",
  SUCCESSFUL: "#16a34a",
  SENT_TO_COMPLIANCE: "#ef4444",
  CONTRACT_GENERATED: "#16a34a",
  CUSTOMER_CREATED_MONITORING_SET: "#0ea5e9",
};

const TIER_COLORS = {
  LOW: "#16a34a",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
  CRITICAL: "#7f1d1d",
};

function prettyStatus(value) {
  return String(value || "").replaceAll("_", " ");
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

function KycModal({ open, onClose, title }) {
  if (!open) return null;
  return (
    <div style={modalBackdrop}>
      <div style={modalCard}>
        <div style={modalHeader}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{title}</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>
              Complete document verification and liveness in this window.
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

function VerificationPanel({ selectedApplication }) {
  if (!selectedApplication) {
    return (
      <EmptyState
        title="No application selected"
        subtitle="Select an application from Applications to see Sumsub verification result."
      />
    );
  }

  const matchedReasons = []
    .concat(selectedApplication.risk_signals || [])
    .concat(selectedApplication.reasons || []);

  return (
    <div style={{ background: "#0f1b39", borderRadius: 14, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Sumsub Verification Result</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={readonlyItem}>
          <strong>Application ID</strong>
          <span>{selectedApplication.id}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Customer</strong>
          <span>{selectedApplication.full_name}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Email</strong>
          <span>{selectedApplication.email}</span>
        </div>
        <div style={readonlyItem}>
          <strong>KYC Status</strong>
          <span>{prettyStatus(selectedApplication.kyc_status)}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Verification Outcome</strong>
          <span>{prettyStatus(selectedApplication.kyc_status)}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Decision</strong>
          <span>{prettyStatus(selectedApplication.decision_status)}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Final Risk Score</strong>
          <span>{selectedApplication.risk_score ?? 0}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Final Risk Tier</strong>
          <span>{prettyStatus(selectedApplication.risk_tier)}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Compliance Status</strong>
          <span>{prettyStatus(selectedApplication.compliance_status)}</span>
        </div>
        <div style={readonlyItem}>
          <strong>Policy Status</strong>
          <span>{prettyStatus(selectedApplication.policy_status)}</span>
        </div>
      </div>

      <div>
        <h4 style={{ marginTop: 0 }}>Matched Risk Signals / Reasons</h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {matchedReasons.length ? (
            matchedReasons.map((reason, idx) => (
              <Badge key={`${reason}-${idx}`} bg="#334155">
                {String(reason)}
              </Badge>
            ))
          ) : (
            <span>No material risk signals detected</span>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {["LOW", "MEDIUM"].includes(String(selectedApplication.risk_tier || "").toUpperCase()) && (
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Proceed to Contract Creation
          </button>
        )}
        {["HIGH", "CRITICAL"].includes(String(selectedApplication.risk_tier || "").toUpperCase()) && (
          <button className="danger" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Send to Compliance Review
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState({ counts: {}, audits: [] });
  const [applications, setApplications] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [monitoring, setMonitoring] = useState([]);
  const [audits, setAudits] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const [tab, setTab] = useState("applications");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [form, setForm] = useState({ fullName: "", email: "" });
  const [selectedId, setSelectedId] = useState(null);
  const [simStatus, setSimStatus] = useState("APPROVED");

  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [kycTitle, setKycTitle] = useState("Sumsub Verification");

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [summaryRes, appsRes, customersRes, monitoringRes, auditsRes] = await Promise.all([
        getSummary(),
        listApplications(),
        listCustomers(),
        listMonitoring(),
        listAudits(),
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
      setAudits(auditsRes?.audits || []);
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
      });

      if (!res?.ok) {
        setError(res?.error || "Failed to apply verification result");
        return;
      }

      setInfo("Verification result processed.");
      await loadAll();
      setTab("verification");
    } catch (e) {
      console.error(e);
      setError("Verification simulation failed");
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

  return (
    <div style={{ minHeight: "100vh", padding: 18 }}>
      <h1 style={{ margin: "8px 0 18px", fontSize: 38, fontWeight: 900 }}>
        PolicyFlow AI
      </h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          ["applications", "APPLICATIONS"],
          ["verification", "VERIFICATION RESULT"],
          ["compliance", "COMPLIANCE REVIEW"],
          ["contracts", "CONTRACTS"],
          ["monitoring", "MONITORING"],
          ["customers", "CUSTOMERS"],
          ["dashboard", "DASHBOARD"],
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

      {!loading && tab === "applications" && (
        <>
          <Section
            title="Applications"
            subtitle="Risk analyst should work from applications and move eligible cases to verification result."
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 20 }}>
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
                <h3>KYC actions</h3>
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

            {!applications.length ? (
              <EmptyState title="No applications found" subtitle="Create one above." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Application ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>KYC Status</th>
                    <th>Verification Outcome</th>
                    <th>Risk Score</th>
                    <th>Risk Tier</th>
                    <th>Status</th>
                    <th>Updated At</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id}>
                      <td>{a.id}</td>
                      <td>{a.full_name}</td>
                      <td>{a.email}</td>
                      <td>
                        <Badge bg={STATUS_COLORS[a.kyc_status] || "#475569"}>
                          {prettyStatus(a.kyc_status)}
                        </Badge>
                      </td>
                      <td>{prettyStatus(a.kyc_status)}</td>
                      <td>{a.risk_score ?? 0}</td>
                      <td>
                        <Badge bg={TIER_COLORS[a.risk_tier] || "#334155"}>
                          {prettyStatus(a.risk_tier)}
                        </Badge>
                      </td>
                      <td>{prettyStatus(a.policy_status || a.decision_status)}</td>
                      <td>{a.updated_at ? new Date(a.updated_at).toLocaleString() : "-"}</td>
                      <td>
                        <button
                          onClick={() => {
                            setSelectedId(a.id);
                            setTab("verification");
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}

      {!loading && tab === "verification" && (
        <Section
          title="Verification Result"
          subtitle="Show actual Sumsub result, risk score, risk tier, and correct next action."
        >
          <VerificationPanel selectedApplication={selectedApplication} />
          <div style={{ marginTop: 20 }}>
            <VerifiedKycList />
          </div>
        </Section>
      )}

      {!loading && tab === "compliance" && (
        <Section title="Compliance Review" subtitle="HIGH and CRITICAL risk cases.">
          <ComplianceQueue />
        </Section>
      )}

      {!loading && tab === "contracts" && (
        <Section title="Contracts" subtitle="LOW / MEDIUM risk cases proceed here.">
          <ContractList />
        </Section>
      )}

      {!loading && tab === "monitoring" && (
        <Section title="Monitoring" subtitle="Monitoring frequency and next review date.">
          {!monitoring.length ? (
            <EmptyState title="No monitoring records" subtitle="They will appear after approved flows." />
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
        <Section title="Customers" subtitle="Created customer records.">
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
                <div style={{ marginTop: 20, background: "#0f1b39", padding: 16, borderRadius: 14 }}>
                  <h3 style={{ marginTop: 0 }}>{selectedCustomer.customer.full_name}</h3>
                  <p>{selectedCustomer.customer.email}</p>
                  <p>Risk Tier: {selectedCustomer.customer.risk_tier}</p>
                </div>
              ) : null}
            </>
          )}
        </Section>
      )}

      {!loading && tab === "dashboard" && (
        <Section title="Dashboard" subtitle="POC summary metrics.">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <MetricCard label="Applications" value={summary.counts.applications || 0} />
            <MetricCard label="Customers" value={summary.counts.customers || 0} />
            <MetricCard label="Contracts" value={summary.counts.contracts || 0} />
            <MetricCard label="Open Reviews" value={summary.counts.open_reviews || 0} />
            <MetricCard label="Monitoring" value={summary.counts.monitoring || 0} />
          </div>
        </Section>
      )}

      {!loading && tab === "audits" && (
        <Section title="Audit Logs" subtitle="FCA-style audit trace for actions and decisions.">
          {!audits.length ? (
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
                {audits.map((a) => (
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

const readonlyItem = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

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