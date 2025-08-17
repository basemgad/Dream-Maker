// backend.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import sqlite3 from 'sqlite3';
import fetch from 'node-fetch'; // if using Node 18+ you can also use the global fetch

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());


// ---- Config ----
const MAX_ATTEMPTS = 20;
const COOLDOWN_PERIOD = 24 * 60 * 60 * 1000; // 24 hours


// ---- SQLite init ----
const db = new sqlite3.Database('./user_attempts.db', (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err);
  } else {
    console.log('Connected to SQLite database');
    db.run(`CREATE TABLE IF NOT EXISTS attempts (
      userId TEXT PRIMARY KEY,
      attempts INTEGER,
      lastAttempt INTEGER
    )`);
  }
});

// ---- Helpers ----
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

// Main generate endpoint
app.post('/api/generate', async (req, res) => {
  try {
    console.log('Received request body:', req.body);
    const { prompt, userId } = req.body;

    if (!prompt || !userId) {
      return res.status(400).json({ error: 'Missing prompt or userId in request body.' });
    }

    const allowed = await canGenerate(userId);
    console.log('Can generate result:', allowed);

    if (!allowed) {
      const status = await getStatus(userId);
      return res.status(403).json({
    error: 'You have reached your limit. Please try again after 24 hours.',
    maxAttempts: MAX_ATTEMPTS,
    ...status
      });
    }

    // Increment attempt
    const statusAfterInc = await updateAttemptsAndGetStatus(userId);

    // Build Runware request
    const taskUUID = uuidv4();
    const requestBody = [{
      taskType: 'imageInference',
      taskUUID,
      includeCost: true,
      model: 'civitai:36520@76907',
      positivePrompt: prompt,
      width: 512,
      height: 512,
      numberResults: 1
    }];

    console.log('Sending request to Runware API:', JSON.stringify(requestBody, null, 2));

    const rwRes = await fetch('https://api.runware.ai/v1/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RUNWARE_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    const rwText = await rwRes.text();
    console.log('Runware API Response:', rwText);

    if (!rwRes.ok) {
      return res.status(500).json({
        error: 'Runware API request failed',
        details: rwText,
        maxAttempts: MAX_ATTEMPTS,
        ...statusAfterInc
      });
    }

    const data = JSON.parse(rwText);
    const imageURL = data?.data?.[0]?.imageURL;
    if (!imageURL) {
      return res.status(500).json({
        error: 'No imageURL in response',
        details: data,
        maxAttempts: MAX_ATTEMPTS,
        ...statusAfterInc
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
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
  const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));


});
