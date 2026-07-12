// drums.js — OSCILLARIUM module: DRUMS. A fully synthesized step-sequencer
// drum machine — no samples, every voice is oscillators and noise buffers.
// 16 sixteenth-note cells per voice (pattern length 8–16), Clock-scheduled
// like beatlab, with swing on the odd sixteenths. While running it drives the
// shared Transport (driver = 'drums') and emits a 'bar' event each time step 0
// is scheduled, so other modules (drone progressions etc.) can ride the grid.

import { Engine, Clock, Transport, clamp } from '../engine.js';
import * as UI from '../ui.js';
import { t, registerDict } from '../i18n.js';

// Russian dictionary — display strings only. Voice KEYS, preset NAMES (remote
// genre lookup keys, vibe deck contract) and remote.apply() params stay English.
registerDict('ru', {
  'DRUMS': 'БАРАБАНЫ',
  'a drum machine for jamming — arbitrary sounds, honest grooves':
    'драм-машина для джема — условные звуки, честный грув',
  'drums power': 'питание барабанов',
  // voice row labels
  'kick': 'бочка',
  'snare': 'малый',
  'hat': 'хэт',
  'open': 'опен',
  'clap': 'клэп',
  'perc': 'перк',
  // controls
  'bpm': 'уд/мин',
  'swing': 'свинг',
  'length': 'длина',
  'level': 'уровень',
  'lvl': 'уров',
  'steps': 'шагов',
  'groove': 'грув',
  'genres': 'жанры',
  'GENERATE ⚄': 'СГЕНЕРИРОВАТЬ ⚄',
  'roll a fresh groove — keeps your bpm and swing':
    'выбросить свежий грув — bpm и свинг остаются как есть',
  // readout pattern names ('custom'/'generated' are display-only)
  'custom': 'свой',
  'generated': 'сгенерировано',
  // genre chip hints (chip names stay English — they are proper names and lookup keys)
  'four on the floor, claps on the backbeat, open hats between the kicks':
    'четыре-на-четыре, клэпы на бэкбите, открытые хэты между бочками',
  'swung head-nod hip hop — kick tucked behind the backbeat':
    'свингованный кивающий хип-хоп — бочка прячется за бэкбитом',
  'a chopped funk break — ghost snares, busy hats with gaps':
    'порезанный фанковый брейк — призрачные малые, плотные хэты с дырами',
  'one-drop — kick and snare land together on beat 3, rim keeps time':
    'уан-дроп — бочка и малый падают вместе на третью долю, римшот держит время',
  'huge and slow — one kick, one snare, hats carry the pulse':
    'огромно и медленно — одна бочка, один малый, пульс несут хэты',
  'the autobahn beat — relentless straight sixteenths, zero swing':
    'бит автобана — неумолимые ровные шестнадцатые, ноль свинга',
  'two-step at 172 — kick on 1, the and-of-2, snares cracking 2 and 4':
    'ту-степ на 172 — бочка на раз и на «и» второй доли, малые щёлкают по 2 и 4',
  '7/8 in a 2+2+3 grouping — fourteen sixteenths per bar':
    '7/8 группировкой 2+2+3 — четырнадцать шестнадцатых на такт',
  'dark and relentless — pounding floor, offbeat opens, hats in the cracks':
    'темно и неумолимо — молотящая бочка, опены на офбите, хэты в щелях',
  'four on the floor with opens lifting every offbeat — claps crack the backbeat':
    'четыре-на-четыре, опены подбрасывают каждый офбит — клэпы щёлкают по бэкбиту',
  'half-time — syncopated kicks, snare on 3, hat roll tumbling into the turnaround':
    'хаф-тайм — синкопы бочки, малый на 3, дробь хэта скатывается в разворот',
  'a rolling clave — rim carries the pattern, hats accent the offbeats':
    'катящаяся клаве — римшот ведёт рисунок, хэты акцентируют офбиты',
  'a chopped breakbeat at 168 — ghost snares around the cracks, hats with gaps':
    'порезанный брейкбит на 168 — призрачные малые вокруг щелчков, хэты с дырами',
  '3/4 time — twelve sixteenths, ONE two three, open hat lifting the turnaround':
    'размер 3/4 — двенадцать шестнадцатых, РАЗ два три, открытый хэт подхватывает разворот',
});

const STEPS = 16; // cells allocated per voice; state.length trims playback

const VOICES = [
  { key: 'kick', label: t('kick'), level: 0.9 },
  { key: 'snare', label: t('snare'), level: 0.8 },
  { key: 'hat', label: t('hat'), level: 0.55 },
  { key: 'open', label: t('open'), level: 0.5 },
  { key: 'clap', label: t('clap'), level: 0.6 },
  { key: 'perc', label: t('perc'), level: 0.5 },
];

// 16-cell row: 1 where `on`, 2 where `acc` (accent = ×1.5 gain).
function stepsArr(on = [], acc = []) {
  const a = new Array(STEPS).fill(0);
  for (const i of on) a[i] = 1;
  for (const i of acc) a[i] = 2;
  return a;
}

function pct(v) { return Math.round(v * 100) + '%'; }

const PRESETS = [
  {
    name: 'house', bpm: 122, swing: 0, length: 16,
    hint: t('four on the floor, claps on the backbeat, open hats between the kicks'),
    pattern: {
      kick: stepsArr([4, 8, 12], [0]),
      clap: stepsArr([4, 12]),
      open: stepsArr([2, 6, 10, 14]),
      hat: stepsArr([0, 4, 8, 12]),
    },
  },
  {
    name: 'boom bap', bpm: 90, swing: 0.16, length: 16,
    hint: t('swung head-nod hip hop — kick tucked behind the backbeat'),
    pattern: {
      kick: stepsArr([7, 10], [0]),
      snare: stepsArr([4, 12]),
      hat: stepsArr([2, 4, 6, 10, 12, 14], [0, 8]),
    },
  },
  {
    name: 'breaks', bpm: 105, swing: 0, length: 16,
    hint: t('a chopped funk break — ghost snares, busy hats with gaps'),
    pattern: {
      kick: stepsArr([10], [0]),
      snare: stepsArr([7, 15], [4, 12]),
      hat: stepsArr([1, 2, 3, 5, 6, 8, 9, 11, 13, 14], [0, 10]),
    },
  },
  {
    name: 'dub', bpm: 75, swing: 0, length: 16,
    hint: t('one-drop — kick and snare land together on beat 3, rim keeps time'),
    pattern: {
      kick: stepsArr([], [8]),
      snare: stepsArr([], [8]),
      perc: stepsArr([4, 12]),
      hat: stepsArr([2, 6, 10]),
      open: stepsArr([14]),
    },
  },
  {
    name: 'half-time', bpm: 82, swing: 0, length: 16,
    hint: t('huge and slow — one kick, one snare, hats carry the pulse'),
    pattern: {
      kick: stepsArr([], [0]),
      snare: stepsArr([], [8]),
      hat: stepsArr([2, 4, 6, 8, 10, 12, 14], [0]),
      perc: stepsArr([11]),
    },
  },
  {
    name: 'motorik', bpm: 120, swing: 0, length: 16,
    hint: t('the autobahn beat — relentless straight sixteenths, zero swing'),
    pattern: {
      kick: stepsArr([4, 8, 12], [0]),
      snare: stepsArr([4, 12]),
      hat: stepsArr([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], [0, 4, 8, 12]),
    },
  },
  {
    name: 'dnb', bpm: 172, swing: 0, length: 16,
    hint: t('two-step at 172 — kick on 1, the and-of-2, snares cracking 2 and 4'),
    pattern: {
      kick: stepsArr([10], [0]),
      snare: stepsArr([], [4, 12]),
      hat: stepsArr([2, 5, 7, 11, 13]),
      open: stepsArr([6]),
    },
  },
  {
    name: 'seven eight', bpm: 98, swing: 0, length: 14,
    hint: t('7/8 in a 2+2+3 grouping — fourteen sixteenths per bar'),
    pattern: {
      kick: stepsArr([4], [0, 8]),
      snare: stepsArr([4, 10]),
      hat: stepsArr([0, 2, 4, 6, 8, 10, 12]),
      perc: stepsArr([13]),
    },
  },
  {
    name: 'techno', bpm: 132, swing: 0, length: 16,
    hint: t('dark and relentless — pounding floor, offbeat opens, hats in the cracks'),
    pattern: {
      kick: stepsArr([4, 12], [0, 8]),
      open: stepsArr([2, 6, 10, 14]),
      hat: stepsArr([3, 7, 11, 15]),
      perc: stepsArr([7]),
    },
  },
  {
    name: 'disco', bpm: 118, swing: 0.05, length: 16,
    hint: t('four on the floor with opens lifting every offbeat — claps crack the backbeat'),
    pattern: {
      kick: stepsArr([4, 8, 12], [0]),
      open: stepsArr([2, 6, 10, 14]),
      clap: stepsArr([], [4, 12]),
      hat: stepsArr([0, 2, 4, 6, 8, 10, 12, 14]),
      perc: stepsArr([14]),
    },
  },
  {
    name: 'trap', bpm: 70, swing: 0, length: 16,
    hint: t('half-time — syncopated kicks, snare on 3, hat roll tumbling into the turnaround'),
    pattern: {
      kick: stepsArr([3, 10], [0]),
      snare: stepsArr([], [8]),
      clap: stepsArr([8]),
      hat: stepsArr([0, 2, 4, 6, 8, 10, 12, 13], [14, 15]),
    },
  },
  {
    name: 'afrobeat', bpm: 108, swing: 0.08, length: 16,
    hint: t('a rolling clave — rim carries the pattern, hats accent the offbeats'),
    pattern: {
      kick: stepsArr([6, 10], [0]),
      perc: stepsArr([2, 5, 8, 12, 14]),
      hat: stepsArr([0, 4, 8, 12], [2, 6, 10, 14]),
      open: stepsArr([15]),
    },
  },
  {
    name: 'jungle', bpm: 168, swing: 0, length: 16,
    hint: t('a chopped breakbeat at 168 — ghost snares around the cracks, hats with gaps'),
    pattern: {
      kick: stepsArr([10], [0]),
      snare: stepsArr([7, 15], [4, 12]),
      hat: stepsArr([1, 2, 5, 6, 8, 9, 11, 13, 14], [0]),
      open: stepsArr([3]),
    },
  },
  {
    name: 'waltz', bpm: 140, swing: 0, length: 12,
    hint: t('3/4 time — twelve sixteenths, ONE two three, open hat lifting the turnaround'),
    pattern: {
      kick: stepsArr([], [0]),
      snare: stepsArr([4, 8]),
      hat: stepsArr([0, 2, 4, 6, 8]),
      open: stepsArr([10]),
    },
  },
];

const MOD = {
  id: 'drums', // NEVER translated — DOM ids, vibe deck and remote registry key on it
  title: t('DRUMS'),
  tagline: t('a drum machine for jamming — arbitrary sounds, honest grooves'),

  build(body, head) {
    // ---- state (audio-free; the AudioContext does not exist yet) ------------
    const state = { bpm: 100, swing: 0, length: 16, level: 0.8 };
    const pattern = {}; // voice key → 16 cells of 0/1/2
    for (const v of VOICES) pattern[v.key] = new Array(STEPS).fill(0);
    let patternName = 'custom'; // for the readout; presets/generate overwrite

    let built = false;
    let running = false;
    let bus = null;      // the ONE module channel (level slider targets this)
    let outGain = null;  // power envelope — ramps on start/stop, no clicks
    let noiseBuf = null;
    const voiceGain = {};          // per-voice level nodes
    const activeSrcs = new Set();  // scheduled one-shot sources (kick oscs, noise)

    // ---- audio graph (lazy) --------------------------------------------------
    function buildAudio() {
      if (built) return;
      const ctx = Engine.ctx;
      bus = Engine.createChannel(state.level);
      outGain = ctx.createGain();
      outGain.gain.value = 0;
      outGain.connect(bus);
      for (const v of VOICES) {
        const g = ctx.createGain();
        g.gain.value = v.level;
        g.connect(outGain);
        voiceGain[v.key] = g;
      }
      noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      built = true;
    }

    // One-shot cleanup: every scheduled source unhooks itself and its chain.
    function track(src, nodes) {
      activeSrcs.add(src);
      src.onended = () => {
        activeSrcs.delete(src);
        try {
          src.disconnect();
          nodes.forEach((n) => n.disconnect());
        } catch (e) { /* already gone */ }
      };
    }

    function envGain(t) {
      const env = Engine.ctx.createGain();
      env.gain.setValueAtTime(0, t);
      return env;
    }

    // ---- the six voices (a = 1 normal hit, 1.5 accent) -----------------------
    function noiseSrc(t, dur) {
      const src = Engine.ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.start(t);
      src.stop(t + dur);
      return src;
    }

    const SYNTH = {
      kick(t, a) {
        const ctx = Engine.ctx;
        // body: sine with a fast 150 → 45 Hz exponential pitch drop
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.05);
        const env = envGain(t);
        env.gain.linearRampToValueAtTime(a, t + 0.002);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o.connect(env);
        env.connect(voiceGain.kick);
        o.start(t);
        o.stop(t + 0.2);
        track(o, [env]);
        // beater click: 2 ms of raw noise
        const n = noiseSrc(t, 0.004);
        const ce = envGain(t);
        ce.gain.linearRampToValueAtTime(a * 0.4, t + 0.0005);
        ce.gain.exponentialRampToValueAtTime(0.001, t + 0.002);
        n.connect(ce);
        ce.connect(voiceGain.kick);
        track(n, [ce]);
      },

      snare(t, a) {
        const ctx = Engine.ctx;
        const n = noiseSrc(t, 0.14);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1800;
        bp.Q.value = 0.9;
        const ne = envGain(t);
        ne.gain.linearRampToValueAtTime(a * 0.8, t + 0.0015);
        ne.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        n.connect(bp);
        bp.connect(ne);
        ne.connect(voiceGain.snare);
        track(n, [bp, ne]);
        // body tone under the noise crack
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(190, t);
        const oe = envGain(t);
        oe.gain.linearRampToValueAtTime(a * 0.5, t + 0.002);
        oe.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.connect(oe);
        oe.connect(voiceGain.snare);
        o.start(t);
        o.stop(t + 0.1);
        track(o, [oe]);
      },

      hat(t, a) { hatHit(t, a, 0.035, voiceGain.hat); },
      open(t, a) { hatHit(t, a, 0.25, voiceGain.open); },

      clap(t, a) {
        const ctx = Engine.ctx;
        const n = noiseSrc(t, 0.17);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1200;
        bp.Q.value = 1.4;
        // three bursts ~10 ms apart, the last one rings out
        const env = envGain(t);
        const p = a * 0.9;
        env.gain.linearRampToValueAtTime(p * 0.8, t + 0.001);
        env.gain.exponentialRampToValueAtTime(p * 0.25, t + 0.009);
        env.gain.linearRampToValueAtTime(p * 0.9, t + 0.011);
        env.gain.exponentialRampToValueAtTime(p * 0.25, t + 0.019);
        env.gain.linearRampToValueAtTime(p, t + 0.021);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        n.connect(bp);
        bp.connect(env);
        env.connect(voiceGain.clap);
        track(n, [bp, env]);
      },

      perc(t, a) { // rim — a short 630 Hz sine blip
        const ctx = Engine.ctx;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(630, t);
        const env = envGain(t);
        env.gain.linearRampToValueAtTime(a * 0.8, t + 0.001);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        o.connect(env);
        env.connect(voiceGain.perc);
        o.start(t);
        o.stop(t + 0.08);
        track(o, [env]);
      },
    };

    function hatHit(t, a, decay, dest) {
      const ctx = Engine.ctx;
      const n = noiseSrc(t, decay + 0.02);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const env = envGain(t);
      env.gain.linearRampToValueAtTime(a * 0.7, t + 0.001);
      env.gain.exponentialRampToValueAtTime(0.001, t + decay);
      n.connect(hp);
      hp.connect(env);
      env.connect(voiceGain.hat === dest ? voiceGain.hat : dest);
      track(n, [hp, env]);
    }

    // ---- sequencer (Clock lookahead, exactly the beatlab idiom) ---------------
    // Step times are recomputed from the CURRENT bpm at schedule time — bpm
    // changes take effect on the next scheduled step (phase continuity not
    // required here). Swing delays every odd sixteenth by swing × stepDur.
    let stepCursor = 0;  // next step index within the bar, 0..length-1
    let nextTime = 0;    // audio-clock time of that step (un-swung grid)
    const flashQ = [];   // scheduled { t, step } the playhead rAF loop consumes

    function scheduleStep(step, t) {
      for (const v of VOICES) {
        const s = pattern[v.key][step];
        if (!s) continue;
        SYNTH[v.key](t, s === 2 ? 1.5 : 1);
      }
    }

    function onTick(horizon) {
      const now = Engine.now();
      let guard = 0;
      while (nextTime < horizon && guard++ < 256) {
        const stepDur = 60 / state.bpm / 4;
        if (stepCursor === 0) {
          Transport.bpm = state.bpm;
          Engine.emit('bar', { time: nextTime, secsPerBar: state.length * stepDur });
        }
        if (nextTime > now - 0.05) {
          const swung = nextTime + (stepCursor % 2 === 1 ? state.swing * stepDur : 0);
          const t = Math.max(swung, now + 0.001);
          scheduleStep(stepCursor, t);
          if (flashQ.length < 400) flashQ.push({ t, step: stepCursor });
        }
        stepCursor = (stepCursor + 1) % state.length;
        nextTime += stepDur;
      }
    }

    const clock = new Clock(onTick, 25, 0.12);

    // ---- power -----------------------------------------------------------------
    function startSound(fade) { // fade (s): optional attack; default = classic power-on
      Engine.init();
      if (running) return;
      running = true;
      buildAudio();
      const t = Engine.now();
      stepCursor = 0;
      nextTime = t + 0.06; // first downbeat lands just after the ramp opens
      Transport.driver = 'drums';
      Transport.bpm = state.bpm;
      // read-before-cancel: a pending off-fade may still be mid-flight (rapid off→on)
      const cur = outGain.gain.value;
      outGain.gain.cancelScheduledValues(t);
      outGain.gain.setValueAtTime(cur, t);
      if (fade != null && isFinite(fade)) {
        outGain.gain.linearRampToValueAtTime(1, t + Math.max(0.005, fade));
      } else {
        outGain.gain.setTargetAtTime(1, t, 0.05);
      }
      clock.start();
      startDraw();
    }

    function stopSound(fade = 0.08) { // INSTANT OFF by default: silent within ~80 ms
      if (!running) return;
      running = false;
      clock.stop();
      Transport.driver = null;
      fade = isFinite(fade) ? Math.max(0.005, fade) : 0.08;
      const t = Engine.now();
      // read-before-cancel: the attack ramp may still be running (rapid on→off)
      const cur = outGain.gain.value;
      outGain.gain.cancelScheduledValues(t);
      outGain.gain.setValueAtTime(cur, t);
      outGain.gain.linearRampToValueAtTime(0, t + fade);
      const tEnd = t + fade + 0.05; // let already-scheduled hits die under the fade
      for (const s of activeSrcs) { try { s.stop(tEnd); } catch (e) { /* already stopped */ } }
      flashQ.length = 0;
      clearPlayhead();
      stopDraw();
    }

    const powerCtl = UI.power({
      title: t('drums power'),
      onChange: (on) => { if (on) startSound(); else stopSound(); },
    });
    head.append(powerCtl.el);
    Engine.onStopAll(() => { stopSound(); powerCtl.set(false); });

    // ---- readout -----------------------------------------------------------------
    const ro = UI.readout('—', 'big');
    function paintReadout() {
      // patternName passes through t(): 'custom'/'generated' translate, genre
      // names (English proper names, no dict entry) fall through unchanged.
      ro.set(`${t(patternName)} · ${state.bpm} bpm · ${state.length} ${t('steps')} · ${t('swing')} ${pct(state.swing)}`);
    }

    // ---- step grid -----------------------------------------------------------------
    const cells = {};   // voice key → 16 <button.drum-cell>
    const lvlSliders = {}; // voice key → per-voice level slider
    const gridEl = document.createElement('div');
    gridEl.className = 'drum-grid';

    function paintCell(key, i) {
      const b = cells[key][i];
      const s = pattern[key][i];
      b.classList.toggle('on', s === 1);
      b.classList.toggle('acc', s === 2);
      b.classList.toggle('ghost', i >= state.length);
    }

    function paintAllCells() {
      for (const v of VOICES) for (let i = 0; i < STEPS; i++) paintCell(v.key, i);
    }

    for (const v of VOICES) {
      const rowEl = document.createElement('div');
      rowEl.className = 'drum-row';
      const lab = document.createElement('span');
      lab.className = 'drum-label';
      lab.textContent = v.label;
      rowEl.append(lab);
      cells[v.key] = [];
      for (let i = 0; i < STEPS; i++) {
        const b = document.createElement('button');
        b.className = 'drum-cell' + (i % 4 === 0 ? ' beatmark' : '');
        b.addEventListener('click', () => {
          if (i >= state.length) return; // ghost cells are inert
          pattern[v.key][i] = (pattern[v.key][i] + 1) % 3; // off → on → accent
          paintCell(v.key, i);
          patternName = 'custom';
          setActiveChip(null);
          paintReadout();
        });
        cells[v.key].push(b);
        rowEl.append(b);
      }
      const sl = UI.slider({
        label: t('lvl'), min: 0, max: 1, value: v.level, format: pct,
        onInput: (val) => {
          v.level = val;
          if (built) voiceGain[v.key].gain.setTargetAtTime(val, Engine.now(), 0.03);
        },
      });
      lvlSliders[v.key] = sl;
      const slWrap = document.createElement('div');
      slWrap.style.width = '90px';
      slWrap.style.flex = 'none';
      slWrap.append(sl.el);
      rowEl.append(slWrap);
      gridEl.append(rowEl);
    }

    // ---- playhead (scheduled queue → rAF, like beatlab's wheel flashes) -----------
    let rafId = 0;
    let lastStep = -1;

    function startDraw() { if (!rafId) rafId = requestAnimationFrame(draw); }
    function stopDraw() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

    function clearPlayhead() {
      if (lastStep < 0) return;
      for (const v of VOICES) cells[v.key][lastStep].classList.remove('playhead');
      lastStep = -1;
    }

    function draw() {
      rafId = requestAnimationFrame(draw);
      const now = Engine.now();
      let cur = -1;
      while (flashQ.length && flashQ[0].t <= now) cur = flashQ.shift().step;
      if (cur < 0 || cur === lastStep) return;
      if (lastStep >= 0) for (const v of VOICES) cells[v.key][lastStep].classList.remove('playhead');
      for (const v of VOICES) cells[v.key][cur].classList.add('playhead');
      lastStep = cur;
    }

    // ---- transport controls ---------------------------------------------------------
    function setBpm(v) {
      state.bpm = clamp(Math.round(v), 60, 200);
      bpmBox.set(state.bpm);
      bpmSl.set(state.bpm);
      if (running) Transport.bpm = state.bpm; // next step schedules at the new rate
      paintReadout();
    }

    function setSwing(v) {
      state.swing = clamp(v, 0, 0.6);
      swingSl.set(state.swing);
      paintReadout();
    }

    function setLength(v) {
      state.length = clamp(Math.round(v), 8, 16);
      lengthSl.set(state.length);
      if (stepCursor >= state.length) stepCursor = 0;
      paintAllCells(); // ghost the trimmed tail
      paintReadout();
    }

    const bpmBox = UI.numberBox({
      label: t('bpm'), min: 60, max: 200, step: 1, value: state.bpm,
      onChange: setBpm,
    });
    const bpmSl = UI.slider({
      label: t('bpm'), min: 60, max: 200, step: 1, value: state.bpm,
      format: (v) => String(Math.round(v)),
      onInput: setBpm,
    });
    const swingSl = UI.slider({
      label: t('swing'), min: 0, max: 0.6, value: state.swing, format: pct,
      onInput: setSwing,
    });
    const lengthSl = UI.slider({
      label: t('length'), min: 8, max: 16, step: 1, value: state.length,
      format: (v) => Math.round(v) + ' ' + t('steps'), // 8–16 → 'шагов' is always the right plural
      onInput: setLength,
    });
    const levelSl = UI.slider({
      label: t('level'), min: 0, max: 1, value: state.level, format: pct,
      onInput: (v) => {
        state.level = v;
        if (bus) bus.gain.setTargetAtTime(v, Engine.now(), 0.03);
      },
    });

    // ---- pattern loading ---------------------------------------------------------
    // Copy a (possibly partial) { voice: cells[] } object into the live pattern.
    function loadPattern(pat, wipeMissing) {
      for (const v of VOICES) {
        const src = pat[v.key];
        if (Array.isArray(src)) {
          for (let i = 0; i < STEPS; i++) {
            const s = src[i];
            if (s != null && isFinite(+s)) pattern[v.key][i] = clamp(Math.round(+s), 0, 2);
          }
        } else if (wipeMissing) {
          pattern[v.key].fill(0);
        }
      }
      paintAllCells();
    }

    function setActiveChip(name) {
      chipRow.el.querySelectorAll('.chip').forEach((c) => {
        c.classList.toggle('active', !!name && c.textContent === name);
      });
    }

    function applyPreset(p) {
      loadPattern(p.pattern, true); // voices a preset omits fall silent
      patternName = p.name;
      setBpm(p.bpm);
      setSwing(p.swing || 0);
      setLength(p.length || 16);
      setActiveChip(p.name);
      paintReadout();
    }

    const chipRow = UI.chips({
      label: t('genres'),
      items: PRESETS,
      onPick: (item) => applyPreset(item),
    });

    // ---- GENERATE — a musically-sensible random groove ------------------------------
    function generate() {
      const pat = {};
      for (const v of VOICES) pat[v.key] = new Array(STEPS).fill(0);
      // kick: the downbeat always, extra kicks mostly on even sixteenths
      pat.kick[0] = 2;
      for (let i = 2; i < STEPS; i += 2) if (Math.random() < 0.2) pat.kick[i] = 1;
      if (Math.random() < 0.1) pat.kick[7] = 1; // occasional push
      // snare: backbeat, or a single 8 for the half-time feel
      if (Math.random() < 0.7) { pat.snare[4] = 2; pat.snare[12] = 2; }
      else pat.snare[8] = 2;
      // hats: one of three figures, with random accents
      const figures = [
        [0, 2, 4, 6, 8, 10, 12, 14],                          // straight 8ths
        [...Array(STEPS).keys()],                             // 16ths
        [2, 6, 10, 14],                                       // offbeats
      ];
      for (const i of figures[Math.floor(Math.random() * 3)]) {
        pat.hat[i] = Math.random() < 0.22 ? 2 : 1;
      }
      // sparse colour: perc / clap / open sprinkles
      for (let i = 0; i < STEPS; i++) {
        if (!pat.snare[i] && Math.random() < 0.13) pat.perc[i] = 1;
        if (Math.random() < 0.1) pat.clap[i] = 1;
        if (i % 2 === 1 && Math.random() < 0.12) { pat.open[i] = 1; pat.hat[i] = 0; }
      }
      loadPattern(pat, true); // bpm and swing stay where the player set them
      patternName = 'generated';
      setActiveChip(null);
      paintReadout();
    }

    const genBtn = UI.button({
      label: t('GENERATE ⚄'),
      kind: 'primary',
      title: t('roll a fresh groove — keeps your bpm and swing'),
      onClick: generate,
    });

    // ---- assemble --------------------------------------------------------------------
    ro.el.style.margin = '4px 0 10px';
    bpmBox.el.style.width = '96px';
    bpmBox.el.style.flex = 'none';
    bpmSl.el.style.flex = '1 1 140px';
    body.append(
      ro.el,
      gridEl,
      UI.group(t('groove'),
        UI.row(bpmBox, bpmSl),
        UI.grid(swingSl, lengthSl, levelSl)),
      UI.row(genBtn),
      chipRow.el,
    );

    // Default groove: pressing power must bounce immediately.
    applyPreset(PRESETS[0]); // 'house'

    // ---- remote API (VIBE macro layer) ----------------------------------------------
    MOD.remote = {
      isOn: () => running,

      // Same code paths as the power button; powerCtl.set() keeps the LED in sync.
      // fade (s) shapes THIS transition's output-gain envelope; off defaults to 0.08.
      power(on, fade) {
        if (on) {
          if (!running) startSound(fade); // Engine.init() runs inside, as the button path does
        } else {
          stopSound(fade);
        }
        powerCtl.set(!!on);
      },

      // Partial params: { bpm, swing, length, level, genre, pattern }. Genre loads
      // its preset exactly like clicking the chip; an explicit pattern (and any
      // explicit numeric keys) then override it. Works while powered off; live
      // audio ramps only while playing; never toggles power; unknown keys ignored.
      apply(params) {
        if (!params || typeof params !== 'object') return;
        if (typeof params.genre === 'string') {
          const p = PRESETS.find((x) => x.name === params.genre);
          if (p) applyPreset(p);
        }
        if (params.pattern && typeof params.pattern === 'object') {
          loadPattern(params.pattern, false); // partial ok — untouched voices keep their cells
          patternName = 'custom';
          setActiveChip(null);
          paintReadout();
        }
        if (params.bpm != null && isFinite(+params.bpm)) setBpm(+params.bpm);
        if (params.swing != null && isFinite(+params.swing)) setSwing(+params.swing);
        if (params.length != null && isFinite(+params.length)) setLength(+params.length);
        if (params.level != null && isFinite(+params.level)) {
          state.level = clamp(+params.level, 0, 1);
          levelSl.set(state.level);
          if (bus) bus.gain.setTargetAtTime(state.level, Engine.now(), 0.03);
        }
      },

      setKey() { /* drums are unpitched */ },
    };
  },
};

export default MOD;
