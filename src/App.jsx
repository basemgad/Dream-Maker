// App.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import Cookies from 'js-cookie';
import { generateImage, getStatus } from './runware';
import moon from './images/moon.png';
import './App.css';
import { v4 as uuidv4 } from 'uuid';

function App() {
  useEffect(() => { document.title = 'Dream Maker'; }, []);

  const [dream, setDream] = useState('');
  const [imgUrl, setImgUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const [remaining, setRemaining] = useState(null);
  const [maxAttempts, setMaxAttempts] = useState(null);
  const [resetAt, setResetAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const textareaRef = useRef(null);

  const userId = Cookies.get('userId') || uuidv4();
  if (!Cookies.get('userId')) {
    Cookies.set('userId', userId, { expires: 365 });
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [dream]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refreshStatus = async () => {
    try {
      const s = await getStatus(userId);
      setRemaining(s.remainingAttempts);
      setMaxAttempts(s.maxAttempts);
      setResetAt(s.resetAt || null);
    } catch (e) {
      console.error('Failed to get status:', e);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    if (!isPreviewOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsPreviewOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.classList.add('modal-open');

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('modal-open');
    };
  }, [isPreviewOpen]);

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
    if (!dream.trim()) return setError('Please describe your dream.');
    setLoading(true);
    setError('');
    setImgUrl('');
    setIsPreviewOpen(false);

    try {
      const data = await generateImage(dream, userId);
      setImgUrl(data.imageURL);
      if (typeof data.remainingAttempts === 'number') setRemaining(data.remainingAttempts);
      if (typeof data.maxAttempts === 'number') setMaxAttempts(data.maxAttempts);
      if (typeof data.resetAt === 'number') setResetAt(data.resetAt);
    } catch (err) {
      console.error('Error in image generation:', err);
      const msg =
        err?.payload?.error ||
        err.message ||
        'You have reached your daily limit. Please try again after the cooldown.';
      setError(msg);

      if (typeof err?.payload?.remainingAttempts === 'number') setRemaining(err.payload.remainingAttempts);
      if (typeof err?.payload?.maxAttempts === 'number') setMaxAttempts(err.payload.maxAttempts);
      if (typeof err?.payload?.resetAt === 'number') setResetAt(err.payload.resetAt);
    } finally {
      setLoading(false);
      refreshStatus();
    }
  };

  const handleKeyDown = useCallback(
    (e) => {
      const isEnter = e.key === 'Enter' || e.code === 'Enter';
      const inTextarea = e.target === textareaRef.current;
      if (inTextarea && isEnter && !e.shiftKey) {
        e.preventDefault();
        if (!loading && dream.trim()) onGenerate();
      }
    },
    [loading, dream]
  );

  useEffect(() => {
    const onDocKeyDown = (e) => {
      const isEnter = e.key === 'Enter' || e.code === 'Enter';
      if (document.activeElement === textareaRef.current && isEnter && !e.shiftKey) {
        e.preventDefault();
        if (!loading && dream.trim()) onGenerate();
      }
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [loading, dream]);

  return (
    <>
      <img src={moon} className="moon" alt="moon" aria-hidden="true" />

      <div className="app-content">
        <h1>Dream Maker</h1>

        <div className="card">
          <p>Describe your dream in the text box and let us visualize it!</p>
        </div>

        <div className="textBox">
          <textarea
            ref={textareaRef}
            className="dreamInput"
            onChange={(e) => setDream(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter Your Dream"
            value={dream}
          />
          <button onClick={onGenerate} disabled={loading} className="btn-hover color-10">
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {imgUrl && (
          <div className="result">
            <img
              src={imgUrl}
              alt="Generated dream"
              className="result-image"
              onClick={() => setIsPreviewOpen(true)}
            />
          </div>
        )}

        <div className="gen-counter">
          {maxAttempts != null && remaining != null ? (
            <>
              <div className="gen-counter__title">Generations Left</div>
              <div className="gen-counter__value">
                {remaining} / {maxAttempts}
              </div>
              {resetAt ? <div className="gen-counter__reset">Resets in {countdownText}</div> : null}
            </>
          ) : (
            <div className="gen-counter__title">Checking status…</div>
          )}
        </div>
      </div>

      <div
        className={`image-modal ${isPreviewOpen ? 'open' : ''}`}
        onClick={() => setIsPreviewOpen(false)}
        aria-hidden={!isPreviewOpen}
      >
        <div
          className="image-modal__content"
          onClick={(e) => e.stopPropagation()}
        >
          {imgUrl && (
            <img
              src={imgUrl}
              alt="Generated dream enlarged"
              className="image-modal__img"
            />
          )}
        </div>
      </div>
    </>
  );
}

export default App;
