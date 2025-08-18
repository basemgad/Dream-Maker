import { useState, useRef, useEffect } from 'react';
import Cookies from 'js-cookie';
import { generateImage, getStatus } from './runware';
import moon from './images/moon.png';
import './App.css';
import { v4 as uuidv4 } from 'uuid';

function App() {
  const [dream, setDream] = useState("");
  const [imgUrl, setImgUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // NEW: status state for the sticky counter
  const [remaining, setRemaining] = useState(null);
  const [maxAttempts, setMaxAttempts] = useState(null);
  const [resetAt, setResetAt] = useState(null); // epoch ms when cooldown ends
  const [now, setNow] = useState(Date.now());   // tick every second for countdown

  const textareaRef = useRef(null);

  // Get userId from cookies or create a new one if it doesn't exist
  const userId = Cookies.get('userId') || uuidv4();
  if (!Cookies.get('userId')) {
    Cookies.set('userId', userId, { expires: 365 }); // Store for 1 year
  }

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [dream]);

  // Tick every second to update the countdown text
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch status from backend
  const refreshStatus = async () => {
    try {
      const s = await getStatus(userId);
      setRemaining(s.remainingAttempts);
      setMaxAttempts(s.maxAttempts);
      setResetAt(s.resetAt || null);
    } catch (e) {
      console.error("Failed to get status:", e);
    }
  };

  // Load status on mount
  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Format countdown as h m s
  const countdownText = (() => {
    if (!resetAt) return '';
    const ms = Math.max(0, resetAt - now);
    const totalSec = Math.floor(ms / 1000);

    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return parts.join(' ');
  })();

  const onGenerate = async () => {
    if (!dream.trim()) return setError("Please describe your dream.");
    setLoading(true);
    setError("");
    setImgUrl("");

    try {
      const data = await generateImage(dream, userId);
      // data: { imageURL, remainingAttempts, resetAt, maxAttempts, ... }
      setImgUrl(data.imageURL);
      if (typeof data.remainingAttempts === 'number') setRemaining(data.remainingAttempts);
      if (typeof data.maxAttempts === 'number') setMaxAttempts(data.maxAttempts);
      if (typeof data.resetAt === 'number') setResetAt(data.resetAt);
    } catch (err) {
      console.error("Error in image generation:", err);
      const msg = err?.payload?.error || err.message || "You have reached your daily limit. Please try again after the cooldown.";
      setError(msg);

      // Attempt to read status from error payload too
      if (typeof err?.payload?.remainingAttempts === 'number') setRemaining(err.payload.remainingAttempts);
      if (typeof err?.payload?.maxAttempts === 'number') setMaxAttempts(err.payload.maxAttempts);
      if (typeof err?.payload?.resetAt === 'number') setResetAt(err.payload.resetAt);
    } finally {
      setLoading(false);
      // Always sync with server after any attempt
      refreshStatus();
    }
  };

  return (
    <>
      {/* Moon stays behind and never blocks clicks */}
      <img src={moon} className="moon" alt="moon" aria-hidden="true" />

      {/* Everything else above the moon */}
      <div className="app-content">
        <h1>Dream Maker</h1>
        <div className="card">
          <p>Describe your dream in the text box and let us visualize it!</p>
        </div>

        <div className="textBox">
          <textarea
            ref={textareaRef}
            className="dreamInput"
            onChange={e => setDream(e.target.value)}
            placeholder="Enter Your Dream"
            value={dream}
          />
          <button onClick={onGenerate} disabled={loading} className="btn-hover color-10">
            {loading ? "Generating..." : "Generate"}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {imgUrl && (
          <div className="result">
            <img src={imgUrl} alt="Generated dream" />
          </div>
        )}

        {/* Sticky generations counter (bottom-left) */}
        <div className="gen-counter">
          {maxAttempts != null && remaining != null ? (
            <>
              <div className="gen-counter__title">Generations Left</div>
              <div className="gen-counter__value">
                {remaining} / {maxAttempts}
              </div>
              {resetAt ? (
                <div className="gen-counter__reset">
                  Resets in {countdownText}
                </div>
              ) : null}
            </>
          ) : (
            <div className="gen-counter__title">Checking status…</div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;