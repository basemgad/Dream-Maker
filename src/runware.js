// runware.js
const API_BASE =
  import.meta.env.VITE_API_BASE || // set on Render Static Site
  (import.meta.env.DEV ? "http://localhost:3000" : ""); // dev fallback

export async function getStatus(userId) {
  const res = await fetch(`${API_BASE}/api/status?userId=${encodeURIComponent(userId)}`);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw Object.assign(new Error(data?.error || "Failed to fetch status"), { payload: data });
  return data;
}

export async function generateImage(prompt, userId) {
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, userId })
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || "Runware API request failed"), { payload: data });
  }
  return data;
}
