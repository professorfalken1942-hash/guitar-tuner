'use client';

import { useState, useEffect, useRef } from 'react';

interface Tuning {
  name: string;
  frequencies: { note: string; freq: number }[];
}

const TUNINGS: Record<string, Tuning> = {
  standard: {
    name: 'Standard',
    frequencies: [
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
    frequencies: [
      { note: 'D#', freq: 77.78 },
      { note: 'G#', freq: 103.83 },
      { note: 'C#', freq: 138.59 },
      { note: 'F#', freq: 184.99 },
      { note: 'A#', freq: 233.08 },
      { note: 'D#', freq: 311.13 },
    ],
  },
  openG: {
    name: 'Open G',
    frequencies: [
      { note: 'D', freq: 73.42 },
      { note: 'G', freq: 98.0 },
      { note: 'D', freq: 146.83 },
      { note: 'G', freq: 196.0 },
      { note: 'B', freq: 246.94 },
      { note: 'D', freq: 293.66 },
    ],
  },
};

export default function GuitarTuner() {
  const [isListening, setIsListening] = useState(false);
  const [frequency, setFrequency] = useState<number | null>(null);
  const [note, setNote] = useState<string>('');
  const [inTune, setInTune] = useState<'flat' | 'sharp' | 'in-tune' | null>(null);
  const [selectedTuning, setSelectedTuning] = useState('standard');
  const [string, setString] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationIdRef = useRef<number | null>(null);

  const getCurrentTuning = () => TUNINGS[selectedTuning];
  const targetFreq = getCurrentTuning().frequencies[string].freq;
  const targetNote = getCurrentTuning().frequencies[string].note;

  useEffect(() => {
    return () => {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (isListening) stopListening();
    };
  }, []);

  const detectPitch = (buffer: any) => {
    let maxBin = 0;
    let maxMagnitude = 0;

    for (let i = 1; i < buffer.length / 2; i++) {
      if (buffer[i] > maxMagnitude) {
        maxMagnitude = buffer[i];
        maxBin = i;
      }
    }

    if (maxMagnitude < 30) return null;

    const freq = (maxBin * 44100) / buffer.length;
    return freq > 40 && freq < 400 ? freq : null;
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      dataArrayRef.current = dataArray;

      setIsListening(true);

      const detectLoop = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        const freq = detectPitch(dataArrayRef.current);
        if (freq) {
          setFrequency(freq);

          const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
          const semitone = 12 * Math.log2(freq / 16.35);
          const semitoneRounded = Math.round(semitone);
          const detectedNote = noteNames[semitoneRounded % 12];
          setNote(detectedNote);

          const cents = 1200 * Math.log2(freq / targetFreq);
          if (Math.abs(cents) < 10) {
            setInTune('in-tune');
          } else if (cents < -10) {
            setInTune('flat');
          } else {
            setInTune('sharp');
          }
        }

        animationIdRef.current = requestAnimationFrame(detectLoop);
      };

      detectLoop();
    } catch (err) {
      console.error('Microphone access denied:', err);
      alert('Microphone access required.');
    }
  };

  const stopListening = () => {
    if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsListening(false);
    setFrequency(null);
    setNote('');
    setInTune(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-800/80 backdrop-blur rounded-3xl shadow-2xl p-8 border border-purple-500/20">
          {/* Header */}
          <h1 className="text-3xl font-bold text-white text-center mb-2">Guitar Tuner</h1>
          <p className="text-slate-400 text-center mb-8">Precise tuning, anytime</p>

          {/* Tuning Select */}
          <div className="grid grid-cols-3 gap-2 mb-8">
            {Object.entries(TUNINGS).map(([key, tuning]) => (
              <button
                key={key}
                onClick={() => {
                  setSelectedTuning(key);
                  setString(0);
                }}
                className={`py-2 rounded-lg text-sm font-medium transition ${
                  selectedTuning === key
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {tuning.name}
              </button>
            ))}
          </div>

          {/* String Selector */}
          <div className="grid grid-cols-6 gap-2 mb-8">
            {getCurrentTuning().frequencies.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setString(idx)}
                className={`py-3 rounded-lg font-bold transition ${
                  string === idx
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>

          {/* Display */}
          <div className="bg-slate-900 rounded-2xl p-8 mb-8 text-center">
            <p className="text-slate-400 text-sm mb-4">Target Note</p>
            <p className="text-5xl font-bold text-purple-400 mb-4">{targetNote}</p>
            <p className="text-slate-400 text-sm mb-4">{targetFreq.toFixed(2)} Hz</p>

            {isListening && frequency && (
              <>
                <p className="text-slate-400 text-sm mb-2">Detected</p>
                <p className={`text-3xl font-bold ${note === targetNote ? 'text-green-400' : 'text-yellow-400'} mb-4`}>
                  {note || '---'} ({frequency.toFixed(1)} Hz)
                </p>

                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mb-4">
                  <div
                    className={`h-full transition-all ${
                      inTune === 'in-tune' ? 'bg-green-500 w-full' : inTune === 'flat' ? 'bg-red-500 w-1/3' : 'bg-red-500 w-2/3'
                    }`}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  {inTune === 'in-tune' ? '✓ In Tune' : inTune === 'flat' ? '← Too Flat' : 'Too Sharp →'}
                </p>
              </>
            )}
          </div>

          {/* Button */}
          <button
            onClick={isListening ? stopListening : startListening}
            className={`w-full py-4 rounded-xl font-bold text-lg transition transform hover:scale-105 ${
              isListening
                ? 'bg-red-500/80 hover:bg-red-600 text-white'
                : 'bg-purple-600 hover:bg-purple-700 text-white'
            }`}
          >
            {isListening ? '🎙️ Stop Tuning' : '🎙️ Start Tuning'}
          </button>

          {/* Info */}
          <p className="text-center text-xs text-slate-500 mt-6">
            Allow microphone access • Point mic at instrument
          </p>
        </div>
      </div>
    </div>
  );
}
