// rig.js — RIG mode: live input (guitar through an audio interface) run
// through an experimental effects chain. Deliberately NOT an amp sim — the
// drive here exists for sustain and clarity, and the rest exists for magic
// and dread. A built-in Karplus-Strong test pluck plays the chain even with
// nothing plugged in.
import { Engine } from './engine.js';
import * as UI from './ui.js';
import { t, registerDict } from './i18n.js';
import { FACTORIES, FX_ORDER } from './fx.js';
import { createPitchDetector } from './pitch.js';

registerDict('ru', {
  'INPUT': 'ВХОД', 'OUTPUT': 'ВЫХОД', 'source': 'источник', 'device': 'устройство', 'input': 'вход',
  'microphone / interface': 'микрофон / интерфейс', 'test pluck': 'тестовый щипок',
  'enable input': 'включить вход', 'input live': 'вход активен', 'no input / permission denied': 'нет входа / доступ запрещён',
  'input gain': 'вход. усиление', 'rig level': 'уровень рига',
  'PLUCK': 'ЩИПОК', 'auto pluck': 'авто-щипок',
  'monitoring through speakers with a live microphone will feedback — use headphones.':
    'мониторинг в колонки с живым микрофоном даст завязку — играйте в наушниках.',
  'the chain runs left to right — stomp a pedal to bring it in.':
    'цепочка идёт слева направо — нажмите на педаль, чтобы включить её.',
  'gate': 'гейт', 'sustain': 'сустейн', 'drive': 'драйв', 'auto-wah': 'авто-вау',
  'ring mod': 'ринг-мод', 'pitch': 'питч', 'mod': 'модуляция', 'delay': 'дилэй', 'reverb': 'ревёрб',
  'threshold': 'порог', 'release': 'спад', 'amount': 'глубина', 'curve': 'кривая',
  'tone': 'тон', 'mix': 'микс', 'sens': 'чувств.', 'q': 'добротность', 'freq': 'частота',
  'semis': 'полутона', 'type': 'тип', 'rate': 'скорость', 'depth': 'глубина',
  'time': 'время', 'feedback': 'фидбек', 'ping-pong': 'пинг-понг',
  'space': 'зал', 'shimmer': 'шиммер',
  'warm': 'тёплый', 'tube': 'ламповый', 'fuzz': 'фузз', 'octave': 'октавный', 'metal': 'метал',
  'cab': 'кабинет', 'model': 'модель', 'tight': 'тайт',
  '4×12 modern': '4×12 модерн', '4×12 vintage': '4×12 винтаж', '2×12 glass': '2×12 стекло', '1×8 lofi': '1×8 лоуфай',
  'tuner': 'тюнер', 'buffer': 'буфер', 'auto': 'авто',
  'the buffer is a request — the readout shows what the hardware actually granted. changing it reloads the page.':
    'буфер — это запрос; в индикаторе то, что реально дало железо. смена перезагружает страницу.',
  'modern metal': 'модерн-метал',
  'djent': 'джент', 'doom wall': 'стена дума', 'silver lead': 'серебряное соло', 'frost': 'иней',
  'crystal clean': 'кристальный клин', 'submarine': 'субмарина',
  'palm-mute tight, scooped, surgical — chug in 7/8, we have the drum preset.': 'тайтовый палм-мьют, выскобленная середина, хирургия — чугайте в 7/8, драм-пресет уже есть.',
  'fuzz into a vintage 4×12, one octave down — tectonic.': 'фузз в винтажный 4×12, октавой ниже — тектоника.',
  'high-gain lead that sings instead of screams — delay and hall included.': 'хай-гейн соло, которое поёт, а не кричит — дилэй и зал в комплекте.',
  'tremolo-picked frost through a cathedral — grim, majestic.': 'тремоло-иней сквозь собор — мрачно и величественно.',
  'compressed sparkle through a glass cab — country-money clean.': 'компрессированное сияние через стеклянный кабинет — чистый звук за большие деньги.',
  'slow wah and a 40 Hz ring under dark echoes — dive, dive, dive.': 'медленная вау и кольцо на 40 Гц под тёмным эхом — погружение, погружение.',
  'chorus': 'хорус', 'phaser': 'фейзер', 'tremolo': 'тремоло', 'vibrato': 'вибрато',
  'room': 'комната', 'hall': 'зал', 'cathedral': 'собор', 'haunted': 'призрачный', 'infinite': 'бесконечный',
  'sustain & clarity': 'сустейн и ясность', 'magical / epic': 'магия / эпос', 'creepy': 'жуть',
  'clean lift': 'чистый лифт', 'violin sustain': 'скрипичный сустейн', 'velvet fuzz': 'бархатный фузз',
  'shimmer cathedral': 'шиммер-собор', 'golden halo': 'золотой нимб', 'starfield': 'звёздное поле', 'excalibur': 'экскалибур',
  'séance': 'спиритический сеанс', 'poltergeist': 'полтергейст', 'mariana trench': 'марианская впадина', 'graveyard wind': 'кладбищенский ветер',
  'transparent sustain and a small room — your tone, but taller.': 'прозрачный сустейн и маленькая комната — ваш звук, только выше ростом.',
  'infinite bow — swells sing, attack melts.': 'бесконечный смычок — свеллы поют, атака тает.',
  'fuzz underneath your clean — sustain without losing the note.': 'фузз ПОД чистым звуком — сустейн без потери ноты.',
  'the Eno move — octave bloom off stone walls.': 'приём Ино — октавное цветение от каменных стен.',
  'chorus into a golden hall — everything you play gets a crown.': 'хорус в золотой зал — всё сыгранное получает корону.',
  'ping-pong echoes drifting into shimmer — play slow.': 'пинг-понг эхо, уплывающее в шиммер — играйте медленно.',
  'singing lead with an octave halo — draw the sword.': 'поющее соло с октавным нимбом — извлеките меч.',
  'voices in the ring modulator — hold a note, they answer.': 'голоса в кольцевом модуляторе — задержите ноту, и они ответят.',
  'your notes come back wrong — lower, later, hungrier.': 'ваши ноты возвращаются не такими — ниже, позже, голоднее.',
  'everything sinks an octave into the pressure.': 'всё тонет на октаву вглубь, под давление.',
  'hold one note and the wind starts to howl.': 'задержите одну ноту — и ветер завоет.',
});

// pedal id → { name, accent, controls } ; control: knob | select | toggle
const PEDALS = [
  {
    id: 'gate', name: 'gate', accent: '#8d8aa8',
    controls: [
      { key: 'threshold', type: 'knob', label: 'threshold', min: 0, max: 0.05, def: 0.008, fmt: (v) => (v * 1000).toFixed(1) },
      { key: 'release', type: 'knob', label: 'release', min: 0.02, max: 0.5, def: 0.12, fmt: (v) => v.toFixed(2) },
    ],
  },
  {
    id: 'sustainer', name: 'sustain', accent: '#9dff00',
    controls: [
      { key: 'amount', type: 'knob', label: 'amount', min: 0, max: 1, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'drive', name: 'drive', accent: '#ff5470',
    controls: [
      { key: 'curve', type: 'select', label: 'curve', options: ['warm', 'tube', 'fuzz', 'octave', 'metal'], def: 'warm' },
      { key: 'amount', type: 'knob', label: 'amount', min: 0, max: 1, def: 0.35, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'tone', type: 'knob', label: 'tone', min: 500, max: 12000, def: 4500, log: true, fmt: (v) => (v / 1000).toFixed(1) + 'k' },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 1, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'cab', name: 'cab', accent: '#c98850',
    controls: [
      {
        key: 'model', type: 'select', label: 'model', def: 'modern412',
        options: [
          { value: 'modern412', label: '4×12 modern' },
          { value: 'vintage412', label: '4×12 vintage' },
          { value: 'glass212', label: '2×12 glass' },
          { value: 'lofi108', label: '1×8 lofi' },
        ],
      },
      { key: 'tight', type: 'knob', label: 'tight', min: 40, max: 250, def: 85, log: true, fmt: (v) => Math.round(v) },
    ],
  },
  {
    id: 'autowah', name: 'auto-wah', accent: '#ffb300',
    controls: [
      { key: 'sens', type: 'knob', label: 'sens', min: 0, max: 1, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'q', type: 'knob', label: 'q', min: 1, max: 14, def: 6, fmt: (v) => v.toFixed(1) },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 1, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'ringmod', name: 'ring mod', accent: '#ff3ec8',
    controls: [
      { key: 'freq', type: 'knob', label: 'freq', min: 0.5, max: 2000, def: 220, log: true, fmt: (v) => v < 10 ? v.toFixed(1) : Math.round(v) },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 0.6, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'pitch', name: 'pitch', accent: '#b26bff',
    controls: [
      { key: 'semis', type: 'knob', label: 'semis', min: -12, max: 12, def: 12, step: 1, fmt: (v) => (v > 0 ? '+' : '') + v },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 0.35, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'mod', name: 'mod', accent: '#00e5ff',
    controls: [
      { key: 'type', type: 'select', label: 'type', options: ['chorus', 'phaser', 'tremolo', 'vibrato'], def: 'chorus' },
      { key: 'rate', type: 'knob', label: 'rate', min: 0.05, max: 8, def: 0.8, log: true, fmt: (v) => v.toFixed(2) },
      { key: 'depth', type: 'knob', label: 'depth', min: 0, max: 1, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 0.5, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    id: 'delay', name: 'delay', accent: '#48dbc3',
    controls: [
      { key: 'time', type: 'knob', label: 'time', min: 0.02, max: 2, def: 0.42, log: true, fmt: (v) => v.toFixed(2) },
      { key: 'feedback', type: 'knob', label: 'feedback', min: 0, max: 0.95, def: 0.35, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'tone', type: 'knob', label: 'tone', min: 500, max: 12000, def: 3200, log: true, fmt: (v) => (v / 1000).toFixed(1) + 'k' },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 0.3, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'pingpong', type: 'toggle', label: 'ping-pong', def: false },
    ],
  },
  {
    id: 'reverb', name: 'reverb', accent: '#e9e7f7',
    controls: [
      { key: 'ir', type: 'select', label: 'space', options: ['room', 'hall', 'cathedral', 'haunted', 'infinite'], def: 'hall' },
      { key: 'mix', type: 'knob', label: 'mix', min: 0, max: 1, def: 0.25, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'shimmer', type: 'knob', label: 'shimmer', min: 0, max: 1, def: 0, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
];

// Presets always specify EVERY pedal (on + params) over the control defaults,
// so chips are self-contained sounds — no leakage between picks.
const PRESET_GROUPS = [
  {
    group: 'sustain & clarity',
    presets: [
      {
        name: 'clean lift', hint: 'transparent sustain and a small room — your tone, but taller.',
        pedals: {
          sustainer: { on: true, amount: 0.35 },
          reverb: { on: true, ir: 'room', mix: 0.15, shimmer: 0 },
        },
      },
      {
        name: 'violin sustain', hint: 'infinite bow — swells sing, attack melts.',
        pedals: {
          sustainer: { on: true, amount: 0.85 },
          drive: { on: true, curve: 'warm', amount: 0.3, tone: 3800, mix: 0.5 },
          mod: { on: true, type: 'chorus', rate: 0.4, depth: 0.3, mix: 0.3 },
          reverb: { on: true, ir: 'hall', mix: 0.3, shimmer: 0 },
        },
      },
      {
        name: 'velvet fuzz', hint: 'fuzz underneath your clean — sustain without losing the note.',
        pedals: {
          sustainer: { on: true, amount: 0.5 },
          drive: { on: true, curve: 'fuzz', amount: 0.55, tone: 3200, mix: 0.45 },
          reverb: { on: true, ir: 'room', mix: 0.18, shimmer: 0 },
        },
      },
      {
        name: 'crystal clean', hint: 'compressed sparkle through a glass cab — country-money clean.',
        pedals: {
          sustainer: { on: true, amount: 0.45 },
          cab: { on: true, model: 'glass212', tight: 80 },
          mod: { on: true, type: 'chorus', rate: 0.5, depth: 0.35, mix: 0.4 },
          reverb: { on: true, ir: 'hall', mix: 0.22, shimmer: 0 },
        },
      },
    ],
  },
  {
    group: 'modern metal',
    presets: [
      {
        name: 'djent', hint: 'palm-mute tight, scooped, surgical — chug in 7/8, we have the drum preset.',
        pedals: {
          gate: { on: true, threshold: 0.02, release: 0.06 },
          drive: { on: true, curve: 'metal', amount: 0.8, tone: 6500, mix: 1 },
          cab: { on: true, model: 'modern412', tight: 110 },
          reverb: { on: true, ir: 'room', mix: 0.08, shimmer: 0 },
        },
      },
      {
        name: 'doom wall', hint: 'fuzz into a vintage 4×12, one octave down — tectonic.',
        pedals: {
          gate: { on: true, threshold: 0.012, release: 0.12 },
          drive: { on: true, curve: 'fuzz', amount: 0.75, tone: 2800, mix: 1 },
          cab: { on: true, model: 'vintage412', tight: 60 },
          pitch: { on: true, semis: -12, mix: 0.25 },
          reverb: { on: true, ir: 'room', mix: 0.15, shimmer: 0 },
        },
      },
      {
        name: 'silver lead', hint: 'high-gain lead that sings instead of screams — delay and hall included.',
        pedals: {
          sustainer: { on: true, amount: 0.4 },
          drive: { on: true, curve: 'metal', amount: 0.6, tone: 4800, mix: 1 },
          cab: { on: true, model: 'glass212', tight: 90 },
          delay: { on: true, time: 0.45, feedback: 0.35, tone: 3000, pingpong: false, mix: 0.25 },
          reverb: { on: true, ir: 'hall', mix: 0.3, shimmer: 0 },
        },
      },
      {
        name: 'frost', hint: 'tremolo-picked frost through a cathedral — grim, majestic.',
        pedals: {
          gate: { on: true, threshold: 0.01, release: 0.1 },
          drive: { on: true, curve: 'metal', amount: 0.7, tone: 7000, mix: 1 },
          cab: { on: true, model: 'vintage412', tight: 100 },
          mod: { on: true, type: 'tremolo', rate: 6.5, depth: 0.55, mix: 0.8 },
          reverb: { on: true, ir: 'cathedral', mix: 0.4, shimmer: 0 },
        },
      },
    ],
  },
  {
    group: 'magical / epic',
    presets: [
      {
        name: 'shimmer cathedral', hint: 'the Eno move — octave bloom off stone walls.',
        pedals: {
          sustainer: { on: true, amount: 0.4 },
          delay: { on: true, time: 0.5, feedback: 0.3, tone: 3200, pingpong: false, mix: 0.2 },
          reverb: { on: true, ir: 'cathedral', mix: 0.45, shimmer: 0.6 },
        },
      },
      {
        name: 'golden halo', hint: 'chorus into a golden hall — everything you play gets a crown.',
        pedals: {
          sustainer: { on: true, amount: 0.3 },
          mod: { on: true, type: 'chorus', rate: 0.6, depth: 0.4, mix: 0.5 },
          reverb: { on: true, ir: 'hall', mix: 0.35, shimmer: 0.25 },
        },
      },
      {
        name: 'starfield', hint: 'ping-pong echoes drifting into shimmer — play slow.',
        pedals: {
          mod: { on: true, type: 'vibrato', rate: 0.15, depth: 0.2, mix: 0.3 },
          delay: { on: true, time: 0.38, feedback: 0.55, tone: 2600, pingpong: true, mix: 0.45 },
          reverb: { on: true, ir: 'hall', mix: 0.3, shimmer: 0.35 },
        },
      },
      {
        name: 'excalibur', hint: 'singing lead with an octave halo — draw the sword.',
        pedals: {
          sustainer: { on: true, amount: 0.6 },
          drive: { on: true, curve: 'tube', amount: 0.45, tone: 4200, mix: 0.7 },
          pitch: { on: true, semis: 12, mix: 0.18 },
          delay: { on: true, time: 0.3, feedback: 0.25, tone: 3000, pingpong: false, mix: 0.2 },
          reverb: { on: true, ir: 'cathedral', mix: 0.35, shimmer: 0 },
        },
      },
    ],
  },
  {
    group: 'creepy',
    presets: [
      {
        name: 'séance', hint: 'voices in the ring modulator — hold a note, they answer.',
        pedals: {
          ringmod: { on: true, freq: 66, mix: 0.5 },
          mod: { on: true, type: 'tremolo', rate: 4.5, depth: 0.6, mix: 0.7 },
          delay: { on: true, time: 0.6, feedback: 0.5, tone: 1800, pingpong: false, mix: 0.35 },
          reverb: { on: true, ir: 'haunted', mix: 0.5, shimmer: 0 },
        },
      },
      {
        name: 'poltergeist', hint: 'your notes come back wrong — lower, later, hungrier.',
        pedals: {
          pitch: { on: true, semis: -12, mix: 0.4 },
          autowah: { on: true, sens: 0.7, q: 9, mix: 1 },
          delay: { on: true, time: 0.17, feedback: 0.6, tone: 2400, pingpong: true, mix: 0.4 },
          reverb: { on: true, ir: 'haunted', mix: 0.4, shimmer: 0 },
        },
      },
      {
        name: 'mariana trench', hint: 'everything sinks an octave into the pressure.',
        pedals: {
          gate: { on: true, threshold: 0.012, release: 0.15 },
          drive: { on: true, curve: 'octave', amount: 0.5, tone: 2800, mix: 0.6 },
          pitch: { on: true, semis: -12, mix: 0.5 },
          reverb: { on: true, ir: 'infinite', mix: 0.5, shimmer: 0 },
        },
      },
      {
        name: 'graveyard wind', hint: 'hold one note and the wind starts to howl.',
        pedals: {
          pitch: { on: true, semis: -12, mix: 0.3 },
          mod: { on: true, type: 'phaser', rate: 0.07, depth: 0.8, mix: 0.6 },
          delay: { on: true, time: 1.2, feedback: 0.7, tone: 1500, pingpong: false, mix: 0.4 },
          reverb: { on: true, ir: 'infinite', mix: 0.65, shimmer: 0.45 },
        },
      },
      {
        name: 'submarine', hint: 'slow wah and a 40 Hz ring under dark echoes — dive, dive, dive.',
        pedals: {
          autowah: { on: true, sens: 0.35, q: 4, mix: 1 },
          ringmod: { on: true, freq: 40, mix: 0.35 },
          delay: { on: true, time: 0.8, feedback: 0.6, tone: 1200, pingpong: false, mix: 0.45 },
          reverb: { on: true, ir: 'infinite', mix: 0.45, shimmer: 0 },
        },
      },
    ],
  },
];

const PLUCK_NOTES = [82.41, 110, 146.83, 196]; // E2 A2 D3 G3

function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initRig(root) {
  // desired state survives before/without the audio graph
  const PST = {};
  for (const p of PEDALS) {
    PST[p.id] = { on: false, params: {} };
    for (const c of p.controls) PST[p.id].params[c.key] = c.def;
  }

  const S = { source: 'pluck', deviceId: '', gain: 1, level: 0.8, out: false, armed: false, autoPluck: false };

  // audio graph (lazy)
  let built = false;
  let inGain = null, meterAn = null, tunerAn = null, rigBus = null;
  let tunerOn = false;
  let pitchDet = null;
  let micStream = null, micNode = null;
  let armSeq = 0; // arm() re-entrancy guard — only the newest request wins the mic
  let plucker = null;
  let autoTimer = null;
  const live = {}; // id -> { fx, wet, dry }

  function buildChain() {
    if (built) return;
    Engine.init();
    const ctx = Engine.ctx;
    inGain = ctx.createGain();
    inGain.gain.value = S.gain;
    meterAn = ctx.createAnalyser();
    meterAn.fftSize = 1024;
    inGain.connect(meterAn);
    tunerAn = ctx.createAnalyser();
    tunerAn.fftSize = 2048;
    inGain.connect(tunerAn);
    pitchDet = createPitchDetector(tunerAn);

    let prev = inGain;
    for (const p of PEDALS) {
      const fx = FACTORIES[p.id](ctx);
      const wet = ctx.createGain(), dry = ctx.createGain(), sum = ctx.createGain();
      prev.connect(fx.input);
      fx.output.connect(wet);
      prev.connect(dry);
      wet.connect(sum);
      dry.connect(sum);
      const st = PST[p.id];
      wet.gain.value = st.on ? 1 : 0;
      dry.gain.value = st.on ? 0 : 1;
      fx.set({ ...st.params });
      live[p.id] = { fx, wet, dry };
      prev = sum;
    }
    rigBus = Engine.createChannel(S.out ? S.level : 0);
    prev.connect(rigBus);
    built = true;
  }

  function applyPedal(id) {
    const st = PST[id], l = live[id];
    if (!l) return;
    const tNow = Engine.now();
    l.wet.gain.setTargetAtTime(st.on ? 1 : 0, tNow, 0.03);
    l.dry.gain.setTargetAtTime(st.on ? 0 : 1, tNow, 0.03);
    l.fx.set({ ...st.params });
  }

  function setOut(on) {
    S.out = on;
    outCtl.set(on);
    if (rigBus) rigBus.gain.setTargetAtTime(on ? S.level : 0, Engine.now(), on ? 0.05 : 0.02);
  }

  // ---- input sources ---------------------------------------------------------

  function makePlucker(ctx) {
    // Karplus-Strong: noise burst into a tuned, damped feedback delay = string
    const loop = ctx.createGain();
    const delay = ctx.createDelay(0.1);
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 4600;
    damp.Q.value = -3; // lowpass Q is in dB; -3 = Butterworth — flat passband, no peak, loop stays < 1
    const fb = ctx.createGain();
    fb.gain.value = 0.985;
    // soft-clip inside the loop: WaveShapers clamp beyond ±1, so the string is
    // bounded no matter what the filter response does
    const clip = ctx.createWaveShaper();
    const cc = new Float32Array(257);
    // slope exactly 1 at zero — a steeper knee raises small-signal loop gain
    // above unity and the string self-oscillates instead of decaying
    for (let i = 0; i < 257; i++) cc[i] = Math.tanh((i / 128) - 1);
    clip.curve = cc;
    const out = ctx.createGain();
    out.gain.value = 1.0;
    loop.connect(delay);
    delay.connect(damp);
    damp.connect(clip);
    clip.connect(fb);
    fb.connect(loop);
    clip.connect(out);
    const burst = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.012), ctx.sampleRate);
    const b0 = burst.getChannelData(0);
    for (let i = 0; i < b0.length; i++) b0[i] = (Math.random() * 2 - 1) * (1 - i / b0.length);
    let noteIx = 1;
    return {
      out,
      pluck(freq) {
        const f = freq || PLUCK_NOTES[(noteIx = (noteIx + 1) % PLUCK_NOTES.length)];
        // Web Audio adds one implicit render quantum (128 samples) to feedback
        // cycles — subtract it or the string tunes flat
        const dt = Math.max(0.001, 1 / f - 128 / ctx.sampleRate);
        delay.delayTime.setValueAtTime(dt, ctx.currentTime);
        const src = ctx.createBufferSource();
        src.buffer = burst;
        const g = ctx.createGain();
        g.gain.value = 1.8; // hot excitation — the in-loop soft clip bounds it
        src.connect(g);
        g.connect(loop);
        src.onended = () => { src.disconnect(); g.disconnect(); };
        src.start();
      },
    };
  }

  function routeSource() {
    if (!built) return;
    if (micNode) micNode.disconnect();
    if (plucker) plucker.out.disconnect();
    if (S.source === 'mic' && micNode) micNode.connect(inGain);
    if (S.source === 'pluck') {
      if (!plucker) plucker = makePlucker(Engine.ctx);
      plucker.out.connect(inGain);
    }
  }

  async function arm() {
    buildChain();
    setOut(true);
    const myReq = ++armSeq; // stale requests (double-click, device switch) are discarded
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: S.deviceId ? { exact: S.deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
    } catch (err) {
      console.error(err);
      if (myReq !== armSeq) return;
      if (S.deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        // the saved device is gone — fall back to the default input, once
        S.deviceId = '';
        devSel.set('');
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false,
          });
        } catch (err2) {
          console.error(err2);
        }
      }
    }
    if (myReq !== armSeq) {
      // a newer arm() (or disarm) owns the mic now — don't leak this stream
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      return;
    }
    if (!stream) {
      if (micStream) return; // failed device switch — the old input survives untouched
      S.armed = false;
      armBtn.textContent = '✕ ' + t('no input / permission denied');
      armBtn.classList.remove('active');
      if (S.source === 'mic') { S.source = 'pluck'; srcSel.set('pluck'); routeSource(); }
      return;
    }
    // the old stream stayed live until the new one resolved — now it can go
    if (micStream) micStream.getTracks().forEach((tr) => tr.stop());
    if (micNode) micNode.disconnect();
    micStream = stream;
    micNode = Engine.ctx.createMediaStreamSource(micStream);
    S.armed = true;
    S.source = 'mic';
    srcSel.set('mic');
    routeSource();
    armBtn.textContent = '● ' + t('input live');
    armBtn.classList.add('active');
    // labels only appear after permission — refresh the device list
    const devs = await navigator.mediaDevices.enumerateDevices();
    if (myReq !== armSeq) return;
    const inputs = devs.filter((d) => d.kind === 'audioinput');
    devSel.el.querySelector('select').innerHTML = '';
    for (const d of inputs) {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || t('input');
      devSel.el.querySelector('select').append(o);
    }
    if (S.deviceId) devSel.set(S.deviceId);
  }

  function disarm() {
    armSeq++; // cancels any in-flight arm()
    if (micStream) micStream.getTracks().forEach((tr) => tr.stop());
    if (micNode) micNode.disconnect();
    micStream = null;
    micNode = null;
    S.armed = false;
    armBtn.textContent = '⏺ ' + t('enable input');
    armBtn.classList.remove('active');
    if (S.source === 'mic') {
      S.source = 'pluck';
      srcSel.set('pluck');
      routeSource();
    }
  }

  // ---- UI ---------------------------------------------------------------------

  const wrap = elem('div', 'rig-wrap');

  // input strip
  const strip = elem('div', 'rig-strip');
  const inTitle = elem('div', 'rig-title', t('INPUT'));
  const srcSel = UI.select({
    label: t('source'),
    options: [
      { value: 'mic', label: t('microphone / interface') },
      { value: 'pluck', label: t('test pluck') },
    ],
    value: 'pluck',
    onChange: (v) => {
      S.source = v;
      if (v === 'mic' && !S.armed) { arm(); return; }
      buildChain();
      setOut(true);
      routeSource();
    },
  });
  const devSel = UI.select({
    label: t('device'),
    options: [{ value: '', label: '—' }],
    value: '',
    onChange: (v) => { S.deviceId = v; if (S.armed) arm(); },
  });
  const armBtn = UI.button({ label: '⏺ ' + t('enable input'), kind: 'primary', onClick: () => (S.armed ? disarm() : arm()) });
  const gainKnob = UI.knob({
    label: t('input gain'), min: 0, max: 4, value: 1, size: 52,
    format: (v) => v.toFixed(2) + '×',
    onInput: (v) => { S.gain = v; if (inGain) inGain.gain.setTargetAtTime(v, Engine.now(), 0.03); },
  });
  const meter = elem('canvas', 'rig-meter');
  meter.width = 280; meter.height = 24;
  const pluckBtn = UI.button({
    label: '♪ ' + t('PLUCK'),
    onClick: () => {
      buildChain();
      setOut(true);
      if (S.source !== 'pluck') { S.source = 'pluck'; srcSel.set('pluck'); }
      routeSource();
      plucker && plucker.pluck();
    },
  });
  const autoT = UI.toggle({
    label: t('auto pluck'),
    onChange: (on) => {
      S.autoPluck = on;
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      if (on) {
        buildChain(); setOut(true);
        if (S.source !== 'pluck') { S.source = 'pluck'; srcSel.set('pluck'); }
        routeSource();
        autoTimer = setInterval(() => { if (S.source === 'pluck' && plucker) plucker.pluck(); }, 1900);
        plucker && plucker.pluck();
      }
    },
  });
  const outCtl = UI.power({ title: t('OUTPUT'), onChange: (on) => setOut(on) });
  const levelKnob = UI.knob({
    label: t('rig level'), min: 0, max: 1, value: 0.8, size: 52,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => { S.level = v; if (S.out && rigBus) rigBus.gain.setTargetAtTime(v, Engine.now(), 0.03); },
  });

  const inputGroup = elem('div', 'rig-io');
  inputGroup.append(inTitle, srcSel.el, devSel.el, armBtn, gainKnob.el, meter, pluckBtn, autoT.el, levelKnob.el, outCtl.el);
  strip.append(inputGroup);

  // ---- tuner + latency row -------------------------------------------------------
  const NOTE_N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const tunerRow = elem('div', 'rig-io rig-tuner-row');
  const tunerNote = UI.readout('—', 'big');
  const tunerCv = elem('canvas', 'tuner-scale');
  tunerCv.width = 260; tunerCv.height = 54;
  const tunerT = UI.toggle({
    label: t('tuner'),
    onChange: (on) => {
      tunerOn = on;
      buildChain();
      if (S.source === 'pluck') routeSource();
      tunerNote.set('—');
      paintTuner(-1);
    },
  });

  let storedBuf = '';
  try {
    const raw = localStorage.getItem('osc-latency') || '';
    storedBuf = /^0\.\d+$/.test(raw) ? raw : ''; // legacy word values → auto
  } catch (e) { /* private mode */ }
  const bufSel = UI.select({
    label: t('buffer'),
    options: [
      { value: '', label: t('auto') },
      { value: '0.005', label: '5 ms' },
      { value: '0.01', label: '10 ms' },
      { value: '0.02', label: '20 ms' },
      { value: '0.05', label: '50 ms' },
    ],
    value: storedBuf,
    onChange: (v) => {
      try {
        if (v) localStorage.setItem('osc-latency', v);
        else localStorage.removeItem('osc-latency');
      } catch (e) { /* private mode */ }
      location.reload();
    },
  });
  const latInfo = UI.readout('—');
  tunerRow.append(tunerT.el, tunerNote.el, tunerCv, bufSel.el, latInfo.el);
  strip.append(tunerRow);
  strip.append(elem('div', 'rig-hint', t('the buffer is a request — the readout shows what the hardware actually granted. changing it reloads the page.')));

  // shared detector (js/pitch.js) — the DOJO scores through the same one
  function detectPitch() {
    return (pitchDet && Engine.ready) ? pitchDet.detect(Engine.ctx.sampleRate) : -1;
  }

  function paintTuner(freq) {
    const cg = tunerCv.getContext('2d');
    const W = tunerCv.width, H = tunerCv.height;
    cg.clearRect(0, 0, W, H);
    cg.fillStyle = 'rgba(0,0,0,0.35)';
    cg.fillRect(0, 0, W, H);
    // cents scale: ticks every 10¢, center line, ±5¢ green zone
    const cx = W / 2, span = W / 2 - 14;
    cg.fillStyle = 'rgba(72, 219, 195, 0.12)';
    cg.fillRect(cx - span * 0.1, 4, span * 0.2, H - 8);
    cg.strokeStyle = 'rgba(141, 138, 168, 0.5)';
    cg.lineWidth = 1;
    for (let cents = -50; cents <= 50; cents += 10) {
      const x = cx + (cents / 50) * span;
      cg.beginPath();
      cg.moveTo(x, cents === 0 ? 6 : H / 2 - 6);
      cg.lineTo(x, H - 6);
      cg.stroke();
    }
    if (freq > 0) {
      const midi = 69 + 12 * Math.log2(freq / 440);
      const n = Math.round(midi);
      const cents = (midi - n) * 100;
      const name = NOTE_N[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
      tunerNote.set(`${name} · ${freq.toFixed(1)} ${t('Hz')}`);
      const x = cx + (Math.max(-50, Math.min(50, cents)) / 50) * span;
      const inTune = Math.abs(cents) < 5;
      cg.strokeStyle = inTune ? '#48dbc3' : Math.abs(cents) < 15 ? '#ffb300' : '#ff5470';
      cg.lineWidth = 3;
      cg.beginPath();
      cg.moveTo(x, 4);
      cg.lineTo(x, H - 4);
      cg.stroke();
    } else {
      tunerNote.set('—');
    }
  }

  setInterval(() => {
    if (tunerOn && document.body.classList.contains('rig')) paintTuner(detectPitch());
  }, 120);

  setInterval(() => {
    if (Engine.ready) {
      const c = Engine.ctx;
      const ms = ((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000;
      latInfo.set(`${(c.sampleRate / 1000).toFixed(1)} kHz · ${ms.toFixed(1)} ms`);
    }
  }, 1000);
  const warn = elem('div', 'rig-warn', '⚠ ' + t('monitoring through speakers with a live microphone will feedback — use headphones.'));
  const hint = elem('div', 'rig-hint', t('the chain runs left to right — stomp a pedal to bring it in.'));
  wrap.append(strip, warn, hint);

  // pedalboard
  const board = elem('div', 'pedalboard');
  for (const p of PEDALS) {
    const card = elem('div', 'pedal');
    card.style.setProperty('--accent', p.accent);
    const head = elem('div', 'pedal-head');
    const stomp = UI.power({
      title: t(p.name),
      onChange: (on) => { PST[p.id].on = on; buildChain(); routeSource(); applyPedal(p.id); },
    });
    stomp.el.classList.add('stomp');
    head.append(elem('span', 'pedal-name', t(p.name)), stomp.el);
    const bodyEl = elem('div', 'pedal-body');
    const ctls = { _power: stomp };
    for (const c of p.controls) {
      if (c.type === 'knob') {
        // UI.knob is linear — log controls (freq/time/rate) run the knob on a
        // 0..1 position and map exponentially so the low end is dialable.
        const toVal = c.log ? (p01) => c.min * Math.pow(c.max / c.min, p01) : (v) => v;
        const toPos = c.log ? (v) => Math.log(v / c.min) / Math.log(c.max / c.min) : (v) => v;
        const k = UI.knob({
          label: t(c.label),
          min: c.log ? 0 : c.min, max: c.log ? 1 : c.max,
          value: toPos(c.def), step: c.step || 0, size: 44,
          format: (v) => (c.fmt || UI.fmt)(toVal(v)),
          onInput: (v) => { PST[p.id].params[c.key] = toVal(v); applyPedal(p.id); },
        });
        ctls[c.key] = { el: k.el, set: (v) => k.set(toPos(v)), get: () => toVal(k.get()) };
        bodyEl.append(k.el);
      } else if (c.type === 'select') {
        const s = UI.select({
          label: t(c.label),
          options: c.options.map((o) => (typeof o === 'string'
            ? { value: o, label: t(o) }
            : { value: o.value, label: t(o.label) })),
          value: c.def,
          onChange: (v) => { PST[p.id].params[c.key] = v; applyPedal(p.id); },
        });
        s.el.classList.add('pedal-select');
        ctls[c.key] = s;
        bodyEl.append(s.el);
      } else {
        const tg = UI.toggle({
          label: t(c.label), value: c.def,
          onChange: (v) => { PST[p.id].params[c.key] = v; applyPedal(p.id); },
        });
        ctls[c.key] = tg;
        bodyEl.append(tg.el);
      }
    }
    PST[p.id]._ctls = ctls;
    card.append(head, bodyEl);
    board.append(card);
  }
  wrap.append(board);

  // presets
  const chipRows = [];
  for (const grp of PRESET_GROUPS) {
    const chips = UI.chips({
      label: t(grp.group),
      items: grp.presets.map((pr) => ({ name: t(pr.name), hint: t(pr.hint), preset: pr })),
      onPick: (item) => {
        // one preset lights up at a time — clear the other groups' highlights
        // (UI.chips already set active on the picked chip in its own row)
        for (const row of chipRows) {
          if (row !== chips.el) row.querySelectorAll('.chip.active').forEach((c) => c.classList.remove('active'));
        }
        applyPreset(item.preset);
      },
    });
    chipRows.push(chips.el);
    wrap.append(chips.el);
  }

  function applyPreset(pr) {
    buildChain();
    setOut(true);
    routeSource();
    for (const p of PEDALS) {
      const st = PST[p.id];
      const cfg = pr.pedals[p.id];
      st.on = !!(cfg && cfg.on);
      for (const c of p.controls) {
        const v = cfg && cfg[c.key] != null ? cfg[c.key] : c.def;
        st.params[c.key] = v;
        st._ctls[c.key].set(v);
      }
      st._ctls._power.set(st.on);
      applyPedal(p.id);
    }
  }

  root.append(wrap);

  // debugging & automated verification
  window.__rig = { PST, S, live, nodes: () => ({ inGain, rigBus, plucker }) };

  // stop-all: mute the rig output (pedal states persist — it's a live rig).
  // it's also the panic button — release the mic entirely.
  Engine.onStopAll(() => {
    setOut(false);
    disarm();
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; autoT.set(false); S.autoPluck = false; }
  });

  // ---- meter loop --------------------------------------------------------------
  const mg = meter.getContext('2d');
  const mBuf = new Float32Array(1024);
  let clipHold = 0;
  function meterLoop() {
    if (document.body.classList.contains('rig') && meterAn) {
      meterAn.getFloatTimeDomainData(mBuf);
      let sum = 0, pk = 0;
      for (let i = 0; i < mBuf.length; i++) { const a = Math.abs(mBuf[i]); sum += a * a; pk = Math.max(pk, a); }
      const rms = Math.sqrt(sum / mBuf.length);
      if (pk > 0.98) clipHold = 60;
      const W = meter.width, H = meter.height;
      mg.clearRect(0, 0, W, H);
      mg.fillStyle = 'rgba(0,0,0,0.35)';
      mg.fillRect(0, 0, W, H);
      const w = Math.min(1, rms * 2.2) * (W - 26);
      const grad = mg.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, '#48dbc3');
      grad.addColorStop(0.7, '#9dff00');
      grad.addColorStop(1, '#ff5470');
      mg.fillStyle = grad;
      mg.fillRect(2, 4, w, H - 8);
      mg.fillStyle = clipHold > 0 ? '#ff5470' : 'rgba(255,84,112,0.15)';
      mg.beginPath();
      mg.arc(W - 11, H / 2, 6, 0, Math.PI * 2);
      mg.fill();
      if (clipHold > 0) clipHold--;
    }
    requestAnimationFrame(meterLoop);
  }
  requestAnimationFrame(meterLoop);

  // The DOJO listens on the rig's pre-chain analyser (dry signal) and reuses
  // the same arm/permission flow — one microphone owner, one panic path.
  return {
    applyPreset,
    arm,
    isArmed: () => S.armed,
    ensureChain: () => buildChain(),
    inputAnalyser: () => tunerAn,
  };
}
