export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const A4 = 440;
const MIN_FREQ = 60;
const MAX_FREQ = 1200;
const MIN_RMS = 0.01;
const MIN_CLARITY = 0.9;

/**
 * Estimates the fundamental frequency of a time-domain buffer using
 * normalized autocorrelation with parabolic interpolation.
 * Returns null for silence or signals without a clear pitch.
 */
export function detectPitch(buffer: Float32Array, sampleRate: number): number | null {
  const n = buffer.length;

  let rms = 0;
  for (let i = 0; i < n; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / n);
  if (rms < MIN_RMS) return null;

  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const maxLag = Math.min(Math.ceil(sampleRate / MIN_FREQ), Math.floor(n / 2));

  // Normalized square difference function (McLeod): values in [-1, 1],
  // 1 meaning a perfect repeat at that lag.
  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let acf = 0;
    let energy = 0;
    for (let i = 0; i < n - lag; i++) {
      acf += buffer[i] * buffer[i + lag];
      energy += buffer[i] * buffer[i] + buffer[i + lag] * buffer[i + lag];
    }
    nsdf[lag] = energy > 0 ? (2 * acf) / energy : 0;
  }

  // Collect the highest peak in each positive region, then take the first
  // one that is close to the global best. This avoids octave errors from
  // picking a later (sub-harmonic) peak.
  const peaks: number[] = [];
  let lag = minLag;
  while (lag <= maxLag && nsdf[lag] > 0) lag++;
  while (lag <= maxLag) {
    while (lag <= maxLag && nsdf[lag] <= 0) lag++;
    let best = -1;
    while (lag <= maxLag && nsdf[lag] > 0) {
      if (best < 0 || nsdf[lag] > nsdf[best]) best = lag;
      lag++;
    }
    if (best >= 0) peaks.push(best);
  }
  if (peaks.length === 0) return null;

  const highest = Math.max(...peaks.map(p => nsdf[p]));
  if (highest < MIN_CLARITY) return null;
  const chosen = peaks.find(p => nsdf[p] >= 0.93 * highest)!;

  const prev = nsdf[chosen - 1] ?? nsdf[chosen];
  const next = nsdf[chosen + 1] ?? nsdf[chosen];
  const denom = prev - 2 * nsdf[chosen] + next;
  const shift = denom !== 0 ? (0.5 * (prev - next)) / denom : 0;

  return sampleRate / (chosen + shift);
}

export function centsBetween(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target);
}

/** Nearest equal-tempered note to a frequency. */
export function frequencyToNote(freq: number): { name: string; octave: number; cents: number } {
  const midi = 69 + 12 * Math.log2(freq / A4);
  const rounded = Math.round(midi);
  return {
    name: NOTE_NAMES[((rounded % 12) + 12) % 12],
    octave: Math.floor(rounded / 12) - 1,
    cents: (midi - rounded) * 100,
  };
}

/** Index of the target frequency closest (in cents) to the detected one. */
export function nearestIndex(freq: number, targets: number[]): number {
  let best = 0;
  for (let i = 1; i < targets.length; i++) {
    if (Math.abs(centsBetween(freq, targets[i])) < Math.abs(centsBetween(freq, targets[best]))) {
      best = i;
    }
  }
  return best;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
