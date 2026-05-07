// App.jsx
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Cookies from 'js-cookie';
import {
  deleteGalleryImage,
  generateImage,
  getGallery,
  getStatus,
  saveGalleryImage
} from './runware';
import moon from './images/moon.png';
import './App.css';
import { v4 as uuidv4 } from 'uuid';

const getOrCreateUserId = () => {
  const existingUserId = Cookies.get('userId');
  if (existingUserId) return existingUserId;

  const nextUserId = uuidv4();
  Cookies.set('userId', nextUserId, { expires: 365, sameSite: 'lax' });
  return nextUserId;
};

const formatSavedDate = (createdAt) => {
  if (!createdAt) return '';

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(createdAt));
};

function App() {
  useEffect(() => {
    document.title = 'Dream Maker';
  }, []);

  const showPlaceholder = useMemo(
    () => new URLSearchParams(window.location.search).get('placeholder') === 'true',
    []
  );
  const userId = useMemo(getOrCreateUserId, []);

  const [dream, setDream] = useState('');
  const [imgUrl, setImgUrl] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);

  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [savingToGallery, setSavingToGallery] = useState(false);
  const [savedCurrentImage, setSavedCurrentImage] = useState(false);

  const [remaining, setRemaining] = useState(null);
  const [maxAttempts, setMaxAttempts] = useState(null);
  const [resetAt, setResetAt] = useState(null);
  const [now, setNow] = useState(Date.now());

  const textareaRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getStatus(userId);
      setRemaining(s.remainingAttempts);
      setMaxAttempts(s.maxAttempts);
      setResetAt(s.resetAt || null);
    } catch (e) {
      console.error('Failed to get status:', e);
    }
  }, [userId]);

  const refreshGallery = useCallback(async () => {
    setGalleryLoading(true);
    setGalleryError('');

    try {
      const data = await getGallery(userId);
      setGallery(data.images || []);
    } catch (e) {
      console.error('Failed to get gallery:', e);
      setGalleryError(e?.payload?.error || e.message || 'Could not load your gallery.');
    } finally {
      setGalleryLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refreshStatus();
    refreshGallery();
  }, [refreshStatus, refreshGallery]);

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

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false);
  }, []);

  const closeGallery = useCallback(() => {
    setIsGalleryOpen(false);
  }, []);

  const openPreview = useCallback((image) => {
    setIsGalleryOpen(false);
    setPreviewImage(image);
    setIsPreviewOpen(true);
  }, []);

  const openGallery = useCallback(() => {
    setIsGalleryOpen(true);
    refreshGallery();
  }, [refreshGallery]);

  useEffect(() => {
    if (!isPreviewOpen && !isGalleryOpen) return undefined;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (isPreviewOpen) {
          closePreview();
        } else {
          closeGallery();
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.body.classList.add('modal-open');

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('modal-open');
    };
  }, [isPreviewOpen, isGalleryOpen, closePreview, closeGallery]);

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

  const onGenerate = useCallback(async () => {
    const prompt = dream.trim();

    if (!prompt) {
      setError('Please describe your dream.');
      return;
    }

    if (loading) return;

    setLoading(true);
    setError('');
    setGalleryError('');
    setImgUrl('');
    setGeneratedPrompt('');
    setSavedCurrentImage(false);
    setIsPreviewOpen(false);
    setIsGalleryOpen(false);

    try {
      const data = await generateImage(prompt, userId);
      setImgUrl(data.imageURL);
      setGeneratedPrompt(prompt);
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
  }, [dream, loading, refreshStatus, userId]);

  const onSaveCurrentImage = useCallback(async () => {
    if (!imgUrl || savedCurrentImage || savingToGallery) return;

    setSavingToGallery(true);
    setGalleryError('');

    try {
      const data = await saveGalleryImage({
        userId,
        prompt: generatedPrompt || dream.trim() || 'Untitled dream',
        imageURL: imgUrl
      });

      setGallery((currentGallery) => {
        const withoutDuplicate = currentGallery.filter((image) => image.id !== data.image.id);
        return [data.image, ...withoutDuplicate];
      });
      setSavedCurrentImage(true);
    } catch (err) {
      console.error('Error saving gallery image:', err);
      setGalleryError(err?.payload?.error || err.message || 'Could not save this image.');
    } finally {
      setSavingToGallery(false);
    }
  }, [dream, generatedPrompt, imgUrl, savedCurrentImage, savingToGallery, userId]);

  const onDeleteGalleryImage = useCallback(async (image) => {
    setGalleryError('');

    try {
      await deleteGalleryImage(image.id, userId);
      setGallery((currentGallery) => currentGallery.filter((item) => item.id !== image.id));
      if (image.imageURL === imgUrl) {
        setSavedCurrentImage(false);
      }
    } catch (err) {
      console.error('Error removing gallery image:', err);
      setGalleryError(err?.payload?.error || err.message || 'Could not remove this image.');
    }
  }, [imgUrl, userId]);

  const handleKeyDown = useCallback(
    (e) => {
      const isEnter = e.key === 'Enter' || e.code === 'Enter';
      const inTextarea = e.target === textareaRef.current;
      if (inTextarea && isEnter && !e.shiftKey) {
        e.preventDefault();
        if (!loading && dream.trim()) onGenerate();
      }
    },
    [loading, dream, onGenerate]
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
  }, [loading, dream, onGenerate]);

  const currentImage = imgUrl
    ? {
        imageURL: imgUrl,
        prompt: generatedPrompt || dream.trim() || 'Generated dream'
      }
    : null;
  const savedLabel = gallery.length === 1 ? '1 saved' : `${gallery.length} saved`;

  return (
    <>
      <img src={moon} className="moon" alt="moon" aria-hidden="true" />

      <button
        type="button"
        className="gallery-trigger"
        onClick={openGallery}
        aria-haspopup="dialog"
        aria-expanded={isGalleryOpen}
      >
        <span>Gallery</span>
        <span className="gallery-trigger__count">{gallery.length}</span>
      </button>

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

        <div className="result">
          {currentImage && (
            <img
              src={currentImage.imageURL}
              alt={`Generated dream: ${currentImage.prompt}`}
              className="result-image"
              onClick={() => openPreview(currentImage)}
            />
          )}
          {!imgUrl && showPlaceholder && (
            <div className="result-image result-placeholder" aria-label="Generated image placeholder" />
          )}
        </div>

        {currentImage && (
          <div className="result-actions">
            <button
              type="button"
              className="gallery-save-button"
              onClick={onSaveCurrentImage}
              disabled={savingToGallery || savedCurrentImage}
            >
              {savedCurrentImage ? 'Saved' : savingToGallery ? 'Saving...' : 'Save to Gallery'}
            </button>
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
            <div className="gen-counter__title">Checking status...</div>
          )}
        </div>
      </div>

      <div
        className={`gallery-modal ${isGalleryOpen ? 'open' : ''}`}
        onClick={closeGallery}
        aria-hidden={!isGalleryOpen}
      >
        <section
          className="gallery gallery-modal__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Saved dream gallery"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="gallery__header">
            <div>
              <h2>Gallery</h2>
              <span className="gallery__count">{savedLabel}</span>
            </div>
            <button
              type="button"
              className="gallery__close"
              onClick={closeGallery}
              aria-label="Close gallery"
            >
              Close
            </button>
          </div>

          {galleryError && <div className="gallery-message gallery-message--error">{galleryError}</div>}

          {galleryLoading ? (
            <div className="gallery-message">Loading gallery...</div>
          ) : gallery.length > 0 ? (
            <div className="gallery-grid">
              {gallery.map((image) => (
                <article className="gallery-item" key={image.id}>
                  <button
                    type="button"
                    className="gallery-item__image"
                    onClick={() => openPreview(image)}
                    aria-label={`Open saved dream from ${formatSavedDate(image.createdAt)}`}
                  >
                    <img src={image.imageURL} alt={`Saved dream: ${image.prompt}`} loading="lazy" />
                  </button>
                  <div className="gallery-item__body">
                    <div className="gallery-item__prompt">{image.prompt}</div>
                    <div className="gallery-item__meta">
                      <span>{formatSavedDate(image.createdAt)}</span>
                      <button
                        type="button"
                        className="gallery-item__remove"
                        onClick={() => onDeleteGalleryImage(image)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="gallery-empty">No saved dreams yet.</div>
          )}
        </section>
      </div>

      <div
        className={`image-modal ${isPreviewOpen ? 'open' : ''}`}
        onClick={closePreview}
        aria-hidden={!isPreviewOpen}
      >
        <div
          className="image-modal__content"
          onClick={(e) => e.stopPropagation()}
        >
          {previewImage?.imageURL && (
            <img
              src={previewImage.imageURL}
              alt={`Generated dream enlarged: ${previewImage.prompt}`}
              className="image-modal__img"
            />
          )}
        </div>
      </div>
    </>
  );
}

export default App;
