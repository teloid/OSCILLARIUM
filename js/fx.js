// fx.js — OSCILLARIUM RIG effects library. Pure Web Audio DSP: no DOM, no UI,
// no worklets, zero deps — runs off any static file server.
// Every factory: createX(ctx) => ({ input, output, set(partial), dispose() }).
// input/output are stable GainNodes; the rig wires chains and bypass routing
// around them and never rewires the internals. Wet/dry mix is equal-power and
// lives INSIDE each effect, so the rig's bypass stays a hard route-around.

// ---- shared plumbing ---------------------------------------------------------

const HOT = 0.03; // default setTargetAtTime tau for audibly-hot params

// Clamp with a NaN net: junk input keeps the previous value instead of
// poisoning an AudioParam.
function num(v, lo, hi, fallback) {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function gainOf(ctx, v) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

function edges(ctx) {
  return { input: ctx.createGain(), output: ctx.createGain() };
}

// Equal-power dry/wet pair: dry = cos(mix·π/2), wet = sin(mix·π/2).
// Effects pour their wet chain into `.wet`.
function makeMix(ctx, input, output, mix) {
  const dry = gainOf(ctx, Math.cos((mix * Math.PI) / 2));
  const wet = gainOf(ctx, Math.sin((mix * Math.PI) / 2));
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return {
    dry,
    wet,
    set(m) {
      const t = ctx.currentTime;
      dry.gain.setTargetAtTime(Math.cos((m * Math.PI) / 2), t, HOT);
      wet.gain.setTargetAtTime(Math.sin((m * Math.PI) / 2), t, HOT);
    },
  };
}

function unplug(nodes) {
  for (const n of nodes) { try { n.disconnect(); } catch {} }
}

function silence(sources) {
  for (const s of sources) { try { s.stop(); } catch {} }
}

// ---- gate ----------------------------------------------------------------------
// Envelope-follower noise gate. An AnalyserNode is the RMS tap and a 30 ms JS
// loop drives one gain — crude, but worklet-free and fast enough for palm-muted
// chug (open tau 4 ms). Only reschedules on a state FLIP, so the param timeline
// stays clean.

export function createGate(ctx) {
  const { input, output } = edges(ctx);
  const p = { threshold: 0.01, release: 0.12 };

  const gate = gainOf(ctx, 1); // starts open — first tick decides
  const tap = ctx.createAnalyser();
  tap.fftSize = 1024; // ~23 ms RMS window at 44.1k
  input.connect(tap);
  input.connect(gate);
  gate.connect(output);

  const buf = new Float32Array(tap.fftSize);
  let open = true;
  // Hidden tabs throttle setInterval to ~1 s while audio keeps rendering — a
  // laggy follower chops notes, so park the gate open until the tab is back.
  const onVis = () => {
    if (document.hidden) {
      open = true;
      gate.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
    }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    tap.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // Hysteresis: close 3 dB under the open point so the edge never chatters.
    const want = p.threshold <= 0 || rms > (open ? p.threshold * 0.7 : p.threshold);
    if (want !== open) {
      open = want;
      gate.gain.setTargetAtTime(want ? 1 : 0, ctx.currentTime, want ? 0.004 : p.release);
    }
  }, 30);

  let dead = false;
  return {
    input,
    output,
    set(patch = {}) {
      if ('threshold' in patch) p.threshold = num(patch.threshold, 0, 0.15, p.threshold);
      if ('release' in patch) p.release = num(patch.release, 0.02, 0.5, p.release);
    },
    dispose() {
      if (dead) return;
      dead = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      unplug([input, tap, gate, output]);
    },
  };
}

// ---- sustainer -----------------------------------------------------------------
// A compressor leaning hard enough to hold notes up, with makeup gain riding the
// same knob so `amount` buys sustain, not volume. Fast attack + soft knee keeps
// the front of the pick intact — clarity, not squash.

export function createSustainer(ctx) {
  const { input, output } = edges(ctx);
  const p = { amount: 0.5 };

  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 10;
  comp.attack.value = 0.004;
  const makeup = gainOf(ctx, 1);
  input.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  function tune(a, ramp) {
    const t = ctx.currentTime;
    const vals = [
      [comp.threshold, -18 - 24 * a], // −18 → −42 dB
      [comp.ratio, 3 + 11 * a],       // 3 → 14
      [comp.release, 0.28 - 0.16 * a],
      [makeup.gain, 1 + 2.2 * a],     // 1 → ~3.2 loudness compensation
    ];
    for (const [param, v] of vals) {
      if (ramp) param.setTargetAtTime(v, t, HOT);
      else param.value = v;
    }
  }
  tune(p.amount, false);

  return {
    input,
    output,
    set(patch = {}) {
      if ('amount' in patch) {
        p.amount = num(patch.amount, 0, 1, p.amount);
        tune(p.amount, true);
      }
    },
    dispose() {
      unplug([input, comp, makeup, output]);
    },
  };
}

// ---- drive ---------------------------------------------------------------------
// pre EQ (metal voicing, neutral otherwise) → pre-gain → WaveShaper (4x
// oversampled) → DC-block highpass → tone lowpass → post-gain → mix. Post-gain
// roughly inverts the loudness the pre-gain+curve added (measured on a nominal
// pick), so the amount knob adds dirt, not volume.

// Transfer curves; k grows with amount. All moderate on purpose — the brief is
// distortion FOR SUSTAIN, parallel-mixable, never a rectifier wall.
const SHAPERS = {
  warm: (a) => {
    const k = 1.5 + 4.5 * a;
    return (x) => Math.tanh(k * x);
  },
  // Asymmetric clip = even harmonics = "tube".
  tube: (a) => {
    const k = 1.5 + 4.5 * a;
    return (x) => Math.tanh((x >= 0 ? k : 0.7 * k) * x);
  },
  // Rational hard knee, pushed toward square as k grows.
  fuzz: (a) => {
    const k = 2 + 28 * a;
    return (x) => (x / (1 + Math.abs(k * x))) * (1 + 0.15 * k);
  },
  // Full-wave fold: even in x, so the octave-up rings out (octavia). The DC it
  // carries comes out in the 90 Hz highpass after the shaper.
  octave: (a) => {
    const k = 2 + 8 * a;
    return (x) => Math.tanh(k * (2 * x * x - 0.6));
  },
  // The deliberate exception to "moderate": two cascaded tanh stages folded
  // into one table — the first stage's ceiling feeds the second's knee, a hard,
  // compressed, modern high-gain sound. Odd-symmetric, so f(0) = 0 and the RMS
  // + full-scale probes below see it like any other table.
  metal: (a) => {
    const g1 = 3 + 14 * a;
    const g2 = 1.8 + 6 * a;
    return (x) => Math.tanh(g2 * Math.tanh(g1 * x));
  },
};

export function createDrive(ctx) {
  const { input, output } = edges(ctx);
  const p = { curve: 'warm', amount: 0.35, tone: 4500, mix: 1 };
  const mix = makeMix(ctx, input, output, p.mix);

  // Metal shapes AROUND the shaper too: a tightness highpass kills flub before
  // the gain stages see it, and the 740 Hz hump is the tube-screamer push.
  // Both stay in-line for every curve — parked at neutral (10 Hz HP, 0 dB
  // peak) they're audibly transparent, and ramping values beats rerouting:
  // no clicks on curve switch.
  const preHP = ctx.createBiquadFilter();
  preHP.type = 'highpass';
  preHP.frequency.value = 10;
  preHP.Q.value = 0.707;
  const preMid = ctx.createBiquadFilter();
  preMid.type = 'peaking';
  preMid.frequency.value = 740;
  preMid.Q.value = 0.9;
  preMid.gain.value = 0;
  const preG = gainOf(ctx, 1);
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const dcHP = ctx.createBiquadFilter();
  dcHP.type = 'highpass';
  dcHP.Q.value = 0.707;
  const toneLP = ctx.createBiquadFilter();
  toneLP.type = 'lowpass';
  toneLP.Q.value = 0.707;
  const postG = gainOf(ctx, 1);
  input.connect(preHP);
  preHP.connect(preMid);
  preMid.connect(preG);
  preG.connect(shaper);
  shaper.connect(dcHP);
  dcHP.connect(toneLP);
  toneLP.connect(postG);
  postG.connect(mix.wet);

  // Filters only — tone drags must never touch the WaveShaper curve, or every
  // input event steps the transfer mid-note and crackles.
  function retuneFilters(ramp) {
    // Drive opens the tone a touch — more dirt needs more air to stay clear.
    const toneHz = Math.min(14000, p.tone * (1 + 0.5 * p.amount));
    const hpHz = p.curve === 'octave' ? 90 : 25;
    // Metal's pre-voicing engages here; every other curve parks the same
    // filters at neutral, so switching to/from metal only ramps params.
    const metal = p.curve === 'metal';
    const preHz = metal ? 90 : 10;
    const midDb = metal ? 5.5 : 0;
    const t = ctx.currentTime;
    if (ramp) {
      toneLP.frequency.setTargetAtTime(toneHz, t, HOT);
      dcHP.frequency.setTargetAtTime(hpHz, t, HOT);
      preHP.frequency.setTargetAtTime(preHz, t, HOT);
      preMid.gain.setTargetAtTime(midDb, t, HOT);
    } else {
      toneLP.frequency.value = toneHz;
      dcHP.frequency.value = hpHz;
      preHP.frequency.value = preHz;
      preMid.gain.value = midDb;
    }
  }

  function retune(ramp) {
    const a = p.amount;
    const f = SHAPERS[p.curve](a);
    const n = 1024;
    const table = new Float32Array(n);
    const f0 = f(0); // recentre so idle input is exactly silent
    for (let i = 0; i < n; i++) table[i] = f((i / (n - 1)) * 2 - 1) - f0;
    shaper.curve = table;

    const pre = 1 + 29 * a;
    // Measure the chain's gain on a 0.35-amplitude sine and invert it.
    const N = 128;
    const ys = new Float32Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) {
      const s = 0.35 * Math.sin((2 * Math.PI * i) / N);
      ys[i] = f(Math.min(1, Math.max(-1, pre * s)));
      mean += ys[i] / N;
    }
    let sq = 0;
    for (let i = 0; i < N; i++) sq += (ys[i] - mean) * (ys[i] - mean);
    let post = Math.min(6, Math.max(0.05, 0.247 / Math.max(Math.sqrt(sq / N), 1e-4)));
    // The RMS probe can sit in a curve's flat trough (octave at low amount)
    // while a full-scale pick peaks way above it — cap post so a 1.0 pick
    // stays under the master limiter's ceiling.
    let peakFS = 0;
    for (let i = 0; i < N; i++) {
      const s = Math.sin((2 * Math.PI * i) / N);
      peakFS = Math.max(peakFS, Math.abs(f(Math.min(1, Math.max(-1, pre * s))) - f0));
    }
    post = Math.min(post, 0.9 / Math.max(peakFS, 1e-4));

    const t = ctx.currentTime;
    if (ramp) {
      preG.gain.setTargetAtTime(pre, t, HOT);
      postG.gain.setTargetAtTime(post, t, HOT);
    } else {
      preG.gain.value = pre;
      postG.gain.value = post;
    }
    retuneFilters(ramp);
  }
  retune(false);

  // Curve rebuilds throttle to ~30 Hz: a slider drag fires dozens of input
  // events a second, and each shaper.curve swap steps the transfer audibly.
  let curveTimer = 0;
  function scheduleRetune() {
    if (curveTimer) return; // the pending rebuild reads the latest p — trailing wins
    curveTimer = setTimeout(() => {
      curveTimer = 0;
      retune(true);
    }, 33);
  }

  return {
    input,
    output,
    set(patch = {}) {
      let curveDirty = false;
      let toneDirty = false;
      if ('curve' in patch && Object.hasOwn(SHAPERS, patch.curve) && patch.curve !== p.curve) {
        p.curve = patch.curve;
        curveDirty = true;
      }
      if ('amount' in patch) {
        const v = num(patch.amount, 0, 1, p.amount);
        if (v !== p.amount) { p.amount = v; curveDirty = true; }
      }
      if ('tone' in patch) {
        const v = num(patch.tone, 500, 12000, p.tone);
        if (v !== p.tone) { p.tone = v; toneDirty = true; }
      }
      if (curveDirty) scheduleRetune(); // full rebuild covers the filters too
      else if (toneDirty) retuneFilters(true);
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
    },
    dispose() {
      clearTimeout(curveTimer);
      unplug([input, preHP, preMid, preG, shaper, dcHP, toneLP, postG, mix.dry, mix.wet, output]);
    },
  };
}

// ---- cab -----------------------------------------------------------------------
// Speaker cabinet emulation: tightness highpass → ConvolverNode with a
// generated stereo IR. IRs are synthesized right here in JS (no
// OfflineAudioContext): a seeded exponentially-decaying noise burst,
// spectrally carved by cascaded RBJ biquads run as difference equations over
// the samples. L/R get different noise seeds under identical filtering —
// decorrelated tails re-widen the mono-folded feed. Full-wet by design (no
// mix): a cab is a speaker, not a flavor; the rig's pedal bypass is the off
// switch.

// Deterministic PRNG (mulberry32): seeded noise keeps IRs reproducible —
// and provably NaN-free — across loads.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One RBJ cookbook biquad (direct form I) run in place over a Float32Array.
function applyBiquad(buf, sr, type, f, q, gainDb = 0) {
  f = Math.min(Math.max(f, 1), sr * 0.45); // keep w0 off Nyquist — stability
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f) / sr;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 1e-3));
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else { // peaking
    b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    buf[i] = y0;
  }
}

// Voicing cascades, applied in order: [type, Hz, Q, dB, stages]. `trim` rides
// on top of unit-energy normalization (the reverb convention: white in →
// ~unity RMS out) so each voicing lands roughly unity-loudness on program
// material — measured by convolving against a distorted 110 Hz harmonic-series
// probe. Bright cabs (glass) shed low-mid program energy and trim up; scooped
// warm cabs concentrate it and trim down.
const CAB_SPECS = {
  modern412: { seconds: 0.045, trim: 0.9, cascade: [
    ['highpass', 75, 0.707, 0, 2],
    ['peaking', 105, 1.2, 4],       // thump
    ['peaking', 550, 1.0, -4],      // scoop
    ['peaking', 2700, 1.1, 5],      // attack
    ['lowpass', 5200, 0.707, 0, 4], // steep fizz kill
  ] },
  vintage412: { seconds: 0.055, trim: 0.7, cascade: [
    ['highpass', 65, 0.707, 0, 2],
    ['peaking', 95, 1.1, 3],
    ['peaking', 1400, 0.8, 2],      // warm mids
    ['peaking', 2200, 1.0, 3],
    ['lowpass', 4200, 0.707, 0, 4],
  ] },
  glass212: { seconds: 0.035, trim: 1.4, cascade: [
    ['highpass', 80, 0.707, 0, 2],
    ['peaking', 120, 1.0, 2],
    ['peaking', 3400, 1.0, 4],      // sparkle
    ['lowpass', 6500, 0.707, 0, 3],
  ] },
  // A practice amp in a closet.
  lofi108: { seconds: 0.025, trim: 1.05, cascade: [
    ['highpass', 180, 0.707, 0, 2],
    ['peaking', 800, 1.4, 5],       // honk
    ['lowpass', 2800, 0.707, 0, 4],
  ] },
};

function makeCabIR(ctx, spec) {
  const rate = ctx.sampleRate;
  const len = Math.max(64, Math.round(spec.seconds * rate));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const rnd = mulberry32(0x5eed + ch * 0x9e3779b9);
    for (let i = 0; i < len; i++) {
      d[i] = (rnd() * 2 - 1) * Math.exp((-6.9 * i) / len); // −60 dB across the burst
    }
    for (const [type, f, q, dB, times = 1] of spec.cascade) {
      for (let k = 0; k < times; k++) applyBiquad(d, rate, type, f, q, dB);
    }
    let energy = 0;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    const g = spec.trim / Math.sqrt(Math.max(energy, 1e-12));
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

const CAB_IR_CACHE = new Map(); // `${model}@${sampleRate}` → AudioBuffer

function cabIRFor(ctx, model) {
  const key = `${model}@${ctx.sampleRate}`;
  if (!CAB_IR_CACHE.has(key)) CAB_IR_CACHE.set(key, makeCabIR(ctx, CAB_SPECS[model]));
  return CAB_IR_CACHE.get(key);
}

export function createCab(ctx) {
  const { input, output } = edges(ctx);
  // Fold any stereo feed to mono at the door, like createDelay — a cab is a
  // mono device; the decorrelated stereo IR re-widens naturally on the way out.
  input.channelCount = 1;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const p = { model: 'modern412', tight: 85 };

  const hp = ctx.createBiquadFilter(); // tightness — flub kill before the cone
  hp.type = 'highpass';
  hp.frequency.value = p.tight;
  hp.Q.value = 0.707;
  input.connect(hp);

  let cur = null;
  const pending = new Map(); // timer id → { c, g } awaiting teardown
  function mount(model, xfade) {
    const c = ctx.createConvolver();
    c.normalize = false; // IRs are energy-normalized in makeCabIR
    c.buffer = cabIRFor(ctx, model);
    const g = gainOf(ctx, xfade ? 0 : 1);
    hp.connect(c);
    c.connect(g);
    g.connect(output);
    if (xfade) {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(1, t, 0.02);
      cur.g.gain.setTargetAtTime(0, t, 0.02);
      const old = cur;
      const id = setTimeout(() => {
        pending.delete(id);
        // disconnect() only drops OUTPUT edges — sever hp→old.c explicitly
        // or the swapped-out convolver (and its IR) stays live forever.
        try { hp.disconnect(old.c); } catch {}
        unplug([old.c, old.g]);
      }, 250);
      pending.set(id, old);
    }
    cur = { c, g };
  }
  mount(p.model, false);

  let dead = false;
  return {
    input,
    output,
    set(patch = {}) {
      if ('tight' in patch) {
        p.tight = num(patch.tight, 40, 250, p.tight);
        hp.frequency.setTargetAtTime(p.tight, ctx.currentTime, HOT);
      }
      if ('model' in patch && patch.model !== p.model && Object.hasOwn(CAB_SPECS, patch.model)) {
        p.model = patch.model;
        mount(p.model, true);
      }
    },
    dispose() {
      if (dead) return;
      dead = true;
      for (const [id, old] of pending) {
        clearTimeout(id);
        try { hp.disconnect(old.c); } catch {}
        unplug([old.c, old.g]);
      }
      pending.clear();
      unplug([input, hp, cur.c, cur.g, output]);
    },
  };
}

// ---- auto-wah ------------------------------------------------------------------
// Envelope follower (|x| → 25 Hz lowpass → gain) wired straight into a bandpass
// filter's frequency AudioParam — the wah tracks at audio rate, no JS in the loop.

export function createAutoWah(ctx) {
  const { input, output } = edges(ctx);
  const p = { sens: 0.5, lo: 350, hi: 2200, q: 6, mix: 1 };
  const mix = makeMix(ctx, input, output, p.mix);

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = p.lo;
  bp.Q.value = p.q;
  // A bandpass keeps only its slice of the spectrum — insertion loss grows with
  // Q, so makeup rides the Q knob to keep the quack at playing level.
  const makeup = gainOf(ctx, 1 + 0.22 * p.q);
  input.connect(bp);
  bp.connect(makeup);
  makeup.connect(mix.wet);

  const rect = ctx.createWaveShaper();
  const n = 1024;
  const absCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) absCurve[i] = Math.abs((i / (n - 1)) * 2 - 1);
  rect.curve = absCurve;
  const smooth = ctx.createBiquadFilter();
  smooth.type = 'lowpass';
  smooth.frequency.value = 25;
  const env = gainOf(ctx, 0);
  input.connect(rect);
  rect.connect(smooth);
  smooth.connect(env);
  env.connect(bp.frequency); // base = lo, follower sweeps up toward hi

  // Interface-level guitar averages well under full scale — boost the follower
  // so sens 1 actually reaches the top of the sweep.
  const SWING = 2.5;
  const sweep = (ramp) => {
    const v = (p.hi - p.lo) * p.sens * SWING;
    if (ramp) env.gain.setTargetAtTime(v, ctx.currentTime, HOT);
    else env.gain.value = v;
  };
  sweep(false);

  return {
    input,
    output,
    set(patch = {}) {
      const t = ctx.currentTime;
      let dirty = false;
      if ('sens' in patch) { p.sens = num(patch.sens, 0, 1, p.sens); dirty = true; }
      if ('lo' in patch) {
        p.lo = num(patch.lo, 200, 800, p.lo);
        bp.frequency.setTargetAtTime(p.lo, t, HOT);
        dirty = true;
      }
      if ('hi' in patch) { p.hi = num(patch.hi, 1200, 4000, p.hi); dirty = true; }
      if ('q' in patch) {
        p.q = num(patch.q, 1, 14, p.q);
        bp.Q.setTargetAtTime(p.q, t, HOT);
        makeup.gain.setTargetAtTime(1 + 0.22 * p.q, t, HOT);
      }
      if (dirty) sweep(true);
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
    },
    dispose() {
      unplug([input, bp, makeup, rect, smooth, env, mix.dry, mix.wet, output]);
    },
  };
}

// ---- ring mod ------------------------------------------------------------------
// True ring modulation: a zero-gain node whose gain IS the carrier, so
// out = in × osc. Sub-40 Hz difference tones just mud the low end — highpass.

export function createRingMod(ctx) {
  const { input, output } = edges(ctx);
  const p = { freq: 220, mix: 0 };
  const mix = makeMix(ctx, input, output, p.mix);

  const ring = gainOf(ctx, 0);
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = p.freq;
  osc.connect(ring.gain);
  osc.start();

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 40;
  input.connect(ring);
  ring.connect(hp);
  hp.connect(mix.wet);

  let dead = false;
  return {
    input,
    output,
    set(patch = {}) {
      if ('freq' in patch) {
        p.freq = num(patch.freq, 0.5, 2000, p.freq);
        osc.frequency.setTargetAtTime(p.freq, ctx.currentTime, 0.02);
      }
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
    },
    dispose() {
      if (dead) return;
      dead = true;
      silence([osc]);
      unplug([input, osc, ring, hp, mix.dry, mix.wet, output]);
    },
  };
}

// ---- pitch shift ---------------------------------------------------------------
// Granular delay-line shifter (the classic "Jungle" pattern). A delay read by a
// looping sawtooth ramp changes read speed: slope d(delayTime)/dt = 1−ratio ⇒
// playback at ratio = 2^(semis/12), so depth = (1−ratio)·GRAIN. Two branches
// half a grain apart with half-sine windows (sin² + cos² = 1: equal power) hide
// each other's wrap point. Grainy at extremes — that's the charm.

export function createPitchShift(ctx) {
  const { input, output } = edges(ctx);
  const p = { semis: 12, mix: 0 };
  const mix = makeMix(ctx, input, output, p.mix);

  const GRAIN = 0.1;
  const BASE = GRAIN + 0.005; // headroom so a full +12 sweep never clamps delayTime at 0
  const len = Math.max(2, Math.round(GRAIN * ctx.sampleRate));
  const rampBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const fadeBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  {
    const r = rampBuf.getChannelData(0);
    const f = fadeBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      r[i] = i / len;                       // 0→1 saw, wraps at the grain edge
      f[i] = Math.sin((Math.PI * i) / len); // window hits zero exactly at the wrap
    }
  }

  const t0 = ctx.currentTime + 0.02;
  const depths = [];
  const sources = [];
  const nodes = [];
  for (const phase of [0, GRAIN / 2]) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = BASE; // ramp source sums on top: BASE ± depth
    const depth = gainOf(ctx, 0);
    const win = gainOf(ctx, 0);
    const ramp = ctx.createBufferSource();
    ramp.buffer = rampBuf;
    ramp.loop = true;
    const fade = ctx.createBufferSource();
    fade.buffer = fadeBuf;
    fade.loop = true;
    ramp.connect(depth);
    depth.connect(delay.delayTime);
    fade.connect(win.gain);
    input.connect(delay);
    delay.connect(win);
    win.connect(mix.wet);
    ramp.start(t0 + phase);
    fade.start(t0 + phase);
    depths.push(depth.gain);
    sources.push(ramp, fade);
    nodes.push(delay, depth, win);
  }

  function retune(ramp) {
    const d = (1 - Math.pow(2, p.semis / 12)) * GRAIN; // negative = upshift
    for (const g of depths) {
      if (ramp) g.setTargetAtTime(d, ctx.currentTime, 0.05);
      else g.value = d;
    }
  }
  retune(false);

  let dead = false;
  return {
    input,
    output,
    set(patch = {}) {
      if ('semis' in patch) {
        p.semis = num(patch.semis, -12, 12, p.semis);
        retune(true);
      }
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
    },
    dispose() {
      if (dead) return;
      dead = true;
      silence(sources);
      unplug([input, ...nodes, ...sources, mix.dry, mix.wet, output]);
    },
  };
}

// ---- mod (chorus / phaser / tremolo / vibrato) -----------------------------------
// One shared sine LFO; each type is a small wet graph built around it. Switching
// type builds the new graph beside the old one and crossfades ~60 ms — no clicks,
// and the LFO phase carries across.

const MOD_TYPES = ['chorus', 'phaser', 'tremolo', 'vibrato'];

export function createMod(ctx) {
  const { input, output } = edges(ctx);
  const p = { type: 'chorus', rate: 0.8, depth: 0.5, mix: 0.5 };
  const mix = makeMix(ctx, input, output, p.mix);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = p.rate;
  lfo.start();

  const ramped = (param, v, ramp) => {
    if (ramp) param.setTargetAtTime(v, ctx.currentTime, HOT);
    else param.value = v;
  };

  function build(type, outGain) {
    const inG = gainOf(ctx, 1);
    const outG = gainOf(ctx, outGain);
    const tap = gainOf(ctx, 1); // this graph's LFO takeoff — one disconnect kills all modulation
    lfo.connect(tap);
    const nodes = [inG, outG, tap];
    let setDepth;

    if (type === 'chorus') {
      // Two detuned taps LFO'd in anti-phase; dry summed in so the wet path
      // alone already shimmers at mix 1.
      const dA = ctx.createDelay(0.05);
      dA.delayTime.value = 0.014;
      const dB = ctx.createDelay(0.05);
      dB.delayTime.value = 0.021;
      const sA = gainOf(ctx, 0);
      const sB = gainOf(ctx, 0);
      tap.connect(sA);
      tap.connect(sB);
      sA.connect(dA.delayTime);
      sB.connect(dB.delayTime);
      const thru = gainOf(ctx, 0.6);
      const mA = gainOf(ctx, 0.5);
      const mB = gainOf(ctx, 0.5);
      inG.connect(thru); thru.connect(outG);
      inG.connect(dA); dA.connect(mA); mA.connect(outG);
      inG.connect(dB); dB.connect(mB); mB.connect(outG);
      setDepth = (d, ramp) => {
        ramped(sA.gain, d * 0.006, ramp);   // ±6 ms at depth 1
        ramped(sB.gain, -d * 0.006, ramp);  // inverted — voices breathe against each other
      };
      nodes.push(dA, dB, sA, sB, thru, mA, mB);
    } else if (type === 'phaser') {
      const aps = [300, 545, 990, 1800].map((f0) => {
        const b = ctx.createBiquadFilter();
        b.type = 'allpass';
        b.frequency.value = f0;
        b.Q.value = 0.5;
        return b;
      });
      for (let i = 1; i < aps.length; i++) aps[i - 1].connect(aps[i]);
      const det = gainOf(ctx, 0);
      tap.connect(det);
      for (const b of aps) det.connect(b.detune); // cents — sweep is musical, ±oct at depth 1
      // Zero-delay cycles are muted by spec — one render quantum keeps the loop legal.
      const fbD = ctx.createDelay(0.02);
      fbD.delayTime.value = 128 / ctx.sampleRate;
      const fb = gainOf(ctx, 0.2);
      inG.connect(aps[0]);
      aps[3].connect(fb); fb.connect(fbD); fbD.connect(aps[0]);
      const thru = gainOf(ctx, 0.5);
      const shifted = gainOf(ctx, 0.5);
      inG.connect(thru); thru.connect(outG);     // dry + allpassed = the notches
      aps[3].connect(shifted); shifted.connect(outG);
      setDepth = (d, ramp) => ramped(det.gain, d * 1200, ramp);
      nodes.push(...aps, det, fbD, fb, thru, shifted);
    } else if (type === 'tremolo') {
      const trem = gainOf(ctx, 1);
      const s = gainOf(ctx, 0);
      tap.connect(s);
      s.connect(trem.gain);
      inG.connect(trem);
      trem.connect(outG);
      setDepth = (d, ramp) => {
        ramped(s.gain, d / 2, ramp);
        ramped(trem.gain, 1 - d / 2, ramp); // base + LFO·d/2 spans (1−d)…1 — fully choppy at 1
      };
      nodes.push(trem, s);
    } else { // vibrato
      const dv = ctx.createDelay(0.05);
      dv.delayTime.value = 0.007;
      const s = gainOf(ctx, 0);
      tap.connect(s);
      s.connect(dv.delayTime);
      inG.connect(dv);
      dv.connect(outG); // fully wet — no dry in the wet path, or it turns into chorus
      setDepth = (d, ramp) => ramped(s.gain, d * 0.004, ramp);
      nodes.push(dv, s);
    }

    setDepth(p.depth, false);
    input.connect(inG);
    outG.connect(mix.wet);
    return {
      out: outG,
      setDepth,
      teardown() {
        try { lfo.disconnect(tap); } catch {}
        try { input.disconnect(inG); } catch {}
        unplug(nodes);
      },
    };
  }

  let graph = build(p.type, 1);
  const pending = new Map(); // timer id → graph awaiting teardown

  function switchType(type) {
    const old = graph;
    graph = build(type, 0);
    const t = ctx.currentTime;
    graph.out.gain.setTargetAtTime(1, t, 0.02); // ~60 ms crossfade
    old.out.gain.setTargetAtTime(0, t, 0.02);
    const id = setTimeout(() => {
      pending.delete(id);
      old.teardown();
    }, 200);
    pending.set(id, old);
  }

  let dead = false;
  return {
    input,
    output,
    set(patch = {}) {
      if ('rate' in patch) {
        p.rate = num(patch.rate, 0.05, 8, p.rate);
        lfo.frequency.setTargetAtTime(p.rate, ctx.currentTime, 0.05);
      }
      if ('depth' in patch) {
        p.depth = num(patch.depth, 0, 1, p.depth);
        graph.setDepth(p.depth, true);
      }
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
      if ('type' in patch && patch.type !== p.type && MOD_TYPES.includes(patch.type)) {
        p.type = patch.type;
        switchType(p.type);
      }
    },
    dispose() {
      if (dead) return;
      dead = true;
      for (const [id, g] of pending) {
        clearTimeout(id);
        g.teardown();
      }
      pending.clear();
      silence([lfo]);
      graph.teardown();
      unplug([lfo, input, mix.dry, mix.wet, output]);
    },
  };
}

// ---- delay ---------------------------------------------------------------------
// Two delay lines with the feedback wired as a gain matrix: pingpong is a
// crossfade of routes (self-feed ⇄ cross-feed), not a rewire, so toggling it
// mid-echo is click-free. Tone lowpass sits INSIDE the loop — every repeat
// darkens like tape.

export function createDelay(ctx) {
  const { input, output } = edges(ctx);
  // Fold any stereo feed to mono at the door: the wet merger's inputs are mono
  // anyway, so this keeps the dry leg hearing the same fold as the echoes
  // instead of the wet path quietly downmixing −6 dB against a stereo dry.
  input.channelCount = 1;
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const p = { time: 0.42, feedback: 0.35, tone: 3200, pingpong: false, mix: 0 };
  const mix = makeMix(ctx, input, output, p.mix);

  const dL = ctx.createDelay(2.5);
  const dR = ctx.createDelay(2.5);
  dL.delayTime.value = p.time;
  dR.delayTime.value = p.time;
  const lp = (hz) => {
    const b = ctx.createBiquadFilter();
    b.type = 'lowpass';
    b.frequency.value = hz;
    b.Q.value = 0.707;
    return b;
  };
  const tL = lp(p.tone);
  const tR = lp(p.tone);
  dL.connect(tL);
  dR.connect(tR);

  const selfL = gainOf(ctx, 0);
  const crossL = gainOf(ctx, 0);
  const selfR = gainOf(ctx, 0);
  const crossR = gainOf(ctx, 0);
  tL.connect(selfL); selfL.connect(dL);
  tL.connect(crossL); crossL.connect(dR);
  tR.connect(selfR); selfR.connect(dR);
  tR.connect(crossR); crossR.connect(dL);

  const merger = ctx.createChannelMerger(2);
  const oLL = gainOf(ctx, 0);
  const oLR = gainOf(ctx, 0);
  const oRR = gainOf(ctx, 0);
  tL.connect(oLL); oLL.connect(merger, 0, 0);
  tL.connect(oLR); oLR.connect(merger, 0, 1);
  tR.connect(oRR); oRR.connect(merger, 0, 1);
  merger.connect(mix.wet);

  input.connect(dL); // pingpong seeds the left hop; mono only ever uses dL

  function route(ramp) {
    const fb = p.feedback;
    const table = p.pingpong
      ? [[selfL, 0], [crossL, fb], [selfR, 0], [crossR, fb], [oLL, 1], [oLR, 0], [oRR, 1]]
      : [[selfL, fb], [crossL, 0], [selfR, 0], [crossR, 0], [oLL, 1], [oLR, 1], [oRR, 0]];
    for (const [node, v] of table) {
      if (ramp) node.gain.setTargetAtTime(v, ctx.currentTime, HOT);
      else node.gain.value = v;
    }
  }
  route(false);

  return {
    input,
    output,
    set(patch = {}) {
      const t = ctx.currentTime;
      let reroute = false;
      if ('time' in patch) {
        p.time = num(patch.time, 0.02, 2, p.time);
        // tau 0.08 — the audible tape-bend on the knob is the point
        dL.delayTime.setTargetAtTime(p.time, t, 0.08);
        dR.delayTime.setTargetAtTime(p.time, t, 0.08);
      }
      if ('feedback' in patch) {
        p.feedback = num(patch.feedback, 0, 0.95, p.feedback);
        reroute = true;
      }
      if ('pingpong' in patch) {
        const v = !!patch.pingpong;
        if (v !== p.pingpong) { p.pingpong = v; reroute = true; }
      }
      if ('tone' in patch) {
        p.tone = num(patch.tone, 500, 12000, p.tone);
        tL.frequency.setTargetAtTime(p.tone, t, HOT);
        tR.frequency.setTargetAtTime(p.tone, t, HOT);
      }
      if (reroute) route(true);
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
    },
    dispose() {
      unplug([input, dL, dR, tL, tR, selfL, crossL, selfR, crossR,
        oLL, oLR, oRR, merger, mix.dry, mix.wet, output]);
    },
  };
}

// ---- reverb --------------------------------------------------------------------
// ConvolverNode with generated stereo IRs (exponentially decaying noise,
// independent channels for width). IRs are energy-normalized so a 14 s tail and
// a 1.2 s room sit at the same wet level — and so the shimmer loop math holds.

export function makeIR(ctx, { seconds = 3.5, decay = 2.4, reverse = false, brighten = 0 } = {}) {
  const rate = ctx.sampleRate;
  const len = Math.max(Math.floor(rate * 0.05), Math.floor(seconds * rate));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lpState = 0;
    let prev = 0;
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let s = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      if (brighten < 0) {
        // One-pole lowpass whose coefficient closes along the tail — the air
        // darkens as it decays (cathedral).
        lpState += Math.exp(4 * brighten * t) * (s - lpState);
        s = lpState;
      } else if (brighten > 0) {
        // First-difference sparkle — a touch of extra top (ghosts).
        const hf = s - prev;
        prev = s;
        s += brighten * hf;
      }
      d[i] = s;
      energy += s * s;
    }
    if (reverse) d.reverse(); // decay becomes a swelling attack
    // Unit energy per channel: white input convolves out at ~unity RMS, so wet
    // level doesn't balloon with IR length.
    const g = 1 / Math.sqrt(Math.max(energy, 1e-12));
    for (let i = 0; i < len; i++) d[i] *= g;
  }
  return buf;
}

const IR_SPECS = {
  room: { seconds: 1.2, decay: 3 },
  hall: { seconds: 3.5, decay: 2.4 },
  cathedral: { seconds: 8, decay: 1.8, brighten: -0.6 },
  haunted: { seconds: 4, decay: 2.2, reverse: true, brighten: 0.35 },
  infinite: { seconds: 14, decay: 1.2 },
};

const IR_CACHE = new Map(); // `${type}@${sampleRate}` → AudioBuffer

function irFor(ctx, type) {
  const key = `${type}@${ctx.sampleRate}`;
  if (!IR_CACHE.has(key)) IR_CACHE.set(key, makeIR(ctx, IR_SPECS[type]));
  return IR_CACHE.get(key);
}

export function createReverb(ctx) {
  const { input, output } = edges(ctx);
  const p = { ir: 'hall', mix: 0.25, predelay: 0.02, shimmer: 0 };
  const mix = makeMix(ctx, input, output, p.mix);

  const pre = ctx.createDelay(0.3);
  pre.delayTime.value = p.predelay;
  const revIn = gainOf(ctx, 1);   // stable ends, so IR swaps and the shimmer
  const revOut = gainOf(ctx, 1);  // return never rewire anything else
  input.connect(pre);
  pre.connect(revIn);
  revOut.connect(mix.wet);

  let cur = null;
  const pending = new Map(); // timer id → { c, g } awaiting teardown
  function mount(type, xfade) {
    const c = ctx.createConvolver();
    c.normalize = false; // we energy-normalize in makeIR; built-in normalization would fight the loop math
    c.buffer = irFor(ctx, type);
    const g = gainOf(ctx, xfade ? 0 : 1);
    revIn.connect(c);
    c.connect(g);
    g.connect(revOut);
    if (xfade) {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(1, t, 0.02);
      cur.g.gain.setTargetAtTime(0, t, 0.02);
      const old = cur;
      const id = setTimeout(() => {
        pending.delete(id);
        // disconnect() only drops OUTPUT edges — sever revIn→old.c explicitly
        // or the swapped-out convolver (and its IR) stays live forever.
        try { revIn.disconnect(old.c); } catch {}
        unplug([old.c, old.g]);
      }, 250);
      pending.set(id, old);
    }
    cur = { c, g };
  }
  mount(p.ir, false);

  // SHIMMER: wet → +12 granular shift → band-limited, soft-clipped, attenuated
  // → back into the convolver. Each pass climbs an octave until the lowpass
  // eats it, so the bloom self-extinguishes; loop gain caps at 0.55 and the
  // tanh net catches any freak IR resonance. The cycle is legal — the shifter's
  // delay lines are the required DelayNode.
  const shifter = createPitchShift(ctx);
  shifter.set({ semis: 12, mix: 1 });
  const shimHP = ctx.createBiquadFilter();
  shimHP.type = 'highpass';
  shimHP.frequency.value = 120;
  const shimLP = ctx.createBiquadFilter();
  shimLP.type = 'lowpass';
  shimLP.frequency.value = 9500;
  const clip = ctx.createWaveShaper();
  {
    const n = 512;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1)) * 2 - 1); // unity slope at 0 — transparent until it saves you
    clip.curve = c;
  }
  // The shifter's dry leg is a zero-delay route (gain ~0, but muting is
  // topological): without an explicit DelayNode here the return would close a
  // delay-free cycle and mute the whole reverb core.
  const shimD = ctx.createDelay(0.05);
  shimD.delayTime.value = 0.003;
  const shimGain = gainOf(ctx, 0);
  revOut.connect(shifter.input);
  shifter.output.connect(shimHP);
  shimHP.connect(shimLP);
  shimLP.connect(clip);
  clip.connect(shimD);
  shimD.connect(shimGain);
  shimGain.connect(revIn);

  let dead = false;
  return {
    input,
    output,
    set(patch = {}) {
      const t = ctx.currentTime;
      if ('predelay' in patch) {
        p.predelay = num(patch.predelay, 0, 0.25, p.predelay);
        pre.delayTime.setTargetAtTime(p.predelay, t, 0.05);
      }
      if ('shimmer' in patch) {
        p.shimmer = num(patch.shimmer, 0, 1, p.shimmer);
        shimGain.gain.setTargetAtTime(p.shimmer * 0.55, t, 0.05);
      }
      if ('mix' in patch) { p.mix = num(patch.mix, 0, 1, p.mix); mix.set(p.mix); }
      if ('ir' in patch && patch.ir !== p.ir && Object.hasOwn(IR_SPECS, patch.ir)) {
        p.ir = patch.ir;
        mount(p.ir, true);
      }
    },
    dispose() {
      if (dead) return;
      dead = true;
      for (const [id, old] of pending) {
        clearTimeout(id);
        try { revIn.disconnect(old.c); } catch {}
        unplug([old.c, old.g]);
      }
      pending.clear();
      shifter.dispose();
      unplug([input, pre, revIn, revOut, cur.c, cur.g,
        shimHP, shimLP, clip, shimD, shimGain, mix.dry, mix.wet, output]);
    },
  };
}

// ---- registry --------------------------------------------------------------------

// The rig's canonical chain order.
export const FX_ORDER = ['gate', 'sustainer', 'drive', 'cab', 'autowah', 'ringmod', 'pitch', 'mod', 'delay', 'reverb'];

export const FACTORIES = {
  gate: createGate,
  sustainer: createSustainer,
  drive: createDrive,
  cab: createCab,
  autowah: createAutoWah,
  ringmod: createRingMod,
  pitch: createPitchShift,
  mod: createMod,
  delay: createDelay,
  reverb: createReverb,
};
