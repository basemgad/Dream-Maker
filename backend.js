// backend.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
import fetch from 'node-fetch'; // Node 18+ also has global fetch, but this works fine
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
app.use(cors()); // you can lock this down later to your frontend domain(s)
app.use(express.json());

// ---- Config ----
const MAX_ATTEMPTS = 20;
const COOLDOWN_PERIOD = 24 * 60 * 60 * 1000; // 24 hours
const RUNWARE_KEY = process.env.RUNWARE_API_KEY || process.env.VITE_RUNWARE_API_KEY;
const FORCE_PLACEHOLDER_IMAGES = process.env.USE_PLACEHOLDER_IMAGES === 'true';

// ---- SQLite init (use absolute path; Render runs at /opt/render/project/src) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'user_attempts.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err, 'at', DB_PATH);
  } else {
    console.log('Connected to SQLite database at', DB_PATH);
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS attempts (
        userId TEXT PRIMARY KEY,
        attempts INTEGER,
        lastAttempt INTEGER
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS gallery_images (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        prompt TEXT NOT NULL,
        imageURL TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        UNIQUE(userId, imageURL)
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_gallery_images_user_created
        ON gallery_images (userId, createdAt DESC)`);
    });
  }
});

// ---- Helpers ----
const isHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const isLocalRequest = (req) => {
  const host = req.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

const shouldUsePlaceholderImages = (req) => (
  FORCE_PLACEHOLDER_IMAGES || (!RUNWARE_KEY && isLocalRequest(req))
);

const PLACEHOLDER_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#29476c" />
      <stop offset="100%" stop-color="#d98ca6" />
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)" />
  <circle cx="768" cy="228" r="108" fill="#fff8dc" opacity="0.95" />
  <path d="M0 720 C210 620 340 810 520 700 C680 600 800 720 1024 630 L1024 1024 L0 1024 Z" fill="#131a2c" opacity="0.68" />
  <text x="512" y="512" text-anchor="middle" fill="#fff9f9" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="700">Local Placeholder</text>
  <text x="512" y="585" text-anchor="middle" fill="#fff9f9" font-family="Arial, Helvetica, sans-serif" font-size="28">Generated image preview</text>
</svg>`;

const canGenerate = (userId) => new Promise((resolve, reject) => {
  const q = `SELECT attempts, lastAttempt FROM attempts WHERE userId = ?`;
  db.get(q, [userId], (err, row) => {
    if (err) return reject(err);
    const now = Date.now();
    if (!row) return resolve(true);

    const elapsed = now - row.lastAttempt;
    if (elapsed >= COOLDOWN_PERIOD) {
      db.run(`UPDATE attempts SET attempts = 0 WHERE userId = ?`, [userId], (e) => {
        if (e) return reject(e);
        resolve(true);
      });
    } else {
      resolve((row.attempts || 0) < MAX_ATTEMPTS);
    }
  });
});

const getStatus = (userId) => new Promise((resolve, reject) => {
  const now = Date.now();
  db.get(`SELECT attempts, lastAttempt FROM attempts WHERE userId = ?`, [userId], (err, row) => {
    if (err) return reject(err);

    if (!row) {
      return resolve({
        attemptsUsed: 0,
        remainingAttempts: MAX_ATTEMPTS,
        msUntilReset: 0,
        resetAt: now
      });
    }

    const elapsed = now - row.lastAttempt;
    if (elapsed >= COOLDOWN_PERIOD) {
      db.run(`UPDATE attempts SET attempts = 0 WHERE userId = ?`, [userId], (uErr) => {
        if (uErr) return reject(uErr);
        resolve({
          attemptsUsed: 0,
          remainingAttempts: MAX_ATTEMPTS,
          msUntilReset: 0,
          resetAt: now
        });
      });
    } else {
      const msUntilReset = COOLDOWN_PERIOD - elapsed;
      resolve({
        attemptsUsed: row.attempts || 0,
        remainingAttempts: Math.max(0, MAX_ATTEMPTS - (row.attempts || 0)),
        msUntilReset,
        resetAt: now + msUntilReset
      });
    }
  });
});

const updateAttemptsAndGetStatus = (userId) => new Promise((resolve, reject) => {
  const currentTime = Date.now();
  const upsert = `INSERT INTO attempts (userId, attempts, lastAttempt) VALUES (?, 1, ?)
                  ON CONFLICT(userId) DO UPDATE SET attempts = attempts + 1, lastAttempt = ?`;
  db.run(upsert, [userId, currentTime, currentTime], (err) => {
    if (err) return reject(err);
    getStatus(userId).then(resolve).catch(reject);
  });
});

const getGalleryImages = (userId) => new Promise((resolve, reject) => {
  db.all(
    `SELECT id, prompt, imageURL, createdAt
     FROM gallery_images
     WHERE userId = ?
     ORDER BY createdAt DESC`,
    [userId],
    (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    }
  );
});

const saveGalleryImage = ({ userId, prompt, imageURL }) => new Promise((resolve, reject) => {
  db.get(
    `SELECT id, prompt, imageURL, createdAt
     FROM gallery_images
     WHERE userId = ? AND imageURL = ?`,
    [userId, imageURL],
    (findErr, existing) => {
      if (findErr) return reject(findErr);
      if (existing) return resolve(existing);

      const image = {
        id: uuidv4(),
        userId,
        prompt,
        imageURL,
        createdAt: Date.now()
      };

      db.run(
        `INSERT INTO gallery_images (id, userId, prompt, imageURL, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
        [image.id, image.userId, image.prompt, image.imageURL, image.createdAt],
        (insertErr) => {
          if (insertErr) return reject(insertErr);
          const { userId: _userId, ...publicImage } = image;
          resolve(publicImage);
        }
      );
    }
  );
});

const deleteGalleryImage = ({ userId, imageId }) => new Promise((resolve, reject) => {
  db.run(
    `DELETE FROM gallery_images WHERE id = ? AND userId = ?`,
    [imageId, userId],
    function onDelete(err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    }
  );
});

// ---- Routes ----

// Status endpoint for the UI counter
app.get('/api/status', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    const status = await getStatus(userId);
    return res.json({ maxAttempts: MAX_ATTEMPTS, ...status });
  } catch (e) {
    console.error('GET /api/status error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/gallery', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const images = await getGalleryImages(userId);
    return res.json({ images });
  } catch (e) {
    console.error('GET /api/gallery error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/gallery', async (req, res) => {
  try {
    const { userId, prompt, imageURL } = req.body;

    if (!userId || !prompt || !imageURL) {
      return res.status(400).json({ error: 'Missing userId, prompt, or imageURL in request body.' });
    }

    if (!isHttpUrl(imageURL)) {
      return res.status(400).json({ error: 'imageURL must be a valid http(s) URL.' });
    }

    const image = await saveGalleryImage({
      userId,
      prompt: String(prompt).trim().slice(0, 2000),
      imageURL
    });

    return res.status(201).json({ image });
  } catch (e) {
    console.error('POST /api/gallery error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/gallery/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const { userId } = req.query;

    if (!userId || !imageId) {
      return res.status(400).json({ error: 'Missing userId or imageId.' });
    }

    const deleted = await deleteGalleryImage({ userId, imageId });
    if (!deleted) return res.status(404).json({ error: 'Gallery image not found.' });

    return res.json({ deleted: true, imageId });
  } catch (e) {
    console.error('DELETE /api/gallery/:imageId error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/placeholder-image/:imageId.svg', (_req, res) => {
  res
    .type('image/svg+xml')
    .set('Cache-Control', 'no-store')
    .send(PLACEHOLDER_SVG);
});

// Main generate endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, userId } = req.body;

    if (!prompt || !userId) {
      return res.status(400).json({ error: 'Missing prompt or userId in request body.' });
    }

    const usePlaceholderImage = shouldUsePlaceholderImages(req);

    if (!RUNWARE_KEY && !usePlaceholderImage) {
      return res.status(500).json({ error: 'Server misconfiguration: missing RUNWARE_API_KEY.' });
    }

    const allowed = await canGenerate(userId);

    if (!allowed) {
      const status = await getStatus(userId);
      return res.status(403).json({
        error: 'You have reached your limit. Please try again after the timer is finished.',
        maxAttempts: MAX_ATTEMPTS,
        ...status
      });
    }

    // Increment attempt
    const statusAfterInc = await updateAttemptsAndGetStatus(userId);

    // Build Runware request
    const taskUUID = uuidv4();

    if (usePlaceholderImage) {
      const imageURL = `${req.protocol}://${req.get('host')}/api/placeholder-image/${taskUUID}.svg`;
      return res.json({
        imageURL,
        mock: true,
        maxAttempts: MAX_ATTEMPTS,
        ...statusAfterInc
      });
    }

    const requestBody = [{
      taskType: 'imageInference',
      taskUUID,
      includeCost: true,
      model: 'imagineart:2.0@0',
      positivePrompt: prompt,
      width: 1024,
      height: 1024,
      numberResults: 1
    }];

      const rwRes = await fetch('https://api.runware.ai/v1/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RUNWARE_KEY}`
        },
        body: JSON.stringify(requestBody)
      });
      
      const rwText = await rwRes.text();
      console.log('Runware status:', rwRes.status);
      console.log('Runware body:', rwText);
      
      let parsed;
      try {
        parsed = JSON.parse(rwText);
      } catch {
        return res.status(rwRes.status || 500).json({
          error: 'Runware returned non-JSON',
          details: rwText
        });
      }
      
      if (!rwRes.ok || parsed.errors?.length || parsed.error) {
        return res.status(rwRes.status || 400).json({
          error: 'Runware generation failed',
          details: parsed.errors || parsed.error || parsed
        });
      }
      
      const imageURL = parsed?.data?.[0]?.imageURL;
      if (!imageURL) {
        return res.status(500).json({
          error: 'Runware returned success but no imageURL',
          details: parsed
        });
      }   

    return res.json({
      imageURL,
      maxAttempts: MAX_ATTEMPTS,
      ...statusAfterInc
    });
  } catch (err) {
    console.error('POST /api/generate error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// ---- Start server ----
const PORT = process.env.PORT || 3000; // define before use
app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
