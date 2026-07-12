// vibe.js — the VIBE deck: a skeuomorphic macro console over the lab modules.
// Scenes mix and match the five machines purely through their remote APIs, so
// every knob turn here is faithfully mirrored in the cockpit when you flip
// back to LAB mode. Nothing on this deck owns audio — the modules do.
import { Engine, NOTE_NAMES } from './engine.js';
import * as UI from './ui.js';
import { t, registerDict } from './i18n.js';

registerDict('ru', {
  'SILENCE': 'ТИШИНА', 'SLEEP TIDE': 'СОННЫЙ ПРИЛИВ', 'TEMPLE': 'ХРАМ', 'FOCUS': 'ФОКУС',
  'JUST GARDEN': 'ЧИСТЫЙ САД', 'THIRD EYE': 'ТРЕТИЙ ГЛАЗ', 'MACHINE RITUAL': 'РИТУАЛ МАШИН',
  'GOLDEN DRIFT': 'ЗОЛОТОЙ ДРЕЙФ', 'CAMPFIRE JAM': 'У КОСТРА', 'DUB CHAPEL': 'ДАБ-ЧАСОВНЯ',
  'AUTOBAHN': 'АВТОБАН', 'NIGHT DRIVE': 'НОЧНОЙ РЕЙС', 'DESERT BLUES': 'БЛЮЗ ПУСТЫНИ', 'STEPPER': 'СТЕППЕР',
  'nothing but the room tone you brought with you.': 'ничего, кроме тишины комнаты, которую вы принесли с собой.',
  'delta undertow, brown surf, a sub you feel more than hear.': 'дельта-отлив, бурый прибой и саб, который скорее чувствуешь, чем слышишь.',
  'tanpura and theta — the oldest drone on earth, rewired.': 'танпура и тета — древнейший дрон на земле, перепаянный заново.',
  'beta clockwork and glass — tunnel vision on tap.': 'бета-часовой механизм и стекло — туннельное зрение по запросу.',
  'a chord with the wolf removed — pure ratios, zero beating.': 'аккорд, из которого изгнали волка — чистые отношения, ноль биений.',
  'theta drift on a septimal third — intervals your piano was never told about.': 'тета-дрейф на септимальной терции — интервалы, о которых вашему пианино не рассказали.',
  '6:7:9 clockwork over a doom floor — spin it up and hear the machine sing.': 'механизм 6:7:9 над думовым полом — раскрутите и услышьте, как машина поёт.',
  'two tones locked at φ — the interval that never comes home.': 'два тона, сцепленные золотым сечением — интервал, который никогда не возвращается домой.',
  'half-time dust and four honest chords — bring your guitar.': 'пыльный хафтайм и четыре честных аккорда — берите гитару.',
  'seventy-five bpm of smoke — low end forever, space for days.': 'семьдесят пять ударов дыма в минуту — бесконечный низ, космос без краёв.',
  'motorik at 120 — the road plays itself, you just steer.': 'моторик на 120 — дорога играет сама, вы только рулите.',
  'techno at 132 under sodium lights — minor, epic, no exits.': 'техно на 132 под натриевыми фонарями — минор, эпос, без съездов.',
  'twelve bars in E — the oldest map there is, drawn in sand.': 'двенадцать тактов в ми — самая старая карта на свете, нарисованная песком.',
  'jungle at 168 over a dorian sub — fast feet, slow ground.': 'джангл на 168 над дорийским сабом — быстрые ноги, медленная земля.',
  'key': 'тон', 'octave': 'октава', 'intensity': 'накал', 'mind': 'разум', 'tempo': 'темп',
  'noise bed': 'шум-подложка', 'just ratios': 'чистый строй',
  'signal': 'сигнал', 'breathe': 'дыхание', 'OUTPUT': 'ВЫХОД', 'STOP': 'СТОП',
  'OSCILLARIUM · VIBE DECK': 'OSCILLARIUM · ВАЙБ-ПУЛЬТ',
  'silence everything, instantly': 'мгновенно заглушить всё',
  'Hz': 'Гц',
});

const XFADE = 0.8; // scene-crossfade seconds for modules leaving the stage

// Each scene: viz mode, default key, optional breath pace (breaths/min), and
// per-module { p: apply()-params, gains: level keys scaled by INTENSITY }.
const SCENES = [
  {
    id: 'off', name: 'SILENCE', viz: 'scope', key: null,
    blurb: 'nothing but the room tone you brought with you.',
    modules: {},
  },
  {
    id: 'sleep', name: 'SLEEP TIDE', viz: 'lissajous', key: 0, breath: 4.5,
    blurb: 'delta undertow, brown surf, a sub you feel more than hear.',
    modules: {
      binaural: { gains: { level: 0.42 }, p: { mode: 'binaural', carrier: 110, beat: 2.5, wave: 'sine', noise: 'brown', noiseLevel: 0.16 } },
      drone: { gains: { level: 0.38 }, p: { note: 'C', octave: 1, wave: 'sine', voices: 1, spread: 0, sub: 0.85, fifth: 0, cutoff: 420, q: 0.5, driftRate: 0.03, driftDepth: 0.15, attack: 4, release: 4 } },
    },
  },
  {
    id: 'temple', name: 'TEMPLE', viz: 'mandala', key: 9, breath: 6,
    blurb: 'tanpura and theta — the oldest drone on earth, rewired.',
    modules: {
      binaural: { gains: { level: 0.3 }, p: { mode: 'binaural', carrier: 180, beat: 6, wave: 'sine', noise: 'off' } },
      drone: { gains: { level: 0.5 }, p: { note: 'A', octave: 2, wave: 'sawtooth', voices: 3, spread: 10, sub: 0.35, fifth: 0.35, cutoff: 2600, q: 1, driftRate: 0.08, driftDepth: 0.35, attack: 2.5, release: 3 } },
    },
  },
  {
    id: 'focus', name: 'FOCUS', viz: 'spectrum', key: 2,
    blurb: 'beta clockwork and glass — tunnel vision on tap.',
    modules: {
      binaural: { gains: { level: 0.32 }, p: { mode: 'binaural', carrier: 300, beat: 16.4, wave: 'sine', noise: 'pink', noiseLevel: 0.1 } },
      drone: { gains: { level: 0.22 }, p: { note: 'D', octave: 3, wave: 'triangle', voices: 2, spread: 6, sub: 0.2, fifth: 0, cutoff: 7500, q: 0.5, driftRate: 0.15, driftDepth: 0.12, attack: 0.6, release: 1 } },
    },
  },
  {
    id: 'garden', name: 'JUST GARDEN', viz: 'scope', key: 5, breath: 6,
    blurb: 'a chord with the wolf removed — pure ratios, zero beating.',
    modules: {
      chords: { gains: { level: 0.42 }, play: 0, p: { key: 'F', octave: 3, just: true, sevenths: false, voicing: 'open', wave: 'sine', cutoff: 8000, attack: 1.2, release: 2.5, vibRate: 0, vibDepth: 0, strum: 25 } },
      drone: { gains: { level: 0.3 }, p: { note: 'F', octave: 2, wave: 'sine', voices: 1, spread: 0, sub: 0.6, fifth: 0, cutoff: 900, q: 0.5, driftRate: 0.05, driftDepth: 0.1, attack: 3, release: 3 } },
      binaural: { gains: { level: 0.2 }, p: { mode: 'binaural', carrier: 240, beat: 10, wave: 'sine', noise: 'off' } },
    },
  },
  {
    id: 'thirdeye', name: 'THIRD EYE', viz: 'mandala', key: 4, breath: 5,
    blurb: 'theta drift on a septimal third — intervals your piano was never told about.',
    modules: {
      binaural: { gains: { level: 0.34 }, p: { mode: 'binaural', carrier: 165, beat: 5.5, wave: 'sine', noise: 'off' } },
      tonelab: { gains: { levelL: 0.22, levelR: 0.22 }, p: { freqL: 164.81, waveL: 'sine', waveR: 'sine', muteL: false, muteR: false, lock: true, ratio: { n: 7, d: 6 }, glide: 0.3 } },
      drone: { gains: { level: 0.3 }, p: { note: 'E', octave: 2, wave: 'sawtooth', voices: 5, spread: 30, sub: 0.5, fifth: 0, cutoff: 800, q: 4, driftRate: 0.05, driftDepth: 0.4, attack: 4, release: 4 } },
    },
  },
  {
    id: 'ritual', name: 'MACHINE RITUAL', viz: 'lissajous', key: 9,
    blurb: '6:7:9 clockwork over a doom floor — spin it up and hear the machine sing.',
    modules: {
      beatlab: {
        gains: { level: 0.5 }, baseRate: 1.6,
        p: {
          rate: 1.6,
          voices: [
            { on: true, ratio: 6, sound: 'tick', pitch: 880, level: 0.8 },
            { on: true, ratio: 7, sound: 'blip', pitch: 660, level: 0.8 },
            { on: true, ratio: 9, sound: 'tom', pitch: 440, level: 0.7 },
            { on: false },
          ],
        },
      },
      drone: { gains: { level: 0.35 }, p: { note: 'A', octave: 1, wave: 'sawtooth', voices: 5, spread: 35, sub: 0.6, fifth: 0, cutoff: 900, q: 8, driftRate: 0.05, driftDepth: 0.5, attack: 3, release: 3 } },
    },
  },
  {
    id: 'golden', name: 'GOLDEN DRIFT', viz: 'lissajous', key: 9, breath: 6,
    blurb: 'two tones locked at φ — the interval that never comes home.',
    modules: {
      tonelab: { gains: { levelL: 0.28, levelR: 0.28 }, p: { freqL: 220, waveL: 'sine', waveR: 'triangle', muteL: false, muteR: false, lock: true, ratio: 'phi', glide: 0.5 } },
      drone: { gains: { level: 0.26 }, p: { note: 'A', octave: 3, wave: 'triangle', voices: 2, spread: 6, sub: 0.2, fifth: 0, cutoff: 8000, q: 0.5, driftRate: 0.1, driftDepth: 0.15, attack: 1, release: 2 } },
      binaural: { gains: { level: 0.22 }, p: { mode: 'binaural', carrier: 240, beat: 10, wave: 'sine', noise: 'off' } },
    },
  },
  {
    id: 'campfire', name: 'CAMPFIRE JAM', viz: 'scope', key: 7,
    blurb: 'half-time dust and four honest chords — bring your guitar.',
    modules: {
      drums: { gains: { level: 0.4 }, baseBpm: 82, p: { genre: 'half-time', bpm: 82 } },
      drone: { gains: { level: 0.32 }, p: { note: 'G', octave: 2, wave: 'sawtooth', voices: 3, spread: 8, sub: 0.4, fifth: 0.3, cutoff: 2200, q: 1, driftRate: 0.06, driftDepth: 0.2, attack: 1.2, release: 2, progression: true, progPreset: 'I – V – vi – IV', progBars: 2, progFollow: true } },
      chords: { gains: { level: 0.28 }, p: { key: 'G', octave: 3, just: false, sevenths: false, voicing: 'close', wave: 'triangle', cutoff: 2600, attack: 0.4, release: 1.6, vibRate: 0, vibDepth: 0, strum: 15 } },
    },
  },
  {
    id: 'dub', name: 'DUB CHAPEL', viz: 'spectrum', key: 2,
    blurb: 'seventy-five bpm of smoke — low end forever, space for days.',
    modules: {
      drums: { gains: { level: 0.42 }, baseBpm: 75, p: { genre: 'dub' } },
      drone: { gains: { level: 0.38 }, p: { note: 'D', octave: 1, wave: 'sine', voices: 1, spread: 0, sub: 0.8, fifth: 0.2, cutoff: 620, q: 1, driftRate: 0.04, driftDepth: 0.2, attack: 2, release: 3, progression: true, progPreset: 'i – bVII (dorian)', progBars: 4, progFollow: false } },
    },
  },
  {
    id: 'motorik', name: 'AUTOBAHN', viz: 'lissajous', key: 4,
    blurb: 'motorik at 120 — the road plays itself, you just steer.',
    modules: {
      drums: { gains: { level: 0.4 }, baseBpm: 120, p: { genre: 'motorik' } },
      drone: { gains: { level: 0.3 }, p: { note: 'E', octave: 2, wave: 'sawtooth', voices: 2, spread: 6, sub: 0.3, fifth: 0.35, cutoff: 3000, q: 1, driftRate: 0.1, driftDepth: 0.15, attack: 0.8, release: 1.5, progression: true, progPreset: 'i – bVII (dorian)', progBars: 2, progFollow: false } },
    },
  },
  {
    id: 'nightdrive', name: 'NIGHT DRIVE', viz: 'spectrum', key: 9,
    blurb: 'techno at 132 under sodium lights — minor, epic, no exits.',
    modules: {
      drums: { gains: { level: 0.42 }, baseBpm: 132, p: { genre: 'techno' } },
      drone: { gains: { level: 0.34 }, p: { note: 'A', octave: 1, wave: 'sawtooth', voices: 4, spread: 18, sub: 0.6, fifth: 0.2, cutoff: 1100, q: 3, driftRate: 0.07, driftDepth: 0.3, attack: 1, release: 1.5, progression: true, progPreset: 'i – VI – VII (epic)', progBars: 2, progFollow: false } },
    },
  },
  {
    id: 'desertblues', name: 'DESERT BLUES', viz: 'scope', key: 4,
    blurb: 'twelve bars in E — the oldest map there is, drawn in sand.',
    modules: {
      drums: { gains: { level: 0.4 }, baseBpm: 92, p: { genre: 'afrobeat', bpm: 92 } },
      drone: { gains: { level: 0.3 }, p: { note: 'E', octave: 2, wave: 'sawtooth', voices: 2, spread: 8, sub: 0.5, fifth: 0.3, cutoff: 1800, q: 1, driftRate: 0.06, driftDepth: 0.15, attack: 0.8, release: 1.5, progression: true, progPreset: '12-bar blues', progBars: 1, progFollow: true } },
      chords: { gains: { level: 0.26 }, p: { key: 'E', octave: 3, just: false, sevenths: true, voicing: 'close', wave: 'triangle', cutoff: 2400, attack: 0.3, release: 1.2, vibRate: 0, vibDepth: 0, strum: 20 } },
    },
  },
  {
    id: 'stepper', name: 'STEPPER', viz: 'mandala', key: 2,
    blurb: 'jungle at 168 over a dorian sub — fast feet, slow ground.',
    modules: {
      drums: { gains: { level: 0.42 }, baseBpm: 168, p: { genre: 'jungle' } },
      drone: { gains: { level: 0.36 }, p: { note: 'D', octave: 1, wave: 'sine', voices: 1, spread: 0, sub: 0.85, fifth: 0, cutoff: 500, q: 0.5, driftRate: 0.05, driftDepth: 0.2, attack: 1.5, release: 2, progression: true, progPreset: 'i – bVII (dorian)', progBars: 2, progFollow: false } },
    },
  },
];

const BANDS = [[4, 'δ'], [8, 'θ'], [13, 'α'], [30, 'β'], [Infinity, 'γ']];
const bandGlyph = (b) => BANDS.find(([lim]) => b < lim)[1];
const beatFrom01 = (t) => 2 * Math.pow(20, t);        // 2 → 40 Hz
const beatTo01 = (b) => Math.log(b / 2) / Math.log(20);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initVibe(root, mods, selectVizMode) {
  const byId = Object.fromEntries(mods.map((m) => [m.id, m]));
  const remote = (id) => byId[id] && byId[id].remote;

  let cur = 0;
  let userKey = null;      // KEY knob override; null = follow the scene
  let intensity = 0.7;

  const scaled = (g) => clamp01(g * (0.35 + 0.85 * intensity));
  const scaledGains = (entry) => {
    const out = {};
    for (const [k, v] of Object.entries(entry.gains || {})) out[k] = scaled(v);
    return out;
  };

  // ---- DOM ---------------------------------------------------------------------

  const frame = elem('div', 'deck-frame');
  const face = elem('div', 'deck-face');
  frame.append(face);
  for (const pos of ['tl', 'tr', 'bl', 'br']) face.append(elem('div', 'deck-screw ' + pos));

  // top row: VU · title plate · lamps
  const top = elem('div', 'deck-top');
  const vuBox = elem('div', 'vu-box');
  const vuCanvas = elem('canvas');
  vuCanvas.width = 380; vuCanvas.height = 176;
  vuCanvas.style.width = '190px'; vuCanvas.style.height = '88px';
  vuBox.append(vuCanvas, elem('div', 'vu-title', t('OUTPUT')));

  const plate = elem('div', 'deck-plate');
  const plateName = elem('div', 'plate-name', t('SILENCE'));
  const plateBlurb = elem('div', 'plate-blurb', t(SCENES[0].blurb));
  plate.append(elem('div', 'plate-etch', t('OSCILLARIUM · VIBE DECK')), plateName, plateBlurb);

  const lamps = elem('div', 'deck-lamps');
  const powerLamp = elem('div', 'lamp');
  const powerWrap = elem('div', 'lamp-wrap');
  powerWrap.append(powerLamp, elem('span', 'lamp-cap', t('signal')));
  const breathLamp = elem('div', 'breath-lamp');
  const breathWrap = elem('div', 'lamp-wrap breath-wrap');
  breathWrap.append(breathLamp, elem('span', 'lamp-cap', t('breathe')));
  lamps.append(powerWrap, breathWrap);

  top.append(vuBox, plate, lamps);

  // middle: scene selector with labels on an arc
  const mid = elem('div', 'deck-mid');
  const selArea = elem('div', 'selector-area');
  const selector = UI.knob({
    label: '', min: 0, max: SCENES.length - 1, value: 0, step: 1, size: 118,
    format: () => '',
    onInput: (v) => setScene(v),
  });
  selector.el.classList.add('selector');
  selArea.append(selector.el);
  const labelEls = SCENES.map((sc, i) => {
    const b = elem('button', 'scene-label', t(sc.name));
    b.addEventListener('click', () => { selector.set(i); setScene(i); });
    selArea.append(b);
    return b;
  });
  const placeLabels = () => {
    // Two columns flanking the knob, ordered to match its rotation: first half
    // climbs the left side bottom→top, second half descends the right. Even
    // spacing — unlike arc placement, long names can never collide.
    const cx = 210, cy = 150, n = SCENES.length;
    const half = Math.ceil(n / 2), gap = 27;
    labelEls.forEach((b, i) => {
      const left = i < half;
      const row = left ? (half - 1) / 2 - i : i - half - (n - half - 1) / 2;
      b.style.left = (cx + (left ? -112 : 112)) + 'px';
      b.style.top = (cy + row * gap) + 'px';
      b.style.transform = left ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
    });
  };
  placeLabels();
  mid.append(selArea);

  // right of selector: the four macro knobs
  const knobs = elem('div', 'deck-knobs');
  const keyKnob = UI.knob({
    label: t('key'), min: 0, max: 11, value: 0, step: 1, size: 64,
    format: (v) => NOTE_NAMES[Math.round(v)],
    onInput: (v) => {
      userKey = Math.round(v);
      const sc = SCENES[cur];
      for (const id of Object.keys(sc.modules)) {
        const r = remote(id);
        if (!r || !r.isOn()) continue;
        if (id === 'binaural') {
          // Transpose the scene's own carrier deterministically — binaural's
          // nearest-octave setKey is not round-trip stable across detents.
          const ref = sc.key != null ? sc.key : userKey;
          let semis = userKey - ref;
          if (semis > 6) semis -= 12; else if (semis < -6) semis += 12;
          r.apply({ carrier: sc.modules.binaural.p.carrier * Math.pow(2, semis / 12) });
        } else if (r.setKey) {
          r.setKey(userKey);
        }
      }
    },
  });
  let octShift = 0;
  const clampi = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
  const applyOct = () => {
    const sc = SCENES[cur];
    if (sc.modules.drone && remote('drone')) {
      remote('drone').apply({ octave: clampi((sc.modules.drone.p.octave || 2) + octShift, 1, 4) });
    }
    if (sc.modules.chords && remote('chords')) {
      remote('chords').apply({ octave: clampi((sc.modules.chords.p.octave || 3) + octShift, 2, 5) });
    }
  };
  const octKnob = UI.knob({
    label: t('octave'), min: -2, max: 1, value: 0, step: 1, size: 64,
    format: (v) => (v > 0 ? '+' : '') + v,
    onInput: (v) => { octShift = v; applyOct(); },
  });
  const intKnob = UI.knob({
    label: t('intensity'), min: 0, max: 1, value: intensity, size: 64,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => {
      intensity = v;
      const sc = SCENES[cur];
      for (const [id, entry] of Object.entries(sc.modules)) {
        const r = remote(id);
        if (r && r.isOn()) r.apply(scaledGains(entry));
      }
    },
  });
  const mindKnob = UI.knob({
    label: t('mind'), min: 0, max: 1, value: beatTo01(10), size: 64,
    format: (v) => beatFrom01(v).toFixed(1) + ' ' + t('Hz') + ' ' + bandGlyph(beatFrom01(v)),
    onInput: (v) => {
      const r = remote('binaural');
      if (SCENES[cur].modules.binaural && r) r.apply({ beat: beatFrom01(v) });
    },
  });
  const tempoKnob = UI.knob({
    label: t('tempo'), min: 0, max: 1, value: 0.5, size: 64,
    format: (v) => '×' + (0.5 * Math.pow(4, v)).toFixed(2),
    onInput: (v) => {
      const mult = 0.5 * Math.pow(4, v);
      const bl = SCENES[cur].modules.beatlab;
      if (bl && remote('beatlab')) remote('beatlab').apply({ rate: (bl.baseRate || 1.2) * mult });
      const dm = SCENES[cur].modules.drums;
      if (dm && remote('drums')) {
        remote('drums').apply({ bpm: Math.round(Math.min(200, Math.max(60, (dm.baseBpm || 100) * mult))) });
      }
    },
  });
  knobs.append(keyKnob.el, octKnob.el, intKnob.el, mindKnob.el, tempoKnob.el);
  mid.append(knobs);

  // bottom row: switches + stop mushroom
  const bottom = elem('div', 'deck-bottom');
  const mkSwitch = (label, onChange) => {
    const wrap = elem('div', 'sw-wrap');
    const b = elem('button', 'sw');
    b.setAttribute('aria-pressed', 'false');
    b.append(elem('div', 'sw-lever'));
    let on = false;
    const paint = () => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
    b.addEventListener('click', () => { on = !on; paint(); onChange(on); });
    wrap.append(b, elem('div', 'sw-label', label));
    return { el: wrap, get: () => on, set(v) { on = !!v; paint(); } };
  };
  const noiseSw = mkSwitch(t('noise bed'), (on) => {
    const entry = SCENES[cur].modules.binaural;
    const r = remote('binaural');
    if (!entry || !r) return;
    r.apply(on
      ? { noise: entry.p.noise !== 'off' ? entry.p.noise : 'pink', noiseLevel: entry.p.noiseLevel || 0.1 }
      : { noise: 'off' });
  });
  const justSw = mkSwitch(t('just ratios'), (on) => {
    const r = remote('chords');
    if (SCENES[cur].modules.chords && r) r.apply({ just: on });
  });
  const stop = elem('button', 'stop-mush', t('STOP'));
  stop.title = t('silence everything, instantly');
  stop.addEventListener('click', () => Engine.stopAll());
  bottom.append(noiseSw.el, justSw.el, elem('div', 'deck-spacer'), stop);

  face.append(top, mid, bottom);
  root.append(frame);

  // ---- scene machinery -----------------------------------------------------------

  function forActive(fn) {
    for (const id of Object.keys(SCENES[cur].modules)) {
      const r = remote(id);
      if (r && r.isOn()) fn(r);
    }
  }

  const setInert = (ctl, inert) => ctl.el.classList.toggle('inert-ctl', !!inert);

  function paintScenePanel(sc) {
    plateName.textContent = t(sc.name);
    plateBlurb.textContent = t(sc.blurb);
    labelEls.forEach((b, i) => b.classList.toggle('active', i === cur));
    setInert(mindKnob, !sc.modules.binaural);
    setInert(tempoKnob, !sc.modules.beatlab && !sc.modules.drums);
    setInert(octKnob, cur === 0 || (!sc.modules.drone && !sc.modules.chords));
    setInert(noiseSw, !sc.modules.binaural);
    setInert(justSw, !sc.modules.chords);
    setInert(keyKnob, cur === 0);
    setInert(intKnob, cur === 0);
    breathWrap.classList.toggle('hidden', !sc.breath);
  }

  function setScene(i) {
    cur = i;
    const sc = SCENES[i];
    Engine.init();
    userKey = null;
    if (sc.key != null) keyKnob.set(sc.key);
    if (sc.modules.binaural) mindKnob.set(beatTo01(sc.modules.binaural.p.beat));
    tempoKnob.set(0.5);
    octShift = 0;
    octKnob.set(0);
    noiseSw.set(!!(sc.modules.binaural && sc.modules.binaural.p.noise !== 'off'));
    justSw.set(!!(sc.modules.chords && sc.modules.chords.p.just));

    selectVizMode(sc.viz || 'scope');
    for (const m of mods) {
      const r = m.remote;
      if (!r) continue;
      const entry = sc.modules[m.id];
      if (entry) {
        r.apply({ ...(entry.p || {}), ...scaledGains(entry) });
        if (!r.isOn()) r.power(true);
        if (m.id === 'chords' && entry.play != null) r.play(entry.play);
      } else if (r.isOn()) {
        r.power(false, XFADE);
      }
    }
    paintScenePanel(sc);
  }

  // STOP ALL from anywhere (header, Esc, mushroom) → deck shows SILENCE.
  Engine.onStopAll(() => {
    cur = 0;
    selector.set(0);
    paintScenePanel(SCENES[0]);
  });

  paintScenePanel(SCENES[0]);

  // ---- VU meter + lamps ------------------------------------------------------------

  const vg = vuCanvas.getContext('2d');
  let needle = -48, vel = 0;
  const tBuf = { arr: null };

  function masterDb() {
    if (!Engine.ready) return -60;
    if (!tBuf.arr) tBuf.arr = new Float32Array(Engine.analyserL.fftSize);
    let sum = 0, n = 0;
    for (const a of [Engine.analyserL, Engine.analyserR]) {
      a.getFloatTimeDomainData(tBuf.arr);
      for (let i = 0; i < tBuf.arr.length; i += 4) { sum += tBuf.arr[i] * tBuf.arr[i]; n++; }
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    return 20 * Math.log10(rms + 1e-6);
  }

  function drawVU() {
    const W = vuCanvas.width, H = vuCanvas.height;
    vg.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H + 26, R = H + 4;
    // scale arc + ticks
    vg.strokeStyle = '#4a3c20';
    vg.lineWidth = 3;
    vg.beginPath();
    vg.arc(cx, cy, R - 22, (-48 - 90) * Math.PI / 180, (48 - 90) * Math.PI / 180);
    vg.stroke();
    const marks = [[-20, '-20'], [-10, '-10'], [-5, '-5'], [-3, '-3'], [0, '0'], [3, '+3']];
    vg.font = '600 15px Georgia, serif';
    vg.textAlign = 'center';
    for (const [db, txt] of marks) {
      const f = (db + 20) / 23;
      const a = (-48 + 96 * f - 90) * Math.PI / 180;
      const hot = db >= 0;
      vg.strokeStyle = hot ? '#b3272d' : '#4a3c20';
      vg.fillStyle = hot ? '#b3272d' : '#4a3c20';
      vg.lineWidth = 3;
      vg.beginPath();
      vg.moveTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      vg.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
      vg.stroke();
      vg.fillText(txt, cx + Math.cos(a) * (R + 8), cy + Math.sin(a) * (R + 8) + 5);
    }
    // red zone
    vg.strokeStyle = '#b3272d';
    vg.lineWidth = 5;
    vg.beginPath();
    vg.arc(cx, cy, R - 22, (-48 + 96 * (20 / 23) - 90) * Math.PI / 180, (48 - 90) * Math.PI / 180);
    vg.stroke();
    // needle
    const a = (needle - 90) * Math.PI / 180;
    vg.strokeStyle = '#1d1408';
    vg.lineWidth = 4;
    vg.beginPath();
    vg.moveTo(cx, cy);
    vg.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12));
    vg.stroke();
    // pivot cap
    vg.fillStyle = '#2c2113';
    vg.beginPath();
    vg.arc(cx, cy - 4, 10, 0, Math.PI * 2);
    vg.fill();
  }

  function loop() {
    if (document.body.classList.contains('vibe')) {
      const db = Math.max(-40, Math.min(3, masterDb()));
      const target = -48 + 96 * ((Math.max(-20, db) + 20) / 23);
      vel += (target - needle) * 0.28;
      vel *= 0.78;
      needle += vel;
      drawVU();

      powerLamp.classList.toggle('on', mods.some((m) => m.remote && m.remote.isOn()));

      const sc = SCENES[cur];
      if (sc.breath) {
        const period = 60 / sc.breath;
        const g = 0.5 - 0.5 * Math.cos((performance.now() / 1000 / period) * Math.PI * 2);
        breathLamp.style.opacity = 0.3 + 0.7 * g;
        breathLamp.style.boxShadow = `0 0 ${6 + 30 * g}px rgba(72, 219, 195, ${0.25 + 0.55 * g})`;
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { setScene, current: () => cur };
}
