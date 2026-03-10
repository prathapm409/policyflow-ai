// client/src/api.js
// Small helper for calling backend API endpoints used by the POC UI.

async function handleResponse(res) {
  let body;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body?.error?.message || body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function getJson(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  return handleResponse(res);
}

export async function postJson(path, data) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function download(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  const buf = await res.arrayBuffer();
  return buf;
}
