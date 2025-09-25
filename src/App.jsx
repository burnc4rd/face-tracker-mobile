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

// Emotion state definitions (excluding neutral from calculations)
const EMOTION_STATES = [
  {
    name: 'Highly Engaged',
    targetPercentages: {
      happy: 35,
      surprised: 20,
      fearful: 0,
      angry: 0,
      disgusted: 0,
      sad: 0
    }
  },
  {
    name: 'Constructively Struggling',
    targetPercentages: {
      happy: 15,
      surprised: 10,
      fearful: 10,
      angry: 10,
      disgusted: 0,
      sad: 10
    }
  },
  {
    name: 'Confused / Overloaded',
    targetPercentages: {
      happy: 5,
      surprised: 15,
      fearful: 15,
      angry: 10,
      disgusted: 5,
      sad: 10
    }
  },
  {
    name: 'Disengaged / Distracted',
    targetPercentages: {
      happy: 5,
      surprised: 5,
      fearful: 5,
      angry: 5,
      disgusted: 5,
      sad: 20
    }
  },
  {
    name: 'Actively Resistant',
    targetPercentages: {
      happy: 0,
      surprised: 5,
      fearful: 5,
      angry: 40,
      disgusted: 25,
      sad: 10
    }
  }
];

// No-op: previously used for chart point images; retained for potential future use

export default function App() {
  const videoRef = useRef(null);
  const runningRef = useRef(true);
  
  // Face-API model states
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
  
  // Emotion history for timeline graph
  const [emotionHistory, setEmotionHistory] = useState([]);
  const timeWindowMs = 15000; // Show 15 seconds of data
  
  // State detection with smoothing
  const [currentState, setCurrentState] = useState('Actively Resistant'); // Test state
  const [smoothedEmotions, setSmoothedEmotions] = useState({});
  const smoothingFactor = 0.1; // Lower = more smoothing
  const smoothingWindow = 10; // Number of recent readings to average

  // Color mapping for emotions
  const emotionColors = {
    angry: '#ef4444',
    disgusted: '#10b981', 
    fearful: '#8b5cf6',
    happy: '#f59e0b',
    neutral: '#6b7280',
    sad: '#3b82f6',
    surprised: '#ec4899'
  };
  
  // Helper function to calculate emotion percentages (excluding neutral)
  function calculateEmotionPercentages(expressions) {
    const { neutral, ...nonNeutralEmotions } = expressions;
    const total = Object.values(nonNeutralEmotions).reduce((sum, val) => sum + val, 0);
    
    if (total === 0) return {};
    
    const percentages = {};
    Object.keys(nonNeutralEmotions).forEach(emotion => {
      percentages[emotion] = (nonNeutralEmotions[emotion] / total) * 100;
    });
    
    return percentages;
  }
  
  
  // Helper function to detect current state based on emotion percentages
  function detectCurrentState(emotionPercentages) {
    if (Object.keys(emotionPercentages).length === 0) return '';
    
    let bestMatch = { state: '', score: Infinity };
    
    EMOTION_STATES.forEach(state => {
      let totalDifference = 0;
      let comparedEmotions = 0;
      
      Object.keys(state.targetPercentages).forEach(emotion => {
        const target = state.targetPercentages[emotion];
        const actual = emotionPercentages[emotion] || 0;
        const difference = Math.abs(target - actual);
        totalDifference += difference;
        comparedEmotions++;
      });
      
      if (comparedEmotions > 0) {
        const avgDifference = totalDifference / comparedEmotions;
        if (avgDifference < bestMatch.score) {
          bestMatch = { state: state.name, score: avgDifference };
        }
      }
    });
    
    return bestMatch.state;
  }


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
        
        // Set up video element
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

            // Calculate emotion percentages (excluding neutral) and smooth them
            const emotionPercentages = calculateEmotionPercentages(result.expressions);
            
            // Update smoothed emotions and detect state in one operation
            setSmoothedEmotions(prev => {
              const smoothed = {};
              Object.keys(emotionPercentages).forEach(emotion => {
                const prevValue = prev[emotion] || 0;
                smoothed[emotion] = prevValue + (emotionPercentages[emotion] - prevValue) * smoothingFactor;
              });
              
              // Detect current state based on smoothed emotions
              const newState = detectCurrentState(smoothed);
              console.log('Emotion percentages:', emotionPercentages);
              console.log('Smoothed emotions:', smoothed);
              console.log('Detected state:', newState);
              if (newState && newState !== currentState) {
                console.log('Setting new state:', newState);
                setCurrentState(newState);
              }
              
              return smoothed;
            });
            
            // Add to emotion history for timeline graph
            const timestamp = performance.now();
            const historyPoint = {
              timestamp,
              emotions: { ...result.expressions }
            };
            
            setEmotionHistory((prev) => {
              const newHistory = [...prev, historyPoint];
              // Keep only data within the time window (15 seconds)
              const cutoffTime = timestamp - timeWindowMs;
              return newHistory.filter(point => point.timestamp >= cutoffTime);
            });
          }
        } catch (e) {
          console.warn('Detection error:', e);
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
    setEmotionHistory([]);
  }


  // Timeline Graph Component
  function TimelineGraph({ history, colors, width = 350, height = 140, timeWindowMs = 15000 }) {
    if (!history.length) return <div style={{ fontSize: 12, opacity: 0.5, textAlign: 'center', padding: 40 }}>No data yet</div>;

    const svgWidth = width;
    const svgHeight = height;
    const padding = 25;
    const graphWidth = svgWidth - padding * 2;
    const graphHeight = svgHeight - padding * 2;

    // Use current time as the right edge, show last 15 seconds
    const currentTime = performance.now();
    const minTime = currentTime - timeWindowMs;
    const maxTime = currentTime;

    return (
      <svg width={svgWidth} height={svgHeight} style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 12 }}>
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(y => (
          <line
            key={y}
            x1={padding}
            y1={padding + y * graphHeight}
            x2={svgWidth - padding}
            y2={padding + y * graphHeight}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
          />
        ))}
        
        {/* Vertical grid lines (time markers) */}
        {[0, 0.25, 0.5, 0.75, 1].map(x => (
          <line
            key={x}
            x1={padding + x * graphWidth}
            y1={padding}
            x2={padding + x * graphWidth}
            y2={svgHeight - padding}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1"
          />
        ))}
        
        {/* Emotion lines */}
        {EMOTIONS.map(emotion => {
          const points = history.map(point => {
            // Map timestamp to x position (time-based)
            const timeProgress = (point.timestamp - minTime) / timeWindowMs;
            const x = padding + Math.max(0, Math.min(1, timeProgress)) * graphWidth;
            const y = padding + (1 - (point.emotions[emotion.key] || 0)) * graphHeight;
            return `${x},${y}`;
          }).join(' ');

          return (
            <polyline
              key={emotion.key}
              points={points}
              fill="none"
              stroke={colors[emotion.key]}
              strokeWidth="2.5"
              opacity="0.9"
            />
          );
        })}
        
        {/* Y-axis labels */}
        <text x="8" y={padding + 5} fontSize="10" fill="rgba(255,255,255,0.7)">100%</text>
        <text x="8" y={padding + graphHeight * 0.5 + 3} fontSize="10" fill="rgba(255,255,255,0.7)">50%</text>
        <text x="8" y={svgHeight - padding + 5} fontSize="10" fill="rgba(255,255,255,0.7)">0%</text>
        
        {/* X-axis labels */}
        <text x={padding} y={svgHeight - 5} fontSize="9" fill="rgba(255,255,255,0.6)">-15s</text>
        <text x={svgWidth - padding - 15} y={svgHeight - 5} fontSize="9" fill="rgba(255,255,255,0.6)">now</text>
      </svg>
    );
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', gap: '2rem', flexWrap: 'wrap' }}>
        {/* Face-API Model Container */}
        <div
          style={{
            width: 'min(420px, 42vw)',
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
            <div style={{ textAlign: 'center', color: '#fff', padding: '0 8px' }}>
              <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: 0.2 }}>Face-API Expression Model</div>
              <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{status}</div>
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
                        borderRadius: 8,
                        padding: '6px 8px',
                        fontSize: 10,
                        fontWeight: 600,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        minWidth: 50,
                        minHeight: 60
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{EMOTIONS.find((e) => e.key === dominant.key)?.emoji}</span>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>{EMOTIONS.find((e) => e.key === dominant.key)?.label}</span>
                      <span style={{ fontSize: 12, opacity: 0.9 }}>{Math.round(dominant.score * 100)}%</span>
                    </div>
                  )}

                  {/* Overall dominant sentiment overlay - bottom right */}
                  {overallKey && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 12,
                        right: 12,
                        background: 'rgba(0,0,0,0.75)',
                        borderRadius: 8,
                        padding: '6px 8px',
                        fontSize: 10,
                        color: 'white',
                        fontWeight: 600,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        minWidth: 50,
                        minHeight: 60
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{EMOTIONS.find((e) => e.key === overallKey)?.emoji}</span>
                      <span style={{ fontSize: 12, opacity: 0.8 }}>{EMOTIONS.find((e) => e.key === overallKey)?.label}</span>
                      <span style={{ fontSize: 12, opacity: 0.9 }}>{formatDuration(emotionDurationsMs[overallKey] || 0)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline Graph frame with glass effect */}
              <div className="glassPanel" style={{ color: '#fff', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div className="glassContent" style={{ display: 'flex', flexDirection: 'column', padding: 8, height: '100%' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, opacity: 0.95, fontWeight: 700, letterSpacing: 0.3, textAlign: 'center' }}>Emotions Timeline</div>
                  </div>

                  {/* State Banner */}
                  {(
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.15)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: 8,
                          padding: '6px 12px',
                          textAlign: 'center'
                        }}
                      >
                        <div
                          style={{
                            color: '#fff',
                            fontSize: '12px',
                            fontWeight: '700',
                            letterSpacing: '0.3px'
                          }}
                        >
                          {currentState}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Timeline Graph */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <TimelineGraph history={emotionHistory} colors={emotionColors} width={350} height={140} timeWindowMs={timeWindowMs} />
                    
                    {/* Color Legend */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 8, maxWidth: 350 }}>
                      {EMOTIONS.map(emotion => (
                        <div key={emotion.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div 
                            style={{ 
                              width: 12, 
                              height: 3, 
                              backgroundColor: emotionColors[emotion.key],
                              borderRadius: 2
                            }} 
                          />
                          <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 500 }}>
                            {emotion.emoji} {emotion.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer buttons */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 6 }}>
                    <button
                      onClick={toggleRunning}
                      style={{ padding: '6px 10px', borderRadius: 8, background: '#111827', color: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', cursor: 'pointer', border: 'none', fontSize: 9 }}
                    >
                      {isRunning ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={resetSession}
                      style={{ padding: '6px 10px', borderRadius: 8, background: '#374151', color: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', cursor: 'pointer', border: 'none', fontSize: 9 }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            </div>
        </div>

      </div>
    </div>
  );
}


