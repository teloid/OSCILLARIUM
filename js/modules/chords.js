// chords.js — OSCILLARIUM harmony pads.
// Diatonic chord pads with a temperament A/B: equal temperament spreads its
// compromise across every key; just intonation locks each chord to small
// integer ratios so the beating stops (clearest with sine/triangle). Chord
// roots stay equal-tempered from the key, so pads agree with other modules —
// only the intervals above each chord's root get re-tuned.

import { Engine, midiToFreq, noteLabel, centsBetween, ratioName, NOTE_NAMES } from '../engine.js';
import * as UI from '../ui.js';
import { t, registerDict } from '../i18n.js';

// Russian dictionary for every user-readable string in this module.
// House rule: translate what the user READS, never what the code COMPARES —
// select option VALUES, preset param values ('close', 'sine', ...), remote
// keys, note names, Roman numerals and chord symbols stay English.
registerDict('ru', {
  'CHORDS': 'АККОРДЫ',
  'harmony pads — equal vs just, hear the wolf leave the room':
    'гармонические пэды — темперация против чистого строя: услышьте, как волк уходит',
  'power — resumes last chord': 'питание — возобновляет последний аккорд',
  // pad quality small-text
  'maj': 'маж', 'min': 'мин', 'dim': 'ум',
  'maj7': 'маж7', 'min7': 'мин7', 'dom7': 'дом7', 'm7♭5': 'м7б5',
  // pad tooltip: "ii of C major" -> "ii в C мажоре"
  'of': 'в', 'major': 'мажоре',
  // controls
  'key': 'тональность', 'octave': 'октава',
  'voicing': 'расположение', 'close': 'тесно', 'open': 'широко', 'wide': 'разброс',
  'just intonation': 'чистый строй', 'sevenths': 'септаккорды', 'latch': 'фиксация',
  // timbre group
  'timbre': 'тембр',
  'waveform': 'волна', 'sine': 'синус', 'triangle': 'треугольник',
  'sawtooth': 'пила', 'square': 'меандр',
  'cutoff': 'срез фильтра', 'attack': 'атака', 'release': 'затухание',
  'vib rate': 'скорость вибрато', 'vib depth': 'глубина вибрато',
  'strum': 'бой', 'level': 'уровень',
  // units
  'Hz': 'Гц', 's': 'с', 'ms': 'мс',
  // presets
  'presets': 'пресеты',
  'warm pad': 'тёплый пэд',
  'soft triangle bed — slow attack, long tail, mellow cutoff':
    'мягкая треугольная подложка — медленная атака, длинный хвост, приглушённый срез',
  'organ': 'орган',
  'snappy square with 5.5 Hz vibrato — drawbar energy, near-instant envelope':
    'бойкий меандр с вибрато 5.5 Гц — энергия регистров, почти мгновенная огибающая',
  'saw wash': 'пильная дымка',
  'slow sawtooth swell in open voicing — dark cinematic smear':
    'медленный наплыв пилы в широком расположении — тёмное киношное марево',
  'pure just': 'идеально чисто',
  'zero beating, the chord disappears into itself — sine + just intonation':
    'ноль биений, аккорд растворяется сам в себе — синус + чистый строй',
  // readout
  'vs equal': 'от равномерной',
});

const DEGREE_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
const TRIAD_QUAL = ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'];
const SEVENTH_QUAL = ['maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7', 'm7b5'];
const QUAL_IVS = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6],
  maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], m7b5: [0, 3, 6, 10],
};
const QUAL_SUFFIX = { maj: '', min: 'm', dim: '°', maj7: 'maj7', min7: 'm7', dom7: '7', m7b5: 'm7♭5' };
const QUAL_SMALL = { maj: t('maj'), min: t('min'), dim: t('dim'), maj7: t('maj7'), min7: t('min7'), dom7: t('dom7'), m7b5: t('m7♭5') };
// Just ratios from the chord's root, per semitone interval. 7/4 is the
// harmonic seventh — flatter and spicier than 12-TET's minor seventh.
const JUST_RATIO = {
  0: [1, 1], 2: [9, 8], 3: [6, 5], 4: [5, 4], 5: [4, 3], 6: [7, 5],
  7: [3, 2], 8: [8, 5], 9: [5, 3], 10: [7, 4], 11: [15, 8],
};

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

const MOD = {
  id: 'chords',
  title: t('CHORDS'),
  tagline: t('harmony pads — equal vs just, hear the wolf leave the room'),
  build,
};
export default MOD;

function build(body, head) {
    // ---- state -------------------------------------------------------------
    const P = {
      key: 'C', octave: 3, just: false, sevenths: false, voicing: 'close',
      latch: true, wave: 'triangle', cutoff: 3500, attack: 0.15, release: 0.8,
      vibRate: 0, vibDepth: 8, strum: 18, level: 0.5,
    };
    let bus = null;         // module volume bus (rule: single channel out)
    let filter = null;      // shared lowpass
    let vibOsc = null;      // shared vibrato LFO
    let vibGain = null;     // LFO depth in cents -> every osc.detune
    let live = null;        // latched voice set
    const held = new Map(); // degree -> momentary voice set (latch off)
    let lastDegree = 0;     // power-on resumes this chord in latch mode

    // ---- music math ----------------------------------------------------------
    // Returns { deg, notes, roman, symbol, qual }; notes sorted low->high,
    // each { f (sounding Hz), eq (equal-tempered Hz), n, d (ratio vs root) }.
    function chordInfo(deg) {
      const keyIdx = NOTE_NAMES.indexOf(P.key);
      const rootSemis = keyIdx + DEGREE_SEMIS[deg];
      const rootMidi = (P.octave + 1) * 12 + rootSemis;
      const rootF = midiToFreq(rootMidi); // root always equal-tempered
      const qual = (P.sevenths ? SEVENTH_QUAL : TRIAD_QUAL)[deg];
      const notes = QUAL_IVS[qual].map((s) => {
        const [n, d] = JUST_RATIO[s];
        const eq = rootF * Math.pow(2, s / 12);
        return { f: P.just ? (rootF * n) / d : eq, eq, n, d };
      });
      if (P.voicing === 'open') {
        const m = notes[1]; // middle note up an octave
        m.f *= 2; m.eq *= 2; m.n *= 2;
        const g = gcd(m.n, m.d); m.n /= g; m.d /= g;
      } else if (P.voicing === 'wide') {
        notes.unshift({ f: rootF / 2, eq: rootF / 2, n: 1, d: 2 });
      }
      notes.sort((a, b) => a.f - b.f);
      const roman = ROMAN[deg] + (P.sevenths ? (deg === 6 ? 'ø7' : '7') : (deg === 6 ? '°' : ''));
      const symbol = NOTE_NAMES[rootSemis % 12] + QUAL_SUFFIX[qual];
      return { deg, notes, roman, symbol, qual };
    }

    // ---- audio graph (all lazy) -----------------------------------------------
    function ensureGraph() {
      Engine.init();
      if (bus) return;
      const ctx = Engine.ctx;
      bus = Engine.createChannel(0); // ramps up on power-on
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = P.cutoff;
      filter.Q.value = 0.7;
      filter.connect(bus);
      vibOsc = ctx.createOscillator();
      vibOsc.frequency.value = Math.max(P.vibRate, 0.01);
      vibGain = ctx.createGain();
      vibGain.gain.value = P.vibRate > 0.01 ? P.vibDepth : 0;
      vibOsc.connect(vibGain);
      vibOsc.start();
    }

    function updateVibrato() {
      if (!vibOsc) return;
      const t = Engine.now();
      vibOsc.frequency.setTargetAtTime(Math.max(P.vibRate, 0.01), t, 0.05);
      vibGain.gain.setTargetAtTime(P.vibRate > 0.01 ? P.vibDepth : 0, t, 0.05);
    }

    // Each press = its own voice set; old sets release independently.
    function startChord(deg) {
      ensureGraph();
      const info = chordInfo(deg);
      const ctx = Engine.ctx;
      const t0 = ctx.currentTime + 0.01;
      const amp = 0.42 / Math.sqrt(info.notes.length);
      const atk = Math.max(P.attack, 0.005);
      const voices = info.notes.map((n, i) => {
        const osc = ctx.createOscillator();
        osc.type = P.wave;
        osc.frequency.value = n.f;
        vibGain.connect(osc.detune);
        const g = ctx.createGain();
        g.gain.value = 0;
        osc.connect(g);
        g.connect(filter);
        const ts = t0 + (i * P.strum) / 1000; // strum low -> high
        g.gain.setValueAtTime(0, ts);
        g.gain.linearRampToValueAtTime(amp, ts + atk);
        osc.start(ts);
        osc.onended = () => {
          try { vibGain.disconnect(osc.detune); } catch (e) { /* already gone */ }
          try { osc.disconnect(); g.disconnect(); } catch (e) { /* already gone */ }
        };
        return { osc, g, startT: ts };
      });
      lastDegree = deg;
      return { deg, voices, dead: false };
    }

    // `rel` (seconds) overrides P.release for this release — power-off uses a
    // fast kill envelope instead of the (possibly seconds-long) release slider.
    function releaseSet(vs, rel) {
      if (!vs || vs.dead) return;
      vs.dead = true;
      const t = Engine.now();
      const r = Math.max(rel != null ? rel : P.release, 0.05);
      for (const v of vs.voices) {
        // read before cancel: cancelling an in-flight ramp reverts .value on
        // Firefox/Safari, which would snap a mid-attack chord to 0 (click)
        const cur = v.g.gain.value;
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(cur, t);
        v.g.gain.setTargetAtTime(0, t, r / 4);
        // stop after the tail; never before the (possibly strummed) start
        try { v.osc.stop(Math.max(t + r + 0.3, v.startT + 0.05)); } catch (e) { /* not started */ }
      }
    }

    function releaseAll(rel) {
      releaseSet(live, rel); live = null;
      for (const vs of held.values()) releaseSet(vs, rel);
      held.clear();
      padEls.forEach((p) => p.classList.remove('active'));
    }

    function eachVoice(fn) {
      if (live && !live.dead) live.voices.forEach(fn);
      for (const vs of held.values()) if (!vs.dead) vs.voices.forEach(fn);
    }

    // Retune every sounding chord to the current key/temperament/voicing.
    // Same note count -> glide oscillators in place (the A/B moment: flip
    // temperament while a chord holds and hear the beating stop). Different
    // count (sevenths/voicing) -> crossfade to a fresh voice set.
    function retuneAll() {
      if (live && !live.dead) {
        const info = chordInfo(live.deg);
        if (info.notes.length !== live.voices.length) {
          const d = live.deg;
          releaseSet(live);
          live = startChord(d);
        } else {
          const t = Engine.now();
          live.voices.forEach((v, i) => v.osc.frequency.setTargetAtTime(info.notes[i].f, t, 0.03));
        }
      }
      for (const [deg, vs] of [...held]) {
        if (vs.dead) { held.delete(deg); continue; }
        const info = chordInfo(deg);
        if (info.notes.length !== vs.voices.length) {
          releaseSet(vs);
          held.set(deg, startChord(deg));
        } else {
          const t = Engine.now();
          vs.voices.forEach((v, i) => v.osc.frequency.setTargetAtTime(info.notes[i].f, t, 0.03));
        }
      }
      paintReadout();
    }

    // ---- power ------------------------------------------------------------------
    // All bus-gain moves go through here. Read-before-cancel: cancelling an
    // in-flight ramp reverts .value on Firefox/Safari, which would snap the
    // bus mid-fade (click). fade == null -> setTargetAtTime (the module's
    // usual feel); fade in seconds -> linear ramp of exactly that length.
    function rampBus(target, fade) {
      if (!bus) return;
      const t = Engine.now();
      const cur = bus.gain.value;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(cur, t);
      if (fade == null) bus.gain.setTargetAtTime(target, t, 0.03);
      else bus.gain.linearRampToValueAtTime(target, t + Math.max(fade, 0.005));
    }

    function powerUp(fade) {
      ensureGraph();
      rampBus(P.level, fade);
      if (P.latch && !(live && !live.dead)) {
        live = startChord(lastDegree);
        padEls[lastDegree].classList.add('active');
        paintReadout();
      }
    }

    // INSTANT OFF: the power button and stop-all must be audibly silent within
    // ~100 ms no matter what the release slider says — voices get a fast kill
    // envelope and the bus linear-ramps to 0 over `fade` seconds (80 ms by
    // default). Node teardown stays deferred via osc.stop/onended.
    function shutdown(fade = 0.08) {
      releaseAll(fade);
      rampBus(0, fade);
    }

    const powerCtl = UI.power({
      title: t('power — resumes last chord'),
      onChange(on) { on ? powerUp() : shutdown(); },
    });
    head.append(powerCtl.el);

    Engine.onStopAll(() => {
      shutdown();
      powerCtl.set(false);
    });

    // Pad presses are user gestures: wake the graph + power UI if needed.
    function ensureOn() {
      ensureGraph();
      if (!powerCtl.get()) powerCtl.set(true);
      rampBus(P.level); // also cuts any pending power-off fade
    }

    // ---- pads ---------------------------------------------------------------------
    const padsDiv = document.createElement('div');
    padsDiv.className = 'pads';
    const padEls = [];
    const padNames = [];
    const padQuals = [];
    for (let deg = 0; deg < 7; deg++) {
      const b = document.createElement('button');
      b.className = 'pad';
      b.type = 'button';
      b.style.touchAction = 'none';
      const nm = document.createElement('div');
      const q = document.createElement('small');
      b.append(nm, q);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); padDown(deg); });
      b.addEventListener('pointerup', () => padUp(deg));
      b.addEventListener('pointerleave', () => padUp(deg));
      b.addEventListener('pointercancel', () => padUp(deg));
      padEls.push(b); padNames.push(nm); padQuals.push(q);
      padsDiv.append(b);
    }

    function refreshPadLabels() {
      for (let deg = 0; deg < 7; deg++) {
        const info = chordInfo(deg);
        padNames[deg].textContent = `${info.roman} — ${info.symbol}`;
        padQuals[deg].textContent = QUAL_SMALL[info.qual];
        padEls[deg].title = `${info.roman} ${t('of')} ${P.key} ${t('major')}`;
      }
    }

    function padDown(deg) {
      ensureOn();
      if (P.latch) {
        if (live && !live.dead && live.deg === deg) {
          releaseSet(live); live = null;
          padEls[deg].classList.remove('active');
        } else {
          if (live) { padEls[live.deg].classList.remove('active'); releaseSet(live); }
          live = startChord(deg);
          padEls[deg].classList.add('active');
        }
      } else {
        const old = held.get(deg);
        if (old) releaseSet(old);
        held.set(deg, startChord(deg));
        padEls[deg].classList.add('active');
      }
      paintReadout();
    }

    function padUp(deg) {
      if (P.latch) return;
      const vs = held.get(deg);
      if (!vs) return;
      releaseSet(vs);
      held.delete(deg);
      padEls[deg].classList.remove('active');
    }

    // ---- readout ---------------------------------------------------------------------
    const readoutCtl = UI.readout('—', 'big');

    function paintReadout() {
      const info = chordInfo(live && !live.dead ? live.deg : lastDegree);
      const parts = info.notes.map((n) => {
        let s = `${noteLabel(n.eq)} ${UI.fmt(n.f)}`;
        if (P.just) {
          const c = Math.round(centsBetween(n.eq, n.f));
          if (c !== 0) s += ` ${c > 0 ? '+' : '−'}${Math.abs(c)}¢`;
        }
        return s;
      });
      let line = `${info.roman} — ${info.symbol} · ${parts.join('  ')}`;
      if (P.just) {
        let worst = null;
        for (const n of info.notes) {
          const c = Math.round(centsBetween(n.eq, n.f));
          if (c !== 0 && (!worst || Math.abs(c) > Math.abs(worst.c))) worst = { n, c };
        }
        if (worst) {
          const nm = ratioName(worst.n.n, worst.n.d);
          line += ` (${worst.n.n}:${worst.n.d}${nm ? ' ' + nm : ''} ${worst.c > 0 ? '+' : '−'}${Math.abs(worst.c)}¢ ${t('vs equal')})`;
        }
      }
      readoutCtl.set(line);
    }

    // ---- controls ---------------------------------------------------------------------
    const keyCtl = UI.select({
      label: t('key'), options: [...NOTE_NAMES], value: 'C',
      onChange(v) { P.key = v; refreshPadLabels(); retuneAll(); },
    });
    const octCtl = UI.select({
      label: t('octave'), options: ['2', '3', '4', '5'], value: '3',
      onChange(v) { P.octave = parseInt(v, 10); retuneAll(); },
    });
    // option VALUES stay English — chordInfo compares P.voicing === 'open'/'wide'
    // and presets/remote.apply send English values.
    const voicingCtl = UI.select({
      label: t('voicing'),
      options: ['close', 'open', 'wide'].map((v) => ({ value: v, label: t(v) })),
      value: 'close',
      onChange(v) { P.voicing = v; retuneAll(); },
    });
    const tempCtl = UI.toggle({
      label: t('just intonation'), value: false,
      onChange(v) { P.just = v; retuneAll(); },
    });
    const sevCtl = UI.toggle({
      label: t('sevenths'), value: false,
      onChange(v) { P.sevenths = v; refreshPadLabels(); retuneAll(); },
    });
    const latchCtl = UI.toggle({
      label: t('latch'), value: true,
      onChange(v) {
        P.latch = v;
        if (v) {
          // momentary chords would drone forever (padUp ignores latch mode)
          for (const [deg, vs] of held) {
            releaseSet(vs);
            padEls[deg].classList.remove('active');
          }
          held.clear();
        } else if (live) {
          padEls[live.deg].classList.remove('active');
          releaseSet(live);
          live = null;
        }
      },
    });

    // option VALUES stay English — P.wave feeds osc.type and preset params.
    const waveCtl = UI.select({
      label: t('waveform'),
      options: ['sine', 'triangle', 'sawtooth', 'square'].map((v) => ({ value: v, label: t(v) })),
      value: 'triangle',
      onChange(v) { P.wave = v; eachVoice((vo) => { vo.osc.type = v; }); },
    });
    const cutoffCtl = UI.slider({
      label: t('cutoff'), min: 200, max: 12000, value: 3500, unit: t('Hz'), log: true,
      onInput(v) { P.cutoff = v; if (filter) filter.frequency.setTargetAtTime(v, Engine.now(), 0.03); },
    });
    const atkCtl = UI.slider({
      label: t('attack'), min: 0.01, max: 3, value: 0.15, unit: t('s'), log: true,
      onInput(v) { P.attack = v; },
    });
    const relCtl = UI.slider({
      label: t('release'), min: 0.05, max: 6, value: 0.8, unit: t('s'), log: true,
      onInput(v) { P.release = v; },
    });
    const vibRateCtl = UI.slider({
      label: t('vib rate'), min: 0, max: 8, value: 0, unit: t('Hz'),
      onInput(v) { P.vibRate = v; updateVibrato(); },
    });
    const vibDepthCtl = UI.slider({
      label: t('vib depth'), min: 0, max: 25, value: 8, unit: '¢',
      onInput(v) { P.vibDepth = v; updateVibrato(); },
    });
    const strumCtl = UI.slider({
      label: t('strum'), min: 0, max: 120, value: 18, unit: t('ms'), format: (v) => v.toFixed(0),
      onInput(v) { P.strum = v; },
    });
    const levelCtl = UI.slider({
      label: t('level'), min: 0, max: 1, value: 0.5, format: (v) => Math.round(v * 100) + '%',
      onInput(v) { P.level = v; if (powerCtl.get()) rampBus(v); },
    });

    // ---- presets / remote params -------------------------------------------------
    const CTL_FOR = {
      key: keyCtl, octave: octCtl, just: tempCtl, sevenths: sevCtl,
      voicing: voicingCtl, wave: waveCtl, cutoff: cutoffCtl, attack: atkCtl,
      release: relCtl, vibRate: vibRateCtl, vibDepth: vibDepthCtl,
      strum: strumCtl, level: levelCtl,
    };

    // Every chip starts from the build-time defaults so presets are
    // self-contained sounds instead of inheriting sticky params from each other.
    const PRESET_BASELINE = {
      wave: 'triangle', cutoff: 3500, attack: 0.15, release: 0.8,
      vibRate: 0, vibDepth: 8, voicing: 'close', just: false,
    };

    const PRESETS = [
      {
        name: t('warm pad'),
        hint: t('soft triangle bed — slow attack, long tail, mellow cutoff'),
        p: { wave: 'triangle', cutoff: 2200, attack: 0.6, release: 2, vibRate: 0 },
      },
      {
        name: t('organ'),
        hint: t('snappy square with 5.5 Hz vibrato — drawbar energy, near-instant envelope'),
        p: { wave: 'square', cutoff: 5000, attack: 0.02, release: 0.15, vibRate: 5.5, vibDepth: 6 },
      },
      {
        name: t('saw wash'),
        hint: t('slow sawtooth swell in open voicing — dark cinematic smear'),
        p: { wave: 'sawtooth', cutoff: 1400, attack: 1.2, release: 3, vibRate: 0, voicing: 'open' },
      },
      {
        name: t('pure just'),
        hint: t('zero beating, the chord disappears into itself — sine + just intonation'),
        p: { wave: 'sine', cutoff: 8000, vibRate: 0, just: true },
      },
    ];

    // Shared by the preset chips and remote.apply(): PARTIAL param object in ->
    // state + control UI + (if playing) live audio with click-free ramps.
    // Unknown keys are ignored; never touches power. Safe while powered off
    // (graph pieces are all null-guarded; state + UI still update).
    function applyParams(p) {
      for (const [k, v] of Object.entries(p || {})) {
        if (!(k in CTL_FOR)) continue;
        P[k] = k === 'octave' ? parseInt(v, 10) : v;
        CTL_FOR[k].set(P[k]);
      }
      if (filter) filter.frequency.setTargetAtTime(P.cutoff, Engine.now(), 0.03);
      updateVibrato();
      eachVoice((vo) => { vo.osc.type = P.wave; });
      if (powerCtl.get()) rampBus(P.level);
      refreshPadLabels();
      retuneAll(); // applies key/voicing/temperament with ramps + repaints readout
    }

    const chipsCtl = UI.chips({
      label: t('presets'),
      items: PRESETS,
      onPick: (item) => applyParams({ ...PRESET_BASELINE, ...item.p }),
    });

    // ---- layout ---------------------------------------------------------------------
    body.append(
      UI.grid(keyCtl, octCtl, voicingCtl),
      UI.row(tempCtl, sevCtl, latchCtl),
      padsDiv,
      readoutCtl.el,
      UI.group(
        t('timbre'),
        UI.grid(waveCtl, cutoffCtl, atkCtl, relCtl),
        UI.grid(vibRateCtl, vibDepthCtl, strumCtl, levelCtl),
      ),
      chipsCtl.el,
    );

    refreshPadLabels();
    paintReadout();

    // ---- remote API (VIBE macro layer) -------------------------------------------
    // Programmatic control mirroring the manual controls: same code paths,
    // same UI updates, same click-free ramps.
    MOD.remote = {
      isOn: () => powerCtl.get(),

      // fade = seconds for THIS transition's output-gain envelope.
      // Defaults: on -> the usual power-on ramp; off -> 0.08 s (instant off).
      power(on, fade) {
        Engine.init();
        on = !!on;
        if (on === powerCtl.get()) return; // idempotent
        powerCtl.set(on);
        if (on) powerUp(fade); // rampBus cuts any pending fade-out cleanly
        else shutdown(fade == null ? 0.08 : fade);
      },

      apply(params) { applyParams(params); },

      // noteIdx 0=C .. 11=B; live chords retune via retuneAll inside applyParams.
      setKey(noteIdx) {
        const nm = NOTE_NAMES[((Math.round(noteIdx) % 12) + 12) % 12];
        if (nm) applyParams({ key: nm });
      },

      // Latch-style chord select regardless of the latch toggle: crossfade
      // from the current live chord to degree 0-6. No-op while powered off.
      play(degree) {
        if (!powerCtl.get()) return;
        const deg = Math.round(degree);
        if (!(deg >= 0 && deg <= 6)) return;
        if (live) { padEls[live.deg].classList.remove('active'); releaseSet(live); }
        live = startChord(deg);
        padEls[deg].classList.add('active');
        paintReadout();
      },

      releaseChord() {
        if (!live) return;
        padEls[live.deg].classList.remove('active');
        releaseSet(live);
        live = null;
      },
    };
}
