import React, { useEffect, useRef, useState } from 'react';
import * as faceapi from '@vladmandic/face-api';

const EMOTIONS = [
  { key: 'angry', label: 'Angry', emoji: '😠' },
  { key: 'disgusted', label: 'Disgusted', emoji: '🤢' },
  { key: 'fearful', label: 'Fearful', emoji: '😨' },
  { key: 'happy', label: 'Happy', emoji: '😃' },
  { key: 'neutral', label: 'Neutral', emoji: '😐' },
  { key: 'sad', label: 'Sad', emoji: '😢' },
  { key: 'surprised', label: 'Surprised', emoji: '😮' },
];

// No-op: previously used for chart point images; retained for potential future use

export default function App() {
  const videoRef = useRef(null);
  const runningRef = useRef(true);
  const [status, setStatus] = useState('Loading models…');
  const [dominant, setDominant] = useState(null);
  const [isRunning, setIsRunning] = useState(true);
  const [emotionCounts, setEmotionCounts] = useState(() =>
    Object.fromEntries(EMOTIONS.map((e) => [e.key, 0]))
  );
  const [emotionDurationsMs, setEmotionDurationsMs] = useState(() =>
    Object.fromEntries(EMOTIONS.map((e) => [e.key, 0]))
  );
  const lastTickRef = useRef(null);

  useEffect(() => {
    async function init() {
      try {
        const MODEL_URL = './models';
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
        setStatus('Starting camera…');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setStatus('Detecting…');
        runningRef.current = true;
        lastTickRef.current = performance.now();
        runLoop();
      } catch (err) {
        console.error(err);
        setStatus('Error: ' + err.message);
      }
    }

    init();

    return () => {
      runningRef.current = false;
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = videoRef.current.srcObject.getTracks();
        tracks.forEach((t) => t.stop());
      }
    };
  }, []);

  async function runLoop() {
    const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 });
    while (runningRef.current) {
      if (videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
        try {
          const now = performance.now();
          const prev = lastTickRef.current ?? now;
          const deltaMs = Math.max(0, now - prev);
          lastTickRef.current = now;
          const result = await faceapi
            .detectSingleFace(videoRef.current, detectorOpts)
            .withFaceExpressions();

          if (result && result.expressions) {
            const entries = Object.entries(result.expressions);
            entries.sort((a, b) => b[1] - a[1]);
            const [topKey, topScore] = entries[0];
            setDominant({ key: topKey, score: topScore });

            // Update session-wide counts
            setEmotionCounts((prev) => ({
              ...prev,
              [topKey]: (prev[topKey] ?? 0) + 1,
            }));

            // Accumulate time for detected top emotion
            setEmotionDurationsMs((prev) => ({
              ...prev,
              [topKey]: (prev[topKey] ?? 0) + deltaMs,
            }));
          }
        } catch (e) {
          console.warn('Detection error', e);
          // On error, reset tick baseline to avoid accumulating paused time on next success
          lastTickRef.current = performance.now();
        }
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  function toggleRunning() {
    setIsRunning((prev) => {
      const next = !prev;
      runningRef.current = next;
      if (next) {
        setStatus('Detecting…');
        lastTickRef.current = performance.now();
        runLoop();
      }
      if (!next) {
        setStatus('Stopped…');
      }
      return next;
    });
  }

  function resetSession() {
    setEmotionCounts(Object.fromEntries(EMOTIONS.map((e) => [e.key, 0])));
    setEmotionDurationsMs(Object.fromEntries(EMOTIONS.map((e) => [e.key, 0])));
  }

  const overallKey = React.useMemo(() => {
    let maxKey = null;
    let maxVal = -1;
    for (const e of EMOTIONS) {
      const v = emotionCounts[e.key] ?? 0;
      if (v > maxVal) {
        maxVal = v;
        maxKey = e.key;
      }
    }
    return maxVal > 0 ? maxKey : null;
  }, [emotionCounts]);

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <style>{`
        @keyframes subtleGradientMove {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }
        .glassPanel {
          position: relative;
          border-radius: 24px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.14);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06), 0 10px 30px rgba(0,0,0,0.25);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          overflow: hidden;
        }
        .glassPanel::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg,
            rgba(99,102,241,0.25),
            rgba(236,72,153,0.25),
            rgba(34,197,94,0.25)
          );
          background-size: 200% 200%;
          animation: subtleGradientMove 14s ease-in-out infinite alternate;
          pointer-events: none;
          z-index: 0;
          mix-blend-mode: overlay;
          opacity: 0.65;
        }
        .glassContent { position: relative; z-index: 1; }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        {/* Single iPhone-like container (screen only) */}
        <div
          style={{
            width: 'min(420px, 90vw)',
            aspectRatio: '9 / 19.5',
            background: '#000',
            borderRadius: 36,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: 14,
            paddingTop: 48,
            gap: 12,
            boxShadow:
              '0 10px 25px rgba(0,0,0,0.45), 0 25px 60px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.2)',
          }}
        >
          {/* Notch */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 120,
              height: 28,
              background: '#000',
              borderBottomLeftRadius: 18,
              borderBottomRightRadius: 18,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              zIndex: 2,
              boxShadow: '0 2px 6px rgba(0,0,0,0.35) inset',
            }}
          />
            {/* In-screen header */}
            <div style={{ textAlign: 'center', color: '#fff' }}>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: 0.2 }}>Dominant Emotion Timer</div>
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{status}</div>
            </div>

            {/* Content area split: camera (50%) and sentiment (50%) */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 12 }}>
              {/* Inner camera frame (50%) - match sentiment frame width and visual container */}
              <div className="glassPanel" style={{ width: '100%', flex: 1, display: 'flex', minHeight: 0 }}>
                <div className="glassContent" style={{ position: 'relative', flex: 1, borderRadius: 18, overflow: 'hidden', background: '#000' }}>
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
                  />

                  {dominant && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        background: 'rgba(255,255,255,0.85)',
                        borderRadius: 12,
                        padding: '8px 12px',
                        fontSize: 18,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
                      }}
                    >
                      <span aria-hidden style={{ marginRight: 8 }}>
                        {EMOTIONS.find((e) => e.key === dominant.key)?.emoji}
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        {EMOTIONS.find((e) => e.key === dominant.key)?.label}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>
                        {Math.round(dominant.score * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Sentiment frame (50%) with glass effect - same width as camera container */}
              <div className="glassPanel" style={{ color: '#fff', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div className="glassContent" style={{ display: 'flex', flexDirection: 'column', padding: 14, height: '100%' }}>
                  {/* Header (centered) */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                    <div style={{ fontSize: 14, opacity: 0.95, fontWeight: 700, letterSpacing: 0.3, textAlign: 'center' }}>Overall Emotion Sentiment</div>
                  </div>

                  {/* Body */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                    {overallKey ? (
                      <div>
                        <div style={{ fontSize: 64, lineHeight: 1 }}>
                          {EMOTIONS.find((e) => e.key === overallKey)?.emoji}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 16, fontWeight: 600 }}>
                          {EMOTIONS.find((e) => e.key === overallKey)?.label}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>
                          Time detected: {formatDuration(emotionDurationsMs[overallKey] || 0)}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, opacity: 0.75 }}>No data yet</div>
                    )}
                  </div>

                  {/* Footer buttons (bottom) */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                    <button
                      onClick={toggleRunning}
                      style={{ padding: '10px 14px', borderRadius: 12, background: '#111827', color: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', cursor: 'pointer', border: 'none', fontSize: 12 }}
                    >
                      {isRunning ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={resetSession}
                      style={{ padding: '10px 14px', borderRadius: 12, background: '#374151', color: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', cursor: 'pointer', border: 'none', fontSize: 12 }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
        </div>
      </div>

      {/* Buttons moved inside sentiment container */}
    </div>
  );
}


