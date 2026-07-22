// pitch.js — shared monophonic pitch detection (RIG tuner, DOJO scoring).
// Unbiased autocorrelation with a first-peak octave guard and parabolic
// refinement. ~1.5 ms per call on a 2048 window — safe to run at 15 Hz.
//
// Known biases (measured): raw (biased) autocorrelation reads sharp because
// the summation window shrinks with lag; unbiased normalization fixes that
// but makes period MULTIPLES win (octave-down errors) — hence the
// smallest-peak-within-10%-of-best pick.

export function createPitchDetector(analyser, { fMin = 55, fMax = 1000, rmsGate = 0.004 } = {}) {
  const buf = new Float32Array(analyser.fftSize);
  return {
    detect(sampleRate) {
      analyser.getFloatTimeDomainData(buf);
      const SIZE = buf.length;
      let rms = 0;
      for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / SIZE);
      if (rms < rmsGate) return -1;

      const maxLag = Math.min(Math.floor(sampleRate / fMin), SIZE >> 1);
      const minLag = Math.max(2, Math.floor(sampleRate / fMax));
      const c = new Float32Array(maxLag + 2);
      for (let lag = 0; lag <= maxLag + 1; lag++) {
        let sum = 0;
        for (let i = 0; i < SIZE - lag; i++) sum += buf[i] * buf[i + lag];
        c[lag] = sum / (SIZE - lag); // unbiased — the raw sum tapers with lag and reads sharp
      }

      let lag0 = minLag;
      while (lag0 < maxLag && c[lag0] > c[lag0 + 1]) lag0++; // walk off the zero-lag peak
      let bestLag = -1, best = -Infinity;
      for (let lag = lag0; lag <= maxLag; lag++) {
        if (c[lag] > best) { best = c[lag]; bestLag = lag; }
      }
      if (bestLag <= 0 || best < 0.3 * c[0]) return -1; // weak periodicity — noise, not a note

      // The global max often sits on a period MULTIPLE (octave-down error) —
      // take the smallest local peak within 10% of it instead.
      let pick = bestLag;
      for (let lag = lag0 + 1; lag < bestLag; lag++) {
        if (c[lag] >= c[lag - 1] && c[lag] >= c[lag + 1] && c[lag] >= 0.9 * best) { pick = lag; break; }
      }
      const y1 = c[pick - 1], y2 = c[pick], y3 = c[pick + 1];
      const denom = 2 * (2 * y2 - y1 - y3);
      const shift = denom ? (y3 - y1) / denom : 0;
      return sampleRate / (pick + shift);
    },
  };
}

export const midiFromFreq = (f) => 69 + 12 * Math.log2(f / 440);
