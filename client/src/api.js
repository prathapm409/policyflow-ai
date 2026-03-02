export async function getSummary() {
  const res = await fetch("/api/summary");
  return res.json();
}

export async function triggerDemo() {
  const res = await fetch("/api/demo/trigger", { method: "POST" });
  return res.json();
}
