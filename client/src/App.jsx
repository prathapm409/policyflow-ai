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
} from "./api";

const STATUS_COLORS = {
  APPROVED: "#16a34a",
  REJECTED: "#dc2626",
  PENDING: "#eab308",
  REVIEW: "#7c3aed",
  IN_PROGRESS: "#2563eb",
  PENDING_KYC: "#64748b",
};

const TIER_COLORS = {
  LOW: "#16a34a",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
  CRITICAL: "#7f1d1d",
};

const SIGNAL_OPTIONS = [
  { key: "pepMatch", label: "PEP match", impact: 50 },
  { key: "sanctionsMatch", label: "Sanctions match", impact: 100 },
  { key: "adverseMedia", label: "Adverse media", impact: 40 },
  { key: "documentFraudDetected", label: "Document tampering", impact: 60 },
  { key: "faceMismatch", label: "Face mismatch", impact: 40 },
  { key: "deviceOrIpMismatch", label: "Device/IP mismatch", impact: 20 },
  { key: "highRiskCountry", label: "Country risk", impact: 30 },
  { key: "manualReviewRequired", label: "Manual review required", impact: 20 },
];

function prettyStatus(value) {
  return String(value || "").replaceAll("_", " ");
}

function calcRisk(signals) {
  let score = 0;
  const reasons = [];

  if (signals.pepMatch) {
    score += 50;
    reasons.push("PEP match detected (+50)");
  }
  if (signals.sanctionsMatch) {
    score += 100;
    reasons.push("Sanctions/watchlist match detected (+100)");
  }
  if (signals.adverseMedia) {
    score += 40;
    reasons.push("Adverse media detected (+40)");
  }
  if (signals.documentFraudDetected) {
    score += 60;
    reasons.push("Document fraud/tampering detected (+60)");
  }
  if (signals.faceMismatch) {
    score += 40;
    reasons.push("Face mismatch detected (+40)");
  }
  if (signals.highRiskCountry) {
    score += 30;
    reasons.push("High-risk country detected (+30)");
  }
  if (signals.deviceOrIpMismatch) {
    score += 20;
    reasons.push("Device/IP mismatch detected (+20)");
  }
  if (signals.manualReviewRequired) {
    score += 20;
    reasons.push("Manual review required (+20)");
  }

  let tier = "LOW";
  let action = "Auto approve";

  if (score >= 80) {
    tier = "CRITICAL";
    action = "Reject / escalate";
  } else if (score >= 51) {
    tier = "HIGH";
    action = "Manual review";
  } else if (score >= 21) {
    tier = "MEDIUM";
    action = "Standard monitoring";
  }

  if (!reasons.length) {
    reasons.push("No material risk signals detected (0)");
  }

  return { score, tier, reasons, action };
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

function FlowCard({ title, subtitle, active = false, done = false, children }) {
  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 260,
        borderRadius: 16,
        padding: 16,
        background: active ? "#c4b5fd" : done ? "#ddd6fe" : "#ede9fe",
        color: "#1f1147",
        boxShadow: active ? "0 10px 30px rgba(124,92,255,0.28)" : "none",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 20, lineHeight: 1.15 }}>{title}</div>
      {subtitle ? (
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4, opacity: 0.9 }}>
          {subtitle}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </div>
  );
}

function Section({ title, right, children }) {
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
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 28 }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Table({ headers, rows, renderRow, emptyText = "No data found." }) {
  if (!rows.length) {
    return <div style={{ opacity: 0.85 }}>{emptyText}</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
        <thead>
          <tr style={{ background: "#334467" }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "14px 12px",
                  fontSize: 14,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState({
    counts: {},
    customers: [],
    audits: [],
    contracts: [],
  });
  const [applications, setApplications] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [verifiedResults, setVerifiedResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("workflow");

  const [form, setForm] = useState({
    fullName: "",
    email: "",
  });

  const [selectedId, setSelectedId] = useState(null);
  const [runningRisk, setRunningRisk] = useState(false);
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

  async function loadAll() {
    setLoading(true);
    setError("");

    const [
      summaryRes,
      appsRes,
      contractsRes,
      customersRes,
      reviewsRes,
      verifiedRes,
    ] = await Promise.all([
      getSummary(),
      listApplications(),
      listContracts(),
      listCustomers(),
      listComplianceReviews(),
      listVerifiedResults(),
    ]);

    if (!summaryRes?.ok) {
      setError(summaryRes?.error || "Failed to load dashboard data");
    }

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
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!selectedId && verifiedResults.length) {
      setSelectedId(verifiedResults[0].id);
    }
  }, [verifiedResults, selectedId]);

  const selectedResult = useMemo(
    () => verifiedResults.find((x) => x.id === selectedId) || applications.find((x) => x.id === selectedId) || null,
    [verifiedResults, applications, selectedId]
  );

  const riskPreview = useMemo(() => calcRisk(signals), [signals]);
  const latestContract = contracts[0] || null;

  async function onCreateApplication(e) {
    e.preventDefault();
    setBusy(true);
    setError("");

    const res = await createApplication(form);
    if (!res?.ok) {
      setError(res?.error || "Failed to create application");
      setBusy(false);
      return;
    }

    setForm({ fullName: "", email: "" });
    await loadAll();
    setTab("applications");
    setBusy(false);
  }

  async function onStartKyc(id) {
    setBusy(true);
    setError("");
    const res = await startKyc(id);
    if (!res?.ok) {
      setError(res?.error || "Failed to start KYC");
      setBusy(false);
      return;
    }
    await loadAll();
    setBusy(false);
  }

  async function onSimulateVerification(target) {
    if (!target?.external_applicant_id) {
      setError("Start KYC first so an external applicant ID is created.");
      return;
    }

    setBusy(true);
    setError("");
    setRunningRisk(true);

    const payload = {
      applicantId: target.external_applicant_id,
      status: simStatus.toLowerCase(),
      ...signals,
    };

    const res = await sendSumsubWebhook(payload);

    setTimeout(async () => {
      setRunningRisk(false);

      if (!res?.ok) {
        setError(res?.error || "Failed to process verification webhook");
        setBusy(false);
        return;
      }

      await loadAll();

      if (res?.application?.risk_tier === "LOW" && res?.contract) {
        setTab("contracts");
      } else if (
        res?.application?.risk_tier === "MEDIUM" ||
        res?.application?.risk_tier === "HIGH" ||
        res?.application?.risk_tier === "CRITICAL"
      ) {
        setTab("reviews");
      } else {
        setTab("verified");
      }

      setBusy(false);
    }, 1200);
  }

  function toggleSignal(key) {
    setSignals((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const workflowBranch = riskPreview.tier;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(180deg, #031133 0%, #081634 30%, #0d1730 100%)",
        color: "#fff",
        fontFamily: "Inter, Arial, sans-serif",
        padding: 18,
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 38, fontWeight: 900 }}>PolicyFlow AI Dashboard</h1>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          ["workflow", "WORKFLOW"],
          ["dashboard", "DASHBOARD"],
          ["applications", "APPLICATIONS"],
          ["verified", "VERIFIED RESULTS"],
          ["reviews", "COMPLIANCE REVIEW"],
          ["customers", "CUSTOMERS"],
          ["contracts", "CONTRACTS"],
          ["audits", "AUDITS"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              border: "none",
              borderRadius: 12,
              background: tab === key ? "#7c5cff" : "#192857",
              color: "#fff",
              padding: "12px 16px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <div>Loading...</div>}

      {error ? (
        <div
          style={{
            background: "#3b1220",
            color: "#fecdd3",
            padding: 14,
            borderRadius: 12,
            marginBottom: 18,
          }}
        >
          {error}
        </div>
      ) : null}

      {!loading && tab === "workflow" && (
        <>
          <Section
            title="Core Functionality Flow"
            right={
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Badge bg="#e0f2fe" color="#0c4a6e">
                  KYC statuses: approved / rejected / pending / review
                </Badge>
                <Badge bg="#ecfccb" color="#365314">Sumsub signals enabled</Badge>
              </div>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
              <div
                style={{
                  background: "#0f1b39",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <h3 style={{ marginTop: 0 }}>1) Create application and start verification</h3>
                <form onSubmit={onCreateApplication} style={{ display: "grid", gap: 12 }}>
                  <input
                    placeholder="Full name"
                    value={form.fullName}
                    onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                    style={inputStyle}
                  />
                  <input
                    placeholder="Email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    style={inputStyle}
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button type="submit" style={primaryBtn} disabled={busy}>
                      Create Application
                    </button>
                  </div>
                </form>

                <div style={{ marginTop: 18 }}>
                  <h4 style={{ marginBottom: 10 }}>Applications</h4>
                  <div style={{ display: "grid", gap: 10, maxHeight: 250, overflow: "auto" }}>
                    {applications.length === 0 ? (
                      <div style={{ opacity: 0.8 }}>No applications yet.</div>
                    ) : (
                      applications.slice(0, 8).map((app) => (
                        <div key={app.id} style={miniCard}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{app.full_name}</div>
                            <div style={{ opacity: 0.8, fontSize: 13 }}>{app.email}</div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                              <Badge bg={STATUS_COLORS[app.kyc_status] || "#475569"}>
                                {prettyStatus(app.kyc_status || "PENDING_KYC")}
                              </Badge>
                              <Badge bg={TIER_COLORS[app.risk_tier] || "#334155"}>
                                {prettyStatus(app.risk_tier || "LOW")}
                              </Badge>
                            </div>
                          </div>
                          <div>
                            <button
                              style={secondaryBtn}
                              disabled={busy}
                              onClick={() => onStartKyc(app.id)}
                            >
                              Start Sumsub KYC
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "#0f1b39",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <h3 style={{ marginTop: 0 }}>2) Simulate Sumsub verification result</h3>

                <div style={{ marginBottom: 10, fontSize: 14, opacity: 0.9 }}>
                  Select an in-progress application below, then apply KYC status and risk labels/tags.
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <select
                    value={selectedId || ""}
                    onChange={(e) => setSelectedId(Number(e.target.value))}
                    style={inputStyle}
                  >
                    <option value="">Select application</option>
                    {applications.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.full_name} — {app.kyc_status}
                      </option>
                    ))}
                  </select>

                  <select
                    value={simStatus}
                    onChange={(e) => setSimStatus(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="APPROVED">approved</option>
                    <option value="REJECTED">rejected</option>
                    <option value="PENDING">pending</option>
                    <option value="REVIEW">review</option>
                  </select>

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

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Badge bg="#0f172a">Risk score: {riskPreview.score}</Badge>
                    <Badge bg={TIER_COLORS[riskPreview.tier]}>{riskPreview.tier}</Badge>
                    <Badge bg="#334155">{riskPreview.action}</Badge>
                  </div>

                  <button
                    style={primaryBtn}
                    disabled={busy || !selectedResult}
                    onClick={() => onSimulateVerification(selectedResult)}
                  >
                    Apply Sumsub Result & Run Risk Assignment
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 22 }}>
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  flexWrap: "wrap",
                  alignItems: "stretch",
                }}
              >
                <FlowCard
                  title="show verified list of results"
                  subtitle="Once approved KYC result is obtained for a customer, show verified items ready for risk assignment."
                  done={verifiedResults.length > 0}
                >
                  <div style={{ fontSize: 13 }}>
                    Verified records: <strong>{verifiedResults.length}</strong>
                  </div>
                </FlowCard>

                <FlowCard
                  title="risk tier assignment process running"
                  subtitle="Evaluate PEP, sanctions, adverse media, document tampering, face mismatch, device/IP risk and country risk."
                  active={runningRisk}
                  done={!runningRisk && Boolean(selectedResult)}
                >
                  <div style={{ fontSize: 13 }}>
                    Current score: <strong>{riskPreview.score}</strong>
                  </div>
                </FlowCard>

                <FlowCard
                  title="risk tier assignment with reasoning"
                  subtitle="Display exact scoring and explain why the customer was classified into the selected tier."
                  done={Boolean(selectedResult)}
                >
                  <div style={{ display: "grid", gap: 8 }}>
                    <Badge bg={TIER_COLORS[riskPreview.tier]}>{riskPreview.tier}</Badge>
                    <div style={{ fontSize: 13 }}>
                      {riskPreview.reasons.map((r) => (
                        <div key={r}>• {r}</div>
                      ))}
                    </div>
                  </div>
                </FlowCard>

                <div style={{ width: "100%" }} />

                <FlowCard
                  title="if risk tier = medium"
                  subtitle="Create customer, send to compliance review, then move to review done page."
                  active={workflowBranch === "MEDIUM"}
                />
                <FlowCard
                  title="create customer"
                  subtitle="Customer is created for MEDIUM tier."
                  done={workflowBranch === "MEDIUM"}
                />
                <FlowCard
                  title="send to compliance review"
                  subtitle="Policy issuance paused and case sent to review queue."
                  done={workflowBranch === "MEDIUM"}
                />
                <FlowCard
                  title="go to compliance review to be done page"
                  subtitle="Dedicated compliance completion screen."
                  done={workflowBranch === "MEDIUM"}
                />

                <div style={{ width: "100%" }} />

                <FlowCard
                  title="if risk tier = low"
                  subtitle="Create customer and generate contract automatically."
                  active={workflowBranch === "LOW"}
                />
                <FlowCard
                  title="create customer"
                  subtitle="Customer creation for LOW tier."
                  done={workflowBranch === "LOW"}
                />
                <FlowCard
                  title="generate contract"
                  subtitle="Create policy contract and make latest contract visible."
                  done={workflowBranch === "LOW"}
                />
                <FlowCard
                  title="go to customer/contracts page"
                  subtitle="Latest customer/contract shown on top by default."
                  done={workflowBranch === "LOW"}
                />
                <FlowCard
                  title="contracts screen"
                  subtitle="Dedicated page for viewing all contracts."
                  done={contracts.length > 0}
                />

                <div style={{ width: "100%" }} />

                <FlowCard
                  title="if risk tier = high / critical"
                  subtitle="Send to compliance review and reject/escalate for critical."
                  active={workflowBranch === "HIGH" || workflowBranch === "CRITICAL"}
                />
                <FlowCard
                  title="send to compliance review"
                  subtitle="High-risk customers are held for compliance action."
                  done={workflowBranch === "HIGH" || workflowBranch === "CRITICAL"}
                />
                <FlowCard
                  title="go to compliance review to be done page"
                  subtitle="Case remains pending until reviewer action."
                  done={workflowBranch === "HIGH" || workflowBranch === "CRITICAL"}
                />
              </div>
            </div>
          </Section>

          <Section title="Risk scoring model">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div style={innerPanel}>
                <h3 style={{ marginTop: 0 }}>Signal → Score Impact</h3>
                <div style={{ display: "grid", gap: 10 }}>
                  {SIGNAL_OPTIONS.map((s) => (
                    <div key={s.key} style={scoreRow}>
                      <span>{s.label}</span>
                      <Badge bg="#312e81">+{s.impact}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div style={innerPanel}>
                <h3 style={{ marginTop: 0 }}>Score → Tier → Action</h3>
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={scoreRow}><span>0–20</span><Badge bg={TIER_COLORS.LOW}>LOW</Badge><span>Auto approve</span></div>
                  <div style={scoreRow}><span>21–50</span><Badge bg={TIER_COLORS.MEDIUM}>MEDIUM</Badge><span>Standard monitoring</span></div>
                  <div style={scoreRow}><span>51–80</span><Badge bg={TIER_COLORS.HIGH}>HIGH</Badge><span>Manual review</span></div>
                  <div style={scoreRow}><span>80+</span><Badge bg={TIER_COLORS.CRITICAL}>CRITICAL</Badge><span>Reject / escalate</span></div>
                </div>
              </div>
            </div>
          </Section>
        </>
      )}

      {!loading && tab === "dashboard" && (
        <Section title="Dashboard">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={metricCard}>
              <div style={metricLabel}>Applications</div>
              <div style={metricValue}>{summary.counts.applications || 0}</div>
            </div>
            <div style={metricCard}>
              <div style={metricLabel}>Customers</div>
              <div style={metricValue}>{summary.counts.customers || 0}</div>
            </div>
            <div style={metricCard}>
              <div style={metricLabel}>Contracts</div>
              <div style={metricValue}>{summary.counts.contracts || 0}</div>
            </div>
            <div style={metricCard}>
              <div style={metricLabel}>Audit Logs</div>
              <div style={metricValue}>{summary.counts.audits || 0}</div>
            </div>
          </div>
        </Section>
      )}

      {!loading && tab === "applications" && (
        <Section title="Applications">
          <Table
            headers={["Name", "Email", "KYC", "Risk Tier", "Decision", "Compliance", "Policy", "Actions"]}
            rows={applications}
            emptyText="No applications found."
            renderRow={(a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={td}>{a.full_name}</td>
                <td style={td}>{a.email}</td>
                <td style={td}>
                  <Badge bg={STATUS_COLORS[a.kyc_status] || "#475569"}>{prettyStatus(a.kyc_status)}</Badge>
                </td>
                <td style={td}>
                  <Badge bg={TIER_COLORS[a.risk_tier] || "#334155"}>{prettyStatus(a.risk_tier)}</Badge>
                </td>
                <td style={td}>{prettyStatus(a.decision_status)}</td>
                <td style={td}>{prettyStatus(a.compliance_status)}</td>
                <td style={td}>{prettyStatus(a.policy_status)}</td>
                <td style={td}>
                  <button style={secondaryBtn} onClick={() => onStartKyc(a.id)} disabled={busy}>
                    Start Sumsub
                  </button>
                </td>
              </tr>
            )}
          />
        </Section>
      )}

      {!loading && tab === "verified" && (
        <Section title="Verified Results">
          <Table
            headers={["Name", "Email", "KYC Status", "Risk Score", "Risk Tier", "Decision", "Reasoning"]}
            rows={verifiedResults}
            emptyText="No verified results yet."
            renderRow={(r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={td}>{r.full_name}</td>
                <td style={td}>{r.email}</td>
                <td style={td}>
                  <Badge bg={STATUS_COLORS[r.kyc_status] || "#475569"}>{prettyStatus(r.kyc_status)}</Badge>
                </td>
                <td style={td}>{r.risk_score ?? 0}</td>
                <td style={td}>
                  <Badge bg={TIER_COLORS[r.risk_tier] || "#334155"}>{prettyStatus(r.risk_tier)}</Badge>
                </td>
                <td style={td}>{prettyStatus(r.decision_status)}</td>
                <td style={td}>{r.risk_score > 0 ? "Risk reasoning available from signal scoring." : "Pending"}</td>
              </tr>
            )}
          />
        </Section>
      )}

      {!loading && tab === "reviews" && (
        <Section title="Compliance Review">
          <Table
            headers={["Applicant ID", "Risk Score", "Risk Tier", "Status", "Reason", "Created"]}
            rows={reviews}
            emptyText="No compliance review items."
            renderRow={(r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={td}>{r.applicant_id}</td>
                <td style={td}>{r.risk_score}</td>
                <td style={td}>
                  <Badge bg={TIER_COLORS[r.risk_tier] || "#334155"}>{prettyStatus(r.risk_tier)}</Badge>
                </td>
                <td style={td}>{prettyStatus(r.status)}</td>
                <td style={{ ...td, maxWidth: 420 }}>{r.reason}</td>
                <td style={td}>{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            )}
          />
        </Section>
      )}

      {!loading && tab === "customers" && (
        <Section title="Customers">
          <Table
            headers={["Name", "Email", "Risk Tier", "Risk Score", "Created"]}
            rows={customers}
            emptyText="No customers created yet."
            renderRow={(c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={td}>{c.full_name}</td>
                <td style={td}>{c.email}</td>
                <td style={td}>
                  <Badge bg={TIER_COLORS[String(c.risk_tier || "").toUpperCase()] || "#334155"}>
                    {prettyStatus(c.risk_tier)}
                  </Badge>
                </td>
                <td style={td}>{c.risk_score ?? 0}</td>
                <td style={td}>{new Date(c.created_at).toLocaleString()}</td>
              </tr>
            )}
          />
        </Section>
      )}

      {!loading && tab === "contracts" && (
        <Section
          title="Contracts"
          right={
            latestContract ? (
              <Badge bg="#dbeafe" color="#1e3a8a">
                Latest contract on top: {latestContract.policy_number}
              </Badge>
            ) : null
          }
        >
          {latestContract ? (
            <div style={{ ...innerPanel, marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Latest Contract</h3>
              <div style={{ display: "grid", gap: 8 }}>
                <div><strong>Policy Number:</strong> {latestContract.policy_number}</div>
                <div><strong>Customer:</strong> {latestContract.full_name}</div>
                <div><strong>Risk Tier:</strong> {latestContract.risk_tier}</div>
                <div><strong>Status:</strong> {latestContract.status}</div>
                <div>
                  <a
                    href={contractPdfUrl(latestContract.id)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#93c5fd", fontWeight: 700 }}
                  >
                    Open latest contract PDF
                  </a>
                </div>
              </div>
            </div>
          ) : null}

          <Table
            headers={["Policy Number", "Customer", "Email", "Risk Tier", "Status", "PDF"]}
            rows={contracts}
            emptyText="No contracts generated yet."
            renderRow={(c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={td}>{c.policy_number}</td>
                <td style={td}>{c.full_name}</td>
                <td style={td}>{c.email}</td>
                <td style={td}>
                  <Badge bg={TIER_COLORS[String(c.risk_tier || "").toUpperCase()] || "#334155"}>
                    {prettyStatus(c.risk_tier)}
                  </Badge>
                </td>
                <td style={td}>{c.status}</td>
                <td style={td}>
                  <a
                    href={contractPdfUrl(c.id)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#93c5fd", fontWeight: 700 }}
                  >
                    Open PDF
                  </a>
                </td>
              </tr>
            )}
          />
        </Section>
      )}

      {!loading && tab === "audits" && (
        <Section title="Audit Logs">
          <Table
            headers={["Event Type", "Created At"]}
            rows={summary.audits || []}
            emptyText="No audit logs found."
            renderRow={(a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <td style={td}>{a.event_type}</td>
                <td style={td}>{new Date(a.created_at).toLocaleString()}</td>
              </tr>
            )}
          />
        </Section>
      )}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0b1631",
  color: "#fff",
  outline: "none",
};

const primaryBtn = {
  border: "none",
  borderRadius: 12,
  background: "#7c5cff",
  color: "#fff",
  padding: "12px 16px",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryBtn = {
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 10,
  background: "#192857",
  color: "#fff",
  padding: "10px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const metricCard = {
  background: "#122041",
  borderRadius: 16,
  padding: 18,
  minWidth: 180,
};

const metricLabel = {
  opacity: 0.8,
  marginBottom: 10,
  fontWeight: 700,
};

const metricValue = {
  fontSize: 34,
  fontWeight: 900,
};

const innerPanel = {
  background: "#0f1b39",
  borderRadius: 16,
  padding: 18,
};

const scoreRow = {
  display: "grid",
  gridTemplateColumns: "1.4fr 100px 1fr",
  gap: 12,
  alignItems: "center",
};

const miniCard = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  background: "#15244a",
  borderRadius: 12,
  padding: 12,
};

const td = {
  padding: "12px",
  verticalAlign: "top",
};