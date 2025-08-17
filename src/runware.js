// runware.js

export async function getStatus(userId) {
  const res = await fetch(`http://localhost:3000/api/status?userId=${encodeURIComponent(userId)}`);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) throw Object.assign(new Error(data?.error || "Failed to fetch status"), { payload: data });
  return data; // { maxAttempts, attemptsUsed, remainingAttempts, msUntilReset, resetAt }
}

export async function generateImage(prompt, userId) {
  const res = await fetch("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, userId })
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || "Runware API request failed"), { payload: data });
  }
  return data; // { imageURL, remainingAttempts, resetAt, maxAttempts, ... }
}
