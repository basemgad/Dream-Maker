// runware.js
const API_BASE =
  import.meta.env.VITE_API_BASE || // set on Render Static Site
  (import.meta.env.DEV ? "http://localhost:3000" : ""); // dev fallback

async function readJsonResponse(res, fallbackMessage) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }

  if (!res.ok) {
    throw Object.assign(new Error(data?.error || fallbackMessage), { payload: data });
  }

  return data;
}

export async function getStatus(userId) {
  const res = await fetch(`${API_BASE}/api/status?userId=${encodeURIComponent(userId)}`);
  return readJsonResponse(res, "Failed to fetch status");
}

export async function generateImage(prompt, userId) {
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, userId })
  });
  return readJsonResponse(res, "Runware API request failed");
}

export async function getGallery(userId) {
  const res = await fetch(`${API_BASE}/api/gallery?userId=${encodeURIComponent(userId)}`);
  return readJsonResponse(res, "Failed to fetch gallery");
}

export async function saveGalleryImage({ userId, prompt, imageURL }) {
  const res = await fetch(`${API_BASE}/api/gallery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, prompt, imageURL })
  });
  return readJsonResponse(res, "Failed to save image");
}

export async function deleteGalleryImage(imageId, userId) {
  const res = await fetch(
    `${API_BASE}/api/gallery/${encodeURIComponent(imageId)}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
  return readJsonResponse(res, "Failed to remove image");
}
