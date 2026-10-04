'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import CentsNeedle from './cents-needle';
import { detectPitch, centsBetween, frequencyToNote, nearestIndex, median } from '@/lib/pitch';

interface Tuning {
  name: string;
  strings: { note: string; freq: number }[];
}

// Strings listed low to high (6th string first).
const TUNINGS: Record<string, Tuning> = {
  standard: {
    name: 'Standard',
    strings: [
      { note: 'E', freq: 82.41 },
      { note: 'A', freq: 110.0 },
      { note: 'D', freq: 146.83 },
      { note: 'G', freq: 196.0 },
      { note: 'B', freq: 246.94 },
      { note: 'E', freq: 329.63 },
    ],
  },
  halfstep: {
    name: 'Half Step Down',
    strings: [
      { note: 'D#', freq: 77.78 },
      { note: 'G#', freq: 103.83 },
      { note: 'C#', freq: 138.59 },
      { note: 'F#', freq: 185.0 },
      { note: 'A#', freq: 233.08 },
      { note: 'D#', freq: 311.13 },
    ],
  },
  dropD: {
    name: 'Drop D',
    strings: [
      { note: 'D', freq: 73.42 },
      { note: 'A', freq: 110.0 },
      { note: 'D', freq: 146.83 },
      { note: 'G', freq: 196.0 },
      { note: 'B', freq: 246.94 },
      { note: 'E', freq: 329.63 },
    ],
  },
  openG: {
    name: 'Open G',
    strings: [
      { note: 'D', freq: 73.42 },
      { note: 'G', freq: 98.0 },
      { note: 'D', freq: 146.83 },
      { note: 'G', freq: 196.0 },
      { note: 'B', freq: 246.94 },
      { note: 'D', freq: 293.66 },
    ],
  },
  dadgad: {
    name: 'DADGAD',
    strings: [
      { note: 'D', freq: 73.42 },
      { note: 'A', freq: 110.0 },
      { note: 'D', freq: 146.83 },
      { note: 'G', freq: 196.0 },
      { note: 'A', freq: 220.0 },
      { note: 'D', freq: 293.66 },
    ],
  },
};

const IN_TUNE_CENTS = 5;
const SMOOTHING_FRAMES = 7;
const HOLD_MS = 1200;

const CHIME_HOLD_MS = 500;
const CHIME_RESET_CENTS = 12;
const CHIME_DURATION_MS = 1300;

// Chime preference, remembered per device.
const chimeListeners = new Set<() => void>();
function subscribeChime(listener: () => void) {
  chimeListeners.add(listener);
  return () => chimeListeners.delete(listener);
}
function readChime() {
  try {
    return localStorage.getItem('chime') !== 'off';
  } catch {
    return true;
  }
}
function writeChime(on: boolean) {
  try {
    localStorage.setItem('chime', on ? 'on' : 'off');
  } catch {}
  chimeListeners.forEach(listener => listener());
}

// Soft bell, quiet enough not to swamp the guitar.
function playChime(ctx: AudioContext) {
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.18, t + 0.01);
  out.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
  out.connect(ctx.destination);
  for (const [freq, level] of [[1760, 1], [2637, 0.35], [3520, 0.12]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = level;
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1.2);
  }
}

export default function GuitarTuner() {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<number | null>(null);
  const [selectedTuning, setSelectedTuning] = useState('standard');
  const [autoDetect, setAutoDetect] = useState(true);
  const [manualString, setManualString] = useState(0);
  const [playingString, setPlayingString] = useState<number | null>(null);
  const chimeOn = useSyncExternalStore(subscribeChime, readChime, () => true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const inTuneSinceRef = useRef<number | null>(null);
  const chimedStringRef = useRef<string | null>(null);
  const chimeRingingUntilRef = useRef(0);

  const tuning = TUNINGS[selectedTuning];
  const targets = tuning.strings.map(s => s.freq);
  // In auto mode, follow the detected string and keep it selected when the sound stops.
  if (autoDetect && frequency) {
    const nearest = nearestIndex(frequency, targets);
    if (nearest !== manualString) setManualString(nearest);
  }
  const activeString = manualString;
  const target = tuning.strings[activeString];
  const cents = frequency ? centsBetween(frequency, target.freq) : null;
  const detected = frequency ? frequencyToNote(frequency) : null;
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  };

  const stopListening = () => {
    if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
    animationIdRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setIsListening(false);
    setFrequency(null);
  };

  const startListening = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;

      const audioContext = getAudioContext();
      await audioContext.resume();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(stream).connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      const recent: number[] = [];
      let lastHeard = 0;

      const detectLoop = () => {
        const now = performance.now();
        // The mic hears our own chime; hold the last reading until it fades.
        if (now < chimeRingingUntilRef.current) {
          lastHeard = now;
          animationIdRef.current = requestAnimationFrame(detectLoop);
          return;
        }
        analyser.getFloatTimeDomainData(buffer);
        const freq = detectPitch(buffer, audioContext.sampleRate);

        if (freq) {
          // Drop history when the pitch jumps (e.g. moving to another string).
          if (recent.length && Math.abs(centsBetween(freq, median(recent))) > 100) {
            recent.length = 0;
          }
          recent.push(freq);
          if (recent.length > SMOOTHING_FRAMES) recent.shift();
          lastHeard = now;
          setFrequency(median(recent));
        } else if (now - lastHeard > HOLD_MS) {
          recent.length = 0;
          setFrequency(null);
        }

        animationIdRef.current = requestAnimationFrame(detectLoop);
      };

      setIsListening(true);
      detectLoop();
    } catch (err) {
      console.error('Microphone access denied:', err);
      setError('Microphone access is required. Check your browser permissions and try again.');
    }
  };

  const stopTone = () => {
    oscillatorRef.current?.stop();
    oscillatorRef.current = null;
    setPlayingString(null);
  };

  const playTone = (idx: number) => {
    const wasPlaying = playingString === idx;
    stopTone();
    if (wasPlaying) return;

    const ctx = getAudioContext();
    ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = tuning.strings[idx].freq;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 2.5);
    osc.onended = () => {
      if (oscillatorRef.current === osc) {
        oscillatorRef.current = null;
        setPlayingString(null);
      }
    };
    oscillatorRef.current = osc;
    setPlayingString(idx);
  };

  useEffect(() => {
    return () => {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      streamRef.current?.getTracks().forEach(track => track.stop());
      audioContextRef.current?.close();
    };
  }, []);

  // Chime once when a string holds in tune. Re-arm only after drifting clearly
  // out of tune or switching strings, so re-plucking a tuned string stays quiet.
  useEffect(() => {
    const key = `${selectedTuning}:${activeString}`;
    if (chimedStringRef.current && chimedStringRef.current !== key) {
      chimedStringRef.current = null;
    }
    if (cents === null) {
      inTuneSinceRef.current = null;
      return;
    }
    if (Math.abs(cents) > CHIME_RESET_CENTS) chimedStringRef.current = null;
    if (Math.abs(cents) > IN_TUNE_CENTS) {
      inTuneSinceRef.current = null;
      return;
    }

    const now = performance.now();
    inTuneSinceRef.current ??= now;
    if (now - inTuneSinceRef.current >= CHIME_HOLD_MS && chimedStringRef.current !== key) {
      chimedStringRef.current = key;
      if (chimeOn && audioContextRef.current) {
        playChime(audioContextRef.current);
        chimeRingingUntilRef.current = now + CHIME_DURATION_MS;
      }
    }
  }, [cents, activeString, selectedTuning, chimeOn]);

  // Keep the screen awake while tuning. The browser drops the lock when the page
  // is hidden, so re-acquire it when the user comes back.
  useEffect(() => {
    if (!isListening || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (lock && !lock.released) return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) sentinel.release();
        else lock = sentinel;
      } catch {
        // Denied (e.g. low battery mode); tuning still works, the screen may just sleep.
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      lock?.release();
    };
  }, [isListening]);


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md app-enter">
        <div className="bg-slate-800/80 backdrop-blur rounded-3xl shadow-2xl p-6 sm:p-8 border border-purple-500/20">
          <h1 className="font-display text-5xl text-white text-center mb-2">Trootone</h1>
          <p className="text-slate-400 text-center mb-5">Precise tuning, anytime</p>

          <button
            onClick={isListening ? stopListening : startListening}
            className={`w-full py-4 mb-6 rounded-xl font-bold text-lg text-white transition transform hover:scale-[1.02] ${
              isListening ? 'bg-red-500/80 hover:bg-red-600' : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {isListening ? 'Stop Tuning' : 'Start Tuning'}
          </button>

          {error && (
            <p className="-mt-3 mb-6 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3">
              {error}
            </p>
          )}

          {/* Tuning select */}
          <label className="block text-xs uppercase tracking-wide text-slate-400 mb-2" htmlFor="tuning">
            Tuning
          </label>
          <select
            id="tuning"
            value={selectedTuning}
            onChange={e => {
              stopTone();
              setSelectedTuning(e.target.value);
              setManualString(0);
            }}
            className="w-full mb-6 rounded-lg bg-slate-700 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {Object.entries(TUNINGS).map(([key, t]) => (
              <option key={key} value={key}>
                {t.name} ({t.strings.map(s => s.note).join(' ')})
              </option>
            ))}
          </select>

          {/* String selector */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">String</span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={chimeOn}
                  onChange={e => {
                    writeChime(e.target.checked);
                  }}
                  className="accent-purple-500"
                />
                Chime
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDetect}
                  onChange={e => setAutoDetect(e.target.checked)}
                  className="accent-purple-500"
                />
                Auto-detect
              </label>
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2 mb-2">
            {tuning.strings.map((s, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setAutoDetect(false);
                  setManualString(idx);
                }}
                aria-pressed={activeString === idx}
                className={`py-3 rounded-lg font-bold transition ${
                  activeString === idx
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {s.note}
                <span className="block text-[10px] font-normal opacity-60">{6 - idx}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-6 gap-2 mb-6">
            {tuning.strings.map((s, idx) => (
              <button
                key={idx}
                onClick={() => playTone(idx)}
                title={`Play reference ${s.note} (${s.freq.toFixed(2)} Hz)`}
                aria-label={`Play reference tone for string ${6 - idx}`}
                className={`py-1 rounded-md text-xs transition ${
                  playingString === idx
                    ? 'bg-purple-500/40 text-white'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600'
                }`}
              >
                {playingString === idx ? '■' : '▶'}
              </button>
            ))}
          </div>

          {/* Display */}
          <div className="bg-slate-900 rounded-2xl p-6 mb-6 text-center">
            <p className="text-slate-400 text-sm">Target</p>
            <p className="text-5xl font-bold text-purple-400">
              {target.note}
              <span className="text-lg text-slate-500 ml-1">{frequencyToNote(target.freq).octave}</span>
            </p>
            <p className="text-slate-500 text-sm mb-6">{target.freq.toFixed(2)} Hz</p>

            {/* Cents meter */}
            <div className="relative h-14 mb-2" aria-hidden>
              <div className="absolute inset-x-0 top-1/2 h-px bg-slate-700" />
              <div
                className="absolute top-0 bottom-0 bg-green-500/15 rounded"
                style={{ left: `${50 - IN_TUNE_CENTS}%`, width: `${IN_TUNE_CENTS * 2}%` }}
              />
              {[-50, -25, 0, 25, 50].map(t => (
                <div
                  key={t}
                  className={`absolute top-1/2 -translate-y-1/2 w-px ${t === 0 ? 'h-10 bg-slate-400' : 'h-4 bg-slate-600'}`}
                  style={{ left: `${50 + t}%` }}
                />
              ))}
              <CentsNeedle
                cents={cents}
                className={cents === null ? 'bg-slate-600' : inTune ? 'bg-green-400' : 'bg-red-400'}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mb-4">
              <span>-50¢</span>
              <span>0</span>
              <span>+50¢</span>
            </div>

            <p
              className={`text-lg font-semibold h-7 ${
                cents === null ? 'text-slate-500' : inTune ? 'text-green-400' : 'text-yellow-400'
              }`}
              role="status"
            >
              {!isListening
                ? 'Press start and play a string'
                : cents === null
                  ? 'Listening…'
                  : inTune
                    ? '✓ In tune'
                    : cents < 0
                      ? `♭ Tune up · ${Math.abs(cents).toFixed(0)}¢ flat`
                      : `♯ Tune down · ${cents.toFixed(0)}¢ sharp`}
            </p>
            <p className="text-xs text-slate-500 h-4 mt-1">
              {detected && frequency
                ? `Hearing ${detected.name}${detected.octave} · ${frequency.toFixed(1)} Hz`
                : ''}
            </p>
          </div>

          <p className="text-center text-xs text-slate-500 mt-6">
            Allow microphone access · Pluck one string at a time
          </p>
        </div>
      </div>
    </div>
  );
}
