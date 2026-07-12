// engine.js — OSCILLARIUM shared audio core.
// One AudioContext for the whole app. Each module asks for a channel with
// Engine.createChannel() and builds its own node graph behind it. The master
// chain is  channels → master gain → limiter → speakers, with per-ear
// analysers tapped after the limiter for the visualizations.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const Engine = {
  ctx: null,
  master: null,
  limiter: null,
  analyserL: null,
  analyserR: null,
  _readyCbs: [],
  _stopCbs: [],

  get ready() { return !!this.ctx; },

  // Idempotent; must be called from a user gesture the first time.
  init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.15;

    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    for (const a of [this.analyserL, this.analyserR]) {
      a.fftSize = 4096;
      a.smoothingTimeConstant = 0.8;
    }
    const split = ctx.createChannelSplitter(2);

    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    this.limiter.connect(split);
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);

    this._readyCbs.splice(0).forEach((cb) => cb());
  },

  onReady(cb) { this.ctx ? cb() : this._readyCbs.push(cb); },

  // A module's output bus. Only call after init (inside onReady or a gesture).
  createChannel(gain = 0.7) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.master);
    return g;
  },

  now() { return this.ctx ? this.ctx.currentTime : 0; },

  setMasterVolume(v) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.now(), 0.03);
  },

  // Modules register how to shut themselves off (audio AND their power UI).
  onStopAll(cb) { this._stopCbs.push(cb); },
  stopAll() {
    this._stopCbs.forEach((cb) => { try { cb(); } catch (err) { console.error(err); } });
  },

  // Tiny event bus for cross-module wiring (drum-machine bars, progressions).
  _events: Object.create(null),
  on(name, cb) { (this._events[name] = this._events[name] || []).push(cb); },
  emit(name, data) {
    (this._events[name] || []).forEach((cb) => { try { cb(data); } catch (err) { console.error(err); } });
  },
};

// ---- transport -----------------------------------------------------------------
// The drum machine drives this while it runs (driver = 'drums', bpm kept current,
// Engine.emit('bar', { time, secsPerBar }) at every scheduled bar start). Anything
// musical that wants to stay on the grid — e.g. the drone's chord progression —
// follows those bar events, and falls back to its own clock when driver is null.
export const Transport = { bpm: 100, driver: null };

// ---- music math -------------------------------------------------------------

export function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

// "A4", or "A4 +12¢" when between keys.
export function noteLabel(freq) {
  if (!(freq > 0)) return '—';
  const m = freqToMidi(freq);
  const n = Math.round(m);
  const cents = Math.round((m - n) * 100);
  const name = NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  return cents === 0 ? name : `${name} ${cents > 0 ? '+' : ''}${cents}¢`;
}

export function centsBetween(f1, f2) { return 1200 * Math.log2(f2 / f1); }

const INTERVAL_NAMES = {
  '1:1': 'unison', '2:1': 'octave', '3:2': 'perfect fifth', '4:3': 'perfect fourth',
  '5:4': 'just major third', '6:5': 'just minor third', '5:3': 'just major sixth',
  '8:5': 'just minor sixth', '9:8': 'major whole tone', '10:9': 'minor whole tone',
  '16:15': 'just semitone', '15:8': 'just major seventh', '9:5': 'just minor seventh',
  '7:6': 'septimal minor third', '7:5': 'septimal tritone', '7:4': 'harmonic seventh',
  '8:7': 'septimal whole tone', '9:7': 'septimal major third', '11:8': 'undecimal tritone',
  '3:1': 'octave + fifth', '4:1': 'double octave', '5:2': 'octave + major third',
};

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

// Name of an integer ratio, e.g. ratioName(7, 6) → "septimal minor third".
// Returns null for ratios without a common name (caller shows cents instead).
export function ratioName(a, b) {
  if (!a || !b) return null;
  const ra = Math.round(a), rb = Math.round(b);
  if (Math.abs(a - ra) > 1e-9 || Math.abs(b - rb) > 1e-9) return null;
  const g = gcd(Math.max(ra, rb), Math.min(ra, rb));
  const hi = Math.max(ra, rb) / g, lo = Math.min(ra, rb) / g;
  return INTERVAL_NAMES[`${hi}:${lo}`] || null;
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---- lookahead clock ----------------------------------------------------------
// Rock-solid scheduling for rhythm modules. onTick(horizon) fires every
// `interval` ms; the module schedules all of its audio events whose time is
// <= horizon (seconds on the audio clock), keeping its own next-event cursors.

export class Clock {
  constructor(onTick, interval = 25, ahead = 0.12) {
    this.onTick = onTick;
    this.interval = interval;
    this.ahead = ahead;
    this._base = { interval, ahead };
    this._t = null;
    this._onVis = null;
  }
  get running() { return this._t !== null; }
  start() {
    if (this._t !== null) return;
    const tick = () => this.onTick(Engine.now() + this.ahead);
    // Hidden tabs clamp setInterval (Safari: ≥ 1 s), which starves a short
    // lookahead — widen the window while hidden, restore it when visible.
    const retune = () => {
      this.interval = document.hidden ? 250 : this._base.interval;
      this.ahead = document.hidden ? 1.5 : this._base.ahead;
    };
    this._onVis = () => {
      retune();
      clearInterval(this._t);
      if (document.hidden) tick(); // fill the wide window before throttling bites
      this._t = setInterval(tick, this.interval);
    };
    document.addEventListener('visibilitychange', this._onVis);
    retune();
    tick();
    this._t = setInterval(tick, this.interval);
  }
  stop() {
    if (this._t !== null) clearInterval(this._t);
    this._t = null;
    if (this._onVis) {
      document.removeEventListener('visibilitychange', this._onVis);
      this._onVis = null;
    }
  }
}
