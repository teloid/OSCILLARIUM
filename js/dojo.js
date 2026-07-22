// dojo.js — DOJO mode: interactive guitar lessons. A piano roll scrolls toward
// a fixed playhead; the lesson synth (or you) plays it; the RIG's pre-chain
// analyser feeds pitch detection so dry guitar is scored no matter what the
// pedalboard is doing. Modes: LISTEN (synth 100%), PRACTICE (guide 30%, loops,
// live coloring), SCORE (count-in, synth muted, one pass, letter grade).
import { Engine, Clock, midiToFreq, NOTE_NAMES, clamp } from './engine.js';
import * as UI from './ui.js';
import { t, registerDict } from './i18n.js';
import { createPitchDetector, midiFromFreq } from './pitch.js';

registerDict('ru', {
  'lessons': 'уроки',
  'LISTEN': 'СЛУШАТЬ', 'PRACTICE': 'ТРЕНИРОВКА', 'SCORE': 'ЗАЧЁТ',
  'play': 'играть', 'stop': 'стоп',
  'tempo': 'темп', 'transpose': 'транспон.', 'loop': 'повтор', 'metronome': 'метроном',
  'load midi': 'загрузить midi',
  'guitar pro? export as midi: file → export → midi.': 'guitar pro? экспортируйте в midi: file → export → midi.',
  'enable input': 'включить вход',
  'detection listens to the rig input — enable it (the test pluck works too).':
    'детекция слушает вход рига — включите его (тестовый щипок тоже считается).',
  'could not read that midi file': 'не удалось прочитать этот midi-файл',
  'first 400 notes': 'первые 400 нот',
  'bar': 'такт', 'bars': 'тактов', 'count-in': 'отсчёт',
  'notes': 'ноты', 'coverage': 'покрытие', 'best combo': 'лучшее комбо', 'perfect': 'идеальных',
  'combo': 'комбо',
  'pick a lesson, press play — the notes roll toward the line.':
    'выберите урок и нажмите играть — ноты поедут к линии.',
  // lesson names + hints (display only; ids/keys stay English)
  'pentatonic opener': 'пентатоника на разгон',
  'the E-minor box, downhill — every solo ever starts here.':
    'бокс E-минора, вниз по склону — отсюда начинается каждое соло.',
  'blues shuffle in A': 'блюзовый шаффл в A',
  'swing it — long-short pairs over a low A. the oldest trick in the book.':
    'свингуйте — пары долгая-короткая над низкой A. старейший трюк в книге.',
  'ode to joy (riff mode)': 'ода к радости (рифф-режим)',
  'Beethoven on the top strings — starts on your open E, dotted kick at phrase ends.':
    'Бетховен на верхних струнах — старт с открытой E, пунктир в концах фраз.',
  'greensleeves': 'зелёные рукава',
  'old England in 6/8 — let the long notes breathe.':
    'старая Англия в 6/8 — дайте длинным нотам дышать.',
  'house of the rising sun': 'дом восходящего солнца',
  'the arpeggio outline — Am C D F, one string at a time.':
    'контур арпеджио — Am C D F, по одной струне за раз.',
  'spider crawl': 'паучий ход',
  'chromatic 1-2-3-4 warmup — slow is smooth, smooth is fast.':
    'хроматическая разминка 1-2-3-4 — медленно значит ровно, ровно значит быстро.',
  'canon lead (pachelbel)': 'канон (пахельбель)',
  'the wedding line — eight changes, keep it singing.':
    'та самая свадебная линия — восемь смен гармонии, пусть поёт.',
  'harmonic minor run': 'гармонический минорный спуск',
  'the neoclassical elevator down — sixteenths to a low A. showoff certified.':
    'неоклассический лифт вниз — шестнадцатые до низкой A. сертифицировано для позёров.',
});

// [midi, startBeat, durBeats] triples → note objects (authoring shorthand).
const nn = (rows) => rows.map(([m, s, d]) => ({ m, s, d }));

// A swung beat: long-short eighth pair (0.66/0.34) at beat b.
const sw = (m1, m2, b) => [[m1, b, 0.66], [m2, b + 0.66, 0.34]];
// One bar of the A-boogie shuffle at bar offset o (A2 A2 · C#3 C#3 · D3 D3 · hi lo).
const shuffleBar = (o, b3hi, b3lo) => [
  ...sw(45, 45, o), ...sw(49, 49, o + 1), ...sw(50, 50, o + 2), ...sw(b3hi, b3lo, o + 3),
];
// Chromatic 1-2-3-4 group: four sixteenths up from `base` starting at beat b.
const spider4 = (base, b) => [0, 1, 2, 3].map((k) => [base + k, b + k * 0.25, 0.25]);
// Descending harmonic-minor four: sixteenths at beat b.
const run4 = (a, b_, c, d, beat) => [[a, beat, 0.25], [b_, beat + 0.25, 0.25], [c, beat + 0.5, 0.25], [d, beat + 0.75, 0.25]];
// 6/8 broken-chord bar (six eighths, d=1 each) at bar offset o.
const arp6 = (o, p) => p.map((m, k) => [m, o + k, 1]);
// Ode-to-joy style phrase: twelve quarters then the dotted figure (q. e h).
const odePhrase = (o, twelve, dot, tail) => [
  ...twelve.map((m, k) => [m, o + k, 1]),
  [dot, o + 12, 1.5], [tail, o + 13.5, 0.5], [tail, o + 14, 2],
];
// Canon upper-neighbor figure over one chord (2 beats): target q, neighbor e, target e.
const canon2 = (o, m, up) => [[m, o, 1], [up, o + 1, 0.5], [m, o + 1.5, 0.5]];

const LESSONS = [
  {
    id: 'pent-open', name: 'pentatonic opener', bpm: 92, beatsPerBar: 4,
    hint: 'the E-minor box, downhill — every solo ever starts here.',
    // E-minor pentatonic, cascading eighths E4→E3, classic rock resolution.
    notes: nn([
      [64, 0, 0.5], [62, 0.5, 0.5], [59, 1, 0.5], [62, 1.5, 0.5],
      [59, 2, 0.5], [57, 2.5, 0.5], [55, 3, 0.5], [57, 3.5, 0.5],
      [55, 4, 0.5], [52, 4.5, 0.5], [55, 5, 0.5], [57, 5.5, 0.5],
      [55, 6, 0.5], [50, 6.5, 0.5], [52, 7, 1],
    ]),
  },
  {
    id: 'shuffle-a', name: 'blues shuffle in A', bpm: 84, beatsPerBar: 4,
    hint: 'swing it — long-short pairs over a low A. the oldest trick in the book.',
    // A2 boogie: A A · C# C# · D D · E D, turned around to the root in bar 4.
    notes: nn([
      ...shuffleBar(0, 52, 50), ...shuffleBar(4, 52, 50), ...shuffleBar(8, 52, 50),
      ...sw(45, 45, 12), ...sw(49, 49, 13), ...sw(50, 49, 14), [45, 15, 1],
    ]),
  },
  {
    id: 'ode-joy', name: 'ode to joy (riff mode)', bpm: 120, beatsPerBar: 4,
    hint: 'Beethoven on the top strings — starts on your open E, dotted kick at phrase ends.',
    // The 16-bar theme, quarters, starting on E4 (open high E); dotted figure
    // closes every phrase. Public domain since 1824.
    notes: nn([
      ...odePhrase(0, [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64], 64, 62),
      ...odePhrase(16, [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64], 62, 60),
      // B section: D D E C · D EF E C · D EF E D · C D G(low)
      [62, 32, 1], [62, 33, 1], [64, 34, 1], [60, 35, 1],
      [62, 36, 1], [64, 37, 0.5], [65, 37.5, 0.5], [64, 38, 1], [60, 39, 1],
      [62, 40, 1], [64, 41, 0.5], [65, 41.5, 0.5], [64, 42, 1], [62, 43, 1],
      [60, 44, 1], [62, 45, 1], [55, 46, 2],
      ...odePhrase(48, [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64], 62, 60),
    ]),
  },
  {
    id: 'greensleeves', name: 'greensleeves', bpm: 200, beatsPerBar: 6,
    hint: 'old England in 6/8 — let the long notes breathe.',
    // 6/8: one beat = one eighth (bpm 200 ≈ dotted-quarter 66). A minor,
    // pickup + first 8 bars, octave-down so it sits on the middle strings.
    notes: nn([
      [57, 5, 1],
      [60, 6, 2], [62, 8, 1], [64, 9, 1.5], [65, 10.5, 0.5], [64, 11, 1],
      [62, 12, 2], [59, 14, 1], [55, 15, 1.5], [57, 16.5, 0.5], [59, 17, 1],
      [60, 18, 2], [57, 20, 1], [57, 21, 1.5], [56, 22.5, 0.5], [57, 23, 1],
      [59, 24, 2], [56, 26, 1], [52, 27, 3],
      [60, 30, 2], [62, 32, 1], [64, 33, 1.5], [65, 34.5, 0.5], [64, 35, 1],
      [62, 36, 2], [59, 38, 1], [55, 39, 1.5], [57, 40.5, 0.5], [59, 41, 1],
      [60, 42, 1.5], [59, 43.5, 0.5], [57, 44, 1], [56, 45, 1.5], [54, 46.5, 0.5], [56, 47, 1],
      [57, 48, 4],
    ]),
  },
  {
    id: 'rising-sun', name: 'house of the rising sun', bpm: 220, beatsPerBar: 6,
    hint: 'the arpeggio outline — Am C D F, one string at a time.',
    // 6/8 broken chords (up-and-over), the classic changes: Am C D F · Am C E E.
    notes: nn([
      ...arp6(0, [45, 48, 52, 57, 52, 48]),   // Am
      ...arp6(6, [48, 52, 55, 60, 55, 52]),   // C
      ...arp6(12, [50, 54, 57, 62, 57, 54]),  // D
      ...arp6(18, [41, 45, 48, 53, 48, 45]),  // F
      ...arp6(24, [45, 48, 52, 57, 52, 48]),  // Am
      ...arp6(30, [48, 52, 55, 60, 55, 52]),  // C
      ...arp6(36, [40, 44, 47, 52, 47, 44]),  // E
      ...arp6(42, [40, 44, 47, 52, 47, 44]),  // E
    ]),
  },
  {
    id: 'spider', name: 'spider crawl', bpm: 100, beatsPerBar: 4,
    hint: 'chromatic 1-2-3-4 warmup — slow is smooth, smooth is fast.',
    // Sixteenths, four frets per string across E3/A3/D4/G4 starts, then the
    // whole crawl shifts up one fret for bar two.
    notes: nn([
      ...spider4(52, 0), ...spider4(57, 1), ...spider4(62, 2), ...spider4(67, 3),
      ...spider4(53, 4), ...spider4(58, 5), ...spider4(63, 6), ...spider4(68, 7),
    ]),
  },
  {
    id: 'canon', name: 'canon lead (pachelbel)', bpm: 90, beatsPerBar: 4,
    hint: 'the wedding line — eight changes, keep it singing.',
    // D major, the violin line over D A Bm F#m G D G A: the half-note descent,
    // then the same targets ornamented with upper neighbors. Public domain, 1694.
    notes: nn([
      [66, 0, 2], [64, 2, 2], [62, 4, 2], [61, 6, 2],
      [59, 8, 2], [57, 10, 2], [59, 12, 2], [61, 14, 2],
      ...canon2(16, 66, 67), ...canon2(18, 64, 66), ...canon2(20, 62, 64), ...canon2(22, 61, 62),
      ...canon2(24, 59, 61), ...canon2(26, 57, 59), ...canon2(28, 59, 61),
      [61, 30, 1], [62, 31, 1],
    ]),
  },
  {
    id: 'harm-minor', name: 'harmonic minor run', bpm: 96, beatsPerBar: 4,
    hint: 'the neoclassical elevator down — sixteenths to a low A. showoff certified.',
    // A harmonic minor, descending fours sequenced down the scale, closing with
    // an E-major arpeggio dive onto the low A (the V→i mic drop).
    notes: nn([
      ...run4(69, 68, 65, 64, 0), ...run4(68, 65, 64, 62, 1),
      ...run4(65, 64, 62, 60, 2), ...run4(64, 62, 60, 59, 3),
      ...run4(62, 60, 59, 57, 4), ...run4(60, 59, 57, 56, 5),
      ...run4(59, 57, 56, 53, 6), ...run4(52, 47, 44, 45, 7),
    ]),
  },
];

// canvas palette
const C_BG = 'rgba(0, 0, 0, 0.35)';
const C_GRID = 'rgba(141, 138, 168, 0.18)';
const C_BARLINE = 'rgba(141, 138, 168, 0.45)';
const C_UPCOMING = 'rgba(178, 107, 255, 0.35)';
const C_ACTIVE = '#b26bff';
const C_HIT = '#48dbc3';
const C_MISS = '#ff5470';
const C_PARTIAL = '#ffb300';
const C_TRAIL = '#00e5ff';
const C_PLAYHEAD = 'rgba(233, 231, 247, 0.85)';
const C_LABEL = 'rgba(7, 7, 12, 0.9)';

const WINDOW_BEATS = 8;     // visible roll width
const PLAYHEAD_FRAC = 0.28; // playhead x as a fraction of canvas width
const DET_MS = 70;          // detection cadence
const HIT_CENTS = 0.6;      // |detected − expected| < 0.6 semitones
const TRAIL_N = 40;

function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// rig = { arm(), isArmed(), ensureChain(), inputAnalyser() } — the RIG owns the
// microphone; DOJO only listens on its pre-chain (dry) analyser.
export function initDojo(root, rig) {
  const S = {
    lesson: LESSONS[0],
    mode: 'listen',   // 'listen' | 'practice' | 'score' (internal keys, never translated)
    tempoPct: 100,    // 40..120% of lesson bpm
    transpose: 0,     // semitones, applied to synth AND expectations
    loop: true,       // LISTEN/PRACTICE only
    metronome: true,
  };

  // ---- lesson-derived (recomputed on lesson/transpose change) ----------------
  let LB = 8;               // lesson length in beats, padded to whole bars
  let rangeLo = 40, rangeHi = 76; // canvas midi range (lesson ±3, transposed)
  let noteLabels = [];      // per-note name strings (prebuilt — none in rAF)
  let statusNote = '';      // midi-import messages ('first 400 notes', errors)

  function refreshDerived() {
    const L = S.lesson;
    let end = 0, lo = 127, hi = 0;
    for (const n of L.notes) {
      end = Math.max(end, n.s + n.d);
      lo = Math.min(lo, n.m);
      hi = Math.max(hi, n.m);
    }
    LB = Math.max(L.beatsPerBar, Math.ceil(end - 1e-6) === 0 ? L.beatsPerBar
      : Math.ceil((end - 1e-6) / L.beatsPerBar) * L.beatsPerBar);
    rangeLo = lo + S.transpose - 3;
    rangeHi = hi + S.transpose + 3;
    if (rangeHi - rangeLo < 10) { const pad = Math.ceil((10 - (rangeHi - rangeLo)) / 2); rangeLo -= pad; rangeHi += pad; }
    noteLabels = L.notes.map((n) => {
      const m = n.m + S.transpose;
      return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
    });
  }

  function effBpm() { return S.lesson.bpm * S.tempoPct / 100; }

  // ---- audio (lazy) ------------------------------------------------------------
  let built = false;
  let voiceBus = null;  // lesson synth (LISTEN 100% / PRACTICE 30% / SCORE 0%)
  let metBus = null;    // metronome, modest level
  const activeSrcs = new Set();

  function buildAudio() {
    if (built) return;
    const ctx = Engine.ctx;
    const chan = Engine.createChannel(0.5);
    voiceBus = ctx.createGain();
    metBus = ctx.createGain();
    metBus.gain.value = 0.45;
    voiceBus.connect(chan);
    metBus.connect(chan);
    built = true;
  }

  // Cheap pluck: triangle → lowpass 2.5k → 5 ms attack, exponential-ish decay
  // to the note end, 60 ms release.
  function scheduleNote(n, tt, durSec) {
    const ctx = Engine.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(midiToFreq(n.m + S.transpose), tt);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    const env = ctx.createGain();
    osc.connect(lp); lp.connect(env); env.connect(voiceBus);
    const tEnd = tt + Math.max(0.06, durSec);
    env.gain.setValueAtTime(0, tt);
    env.gain.linearRampToValueAtTime(0.5, tt + 0.005);
    env.gain.exponentialRampToValueAtTime(0.13, tEnd);
    env.gain.exponentialRampToValueAtTime(0.0008, tEnd + 0.06);
    osc.start(tt);
    osc.stop(tEnd + 0.08);
    activeSrcs.add(osc);
    osc.onended = () => {
      activeSrcs.delete(osc);
      try { osc.disconnect(); lp.disconnect(); env.disconnect(); } catch (e) { /* gone */ }
    };
  }

  // Metronome blip: 1.5 kHz, accented 2 kHz on beat 1.
  function scheduleBlip(tt, accent) {
    const ctx = Engine.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accent ? 2000 : 1500, tt);
    const env = ctx.createGain();
    osc.connect(env); env.connect(metBus);
    env.gain.setValueAtTime(0, tt);
    env.gain.linearRampToValueAtTime(accent ? 0.6 : 0.3, tt + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, tt + (accent ? 0.07 : 0.045));
    osc.start(tt);
    osc.stop(tt + 0.09);
    activeSrcs.add(osc);
    osc.onended = () => {
      activeSrcs.delete(osc);
      try { osc.disconnect(); env.disconnect(); } catch (e) { /* gone */ }
    };
  }

  // ---- transport: phase-anchored beats ------------------------------------------
  // beatAt(t) = phAnchor + (t − phTime)/spb. Tempo changes reanchor first, so the
  // beat position is phase-continuous (same trick as beatlab's setRate).
  let running = false;
  let spb = 60 / effBpm();
  let phAnchor = 0, phTime = 0;
  let schedBase = 0;   // beat offset of the loop iteration being SCHEDULED
  let noteIx = 0;      // next note to schedule within that iteration
  let metCursor = 0;   // next metronome beat (integer; negative during count-in)

  const beatAt = (tt) => phAnchor + (tt - phTime) / spb;
  const timeOfBeat = (b) => phTime + (b - phAnchor) * spb;

  function onTick(horizon) {
    if (!running) return;
    const hBeat = beatAt(horizon);
    const looping = S.loop && S.mode !== 'score';
    // metronome (count-in beats always click; the toggle governs the rest)
    const metLimit = looping ? Infinity : schedBase + LB;
    const bpb = S.lesson.beatsPerBar;
    while (metCursor < hBeat && metCursor < metLimit) {
      if (S.metronome || metCursor < 0) {
        scheduleBlip(timeOfBeat(metCursor), ((metCursor % bpb) + bpb) % bpb === 0);
      }
      metCursor++;
    }
    // lesson notes (loop rolls schedBase forward one lesson at a time)
    const notes = S.lesson.notes;
    for (let g = 0; g < 32; g++) {
      while (noteIx < notes.length && schedBase + notes[noteIx].s < hBeat) {
        const n = notes[noteIx++];
        scheduleNote(n, timeOfBeat(schedBase + n.s), n.d * spb);
      }
      if (noteIx < notes.length || !looping) break;
      schedBase += LB;
      noteIx = 0;
      if (schedBase >= hBeat) break;
    }
    // end of a non-looping run
    if (!looping && beatAt(Engine.now()) >= schedBase + LB + 0.02) {
      finishRun();
      return;
    }
    updateStatus();
    updateComboEl();
  }

  const clock = new Clock(onTick, 25, 0.12);

  // ---- detection + per-note scoring ---------------------------------------------
  let det = null;
  let detTimer = null;
  let detPtr = 0;    // next unfinalized note (current loop iteration)
  let curIter = 0;   // loop iteration the DETECTOR is looking at
  // parallel per-note state (allocated per lesson, reset per iteration)
  let stFrames = new Int32Array(0), stHitFrames = new Int32Array(0);
  let stVerdict = new Int8Array(0);     // 0 pending · 1 hit · 2 partial · 3 miss
  let stPerfect = new Uint8Array(0);
  let stFirstHit = new Float64Array(0); // -1 until the first hit frame
  // run stats
  let runHit = 0, runPerfect = 0, covSum = 0, judged = 0, combo = 0, bestCombo = 0;
  // pitch trail ring buffer (beat, midi) — fixed, nothing allocated live
  const trailB = new Float64Array(TRAIL_N);
  const trailM = new Float64Array(TRAIL_N);
  let trailHead = 0, trailLen = 0;

  function allocStates() {
    const n = S.lesson.notes.length;
    stFrames = new Int32Array(n);
    stHitFrames = new Int32Array(n);
    stVerdict = new Int8Array(n);
    stPerfect = new Uint8Array(n);
    stFirstHit = new Float64Array(n);
  }

  function resetStates() {
    stFrames.fill(0); stHitFrames.fill(0); stVerdict.fill(0);
    stPerfect.fill(0); stFirstHit.fill(-1);
  }

  function finalizeNote(i) {
    const cov = stHitFrames[i] / Math.max(1, stFrames[i]);
    covSum += cov;
    judged++;
    if (cov >= 0.45) {
      stVerdict[i] = 1;
      runHit++;
      if (stPerfect[i]) runPerfect++;
      combo++;
      if (combo > bestCombo) bestCombo = combo;
    } else {
      stVerdict[i] = cov >= 0.2 ? 2 : 3;
      combo = 0;
    }
  }

  function detTick() {
    if (!running || !det || !Engine.ready) return;
    const now = Engine.now();
    const nowBeat = beatAt(now);
    if (nowBeat < 0) return; // count-in
    const notes = S.lesson.notes;
    if (S.loop && S.mode !== 'score') {
      // crossed into the next loop iteration → close out the old one, fresh slate
      const iter = Math.floor(nowBeat / LB);
      if (iter !== curIter) {
        while (detPtr < notes.length) finalizeNote(detPtr++);
        curIter = iter;
        detPtr = 0;
        resetStates();
      }
    } else if (nowBeat >= LB) {
      return; // past the end — onTick's finishRun() will finalize and grade
    }
    const base = curIter * LB;
    // finalize notes whose window has closed
    while (detPtr < notes.length) {
      const n = notes[detPtr];
      if (now <= timeOfBeat(base + n.s + n.d) - 0.04) break;
      finalizeNote(detPtr++);
    }
    // one detection frame
    const f = det.detect(Engine.ctx.sampleRate);
    const midi = f > 0 ? midiFromFreq(f) : -1;
    if (f > 0) {
      trailB[trailHead] = nowBeat;
      trailM[trailHead] = midi;
      trailHead = (trailHead + 1) % TRAIL_N;
      if (trailLen < TRAIL_N) trailLen++;
    }
    // does this frame land inside the current expected window?
    if (detPtr < notes.length) {
      const n = notes[detPtr];
      const tOn = timeOfBeat(base + n.s);
      if (now >= tOn + 0.08 && now <= timeOfBeat(base + n.s + n.d) - 0.04) {
        stFrames[detPtr]++;
        if (f > 0 && Math.abs(midi - (n.m + S.transpose)) < HIT_CENTS) {
          stHitFrames[detPtr]++;
          if (stFirstHit[detPtr] < 0) {
            stFirstHit[detPtr] = now;
            if (Math.abs(now - tOn) <= 0.1) stPerfect[detPtr] = 1;
          }
        }
      }
    }
    updateComboEl();
  }

  // ---- run lifecycle ---------------------------------------------------------------
  function startRun() {
    Engine.init();
    stopRun();
    buildAudio();
    det = null;
    if (S.mode !== 'listen') {
      rig.ensureChain();
      const an = rig.inputAnalyser();
      if (an) det = createPitchDetector(an);
    }
    spb = 60 / effBpm();
    voiceBus.gain.value = S.mode === 'listen' ? 1 : S.mode === 'practice' ? 0.3 : 0;
    phTime = Engine.now() + 0.12;
    phAnchor = S.mode === 'score' ? -S.lesson.beatsPerBar : 0; // 1-bar count-in
    schedBase = 0; noteIx = 0; metCursor = phAnchor;
    detPtr = 0; curIter = 0;
    resetStates();
    runHit = 0; runPerfect = 0; covSum = 0; judged = 0; combo = 0; bestCombo = 0;
    trailLen = 0; trailHead = 0;
    clearGrade();
    running = true;
    playBtn.textContent = '■ ' + t('stop');
    if (det) detTimer = setInterval(detTick, DET_MS);
    clock.start();
    updateStatus();
    updateComboEl();
    syncRaf();
  }

  function stopRun() {
    if (detTimer) { clearInterval(detTimer); detTimer = null; }
    clock.stop();
    if (!running) return;
    running = false;
    for (const s of activeSrcs) { try { s.stop(); } catch (e) { /* already stopped */ } }
    playBtn.textContent = '▶ ' + t('play');
    updateStatus();
    updateComboEl();
    syncRaf();
  }

  function finishRun() {
    const scored = S.mode === 'score' && det;
    if (scored) {
      while (detPtr < S.lesson.notes.length) finalizeNote(detPtr++);
      showGrade();
    }
    stopRun();
  }

  function computeGrade(hitPct, avgCov) {
    if (hitPct >= 0.95 && avgCov >= 0.8) return 'S';
    if (hitPct >= 0.85) return 'A';
    if (hitPct >= 0.7) return 'B';
    if (hitPct >= 0.5) return 'C';
    return 'D';
  }

  // ---- UI --------------------------------------------------------------------------
  const wrap = elem('div', 'dojo-wrap');

  // lesson picker
  const lessonChips = UI.chips({
    label: t('lessons'),
    items: LESSONS.map((l) => ({ name: t(l.name), hint: t(l.hint), lesson: l })),
    onPick: (item) => setLesson(item.lesson),
  });
  const chipsRow = lessonChips.el.querySelector('.chips');
  wrap.append(lessonChips.el);

  // roll canvas + live combo
  const canvas = elem('canvas', 'lesson-canvas');
  const comboEl = elem('div', 'dojo-combo');
  wrap.append(canvas, comboEl);

  // transport row
  const MODE_LABELS = { listen: 'LISTEN', practice: 'PRACTICE', score: 'SCORE' };
  const modeBtnEls = {};
  const row1 = elem('div', 'dojo-row');
  for (const m of ['listen', 'practice', 'score']) {
    const b = UI.button({ label: t(MODE_LABELS[m]), onClick: () => setMode(m) });
    modeBtnEls[m] = b;
    row1.append(b);
  }
  const playBtn = UI.button({ label: '▶ ' + t('play'), kind: 'primary', onClick: () => (running ? stopRun() : startRun()) });
  const tempoKnob = UI.knob({
    label: t('tempo'), min: 40, max: 120, value: S.tempoPct, step: 1, size: 56,
    format: (v) => Math.round(v) + '%',
    onInput: (v) => setTempoPct(v),
  });
  const transKnob = UI.knob({
    label: t('transpose'), min: -12, max: 12, value: 0, step: 1, size: 56,
    format: (v) => (v > 0 ? '+' : '') + v,
    onInput: (v) => setTranspose(v),
  });
  const loopT = UI.toggle({ label: t('loop'), value: S.loop, onChange: (v) => { S.loop = v; } });
  const metT = UI.toggle({ label: t('metronome'), value: S.metronome, onChange: (v) => { S.metronome = v; } });
  row1.append(playBtn, tempoKnob.el, transKnob.el, loopT.el, metT.el);
  wrap.append(row1);

  // status + midi import
  const statusRd = UI.readout('—');
  const fileIn = elem('input');
  fileIn.type = 'file';
  fileIn.accept = '.mid,.midi';
  fileIn.style.display = 'none';
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    f.arrayBuffer()
      .then((buf) => loadMidi(f.name, buf))
      .catch((err) => {
        console.error('[dojo] midi read', err);
        statusNote = t('could not read that midi file');
        updateStatus();
      });
  });
  const midiBtn = UI.button({ label: '⇪ ' + t('load midi'), onClick: () => fileIn.click() });
  const row2 = elem('div', 'dojo-row');
  row2.append(statusRd.el, midiBtn, fileIn);
  wrap.append(row2);
  wrap.append(elem('div', 'dojo-hint', t('guitar pro? export as midi: file → export → midi.')));

  // grade panel
  const gradeEl = elem('div', 'dojo-grade');
  const statsEl = elem('div', 'dojo-stats');
  wrap.append(gradeEl, statsEl);

  // input hint (PRACTICE/SCORE with no armed input)
  const inputHint = elem('div', 'dojo-hint');
  inputHint.append(
    elem('span', '', t('detection listens to the rig input — enable it (the test pluck works too).')),
    UI.button({
      label: '⏺ ' + t('enable input'), kind: 'primary',
      onClick: () => {
        Engine.init();
        Promise.resolve(rig.arm()).then(() => updateInputHint(), () => updateInputHint());
      },
    }),
  );
  inputHint.style.display = 'none';
  wrap.append(inputHint);

  root.append(wrap);

  function setMode(m) {
    if (S.mode === m) return;
    stopRun();
    S.mode = m;
    for (const k in modeBtnEls) modeBtnEls[k].classList.toggle('active', k === m);
    updateInputHint();
    updateComboEl();
  }

  function setLesson(l) {
    stopRun();
    S.lesson = l;
    statusNote = '';
    refreshDerived();
    allocStates();
    resetStates();
    detPtr = 0; curIter = 0; trailLen = 0; trailHead = 0;
    clearGrade();
    updateStatus();
  }

  function setTempoPct(v) {
    if (running && S.mode === 'score') { tempoKnob.set(S.tempoPct); return; } // locked mid-SCORE
    if (running && Engine.ready) { // fold elapsed phase in at the OLD tempo first
      const now = Engine.now();
      phAnchor = beatAt(now);
      phTime = now;
    }
    S.tempoPct = v;
    spb = 60 / effBpm();
    updateStatus();
  }

  function setTranspose(v) {
    if (running && S.mode === 'score') { transKnob.set(S.transpose); return; } // locked mid-SCORE
    S.transpose = v;
    refreshDerived(); // labels + canvas range follow; future notes schedule transposed
    updateStatus();
  }

  function updateInputHint() {
    const need = S.mode !== 'listen' && !rig.isArmed();
    inputHint.style.display = need ? '' : 'none';
  }

  // ---- readout / combo / grade (cached — updateStatus runs at tick rate) ---------
  let statusTxt = '', comboTxt = null;

  function updateStatus() {
    const L = S.lesson;
    let pos = '—';
    if (running && Engine.ready) {
      const b = beatAt(Engine.now());
      if (b < 0) pos = t('count-in');
      else {
        const ib = ((b % LB) + LB) % LB;
        pos = t('bar') + ' ' + (Math.floor(ib / L.beatsPerBar) + 1) + ':' + (Math.floor(ib % L.beatsPerBar) + 1);
      }
    }
    const txt = pos + ' · ' + Math.round(effBpm()) + ' bpm · '
      + (LB / L.beatsPerBar) + ' ' + t('bars') + (statusNote ? ' · ' + statusNote : '');
    if (txt !== statusTxt) { statusTxt = txt; statusRd.set(txt); }
  }

  function updateComboEl() {
    const txt = running && S.mode !== 'listen' && combo > 0 ? t('combo') + ' ×' + combo : '';
    if (txt !== comboTxt) { comboTxt = txt; comboEl.textContent = txt; }
  }

  function showGrade() {
    const total = S.lesson.notes.length;
    const avgCov = covSum / Math.max(1, judged);
    gradeEl.textContent = computeGrade(runHit / Math.max(1, total), avgCov);
    statsEl.textContent = t('notes') + ' ' + runHit + '/' + total
      + ' · ' + t('coverage') + ' ' + Math.round(avgCov * 100) + '%'
      + ' · ' + t('best combo') + ' ' + bestCombo
      + ' · ' + t('perfect') + ' ' + runPerfect;
  }

  function clearGrade() {
    gradeEl.textContent = '';
    statsEl.textContent = '';
  }

  // ---- canvas roll ------------------------------------------------------------------
  const g = canvas.getContext('2d');
  const IDLE_HINT = t('pick a lesson, press play — the notes roll toward the line.');
  const COUNT_TXT = t('count-in');
  let W = 0, H = 0, dpr = 1;

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  function roundBar(x, y, w, h) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, Math.min(4, h / 2, w / 2));
    else g.rect(x, y, w, h);
    g.fill();
  }

  // one bounded pass over the notes at a given loop-iteration offset;
  // useVerdicts: this base is the iteration the DETECTOR is scoring right now
  function drawNotes(base, curBeat, pxPerBeat, phX, isCurrent, useVerdicts) {
    const notes = S.lesson.notes;
    const spanY = H - 24;
    const barH = clamp((spanY / Math.max(1, rangeHi - rangeLo)) * 0.9, 5, 16);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const bs = base + n.s;
      const x0 = phX + (bs - curBeat) * pxPerBeat;
      if (x0 > W) break; // sorted by s — nothing further is visible
      const x1 = phX + (bs + n.d - curBeat) * pxPerBeat;
      if (x1 < 0) continue;
      let col = C_UPCOMING;
      if (isCurrent) {
        const v = useVerdicts ? stVerdict[i] : 0;
        if (v === 1) col = C_HIT;
        else if (v === 2) col = C_PARTIAL;
        else if (v === 3) col = C_MISS;
        else if (curBeat >= bs && curBeat < bs + n.d) col = C_ACTIVE;
      }
      const m = n.m + S.transpose;
      const yC = 12 + (1 - (m - rangeLo) / (rangeHi - rangeLo)) * spanY;
      const w = Math.max(2, x1 - x0 - 1);
      g.fillStyle = col;
      roundBar(x0, yC - barH / 2, w, barH);
      if (w > 34) {
        g.fillStyle = C_LABEL;
        g.fillText(noteLabels[i], x0 + 4, yC + 3.5);
      }
    }
  }

  let rafId = 0;
  const dojoActive = () => document.body.classList.contains('dojo');

  function syncRaf() {
    if ((dojoActive() || running) && !rafId) rafId = requestAnimationFrame(draw);
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    if (!dojoActive() && !running) { cancelAnimationFrame(rafId); rafId = 0; return; }
    resizeIfDprChanged();
    if (W < 8 || H < 8) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = C_BG;
    g.fillRect(0, 0, W, H);

    const curBeat = running && Engine.ready ? beatAt(Engine.now()) : 0;
    const pxPerBeat = W / WINDOW_BEATS;
    const phX = W * PLAYHEAD_FRAC;
    const bpb = S.lesson.beatsPerBar;

    // beat grid (bar lines brighter)
    g.lineWidth = 1;
    const bL = Math.ceil(curBeat - phX / pxPerBeat);
    const bR = Math.floor(curBeat + (W - phX) / pxPerBeat);
    for (let b = bL; b <= bR; b++) {
      const x = phX + (b - curBeat) * pxPerBeat;
      g.strokeStyle = ((b % bpb) + bpb) % bpb === 0 ? C_BARLINE : C_GRID;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }

    // notes: current iteration (verdict colors) + neighbors while looping
    const detMode = S.mode !== 'listen';
    const iterBase = running ? Math.floor(Math.max(0, curBeat) / LB) * LB : 0;
    drawNotes(iterBase, curBeat, pxPerBeat, phX, true, detMode && curIter * LB === iterBase);
    if (running && S.loop && S.mode !== 'score') {
      drawNotes(iterBase + LB, curBeat, pxPerBeat, phX, false, detMode);
      if (iterBase > 0) drawNotes(iterBase - LB, curBeat, pxPerBeat, phX, false, detMode);
    }

    // live pitch trail (newest brightest)
    if (running && detMode && trailLen > 0) {
      const spanY = H - 24;
      g.fillStyle = C_TRAIL;
      for (let k = 0; k < trailLen; k++) {
        const idx = (trailHead - 1 - k + TRAIL_N + TRAIL_N) % TRAIL_N;
        const x = phX + (trailB[idx] - curBeat) * pxPerBeat;
        if (x < -4) continue;
        const y = 12 + (1 - (trailM[idx] - rangeLo) / (rangeHi - rangeLo)) * spanY;
        g.globalAlpha = 0.85 * (1 - k / TRAIL_N);
        g.beginPath();
        g.arc(x, y, 2.5, 0, 6.2832);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // playhead
    g.strokeStyle = C_PLAYHEAD;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(phX, 0);
    g.lineTo(phX, H);
    g.stroke();

    g.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    if (!running) {
      g.fillStyle = 'rgba(233, 231, 247, 0.55)';
      g.fillText(IDLE_HINT, 10, 16);
    } else if (curBeat < 0) {
      g.fillStyle = C_PLAYHEAD;
      g.fillText(COUNT_TXT, phX + 8, 16);
    }
  }

  function resizeIfDprChanged() {
    if (Math.min(window.devicePixelRatio || 1, 2) !== dpr) resize();
  }

  new MutationObserver(syncRaf).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // ---- MIDI import (minimal SMF format 0/1) --------------------------------------
  function parseMidi(buf) {
    const bytes = new Uint8Array(buf);
    const dv = new DataView(buf);
    let p = 0;
    const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
    const u16 = () => { const v = dv.getUint16(p); p += 2; return v; };
    const u8 = () => bytes[p++];
    const vlq = () => {
      let v = 0, b, i = 0;
      do { b = u8(); v = (v << 7) | (b & 0x7f); } while ((b & 0x80) && ++i < 5);
      return v;
    };
    if (bytes.length < 14 || u32() !== 0x4d546864) throw new Error('not a midi file');
    const hlen = u32();
    u16(); // format (0/1 both fine; picking the densest track covers both)
    const ntracks = u16();
    const division = u16();
    p += hlen - 6;
    if (division & 0x8000) throw new Error('smpte division unsupported');
    if (!division) throw new Error('zero division');

    let bpm = 0, bpb = 0;
    const tracks = [];
    for (let ti = 0; ti < ntracks && p + 8 <= bytes.length; ti++) {
      const id = u32();
      const len = u32();
      const end = Math.min(p + len, bytes.length);
      if (id !== 0x4d54726b) { p = end; continue; } // alien chunk — skip
      let tick = 0, run = 0;
      const notes = [];
      const open = Object.create(null); // (channel·128+pitch) → index into notes
      while (p < end) {
        tick += vlq();
        let st = bytes[p];
        if (st & 0x80) { p++; if (st < 0xf0) run = st; }
        else { st = run; if (!st) throw new Error('dangling running status'); }
        if (st === 0xff) {
          const type = u8();
          const l = vlq();
          if (type === 0x51 && l === 3 && !bpm) {
            const us = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
            if (us > 0) bpm = 60000000 / us; // first setTempo wins
          } else if (type === 0x58 && l >= 2 && !bpb) {
            bpb = Math.max(1, Math.round(bytes[p] * 4 / Math.pow(2, bytes[p + 1])));
          }
          p += l;
        } else if (st === 0xf0 || st === 0xf7) {
          p += vlq(); // sysex — skip payload
        } else {
          const hi = st & 0xf0;
          if (hi === 0x90 || hi === 0x80) {
            const pitch = u8(), vel = u8();
            const key = (st & 0x0f) * 128 + pitch;
            if (hi === 0x90 && vel > 0) {
              if (open[key] != null) { const o = notes[open[key]]; o.dt = Math.max(1, tick - o.tick); } // retrigger
              open[key] = notes.length;
              notes.push({ m: pitch, tick, dt: 0 });
            } else if (open[key] != null) {
              const o = notes[open[key]];
              o.dt = Math.max(1, tick - o.tick);
              open[key] = null;
            }
          } else if (hi === 0xc0 || hi === 0xd0) p += 1;
          else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) p += 2;
          else if (st === 0xf2) p += 2;
          else if (st === 0xf1 || st === 0xf3) p += 1;
          // remaining system-realtime bytes carry no data
        }
      }
      for (const k in open) { // hanging note-ons: close at track end
        if (open[k] != null) {
          const o = notes[open[k]];
          if (!o.dt) o.dt = Math.max(1, tick - o.tick) || division;
        }
      }
      p = end;
      tracks.push(notes);
    }

    let best = null; // the track with the most note-ons carries the melody
    for (const tr of tracks) if (tr.length && (!best || tr.length > best.length)) best = tr;
    if (!best) throw new Error('no notes');

    // monophonic reduction: chords keep the highest pitch, overlaps clip the
    // previous note at the new onset
    best.sort((a, b) => a.tick - b.tick || b.m - a.m);
    const mono = [];
    for (const n of best) {
      const last = mono[mono.length - 1];
      if (last && n.tick === last.tick) continue;
      if (last && n.tick < last.tick + last.dt) last.dt = n.tick - last.tick;
      mono.push(n);
    }

    bpb = bpb || 4;
    let out = mono.map((n) => ({ m: n.m, s: n.tick / division, d: Math.max(0.05, n.dt / division) }));
    const shift = Math.floor(out[0].s / bpb) * bpb; // drop leading silence, bar-aligned
    if (shift > 0) for (const n of out) n.s -= shift;
    let truncated = false;
    if (out.length > 400) { out = out.slice(0, 400); truncated = true; }
    return { bpm: clamp(bpm || 120, 20, 300), beatsPerBar: bpb, notes: out, truncated };
  }

  let midiChip = null;
  function loadMidi(name, buf) {
    let parsed;
    try {
      parsed = parseMidi(buf);
    } catch (err) {
      console.error('[dojo] midi parse', err);
      statusNote = t('could not read that midi file');
      updateStatus();
      return;
    }
    const lesson = {
      id: 'midi-import', name: 'midi: ' + name, hint: name,
      bpm: parsed.bpm, beatsPerBar: parsed.beatsPerBar, notes: parsed.notes,
    };
    if (!midiChip) { // one import chip, replaced on every load
      midiChip = elem('button', 'chip');
      midiChip.addEventListener('click', () => {
        chipsRow.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        midiChip.classList.add('active');
        setLesson(midiChip._lesson);
        if (midiChip._note) { statusNote = midiChip._note; updateStatus(); }
      });
      chipsRow.append(midiChip);
    }
    midiChip._lesson = lesson;
    midiChip._note = parsed.truncated ? t('first 400 notes') : '';
    midiChip.textContent = lesson.name;
    midiChip.title = name;
    midiChip.click(); // select it
  }

  // ---- wiring ------------------------------------------------------------------------
  Engine.onStopAll(() => stopRun());

  setInterval(() => { if (dojoActive()) updateInputHint(); }, 900); // rig can be armed elsewhere

  const firstChip = chipsRow.querySelector('.chip');
  if (firstChip) firstChip.classList.add('active');
  refreshDerived();
  allocStates();
  resetStates();
  updateStatus();
  syncRaf();

  // debugging & automated verification
  window.__dojo = { S, LESSONS, startRun, stopRun, parseMidi, isRunning: () => running };
}
