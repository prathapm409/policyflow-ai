export async function getSummary() {
  const res = await fetch("/api/summary");
  return res.json();
}

export async function triggerDemo() {
  const res = await fetch("/api/demo/trigger", { method: "POST" });
  return res.json();
}

export async function createApplication({ fullName, email }) {
  const res = await fetch("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email })
  });
  return res.json();
}

export async function listApplications() {
  const res = await fetch("/api/applications");
  return res.json();
}

export async function startKyc(applicationId) {
  const res = await fetch(`/api/applications/${applicationId}/start-kyc`, {
    method: "POST",
  });
  return res.json();
}