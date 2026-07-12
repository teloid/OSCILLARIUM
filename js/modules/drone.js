// drone.js — OSCILLARIUM module: sustained drone / tanpura-for-the-machine-age.
// Graph per power-on:
//   root stack: MAXV oscillators (detuned unison, per-osc gains) → stack gain ┐
//   sub stack:  1 sine osc @ f0/2 → sub gain                                  ├→ lowpass → env → bus
//   fifth stack: 1 osc @ f0·3/2 → fifth gain                                  ┘
//   drift: sine LFO → gain (cents) → filter.detune  (exponential sweep for free)
// All 7 root voices run from the start; the voice count just fades per-osc
// gains, so changing voices/spread live never clicks.
//
// Chord progression: an optional engine transposes the root through a chord
// cycle (backing track for jamming). It follows the drum machine's bar events
// when Transport.driver === 'drums', otherwise its own lookahead clock.

import { Engine, Transport, Clock, NOTE_NAMES, midiToFreq, noteLabel, clamp } from '../engine.js';
import * as UI from '../ui.js';
import { t, registerDict, lang } from '../i18n.js';

// Russian dictionary — translate what the user READS, never what the code
// COMPARES (wave/preset/progression keys and remote.apply() values stay English).
registerDict('ru', {
  'DRONE': 'ДРОН',
  'a floor to stand on — tanpura for the machine age': 'пол под ногами — танпура машинной эры',
  // groups
  'pitch': 'высота',
  'stack': 'стек',
  'filter · drift': 'фильтр · дрейф',
  'envelope · level': 'огибающая · уровень',
  'progression': 'прогрессия',
  // controls + units
  'root': 'тоника',
  'octave': 'октава',
  'waveform': 'форма волны',
  'sawtooth': 'пила', 'square': 'меандр', 'triangle': 'треугольник', 'sine': 'синус',
  'voices': 'голоса',
  'spread': 'разброс',
  'sub': 'саб',
  'fifth': 'квинта',
  'cutoff': 'срез',
  'resonance': 'резонанс',
  'drift rate': 'скорость дрейфа',
  'drift depth': 'глубина дрейфа',
  'attack': 'атака',
  'release': 'затухание',
  'level': 'уровень',
  'Hz': 'Гц', 's': 'с',
  'drone power': 'питание дрона',
  // presets
  'presets': 'пресеты',
  'om sub': 'ом-саб',
  'feel it in the chest — one sine, mostly sub-octave': 'отдаётся в груди — один синус, почти целиком суб-октава',
  'tanpura': 'танпура',
  'the classical practice companion — root + just fifth, gentle drift': 'классический спутник практики — тоника + чистая квинта, мягкий дрейф',
  'glass organ': 'стеклянный орган',
  'icy triangle pair, filter wide open — quick to speak': 'ледяная пара треугольников, фильтр нараспашку — отзывается сразу',
  'doom': 'дум',
  'sunn o))) at home — five wide saws, resonant lowpass crawl': 'sunn o))) на дому — пять широких пил, ползучий резонансный лоупас',
  // progression
  'lead chords': 'вести аккорды',
  'changes': 'смены',
  'bars per chord': 'тактов на аккорд',
  'bpm (solo)': 'bpm (соло)',
  'waiting for drone power': 'ждёт питания дрона',
  'synced to drums': 'синхрон с барабанами',
  'solo clock': 'свой метроном',
  'maj': 'маж', 'min': 'мин', 'dom7': 'дом7', 'dim': 'ум',
  '(3:2 just)': '(3:2 чистая)',
});

// 'in 2 bars' / 'через 2 такта' — with the Russian plural (такт/такта/тактов)
function inBars(n) {
  if (lang() !== 'ru') return `in ${n} bar${n === 1 ? '' : 's'}`;
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'такт'
    : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'такта' : 'тактов';
  return `через ${n} ${word}`;
}

const MAXV = 7;        // root unison voices allocated up front
const GLIDE = 0.15;    // s, root pitch glide
const TAU = 0.03;      // s, gain/detune smoothing
const DRIFT_CENTS = 1800; // depth 1 ≈ ±1.5 octaves around cutoff
const WAVES = ['sawtooth', 'square', 'triangle', 'sine'];

// Chord progressions. semis = semitone offset applied to the drone root;
// deg = diatonic pad index (0-6) for the chords module, null = drone-only;
// qual = chord quality ('maj' | 'min' | 'dom' | 'dim') for the readout + emit.
const P = (semis, deg, name, qual) => ({ semis, deg, name, qual });
const PROGS = {
  'I – IV': [P(0, 0, 'I', 'maj'), P(5, 3, 'IV', 'maj')],
  'I – V – vi – IV': [P(0, 0, 'I', 'maj'), P(7, 4, 'V', 'maj'), P(9, 5, 'vi', 'min'), P(5, 3, 'IV', 'maj')],
  'I – vi – IV – V': [P(0, 0, 'I', 'maj'), P(9, 5, 'vi', 'min'), P(5, 3, 'IV', 'maj'), P(7, 4, 'V', 'maj')],
  'ii – V – I': [P(2, 1, 'ii', 'min'), P(7, 4, 'V', 'dom'), P(0, 0, 'I', 'maj'), P(0, 0, 'I', 'maj')],
  // fixed 12-bar cycle — always one bar per step, whatever "bars per chord" says
  '12-bar blues': [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7]
    .map((s) => (s === 5 ? P(5, 3, 'IV', 'dom') : s === 7 ? P(7, 4, 'V', 'dom') : P(0, 0, 'I', 'dom'))),
  'i – bVII (dorian)': [P(0, null, 'i', 'min'), P(10, null, 'bVII', 'maj')],
  'andalusian': [P(0, null, 'i', 'min'), P(10, null, 'bVII', 'maj'), P(8, null, 'bVI', 'maj'), P(7, null, 'V', 'maj')],
  'vi – IV – I – V': [P(9, 5, 'vi', 'min'), P(5, 3, 'IV', 'maj'), P(0, 0, 'I', 'maj'), P(7, 4, 'V', 'maj')],
  'I – iii – IV – V': [P(0, 0, 'I', 'maj'), P(4, 2, 'iii', 'min'), P(5, 3, 'IV', 'maj'), P(7, 4, 'V', 'maj')],
  'I – bVII – IV (mixo)': [P(0, 0, 'I', 'maj'), P(10, null, 'bVII', 'maj'), P(5, 3, 'IV', 'maj')],
  'i – iv – v (minor)': [P(0, null, 'i', 'min'), P(5, null, 'iv', 'min'), P(7, null, 'v', 'min')],
  'i – VI – VII (epic)': [P(0, null, 'i', 'min'), P(8, null, 'VI', 'maj'), P(10, null, 'VII', 'maj')],
  'I – IV – V – IV (rock)': [P(0, 0, 'I', 'maj'), P(5, 3, 'IV', 'maj'), P(7, 4, 'V', 'maj'), P(5, 3, 'IV', 'maj')],
};

const MOD = {
  id: 'drone',
  title: t('DRONE'),
  tagline: t('a floor to stand on — tanpura for the machine age'),

  build(body, head) {
    // ---- state (audio built lazily; nothing touches Engine.ctx here) ----
    const st = {
      note: 'A', oct: 2, wave: 'sawtooth',
      voices: 3, spread: 12, sub: 0.4, fifth: 0,
      cutoff: 1800, q: 1, driftRate: 0.1, driftDepth: 0.25,
      attack: 2, release: 3, level: 0.5,
      prog: false, progPreset: 'I – IV', progBars: 2, progBpm: 100, progFollow: false,
    };

    let bus = null;   // module channel, created once on first power-on
    let graph = null; // per-run node graph; null when silent

    // Progression transposition, in semitones. 0 while the progression is off.
    // The BASE note/octave stays live: changing the selects (or setKey) while
    // the progression runs re-bases it without resetting its position.
    let progSemis = 0;

    const baseMidi = () => (st.oct + 1) * 12 + NOTE_NAMES.indexOf(st.note);
    const rootFreq = () => midiToFreq(baseMidi() + progSemis);

    // symmetric detune offsets in cents, total width = spread; always MAXV long
    function detunes(n, spread) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(spread * (n > 1 ? i / (n - 1) - 0.5 : 0));
      while (out.length < MAXV) out.push(0);
      return out;
    }

    // `from` (optional): the value the param will hold at time t. Pass it when
    // scheduling ahead — reading .value now and applying it later would snap
    // the pitch back before ramping.
    function glideParam(p, target, t, dur, from) {
      // read BEFORE cancelling — cancelling an in-flight ramp reverts .value
      // to the ramp's origin on Firefox/Safari (audible snap-back warble)
      const cur = from != null ? from : p.value;
      p.cancelScheduledValues(t);
      p.setValueAtTime(cur, t);
      p.linearRampToValueAtTime(target, t + dur);
    }

    // ---- live apply helpers (no-ops while silent) ----
    // Glide all stacks to the current root at time t. Bar-synced progression
    // changes pass a future t (drum lookahead) so they land on the downbeat;
    // in that case start from the previous glide's target, not a stale .value.
    function applyPitchAt(t) {
      if (!graph) return;
      const f0 = rootFreq();
      const last = graph.lastGlide;
      const ahead = t > Engine.now() + 0.01;
      const from = ahead && last && t >= last.end ? last.f0 : null;
      graph.voices.forEach((v) => glideParam(v.o.frequency, f0, t, GLIDE, from));
      glideParam(graph.subOsc.frequency, f0 / 2, t, GLIDE, from != null ? from / 2 : null);
      glideParam(graph.fifthOsc.frequency, f0 * 1.5, t, GLIDE, from != null ? from * 1.5 : null);
      graph.lastGlide = { f0, end: t + GLIDE };
    }

    function applyPitch() { applyPitchAt(Engine.now()); }

    function applyWave() {
      if (!graph) return;
      graph.voices.forEach((v) => { v.o.type = st.wave; });
      graph.fifthOsc.type = st.wave; // sub stays sine
    }

    function applyVoices() {
      if (!graph) return;
      const t = Engine.now(), dts = detunes(st.voices, st.spread);
      const lvl = 0.5 / Math.sqrt(st.voices);
      graph.voices.forEach((v, i) => {
        const on = i < st.voices;
        v.g.gain.setTargetAtTime(on ? lvl : 0, t, TAU);
        if (on) v.o.detune.setTargetAtTime(dts[i], t, TAU);
      });
    }

    function applyLevels() {
      if (!graph) return;
      const t = Engine.now();
      graph.subGain.gain.setTargetAtTime(st.sub * 0.9, t, TAU);
      graph.fifthGain.gain.setTargetAtTime(st.fifth * 0.7, t, TAU);
    }

    function applyFilter() {
      if (!graph) return;
      const t = Engine.now();
      graph.filter.frequency.setTargetAtTime(st.cutoff, t, TAU);
      graph.filter.Q.setTargetAtTime(st.q, t, TAU);
    }

    function applyDrift() {
      if (!graph) return;
      const t = Engine.now();
      graph.lfo.frequency.setTargetAtTime(st.driftRate, t, 0.05);
      graph.lfoGain.gain.setTargetAtTime(st.driftDepth * DRIFT_CENTS, t, 0.05);
    }

    function applyBusLevel() {
      if (bus) bus.gain.setTargetAtTime(st.level, Engine.now(), TAU);
    }

    // ---- start / stop ----
    // fade (optional, seconds) overrides the attack slider for this power-on.
    function start(fade) {
      Engine.init();
      if (graph) return; // double-start guard
      cutFading(0.02);   // restart during a pending fade-out: cut the old graph now
      if (!bus) bus = Engine.createChannel(st.level);
      const ctx = Engine.ctx, t = ctx.currentTime, f0 = rootFreq();

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = st.cutoff;
      filter.Q.value = st.q;

      const env = ctx.createGain();
      env.gain.value = 0;
      filter.connect(env);
      env.connect(bus);

      // root unison stack — all MAXV oscs run; inactive ones sit at gain 0
      const rootStack = ctx.createGain();
      rootStack.gain.value = 1;
      rootStack.connect(filter);
      const dts = detunes(st.voices, st.spread);
      const lvl = 0.5 / Math.sqrt(st.voices);
      const voices = [];
      for (let i = 0; i < MAXV; i++) {
        const o = ctx.createOscillator();
        o.type = st.wave;
        o.frequency.value = f0;
        o.detune.value = dts[i];
        const g = ctx.createGain();
        g.gain.value = i < st.voices ? lvl : 0;
        o.connect(g);
        g.connect(rootStack);
        o.start(t);
        voices.push({ o, g });
      }

      // sub-octave (always sine)
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.value = f0 / 2;
      const subGain = ctx.createGain();
      subGain.gain.value = st.sub * 0.9;
      subOsc.connect(subGain);
      subGain.connect(filter);
      subOsc.start(t);

      // just fifth (3:2)
      const fifthOsc = ctx.createOscillator();
      fifthOsc.type = st.wave;
      fifthOsc.frequency.value = f0 * 1.5;
      const fifthGain = ctx.createGain();
      fifthGain.gain.value = st.fifth * 0.7;
      fifthOsc.connect(fifthGain);
      fifthGain.connect(filter);
      fifthOsc.start(t);

      // drift LFO → filter.detune (cents → exponential cutoff sweep)
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = st.driftRate;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = st.driftDepth * DRIFT_CENTS;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.detune);
      lfo.start(t);

      // attack envelope
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + Math.max(0.01, fade ?? st.attack));

      graph = { filter, env, rootStack, voices, subOsc, subGain, fifthOsc, fifthGain, lfo, lfoGain, lastGlide: null };

      if (st.prog) progStart(); // progression runs only while toggled on AND powered
    }

    // Power-off is an instant cut (~80 ms) — the release slider no longer drives
    // it. Longer fades only happen when remote.power(false, fade) asks for one.
    let fading = null; // graph still fading out after stop(); re-cut on restart

    // Reshape the pending fade-out (if any) to reach silence in `rel` seconds.
    function cutFading(rel) {
      if (!fading) return;
      const g = fading;
      const t = Engine.now();
      const cur = g.env.gain.value; // read before cancel — cancelling mid-ramp reverts .value
      g.env.gain.cancelScheduledValues(t);
      g.env.gain.setValueAtTime(cur, t);
      g.env.gain.linearRampToValueAtTime(0, t + rel);
      const oscs = [...g.voices.map((v) => v.o), g.subOsc, g.fifthOsc, g.lfo];
      // re-invoking stop() moves the scheduled stop earlier where supported;
      // where it throws, the original stop stands and the graph is silent anyway
      oscs.forEach((o) => { try { o.stop(t + rel + 0.05); } catch (e) { /* keep original stop */ } });
    }

    // fade (optional, seconds) is this transition's fade-out; default 0.08 (instant off).
    function stop(fade) {
      progStop(); // power-off / stop-all halts the progression (idempotent)
      const rel = Math.max(0.02, fade ?? 0.08);
      if (!graph) {
        if (rel < 0.1) cutFading(rel); // power-off / stop-all during a long remote fade
        return;
      }
      const g = graph;
      graph = null; // release ownership — a fresh power-on builds a new graph
      fading = g;
      const t = Engine.now();
      const cur = g.env.gain.value; // read before cancel — cancelling mid-ramp reverts .value
      g.env.gain.cancelScheduledValues(t);
      g.env.gain.setValueAtTime(cur, t);
      g.env.gain.linearRampToValueAtTime(0, t + rel);
      const tEnd = t + rel + 0.08; // oscillators outlive the fade
      const oscs = [...g.voices.map((v) => v.o), g.subOsc, g.fifthOsc, g.lfo];
      oscs.forEach((o) => { try { o.stop(tEnd); } catch (e) { /* already stopped */ } });
      g.voices[0].o.onended = () => {
        if (fading === g) fading = null;
        try {
          g.env.disconnect();
          g.filter.disconnect();
          g.rootStack.disconnect();
          g.subGain.disconnect();
          g.fifthGain.disconnect();
          g.lfoGain.disconnect();
        } catch (e) { /* already gone */ }
      };
    }

    // ---- readout ----
    // Always shows the BASE root — the progression's movement has its own readout.
    const ro = UI.readout('—', 'big');
    function paintReadout() {
      const f0 = midiToFreq(baseMidi());
      let s = `${st.note}${st.oct} · ${f0.toFixed(2)} ${t('Hz')}`;
      if (st.fifth > 0) s += `  +  ${noteLabel(f0 * 1.5)} ${(f0 * 1.5).toFixed(2)} ${t('Hz')} ${t('(3:2 just)')}`;
      ro.set(s);
    }

    // ---- controls ----
    const pct = (v) => Math.round(v * 100) + '%';

    const noteSel = UI.select({
      label: t('root'), options: [...NOTE_NAMES], value: st.note,
      onChange: (v) => { st.note = v; applyPitch(); paintReadout(); paintProg(); },
    });
    const octSel = UI.select({
      label: t('octave'), options: ['1', '2', '3', '4'], value: String(st.oct),
      onChange: (v) => { st.oct = parseInt(v, 10); applyPitch(); paintReadout(); },
    });
    const waveSel = UI.select({
      // display translated, compare English — o.type / remote.apply need the raw value
      label: t('waveform'), options: WAVES.map((w) => ({ value: w, label: t(w) })), value: st.wave,
      onChange: (v) => { st.wave = v; applyWave(); },
    });

    const voicesCtl = UI.slider({
      label: t('voices'), min: 1, max: 7, step: 1, value: st.voices,
      format: (v) => String(Math.round(v)),
      onInput: (v) => { st.voices = Math.round(v); applyVoices(); },
    });
    const spreadCtl = UI.slider({
      label: t('spread'), min: 0, max: 60, value: st.spread, unit: '¢',
      format: (v) => v.toFixed(1),
      onInput: (v) => { st.spread = v; applyVoices(); },
    });
    const subCtl = UI.slider({
      label: t('sub'), min: 0, max: 1, value: st.sub, format: pct,
      onInput: (v) => { st.sub = v; applyLevels(); },
    });
    const fifthCtl = UI.slider({
      label: t('fifth'), min: 0, max: 1, value: st.fifth, format: pct,
      onInput: (v) => { st.fifth = v; applyLevels(); paintReadout(); },
    });

    const cutoffCtl = UI.slider({
      label: t('cutoff'), min: 80, max: 12000, value: st.cutoff, log: true, unit: t('Hz'),
      onInput: (v) => { st.cutoff = v; applyFilter(); },
    });
    const qCtl = UI.slider({
      label: t('resonance'), min: 0, max: 18, value: st.q,
      format: (v) => v.toFixed(1),
      onInput: (v) => { st.q = v; applyFilter(); },
    });
    const rateCtl = UI.slider({
      label: t('drift rate'), min: 0.02, max: 2, value: st.driftRate, log: true, unit: t('Hz'),
      onInput: (v) => { st.driftRate = v; applyDrift(); },
    });
    const depthCtl = UI.slider({
      label: t('drift depth'), min: 0, max: 1, value: st.driftDepth, format: pct,
      onInput: (v) => { st.driftDepth = v; applyDrift(); },
    });

    const attackCtl = UI.slider({
      label: t('attack'), min: 0.01, max: 8, value: st.attack, log: true, unit: t('s'),
      onInput: (v) => { st.attack = v; },
    });
    const relCtl = UI.slider({
      label: t('release'), min: 0.05, max: 10, value: st.release, log: true, unit: t('s'),
      onInput: (v) => { st.release = v; },
    });
    const levelCtl = UI.slider({
      label: t('level'), min: 0, max: 1, value: st.level, format: pct,
      onInput: (v) => { st.level = v; applyBusLevel(); },
    });

    // ---- presets ----
    const PRESETS = [
      {
        name: t('om sub'), hint: t('feel it in the chest — one sine, mostly sub-octave'),
        p: { wave: 'sine', note: 'C', oct: 2, voices: 1, spread: 0, sub: 0.8, fifth: 0, cutoff: 600, q: 0.7, driftRate: 0.06, driftDepth: 0.15, attack: 4, release: 6 },
      },
      {
        name: t('tanpura'), hint: t('the classical practice companion — root + just fifth, gentle drift'),
        p: { wave: 'sawtooth', note: 'A', oct: 2, voices: 3, spread: 10, sub: 0.25, fifth: 0.35, cutoff: 2600, q: 1, driftRate: 0.08, driftDepth: 0.35, attack: 2, release: 3 },
      },
      {
        name: t('glass organ'), hint: t('icy triangle pair, filter wide open — quick to speak'),
        p: { wave: 'triangle', note: 'E', oct: 3, voices: 2, spread: 6, sub: 0.2, fifth: 0, cutoff: 8000, q: 0.8, driftRate: 0.12, driftDepth: 0.15, attack: 0.4, release: 1.5 },
      },
      {
        name: t('doom'), hint: t('sunn o))) at home — five wide saws, resonant lowpass crawl'),
        p: { wave: 'sawtooth', note: 'A', oct: 1, voices: 5, spread: 35, sub: 0.6, fifth: 0.3, cutoff: 900, q: 8, driftRate: 0.05, driftDepth: 0.5, attack: 5, release: 8 },
      },
    ];

    function applyPreset(p) {
      Object.assign(st, p);
      // UI first (set() never fires callbacks)…
      noteSel.set(st.note); octSel.set(st.oct); waveSel.set(st.wave);
      voicesCtl.set(st.voices); spreadCtl.set(st.spread);
      subCtl.set(st.sub); fifthCtl.set(st.fifth);
      cutoffCtl.set(st.cutoff); qCtl.set(st.q);
      rateCtl.set(st.driftRate); depthCtl.set(st.driftDepth);
      attackCtl.set(st.attack); relCtl.set(st.release); levelCtl.set(st.level);
      // …then audio, with ramps if playing
      applyWave(); applyPitch(); applyVoices(); applyLevels(); applyFilter(); applyDrift(); applyBusLevel();
      paintReadout();
      paintProg(); // chord letters in the progression readout track the base note
    }

    const chipRow = UI.chips({
      label: t('presets'),
      items: PRESETS,
      onPick: (item) => applyPreset(item.p),
    });

    // ---- power + stop-all ----
    const powerCtl = UI.power({
      title: t('drone power'),
      onChange: (on) => { on ? start() : stop(); }, // stop() = instant off (~80 ms)
    });
    head.append(powerCtl.el);

    Engine.onStopAll(() => {
      stop(); // instant off (~80 ms) — also halts the progression
      powerCtl.set(false);
    });

    // ---- chord progression (jam-along backing) ----
    let progRun = false;      // engine running (toggle on AND drone powered)
    let progPos = 0;          // current step index
    let progBarsSeen = 0;     // bars elapsed within the current step
    let progSelfNext = 0;     // next self-clocked bar (audio time); 0 = re-anchor

    // blues is a fixed 12-bar cycle: one bar per step, whatever the select says
    function stepBars() { return st.progPreset === '12-bar blues' ? 1 : st.progBars; }

    // 'vi E min', 'V G dom7' — roman numeral + real chord letter (from the base
    // note select + step.semis) + quality word. Works for deg-null steps too.
    // Keys are the emitted qual codes; only the displayed words are translated.
    const QUAL_WORDS = { maj: t('maj'), min: t('min'), dom: t('dom7'), dim: t('dim') };
    function chordLabel(step) {
      const letter = NOTE_NAMES[(NOTE_NAMES.indexOf(st.note) + step.semis) % 12];
      return `${step.name} ${letter} ${QUAL_WORDS[step.qual] || step.qual}`;
    }

    function paintProg() {
      if (!progRun) {
        progRo.set(st.prog ? t('waiting for drone power') : '—');
        return;
      }
      const steps = PROGS[st.progPreset];
      const cur = steps[progPos], next = steps[(progPos + 1) % steps.length];
      const left = Math.max(1, stepBars() - progBarsSeen);
      const src = Transport.driver === 'drums' ? t('synced to drums') : t('solo clock');
      progRo.set(`${chordLabel(cur)} → ${chordLabel(next)} ${inBars(left)} · ${src}`);
    }

    // Land on the current step at audio time `time` (drummer's downbeat when synced).
    function fireStep(time) {
      const step = PROGS[st.progPreset][progPos];
      progSemis = step.semis;
      applyPitchAt(time); // same ~0.15 s root glide; sub + fifth follow
      Engine.emit('progression', { deg: step.deg, semis: step.semis, qual: step.qual, follow: st.progFollow, time });
      paintProg();
    }

    function onBarAt(time) {
      progBarsSeen += 1;
      if (progBarsSeen >= stepBars()) {
        progBarsSeen = 0;
        progPos = (progPos + 1) % PROGS[st.progPreset].length;
        fireStep(time);
      } else {
        paintProg();
      }
    }

    // Registered ONCE (Engine.on has no off()); gates on running state + driver.
    Engine.on('bar', (evt) => {
      if (!progRun || Transport.driver !== 'drums') return;
      onBarAt(evt && isFinite(evt.time) ? evt.time : Engine.now());
    });

    // Self clock — only advances when the drum machine is not driving the
    // Transport; while drums drive, it just waits, re-anchoring when they stop.
    const progClock = new Clock((horizon) => {
      if (!progRun) return;
      if (Transport.driver === 'drums') { progSelfNext = 0; return; }
      if (!progSelfNext) progSelfNext = Engine.now() + 240 / st.progBpm;
      let guard = 0;
      while (progSelfNext <= horizon && guard++ < 64) {
        onBarAt(progSelfNext);
        progSelfNext += 240 / st.progBpm; // secsPerBar = 240/bpm (4 beats)
      }
    });

    function progStart() {
      if (progRun || !graph) return;
      progRun = true;
      progPos = 0;      // always restarts from step 0
      progBarsSeen = 0;
      progSelfNext = 0; // self clock re-anchors one bar out on its first tick
      fireStep(Engine.now()); // land on chord I right away
      progClock.start();
    }

    function progStop() {
      if (!progRun) { paintProg(); return; }
      progRun = false;
      progClock.stop();
      progPos = 0;
      progBarsSeen = 0;
      progSelfNext = 0;
      if (progSemis !== 0) {
        progSemis = 0;
        applyPitch(); // glide home if the drone keeps sounding (toggle-off while on)
      }
      paintProg();
    }

    function setProgPreset(name) {
      if (!PROGS[name]) return;
      st.progPreset = name;
      changesSel.set(name);
      refreshBarsSel();
      if (progRun) { // restart the cycle from chord I; the clock keeps running
        progPos = 0;
        progBarsSeen = 0;
        fireStep(Engine.now());
      } else {
        paintProg();
      }
    }

    function setProgBpm(v) {
      st.progBpm = clamp(Math.round(v), 60, 200);
      bpmBox.set(st.progBpm);
      // a faster solo tempo shouldn't leave the next change stranded on the old grid
      if (progSelfNext) progSelfNext = Math.min(progSelfNext, Engine.now() + 240 / st.progBpm);
    }

    const progToggle = UI.toggle({
      label: t('progression'), value: st.prog,
      onChange: (on) => {
        st.prog = on;
        if (on && powerCtl.get()) progStart();
        else progStop(); // idempotent; repaints the readout either way
      },
    });
    const followToggle = UI.toggle({
      label: t('lead chords'), value: st.progFollow,
      onChange: (on) => { st.progFollow = on; },
    });
    const changesSel = UI.select({
      // options ARE the PROGS lookup keys — roman-numeral universal, shown as-is
      label: t('changes'), options: Object.keys(PROGS), value: st.progPreset,
      onChange: (v) => setProgPreset(v),
    });
    const barsSel = UI.select({
      label: t('bars per chord'), options: ['1', '2', '4'], value: String(st.progBars),
      onChange: (v) => { st.progBars = parseInt(v, 10); paintProg(); },
    });
    const bpmBox = UI.numberBox({
      label: t('bpm (solo)'), value: st.progBpm, min: 60, max: 200, step: 1,
      onChange: (v) => setProgBpm(v),
    });
    const progRo = UI.readout('—');
    progRo.el.style.marginTop = '8px';

    const barsSelInput = barsSel.el.querySelector('select');
    function refreshBarsSel() { // gray out bars-per-chord while blues is selected
      const blues = st.progPreset === '12-bar blues';
      if (barsSelInput) barsSelInput.disabled = blues;
      barsSel.el.style.opacity = blues ? '0.45' : '';
    }
    refreshBarsSel();

    // ---- remote API (VIBE macro layer) ----
    const NUM_KEYS = { // apply() numeric keys → [min, max, integer?]
      voices: [1, 7, true], spread: [0, 60], sub: [0, 1], fifth: [0, 1],
      cutoff: [80, 12000], q: [0, 18], driftRate: [0.02, 2], driftDepth: [0, 1],
      attack: [0.01, 8], release: [0.05, 10], level: [0, 1],
    };

    MOD.remote = {
      isOn: () => powerCtl.get(),

      power(on, fade) {
        Engine.init(); // same guard as a user gesture
        if (on) {
          powerCtl.set(true);
          start(fade); // no-op if already running (double-start guard)
        } else {
          powerCtl.set(false);
          stop(fade); // fade ?? 0.08 — instant off unless the caller asks for longer
        }
      },

      apply(params) {
        if (!params || typeof params !== 'object') return;
        const p = {};
        if (typeof params.note === 'string' && NOTE_NAMES.includes(params.note)) p.note = params.note;
        if (params.octave !== undefined && isFinite(+params.octave)) p.oct = clamp(Math.round(+params.octave), 1, 4);
        if (WAVES.includes(params.wave)) p.wave = params.wave;
        for (const [k, [lo, hi, int]] of Object.entries(NUM_KEYS)) {
          if (params[k] === undefined) continue;
          const v = +params[k];
          if (isFinite(v)) p[k] = clamp(int ? Math.round(v) : v, lo, hi);
        }
        if (Object.keys(p).length) applyPreset(p); // state + UI + (if playing) ramped audio

        // progression keys — state + UI; the engine only runs while powered,
        // and none of these ever toggles the drone's power. Plain state first,
        // stop before preset, start LAST, so a single payload like
        // { progression:true, progPreset:…, progFollow:true } fires its first
        // step with everything already absorbed.
        if (typeof params.progFollow === 'boolean') {
          st.progFollow = params.progFollow;
          followToggle.set(st.progFollow);
        }
        if (params.progBpm !== undefined && isFinite(+params.progBpm)) setProgBpm(+params.progBpm);
        if (params.progBars !== undefined) {
          const b = Math.round(+params.progBars);
          if (b === 1 || b === 2 || b === 4) {
            st.progBars = b;
            barsSel.set(String(b));
            paintProg();
          }
        }
        if (params.progression === false) {
          st.prog = false;
          progToggle.set(false);
          progStop();
        }
        if (typeof params.progPreset === 'string' && PROGS[params.progPreset]) {
          setProgPreset(params.progPreset); // exact select label strings only
        }
        if (params.progression === true) {
          st.prog = true;
          progToggle.set(true);
          if (powerCtl.get()) progStart(); // armed until power-on otherwise
          else paintProg();
        }
      },

      setKey(noteIdx) {
        const i = ((Math.round(noteIdx) % 12) + 12) % 12;
        st.note = NOTE_NAMES[i]; // keep the current octave
        noteSel.set(st.note);
        applyPitch(); // same glide as the root select
        paintReadout();
        paintProg(); // re-letter the progression readout in the new key
      },
    };

    // ---- layout ----
    body.append(ro.el);
    body.append(UI.group(t('pitch'), UI.grid(noteSel, octSel, waveSel)));
    body.append(UI.group(t('stack'), UI.grid(voicesCtl, spreadCtl, subCtl, fifthCtl)));
    body.append(UI.group(t('filter · drift'), UI.grid(cutoffCtl, qCtl, rateCtl, depthCtl)));
    body.append(UI.group(t('envelope · level'), UI.grid(attackCtl, relCtl, levelCtl)));
    body.append(chipRow.el);
    body.append(UI.group(t('progression'),
      UI.row(progToggle, followToggle),
      UI.grid(changesSel, barsSel, bpmBox),
      progRo,
    ));

    paintReadout();
    paintProg();
  },
};

export default MOD;
