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
