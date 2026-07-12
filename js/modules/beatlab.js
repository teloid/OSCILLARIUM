// beatlab.js — RHYTHM ⇄ PITCH. Four pulse trains locked in an integer ratio:
// below ~20 Hz they are a polyrhythm, above it they fuse into a chord with
// exactly that frequency ratio. One giant rate slider crosses the boundary.
//
// Dual engine: a Clock-scheduled click engine (one-shot bursts, cursors kept
// in CYCLE PHASE so rate changes stay phase-continuous) and a continuous
// oscillator engine, equal-power crossfaded between 20 and 26 Hz.

import { Engine, Clock, noteLabel, centsBetween, ratioName, clamp, midiToFreq } from '../engine.js';
import * as UI from '../ui.js';
import { t, registerDict } from '../i18n.js';

registerDict('ru', {
  // title / tagline / power
  'RHYTHM ⇄ PITCH': 'РИТМ ⇄ ТОН',
  'a polyrhythm you can speed up until it becomes a chord': 'полиритм, который можно разогнать до аккорда',
  'power — 4:3 at 1.2 Hz, then press SPIN UP': 'питание — 4:3 на 1.2 Гц, затем жмите РАЗГОН',
  // zones (display only — code compares the English words)
  'RHYTHM': 'РИТМ', 'FLUTTER': 'ТРЕПЕТ', 'TONE': 'ТОН',
  // readout word-parts
  'cycle': 'цикл', 'Hz': 'Гц', 'every': 'каждые', 'ms': 'мс',
  'all voices off': 'все голоса выключены',
  'no voices enabled': 'ни один голос не включён',
  'irrational — never repeats': 'иррационально — никогда не повторяется',
  'per cycle — solo train, no interval': 'за цикл — одиночная цепочка, без интервала',
  // chord names (CHORDS values; keys stay English lookup keys)
  'just major chord': 'чистый мажорный аккорд',
  'just minor chord': 'чистый минорный аккорд',
  'septimal minor': 'септимальный минор',
  // interval names as rendered by ratioName()
  'unison': 'унисон', 'octave': 'октава',
  'perfect fifth': 'чистая квинта', 'perfect fourth': 'чистая кварта',
  'just major third': 'чистая большая терция', 'just minor third': 'чистая малая терция',
  'just major sixth': 'чистая большая секста', 'just minor sixth': 'чистая малая секста',
  'major whole tone': 'большой целый тон', 'minor whole tone': 'малый целый тон',
  'just semitone': 'чистый полутон',
  'just major seventh': 'чистая большая септима', 'just minor seventh': 'чистая малая септима',
  'septimal minor third': 'септимальная малая терция', 'septimal tritone': 'септимальный тритон',
  'harmonic seventh': 'натуральная септима', 'septimal whole tone': 'септимальный целый тон',
  'septimal major third': 'септимальная большая терция', 'undecimal tritone': 'ундецимальный тритон',
  'octave + fifth': 'октава + квинта', 'double octave': 'двойная октава',
  'octave + major third': 'октава + большая терция',
  // controls
  'rate': 'скорость', 'level': 'уровень',
  'ratio': 'отношение', 'sound': 'звук', 'pitch': 'высота',
  'tick': 'тик', 'blip': 'блип', 'tom': 'том', 'pulse': 'пульс',
  // spin button
  'SPIN UP': 'РАЗГОН', 'HOLD': 'ДЕРЖАТЬ', 'SPIN DOWN': 'ОТКАТ',
  'ramp rate ×32 over 15 s — hear the rhythm fuse into a chord': 'разгон скорости ×32 за 15 с — услышьте, как ритм сплавляется в аккорд',
  // preset chips + hints
  'ratio presets': 'пресеты отношений',
  'straight 4': 'ровные 4', '3:2 hemiola': 'гемиола 3:2',
  'four even pulses — a bare metronome that fuses into one pure tone': 'четыре ровных удара — голый метроном, сплавляющийся в один чистый тон',
  'three against two → speeds up into a perfect fifth': 'три против двух → разгоняется в чистую квинту',
  'four against three → perfect fourth': 'четыре против трёх → чистая кварта',
  'five against four → just major third': 'пять против четырёх → чистая большая терция',
  'seven against six → septimal minor third, the blue one': 'семь против шести → септимальная малая терция, та самая блюзовая',
  'three trains → just major chord': 'три цепочки → чистый мажорный аккорд',
  'three trains → septimal minor chord, darker and buzzier': 'три цепочки → септимальный минорный аккорд, темнее и жужжит сильнее',
  'perfect fourth + just major third stacked — a major chord, second inversion': 'чистая кварта + чистая большая терция стопкой — мажорный аккорд во втором обращении',
  'fifth plus harmonic seventh — a spectral stack': 'квинта плюс натуральная септима — спектральная стопка',
  'golden ratio — never aligns, ever': 'золотое сечение — не сходится никогда',
  // group titles
  'cycle — rhythm to pitch': 'цикл — от ритма к тону',
  'pulse trains': 'цепочки импульсов',
  'rhythm wheel': 'колесо ритма',
});

const COLORS = ['#ff3ec8', '#00e5ff', '#9dff00', '#ffb300'];
const XF_LO = 20;   // below this the tone engine is silent
const XF_HI = 26;   // above this the click engine stops scheduling
const WAVE = { tick: 'sawtooth', blip: 'sine', tom: 'sine', pulse: 'square' };
const TONE_SCALE = { tick: 0.13, blip: 0.25, tom: 0.25, pulse: 0.10 };
// Keys are lookup keys (reduced ratio strings) — display goes through t(value).
const CHORDS = {
  '4:5:6': 'just major chord',
  '10:12:15': 'just minor chord',
  '6:7:9': 'septimal minor',
};
// Chip names/hints are display-only; onPick consumes `ratios`, never the name.
const PRESETS = [
  { name: t('straight 4'), ratios: [4], hint: t('four even pulses — a bare metronome that fuses into one pure tone') },
  { name: t('3:2 hemiola'), ratios: [3, 2], hint: t('three against two → speeds up into a perfect fifth') },
  { name: '4:3', ratios: [4, 3], hint: t('four against three → perfect fourth') },
  { name: '5:4', ratios: [5, 4], hint: t('five against four → just major third') },
  { name: '7:6', ratios: [7, 6], hint: t('seven against six → septimal minor third, the blue one') },
  { name: '4:5:6', ratios: [4, 5, 6], hint: t('three trains → just major chord') },
  { name: '6:7:9', ratios: [6, 7, 9], hint: t('three trains → septimal minor chord, darker and buzzier') },
  { name: '3:4:5', ratios: [3, 4, 5], hint: t('perfect fourth + just major third stacked — a major chord, second inversion') },
  { name: '2:3:7', ratios: [2, 3, 7], hint: t('fifth plus harmonic seventh — a spectral stack') },
  { name: 'φ', ratios: [1, 1.6180339887], hint: t('golden ratio — never aligns, ever') },
];

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function pct(v) { return Math.round(v * 100) + '%'; }
function ratioStr(r) {
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toFixed(3);
}

const MOD = {
  id: 'beatlab',
  title: t('RHYTHM ⇄ PITCH'),
  tagline: t('a polyrhythm you can speed up until it becomes a chord'),

  build(body, head) {
    // ---- state (audio-free; the AudioContext does not exist yet) ------------
    const voices = [
      { enabled: true, ratio: 4, sound: 'tick', pitch: 880, level: 0.8 },
      { enabled: true, ratio: 3, sound: 'blip', pitch: 660, level: 0.8 },
      { enabled: false, ratio: 5, sound: 'tom', pitch: 440, level: 0.7 },
      { enabled: false, ratio: 7, sound: 'pulse', pitch: 330, level: 0.7 },
    ];
    const state = { rate: 1.2, level: 0.7 };

    let built = false;
    let running = false;
    let bus = null;       // the ONE module channel (level slider targets this)
    let outGain = null;   // power envelope — ramps on start/stop, no clicks
    let clickBus = null;  // click engine sum   (crossfade cos)
    let toneBus = null;   // tone engine sum    (crossfade sin)
    let noiseBuf = null;
    const clickGain = [null, null, null, null]; // per-voice level (click side)
    const toneGain = [null, null, null, null];  // per-voice level (tone side)
    const toneOsc = [null, null, null, null];   // continuous oscillators, per power-on
    const activeSrcs = new Set();               // scheduled one-shot click sources
    const stoppingOscs = new Set();             // tone oscs fading out after power-off

    // ---- phase integrator ----------------------------------------------------
    // Cycle phase advances at `rate` cycles/s. Cursors live in phase, not time,
    // so rate changes mid-flight stay phase-continuous. Reanchor BEFORE every
    // rate change so phase history is folded in at the old rate.
    let phAnchor = 0;
    let phTime = 0;
    const phaseAt = (t) => phAnchor + (t - phTime) * state.rate;
    function reanchor() {
      const t = Engine.now();
      phAnchor = phaseAt(t);
      phTime = t;
    }

    // ---- click engine (Clock lookahead scheduler) ----------------------------
    const cursors = [0, 0, 0, 0]; // next fire, in cycle phase
    let clickSynced = false;      // false → resync cursors on next tick
    const flashQ = [];            // scheduled {t, v, ph} the draw loop consumes
    const flashes = [];           // fired, decaying on the wheel

    function resyncCursor(i, t = Engine.now()) {
      const p = phaseAt(t);
      cursors[i] = (Math.floor(p * voices[i].ratio + 1e-9) + 1) / voices[i].ratio;
    }

    function onTick(horizon) {
      const now = Engine.now();
      if (state.rate > XF_HI) { clickSynced = false; return; } // pure tone zone
      if (!clickSynced) {
        for (let i = 0; i < 4; i++) resyncCursor(i, now);
        clickSynced = true;
      }
      const hp = phaseAt(horizon);
      for (let i = 0; i < 4; i++) {
        const v = voices[i];
        if (!v.enabled) continue;
        let guard = 0;
        while (cursors[i] < hp && guard++ < 512) {
          const t = phTime + (cursors[i] - phAnchor) / state.rate;
          if (t > now - 0.03) {
            scheduleClick(i, Math.max(t, now + 0.001));
            if (flashQ.length < 600) flashQ.push({ t, v: i, ph: ((cursors[i] % 1) + 1) % 1 });
          }
          cursors[i] += 1 / v.ratio;
        }
      }
    }

    const clock = new Clock(onTick, 25, 0.12);

    function scheduleClick(i, t) {
      const ctx = Engine.ctx;
      const v = voices[i];
      const env = ctx.createGain();
      env.connect(clickGain[i]);
      env.gain.setValueAtTime(0, t);
      let src;
      const extras = [];
      if (v.sound === 'tick') {
        src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = v.pitch;
        bp.Q.value = 6;
        src.connect(bp); bp.connect(env);
        extras.push(bp);
        env.gain.linearRampToValueAtTime(1.1, t + 0.001);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        src.start(t); src.stop(t + 0.07);
      } else {
        src = ctx.createOscillator();
        src.type = WAVE[v.sound];
        src.frequency.setValueAtTime(v.pitch, t);
        src.connect(env);
        if (v.sound === 'blip') {
          env.gain.linearRampToValueAtTime(0.8, t + 0.002);
          env.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
          src.start(t); src.stop(t + 0.11);
        } else if (v.sound === 'tom') {
          src.frequency.exponentialRampToValueAtTime(Math.max(40, v.pitch * 0.42), t + 0.12);
          env.gain.linearRampToValueAtTime(0.9, t + 0.003);
          env.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
          src.start(t); src.stop(t + 0.19);
        } else { // pulse
          env.gain.linearRampToValueAtTime(0.45, t + 0.001);
          env.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
          src.start(t); src.stop(t + 0.045);
        }
      }
      activeSrcs.add(src);
      src.onended = () => {
        activeSrcs.delete(src);
        try { src.disconnect(); env.disconnect(); extras.forEach((n) => n.disconnect()); } catch (e) { /* gone */ }
      };
    }

    // ---- audio graph (lazy) ---------------------------------------------------
    function buildAudio() {
      if (built) return;
      const ctx = Engine.ctx;
      bus = Engine.createChannel(state.level);
      outGain = ctx.createGain();
      outGain.gain.value = 0;
      outGain.connect(bus);
      clickBus = ctx.createGain();
      toneBus = ctx.createGain();
      toneBus.gain.value = 0;
      clickBus.connect(outGain);
      toneBus.connect(outGain);
      for (let i = 0; i < 4; i++) {
        clickGain[i] = ctx.createGain();
        toneGain[i] = ctx.createGain();
        clickGain[i].connect(clickBus);
        toneGain[i].connect(toneBus);
      }
      noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.1), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      built = true;
    }

    function applyVoiceGains(i, immediate = false) {
      if (!built) return;
      const t = Engine.now();
      const v = voices[i];
      const on = v.enabled ? v.level : 0;
      if (immediate) {
        clickGain[i].gain.value = on;
        toneGain[i].gain.value = on * TONE_SCALE[v.sound];
      } else {
        clickGain[i].gain.setTargetAtTime(on, t, 0.03);
        toneGain[i].gain.setTargetAtTime(on * TONE_SCALE[v.sound], t, 0.03);
      }
    }

    function applyRate() {
      if (!built) return;
      const t = Engine.now();
      const x = clamp((state.rate - XF_LO) / (XF_HI - XF_LO), 0, 1);
      clickBus.gain.setTargetAtTime(Math.cos(x * Math.PI / 2), t, 0.03);
      toneBus.gain.setTargetAtTime(Math.sin(x * Math.PI / 2), t, 0.03);
      for (let i = 0; i < 4; i++) {
        if (toneOsc[i]) {
          toneOsc[i].frequency.setTargetAtTime(
            clamp(state.rate * voices[i].ratio, 0.1, 12000), t, 0.025);
        }
      }
    }

    function setRate(v) {
      v = clamp(v, 0.5, 400);
      if (Engine.ready) reanchor(); // fold elapsed phase in at the OLD rate first
      if (v < state.rate) clickSynced = false; // slower rate: cursors may sit far ahead — resync next tick
      state.rate = v;
      applyRate();
      updateReadouts();
    }

    // ---- power ------------------------------------------------------------------
    function startSound(fade) { // fade (s): optional attack length; default = classic power-on
      Engine.init();
      if (running) return;
      running = true;
      buildAudio();
      // silence any oscillators still fading from a rapid off→on
      for (const o of stoppingOscs) { try { o.disconnect(); } catch (e) { /* gone */ } }
      stoppingOscs.clear();
      // flush clicks still queued from the pre-off pattern (onended prunes the set)
      for (const s of activeSrcs) { try { s.stop(); } catch (e) { /* already stopped */ } }
      const t = Engine.now();
      phAnchor = 0;
      phTime = t + 0.05; // first downbeat lands just after the ramp opens
      clickSynced = false;
      rotLast = t; // wheel rotation integrates from here
      for (let i = 0; i < 4; i++) {
        applyVoiceGains(i, true);
        const o = Engine.ctx.createOscillator();
        o.type = WAVE[voices[i].sound];
        o.frequency.value = clamp(state.rate * voices[i].ratio, 0.1, 12000);
        o.connect(toneGain[i]);
        o.start();
        toneOsc[i] = o;
      }
      applyRate();
      // read-before-cancel: a pending off-fade may still be mid-flight (rapid off→on)
      const cur = outGain.gain.value;
      outGain.gain.cancelScheduledValues(t);
      outGain.gain.setValueAtTime(cur, t);
      if (fade != null && isFinite(fade)) {
        outGain.gain.linearRampToValueAtTime(1, t + Math.max(0.005, fade));
      } else {
        outGain.gain.setTargetAtTime(1, t, 0.06);
      }
      clock.start();
      startDraw();
    }

    function stopSound(fade = 0.08) { // INSTANT OFF by default: audibly silent within ~80 ms
      fade = isFinite(fade) ? Math.max(0.005, fade) : 0.08;
      if (!running) {
        // STOP ALL during a remote fade-out: the flag is already down but the
        // long ramp may still be sounding — hard-cut it to honor instant off.
        if (built && fade < 0.1) {
          clock.stop();
          const t = Engine.now();
          const cur = outGain.gain.value;
          outGain.gain.cancelScheduledValues(t);
          outGain.gain.setValueAtTime(cur, t);
          outGain.gain.linearRampToValueAtTime(0, t + fade);
          for (const s of activeSrcs) { try { s.stop(t + fade); } catch (e) { /* already stopped */ } }
          for (const o of stoppingOscs) { try { o.stop(t + fade); } catch (e) { /* already stopped */ } }
        }
        return;
      }
      running = false;
      // long fade (scene crossfade): keep the click scheduler running through
      // the fade so the rhythm fades instead of hard-cutting to silence.
      if (fade < 0.1) {
        clock.stop();
      } else {
        setTimeout(() => { if (!running) { clock.stop(); flashQ.length = 0; } }, fade * 1000);
      }
      haltSpin();
      const t = Engine.now();
      // read-before-cancel: the attack ramp may still be running (rapid on→off)
      const cur = outGain.gain.value;
      outGain.gain.cancelScheduledValues(t);
      outGain.gain.setValueAtTime(cur, t);
      outGain.gain.linearRampToValueAtTime(0, t + fade);
      const tEnd = t + fade + 0.05; // deferred node teardown, once the fade has finished
      for (let i = 0; i < 4; i++) {
        const o = toneOsc[i];
        toneOsc[i] = null;
        if (!o) continue;
        stoppingOscs.add(o);
        o.onended = () => { stoppingOscs.delete(o); try { o.disconnect(); } catch (e) { /* gone */ } };
        try { o.stop(tEnd); } catch (e) { /* already stopped */ }
      }
      for (const s of activeSrcs) { try { s.stop(tEnd); } catch (e) { /* already stopped */ } }
      flashQ.length = 0;
      flashes.length = 0;
      stopDraw();
    }

    const powerCtl = UI.power({
      title: t('power — 4:3 at 1.2 Hz, then press SPIN UP'),
      onChange: (on) => { if (on) startSound(); else stopSound(); },
    });
    head.append(powerCtl.el);
    Engine.onStopAll(() => { stopSound(); powerCtl.set(false); });

    // ---- readouts -------------------------------------------------------------
    const rateRd = UI.readout('—', 'big');
    const voiceRd = UI.readout('—');
    const intervalRd = UI.readout('—');
    rateRd.el.style.margin = '10px 0 8px';
    voiceRd.el.style.margin = '0 0 10px';
    intervalRd.el.style.marginTop = '10px';

    function zoneOf(r) { return r < 8 ? 'RHYTHM' : r < 25 ? 'FLUTTER' : 'TONE'; }

    function updateReadouts() {
      const r = state.rate;
      const z = zoneOf(r); // English zone word — compared below; translate on display only
      rateRd.set(`${t('cycle')} ${UI.fmt(r)} ${t('Hz')} · ${Math.round(r * 60)} BPM · ${t(z)}`);
      const on = voices.map((v, i) => ({ v, i })).filter((o) => o.v.enabled);
      if (!on.length) {
        voiceRd.set(t('all voices off'));
      } else if (z === 'TONE') {
        voiceRd.set(on.map(({ v, i }) => {
          const f = r * v.ratio;
          return `v${i + 1} ${ratioStr(v.ratio)}× = ${UI.fmt(f)} ${t('Hz')} · ${noteLabel(f)}`;
        }).join('  ·  '));
      } else {
        voiceRd.set(on.map(({ v, i }) =>
          `v${i + 1} ${ratioStr(v.ratio)}× → ${t('every')} ${UI.fmt(1000 / (r * v.ratio))} ${t('ms')}`
        ).join('  ·  '));
      }
      updateIntervals();
    }

    function updateIntervals() {
      const on = voices.filter((v) => v.enabled).map((v) => v.ratio).sort((a, b) => a - b);
      if (!on.length) { intervalRd.set(t('no voices enabled')); return; }
      // integerize rational fractional sets (e.g. 1.5:1 → 3:2); only give up when no k works
      let k = 0;
      for (let m = 1; m <= 48; m++) {
        if (on.every((r) => Math.abs(m * r - Math.round(m * r)) < 1e-6)) { k = m; break; }
      }
      if (!k) {
        intervalRd.set(t('irrational — never repeats'));
        return;
      }
      const ints = on.map((r) => Math.round(k * r));
      if (ints.length === 1) { intervalRd.set(`${ints[0] / k} ${t('per cycle — solo train, no interval')}`); return; }
      const g = ints.reduce((a, b) => gcd(a, b));
      const red = ints.map((n) => n / g);
      const key = red.join(':');
      if (CHORDS[key]) { intervalRd.set(`${key} → ${t(CHORDS[key])}`); return; }
      const s = red[0];
      const parts = red.slice(1).map((r) => {
        const gg = gcd(r, s);
        const a = r / gg, b = s / gg;
        const name = ratioName(a, b);
        return `${a}:${b} → ${name ? t(name) : Math.round(centsBetween(1, a / b)) + '¢'}`;
      });
      intervalRd.set(parts.join(' · '));
    }

    // ---- global controls --------------------------------------------------------
    const rateSl = UI.slider({
      label: t('rate'), min: 0.5, max: 400, value: state.rate, log: true, unit: t('Hz'),
      onInput: (v) => { haltSpin(); setRate(v); },
    });

    const levelSl = UI.slider({
      label: t('level'), min: 0, max: 1, value: state.level, format: pct,
      onInput: (v) => {
        state.level = v;
        if (bus) bus.gain.setTargetAtTime(v, Engine.now(), 0.03);
      },
    });

    // ---- spin up / spin down ------------------------------------------------------
    let spinMode = 'idle'; // idle | up | down | spun
    let spinRaf = 0;
    let preSpin = state.rate;

    const spinBtn = UI.button({
      label: t('SPIN UP'),
      kind: 'primary',
      title: t('ramp rate ×32 over 15 s — hear the rhythm fuse into a chord'),
      onClick: () => {
        if (spinMode === 'up' || spinMode === 'down') { haltSpin(); return; }
        if (spinMode === 'spun') {
          spinMode = 'down';
          setSpinLabel();
          runRamp(preSpin, 8, 'idle');
          return;
        }
        preSpin = state.rate;
        spinMode = 'up';
        setSpinLabel();
        runRamp(Math.min(state.rate * 32, 400), 15, 'spun');
      },
    });

    function setSpinLabel() {
      spinBtn.textContent =
        (spinMode === 'up' || spinMode === 'down') ? t('HOLD')
          : spinMode === 'spun' ? t('SPIN DOWN') : t('SPIN UP');
    }

    function cancelRamp() {
      if (spinRaf) cancelAnimationFrame(spinRaf);
      spinRaf = 0;
    }

    function haltSpin() { // HOLD, slider grab, or power-off: freeze at current rate
      if (spinMode !== 'up' && spinMode !== 'down') return;
      cancelRamp();
      spinMode = state.rate > preSpin * 1.02 ? 'spun' : 'idle';
      setSpinLabel();
    }

    function runRamp(target, dur, doneMode) {
      cancelRamp();
      const from = state.rate;
      if (Math.abs(target - from) < 1e-9) { spinMode = doneMode; setSpinLabel(); return; }
      let u = 0;
      let lastT = performance.now();
      const step = () => {
        const nowMs = performance.now();
        u = clamp(u + Math.min(nowMs - lastT, 50) / (dur * 1000), 0, 1); // clamped delta — a hidden tab pauses the ramp
        lastT = nowMs;
        const r = from * Math.pow(target / from, u); // exponential — even in pitch
        setRate(r);
        rateSl.set(r);
        if (u >= 1) {
          spinRaf = 0;
          spinMode = doneMode;
          setSpinLabel();
        } else {
          spinRaf = requestAnimationFrame(step);
        }
      };
      spinRaf = requestAnimationFrame(step);
    }

    // ---- voice rows ----------------------------------------------------------------
    const enT = [], ratioB = [], soundS = [], pitchB = [], lvlS = [];

    function voiceRow(i) {
      const v = voices[i];
      const en = UI.toggle({
        label: `v${i + 1}`, value: v.enabled,
        onChange: (on) => {
          v.enabled = on;
          if (on && running) resyncCursor(i);
          applyVoiceGains(i);
          applyRate();
          updateReadouts();
        },
      });
      const ratio = UI.numberBox({
        label: t('ratio'), value: v.ratio, min: 0.25, max: 16, step: 'any',
        onChange: (val) => {
          v.ratio = val;
          if (running) resyncCursor(i);
          applyRate();
          updateReadouts();
        },
      });
      const sound = UI.select({
        // values stay English — WAVE/TONE_SCALE lookups and remote.apply() compare them
        label: t('sound'),
        options: ['tick', 'blip', 'tom', 'pulse'].map((s) => ({ value: s, label: t(s) })),
        value: v.sound,
        onChange: (s) => {
          v.sound = s;
          if (toneOsc[i]) toneOsc[i].type = WAVE[s];
          applyVoiceGains(i);
        },
      });
      const pitch = UI.numberBox({
        label: t('pitch'), unit: t('Hz'), value: v.pitch, min: 60, max: 2000, step: 1,
        onChange: (val) => { v.pitch = val; },
      });
      const lvl = UI.slider({
        label: t('level'), min: 0, max: 1, value: v.level, format: pct,
        onInput: (val) => { v.level = val; applyVoiceGains(i); },
      });
      ratio.el.style.width = '86px';
      sound.el.style.width = '96px';
      sound.el.style.flex = 'none';
      pitch.el.style.width = '104px';
      lvl.el.style.flex = '1 1 110px';
      const dot = document.createElement('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:50%;flex:none;background:${COLORS[i]};box-shadow:0 0 8px ${COLORS[i]};`;
      enT[i] = en;
      ratioB[i] = ratio;
      soundS[i] = sound;
      pitchB[i] = pitch;
      lvlS[i] = lvl;
      return UI.row(dot, en, ratio, sound, pitch, lvl);
    }

    // ---- presets --------------------------------------------------------------------
    const presetChips = UI.chips({
      label: t('ratio presets'),
      items: PRESETS,
      onPick: (item) => applyPreset(item.ratios),
    });

    function applyPreset(ratios) {
      const t = Engine.ready ? Engine.now() : 0;
      for (let i = 0; i < 4; i++) {
        const v = voices[i];
        const en = i < ratios.length;
        v.enabled = en;
        if (en) {
          v.ratio = ratios[i];
          ratioB[i].set(v.ratio);
        }
        enT[i].set(en);
        applyVoiceGains(i); // ramped if playing
        if (running && en) resyncCursor(i, t);
      }
      applyRate(); // retunes tone oscillators with ramps
      updateReadouts();
    }

    // ---- rhythm wheel -----------------------------------------------------------------
    const canvas = document.createElement('canvas');
    canvas.className = 'mini-canvas';
    canvas.style.height = '170px';
    let rafId = 0;
    let rot = 0;     // chord-geometry rotation, integrated frame by frame
    let rotLast = 0; // previous frame's audio time

    function startDraw() { if (!rafId) rafId = requestAnimationFrame(draw); }
    function stopDraw() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

    function dotPhases(ratio) {
      const out = [];
      const n = Math.max(1, Math.ceil(ratio - 1e-9));
      for (let k = 0; k < n; k++) {
        const p = k / ratio;
        if (p < 1 - 1e-9) out.push(p);
      }
      return out;
    }

    function draw() {
      rafId = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 300;
      const h = canvas.clientHeight || 170;
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const now = Engine.now();
      // consume scheduled flashes whose time has passed; prune old ones
      for (let k = flashQ.length - 1; k >= 0; k--) {
        if (flashQ[k].t <= now) { flashes.push(flashQ[k]); flashQ.splice(k, 1); }
      }
      for (let k = flashes.length - 1; k >= 0; k--) {
        if (now - flashes[k].t > 0.4) flashes.splice(k, 1);
      }

      const cx = w / 2, cy = h / 2;
      const R0 = Math.min(w, h) / 2 - 12;
      const x = clamp((state.rate - XF_LO) / (XF_HI - XF_LO), 0, 1); // 0 rhythm → 1 tone
      const ph = ((phaseAt(now) % 1) + 1) % 1;
      rot += (now - rotLast) * 0.15 * x; // chord geometry slowly rotates in the tone zone
      rotLast = now;
      const radii = [0.4, 0.6, 0.8, 1.0].map((f) => R0 * f);
      const ang = (p) => -Math.PI / 2 + (p + rot / (2 * Math.PI)) * 2 * Math.PI;

      for (let i = 0; i < 4; i++) {
        if (!voices[i].enabled) continue;
        const r = radii[i];
        const col = COLORS[i];
        // ring
        g.beginPath();
        g.arc(cx, cy, r, 0, 2 * Math.PI);
        g.strokeStyle = col;
        g.globalAlpha = 0.22;
        g.lineWidth = 1;
        g.stroke();
        const dots = dotPhases(voices[i].ratio);
        // tone zone: star polygon connecting the ring's dots
        if (x > 0.01 && dots.length >= 2) {
          g.beginPath();
          dots.forEach((p, k) => {
            const a = ang(p);
            const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
            k === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
          });
          g.closePath();
          g.strokeStyle = col;
          g.globalAlpha = 0.75 * x;
          g.lineWidth = 1.5;
          g.shadowColor = col;
          g.shadowBlur = 10 * x;
          g.stroke();
          g.shadowBlur = 0;
        }
        // base dots
        for (const p of dots) {
          const a = ang(p);
          g.beginPath();
          g.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 3, 0, 2 * Math.PI);
          g.fillStyle = col;
          g.globalAlpha = 0.5 + 0.45 * x;
          g.fill();
        }
      }

      // rhythm zone: fired dots flash bright and decay (~150 ms)
      if (x < 0.99) {
        for (const f of flashes) {
          if (!voices[f.v].enabled) continue;
          const a = Math.exp(-(now - f.t) / 0.15) * (1 - x);
          if (a < 0.02) continue;
          const r = radii[f.v];
          const an = ang(f.ph);
          g.beginPath();
          g.arc(cx + r * Math.cos(an), cy + r * Math.sin(an), 3 + 4 * a, 0, 2 * Math.PI);
          g.fillStyle = COLORS[f.v];
          g.globalAlpha = a;
          g.shadowColor = COLORS[f.v];
          g.shadowBlur = 16 * a;
          g.fill();
          g.shadowBlur = 0;
        }
        // sweep hand — one revolution per cycle, locked to the scheduler's phase
        const ha = -Math.PI / 2 + ph * 2 * Math.PI;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + R0 * Math.cos(ha), cy + R0 * Math.sin(ha));
        g.strokeStyle = '#e9e7f7';
        g.globalAlpha = 0.75 * (1 - x);
        g.lineWidth = 1;
        g.stroke();
      }
      // hub
      g.beginPath();
      g.arc(cx, cy, 2.5, 0, 2 * Math.PI);
      g.fillStyle = '#e9e7f7';
      g.globalAlpha = 0.8;
      g.fill();
      g.globalAlpha = 1;
    }

    // ---- assemble --------------------------------------------------------------------
    levelSl.el.style.flex = '1 1 160px';
    const cols = document.createElement('div');
    cols.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:0 20px;align-items:start;';
    const left = document.createElement('div');
    const right = document.createElement('div');
    cols.append(left, right);
    body.append(cols);

    left.append(
      UI.group(t('cycle — rhythm to pitch'),
        rateSl, rateRd, voiceRd,
        UI.row(spinBtn, levelSl)),
      presetChips.el,
      UI.group(t('pulse trains'), voiceRow(0), voiceRow(1), voiceRow(2), voiceRow(3)),
    );
    right.append(
      UI.group(t('rhythm wheel'), canvas, intervalRd),
    );

    updateReadouts();

    // ---- remote API (VIBE macro layer) ----------------------------------------------
    MOD.remote = {
      isOn: () => running,

      // Same code paths as the power button; powerCtl.set() keeps the LED in sync.
      // fade (s) shapes THIS transition's output-gain envelope; off defaults to 0.08.
      power(on, fade) {
        if (on) {
          if (!running) startSound(fade); // Engine.init() runs inside, as the button path does
        } else {
          haltSpin(); // halt an in-flight SPIN ramp even if audio never started
          stopSound(fade);
        }
        powerCtl.set(!!on);
      },

      // Partial params: { rate, level, voices: [{ on, ratio, sound, pitch, level }, ...] }.
      // State + UI always; live audio ramps only while playing. Never toggles power.
      apply(params) {
        if (!params || typeof params !== 'object') return;
        if (params.rate != null && isFinite(params.rate)) {
          haltSpin(); // an active SPIN ramp would immediately override the new rate
          setRate(params.rate); // clamp + cursor resync + click-free ramps + readouts
          rateSl.set(state.rate);
        }
        if (params.level != null && isFinite(params.level)) {
          state.level = clamp(params.level, 0, 1);
          levelSl.set(state.level);
          if (bus) bus.gain.setTargetAtTime(state.level, Engine.now(), 0.03);
        }
        if (Array.isArray(params.voices)) {
          let touched = false;
          params.voices.forEach((pv, i) => {
            if (!pv || typeof pv !== 'object' || i > 3) return;
            const v = voices[i];
            if (typeof pv.on === 'boolean') {
              v.enabled = pv.on;
              enT[i].set(pv.on);
              if (pv.on && running) resyncCursor(i);
            }
            if (pv.ratio != null && isFinite(pv.ratio)) {
              v.ratio = clamp(pv.ratio, 0.25, 16);
              ratioB[i].set(v.ratio);
              if (running) resyncCursor(i);
            }
            if (pv.sound != null && WAVE[pv.sound]) {
              v.sound = pv.sound;
              soundS[i].set(pv.sound);
              if (toneOsc[i]) toneOsc[i].type = WAVE[pv.sound];
            }
            if (pv.pitch != null && isFinite(pv.pitch)) {
              v.pitch = clamp(pv.pitch, 60, 2000);
              pitchB[i].set(v.pitch);
            }
            if (pv.level != null && isFinite(pv.level)) {
              v.level = clamp(pv.level, 0, 1);
              lvlS[i].set(v.level);
            }
            applyVoiceGains(i); // ramped; no-op while the graph is unbuilt
            touched = true;
          });
          if (touched) { applyRate(); updateReadouts(); }
        }
      },

      // Transpose click pitches so voice 1 lands on the key's C5..B5 note.
      // Defaults 880/660/440/330 are A5/E5/A4/E4 — key A (9) restores them.
      setKey(noteIdx) {
        const mult = midiToFreq(72 + noteIdx) / voices[0].pitch;
        if (!isFinite(mult) || mult <= 0) return;
        for (let i = 0; i < 4; i++) {
          voices[i].pitch = clamp(Math.round(voices[i].pitch * mult * 100) / 100, 60, 2000);
          pitchB[i].set(voices[i].pitch);
        }
      },
    };
  },
};

export default MOD;
