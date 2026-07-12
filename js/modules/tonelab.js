// tonelab.js — OSCILLARIUM module: TONE LAB.
// Two independent generators, one per ear. Each strip is osc → gain → panner,
// both panners feed one module bus (Engine.createChannel). A ratio lock can
// slave the right generator to the left at just / irrational ratios.

import { Engine, noteLabel, centsBetween, ratioName, clamp, midiToFreq } from '../engine.js';
import * as UI from '../ui.js';
import { t, registerDict } from '../i18n.js';

// Russian dictionary — display strings only. Select option VALUES, ratio keys,
// waveform names the code compares, and the remote.apply() contract stay English.
registerDict('ru', {
  // header
  'TONE LAB': 'ТОН-ЛАБ',
  'two independent generators, one per ear — test gear, test brain':
    'два независимых генератора, по одному на ухо — тест железа и мозга',
  'tone lab power': 'питание тон-лаба',
  // group titles
  'left ear': 'левое ухо',
  'right ear': 'правое ухо',
  'coupling': 'сцепка',
  // control labels
  'freq': 'частота',
  'exact': 'точно',
  'wave': 'форма',
  'fine': 'подстройка',
  'level': 'уровень',
  'pan': 'панорама',
  'mute': 'мьют',
  'glide': 'глайд',
  'volume': 'громкость',
  'ratio lock': 'замок отношения',
  'ratio': 'отношение',
  'n': 'числ',
  'd': 'знам',
  'presets': 'пресеты',
  // units
  'Hz': 'Гц',
  's': 'с',
  // waveform option labels (values stay English)
  'sine': 'синус',
  'triangle': 'треугольник',
  'square': 'меандр',
  'sawtooth': 'пила',
  // ratio select option label (value stays 'custom')
  'custom': 'своё',
  // combined-readout words
  'beat Δ': 'биения Δ',
  'dead unison': 'мёртвый унисон',
  'glacial swell': 'ледниковая зыбь',
  'slow throb': 'медленная пульсация',
  'fast flutter': 'быстрый трепет',
  'rough buzz': 'грубое жужжание',
  'never resolves': 'никогда не разрешается',
  // interval names surfaced by ratioName() in the big readout
  'unison': 'унисон',
  'octave': 'октава',
  'perfect fifth': 'чистая квинта',
  'perfect fourth': 'чистая кварта',
  'just major third': 'натуральная большая терция',
  'just minor third': 'натуральная малая терция',
  'just major sixth': 'натуральная большая секста',
  'just minor sixth': 'натуральная малая секста',
  'major whole tone': 'большой целый тон',
  'minor whole tone': 'малый целый тон',
  'just semitone': 'натуральный полутон',
  'just major seventh': 'натуральная большая септима',
  'just minor seventh': 'натуральная малая септима',
  'septimal minor third': 'септимальная малая терция',
  'septimal tritone': 'септимальный тритон',
  'harmonic seventh': 'гармоническая септима',
  'septimal whole tone': 'септимальный целый тон',
  'septimal major third': 'септимальная большая терция',
  'undecimal tritone': 'ундецимальный тритон',
  'octave + fifth': 'октава + квинта',
  'double octave': 'двойная октава',
  'octave + major third': 'октава + большая терция',
  // preset chips + hints
  'A440 unison': 'унисон A440',
  'both ears at concert A — the calibration zero': 'оба уха на концертном ля — ноль калибровки',
  'slow beat': 'медленные биения',
  '3 Hz binaural-ish throb, also great for tuning practice':
    'почти бинауральная пульсация 3 Гц — заодно тренировка настройки',
  'just 3:2 locked above 220 Hz — 702¢ of pure consonance':
    'натуральное 3:2 над 220 Гц — 702¢ чистого консонанса',
  'septimal 7:6': 'септимальная 7:6',
  'the blue third — not on your piano': 'блюзовая терция — на пианино такой нет',
  'golden φ': 'золотое φ',
  'maximally irrational — never resolves': 'максимально иррационально — никогда не разрешается',
  'octave sub': 'октавный саб',
  'subwoofer & headphone driver test': 'тест сабвуфера и драйверов наушников',
  'edge of hearing': 'край слышимости',
  'gear test — what can you actually hear?': 'тест железа — что ты реально слышишь?',
});

const PHI = 1.6180339887;
const F_MIN = 20, F_MAX = 20000;
const RATIO_KEYS = ['1:1', '2:1', '3:2', '4:3', '5:4', '6:5', '7:6', '7:4', '9:8', '16:15', 'φ:1', 'custom'];
const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];

// name/hint are display-only; applyPreset reads fL/fR/lock, so t() is safe here.
const PRESETS = [
  { name: t('A440 unison'), hint: t('both ears at concert A — the calibration zero'), fL: 440, fR: 440 },
  { name: t('slow beat'), hint: t('3 Hz binaural-ish throb, also great for tuning practice'), fL: 440, fR: 443 },
  { name: t('perfect fifth'), hint: t('just 3:2 locked above 220 Hz — 702¢ of pure consonance'), fL: 220, lock: '3:2' },
  { name: t('septimal 7:6'), hint: t('the blue third — not on your piano'), fL: 220, lock: '7:6' },
  { name: t('golden φ'), hint: t('maximally irrational — never resolves'), fL: 220, lock: 'φ:1' },
  { name: t('octave sub'), hint: t('subwoofer & headphone driver test'), fL: 55, fR: 110 },
  { name: t('edge of hearing'), hint: t('gear test — what can you actually hear?'), fL: 30, fR: 15000 },
];

const MOD = {
  id: 'tonelab',
  title: t('TONE LAB'),
  tagline: t('two independent generators, one per ear — test gear, test brain'),
  build,
};
export default MOD;

// build() assigns MOD.remote once the controls exist (VIBE macro layer).
function build(body, head) {
    // ---- state (audio nodes are created lazily on power-on) ------------------
    const st = {
      L: { freq: 440, wave: 'sine', det: 0, level: 0.5, mute: false, pan: -1 },
      R: { freq: 440, wave: 'sine', det: 0, level: 0.5, mute: false, pan: 1 },
      glide: 0,
      volume: 0.7,
      lock: false,
      ratioKey: '3:2',
      n: 3, d: 2,
    };

    let bus = null;               // module bus (Engine.createChannel)
    let running = false;
    const nodes = { L: null, R: null };
    const ui = {};                // filled with strip controls below

    // ---- audio ---------------------------------------------------------------

    // fadeIn: optional seconds for the fade-in envelope (remote power(true, fade));
    // omitted -> the usual quick anti-click ramp.
    function startStrip(k, fadeIn) {
      const ctx = Engine.ctx;
      const s = st[k];
      const osc = ctx.createOscillator();
      osc.type = s.wave;
      osc.frequency.value = s.freq;
      osc.detune.value = s.det;
      const g = ctx.createGain();
      g.gain.value = 0;           // fade in — no click
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (pan.pan) pan.pan.value = s.pan;
      osc.connect(g);
      g.connect(pan);
      pan.connect(bus);
      osc.start();
      const target = s.mute ? 0 : s.level;
      if (typeof fadeIn === 'number' && isFinite(fadeIn)) {
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(target, ctx.currentTime + Math.max(0.01, fadeIn));
      } else {
        g.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
      }
      nodes[k] = { osc, g, pan };
    }

    function start(fadeIn) {
      Engine.init();
      if (running) return;        // double-start guard
      running = true;
      cutFades();                 // a restart mid-fade must not leave an audible tail
      if (!bus) bus = Engine.createChannel(st.volume);
      startStrip('L', fadeIn);
      startStrip('R', fadeIn);
    }

    // Strips still ramping to silence after stop(). A quick restart hard-cuts
    // them so the old graph is never heard under the new one; each strip still
    // tears itself down (osc.stop → onended → disconnect) — no leaks.
    const fading = new Set();

    function cutFades() {
      const t = Engine.now();
      for (const nd of fading) {
        const cur = nd.g.gain.value;                // read BEFORE cancel
        nd.g.gain.cancelScheduledValues(t);
        nd.g.gain.setValueAtTime(cur, t);
        nd.g.gain.linearRampToValueAtTime(0, t + 0.02);
      }
    }

    // fade: seconds for the output-gain ramp. Default 0.08 keeps the power
    // button and Engine stop-all audibly silent within ~100 ms; node teardown
    // stays deferred until just past the ramp.
    function stop(fade = 0.08) {
      if (!running) { if (fade < 0.1) cutFades(); return; } // instant off must silence pending fade tails
      running = false;
      fade = Math.max(0.01, +fade || 0);
      const t = Engine.now();
      for (const k of ['L', 'R']) {
        const nd = nodes[k];
        if (!nd) continue;
        nodes[k] = null;
        const cur = nd.g.gain.value;                // read BEFORE cancel
        nd.g.gain.cancelScheduledValues(t);
        nd.g.gain.setValueAtTime(cur, t);
        nd.g.gain.linearRampToValueAtTime(0, t + fade);
        fading.add(nd);
        nd.osc.onended = () => {
          fading.delete(nd);
          try { nd.osc.disconnect(); nd.g.disconnect(); nd.pan.disconnect(); } catch (_) { /* already gone */ }
        };
        nd.osc.stop(t + fade + 0.05);
      }
    }

    function rampFreq(k) {
      const nd = nodes[k];
      if (!nd) return;
      const t = Engine.now();
      const p = nd.osc.frequency;
      const cur = p.value;        // read BEFORE cancel — cancel can revert an in-flight ramp
      p.cancelScheduledValues(t);
      p.setValueAtTime(Math.max(0.01, cur), t);
      if (st.glide <= 0.001) p.setTargetAtTime(st[k].freq, t, 0.02);
      else p.linearRampToValueAtTime(st[k].freq, t + st.glide);
    }
    function rampDetune(k) {
      const nd = nodes[k];
      if (nd) nd.osc.detune.setTargetAtTime(st[k].det, Engine.now(), 0.02);
    }
    function rampLevel(k) {
      const nd = nodes[k];
      if (nd) nd.g.gain.setTargetAtTime(st[k].mute ? 0 : st[k].level, Engine.now(), 0.03);
    }
    function rampPan(k) {
      const nd = nodes[k];
      if (nd && nd.pan.pan) nd.pan.pan.setTargetAtTime(st[k].pan, Engine.now(), 0.03);
    }
    function setWave(k) {
      const nd = nodes[k];
      if (nd) nd.osc.type = st[k].wave;
    }

    // ---- ratio lock ------------------------------------------------------------

    function curRatio() {
      if (st.ratioKey === 'φ:1') return { r: PHI, irrational: true };
      if (st.ratioKey === 'custom') return { r: st.n / st.d, n: st.n, d: st.d };
      const [a, b] = st.ratioKey.split(':').map(Number);
      return { r: a / b, n: a, d: b };
    }

    // slave R to L at the current ratio (audio + UI, no callbacks fired)
    function followLock() {
      const f = clamp(st.L.freq * curRatio().r, F_MIN, F_MAX);
      st.R.freq = f;
      ui.R.freqSl.set(f);
      ui.R.freqNb.set(+f.toFixed(2));
      rampFreq('R');
    }

    // src: 'slider' | 'box' | undefined (programmatic — presets, lock)
    function setFreq(k, v, src) {
      st[k].freq = clamp(+v, F_MIN, F_MAX);
      if (src !== 'slider') ui[k].freqSl.set(st[k].freq);
      if (src !== 'box') ui[k].freqNb.set(+st[k].freq.toFixed(2));
      rampFreq(k);
      if (k === 'L' && st.lock) followLock();
      if (k === 'R' && src && st.lock) { st.lock = false; lockTg.set(false); } // touching R breaks the leash
      paintReadouts();
    }

    // ---- readouts ----------------------------------------------------------------

    function paintReadouts() {
      const effL = st.L.freq * Math.pow(2, st.L.det / 1200);
      const effR = st.R.freq * Math.pow(2, st.R.det / 1200);
      ui.L.read.set(`${effL.toFixed(2)} ${t('Hz')} · ${noteLabel(effL)}`);
      ui.R.read.set(`${effR.toFixed(2)} ${t('Hz')} · ${noteLabel(effR)}`);
      const d = Math.abs(effL - effR);
      if (d < 30) {
        const word = d < 0.01 ? t('dead unison')
          : d < 1 ? t('glacial swell')
          : d < 6 ? t('slow throb')
          : d < 14 ? t('fast flutter')
          : t('rough buzz');
        bigRead.set(`${t('beat Δ')} ${d.toFixed(2)} ${t('Hz')} — ${word}`);
      } else {
        const centsEff = Math.abs(centsBetween(effL, effR));
        const cents = Math.round(centsEff);
        let tail = '';
        if (st.lock) {
          // only claim the ratio when the audible interval actually matches it
          // (followLock clamping and the ±100¢ fine sliders can pull it away)
          const rt = curRatio();
          const lockCents = Math.abs(1200 * Math.log2(rt.r));
          if (Math.abs(centsEff - lockCents) < 3) {
            if (rt.irrational) tail = ` · φ:1 — ${t('never resolves')}`;
            else {
              const nm = ratioName(rt.n, rt.d);
              tail = nm ? ` · ${t(nm)} (${rt.n}:${rt.d})` : ` · (${rt.n}:${rt.d})`;
            }
          }
        }
        bigRead.set(`${cents}¢${tail}`);
      }
    }

    // ---- strips ---------------------------------------------------------------

    function stripUI(k, title) {
      const s = st[k];
      const read = UI.readout('—');
      read.el.style.flex = '1';

      const freqSl = UI.slider({
        label: t('freq'), min: F_MIN, max: F_MAX, value: s.freq, unit: t('Hz'), log: true,
        onInput: (v) => setFreq(k, v, 'slider'),
      });
      const freqNb = UI.numberBox({
        label: t('exact'), unit: t('Hz'), min: F_MIN, max: F_MAX, step: 0.01, value: s.freq,
        onChange: (v) => setFreq(k, v, 'box'),
      });
      const wave = UI.select({
        // values stay English — s.wave feeds osc.type and remote.apply's WAVES check
        label: t('wave'), options: WAVES.map((w) => ({ value: w, label: t(w) })), value: s.wave,
        onChange: (v) => { s.wave = v; setWave(k); },
      });
      wave.el.style.flex = '1';
      const fine = UI.slider({
        label: t('fine'), min: -100, max: 100, step: 1, value: s.det, unit: '¢',
        format: (v) => (v > 0 ? '+' : '') + v.toFixed(0),
        onInput: (v) => { s.det = v; rampDetune(k); paintReadouts(); },
      });
      const level = UI.slider({
        label: t('level'), min: 0, max: 1, step: 0.01, value: s.level,
        format: (v) => Math.round(v * 100) + '%',
        onInput: (v) => { s.level = v; rampLevel(k); },
      });
      const pan = UI.slider({
        label: t('pan'), min: -1, max: 1, step: 0.01, value: s.pan,
        format: (v) => Math.abs(v) < 0.005 ? 'C' : (v < 0 ? 'L ' + (-v).toFixed(2) : 'R ' + v.toFixed(2)),
        onInput: (v) => { s.pan = v; rampPan(k); },
      });
      const mute = UI.toggle({
        label: t('mute'), value: s.mute,
        onChange: (v) => { s.mute = v; rampLevel(k); },
      });

      const grp = UI.group(title, freqSl, UI.row(freqNb, wave), fine, level, pan, UI.row(mute, read));
      return { grp, read, freqSl, freqNb, wave, fine, level, pan, mute };
    }

    ui.L = stripUI('L', t('left ear'));
    ui.R = stripUI('R', t('right ear'));

    // ---- global controls -----------------------------------------------------

    const glideSl = UI.slider({
      label: t('glide'), min: 0, max: 2, step: 0.01, value: st.glide, unit: t('s'),
      format: (v) => v.toFixed(2),
      onInput: (v) => { st.glide = v; },
    });
    const volSl = UI.slider({
      label: t('volume'), min: 0, max: 1, step: 0.01, value: st.volume,
      format: (v) => Math.round(v * 100) + '%',
      onInput: (v) => {
        st.volume = v;
        if (bus) bus.gain.setTargetAtTime(v, Engine.now(), 0.03);
      },
    });
    const lockTg = UI.toggle({
      label: t('ratio lock'), value: st.lock,
      onChange: (v) => {
        st.lock = v;
        if (v) followLock();
        paintReadouts();
      },
    });
    const ratioSel = UI.select({
      // option values stay the English RATIO_KEYS — curRatio(), preset lock keys
      // and ratioSel.set('custom') all compare against them; only the 'custom'
      // entry has a word to translate.
      label: t('ratio'),
      options: RATIO_KEYS.map((k) => ({ value: k, label: k === 'custom' ? t('custom') : k })),
      value: st.ratioKey,
      onChange: (v) => {
        st.ratioKey = v;
        if (st.lock) followLock();
        paintReadouts();
      },
    });
    ratioSel.el.style.minWidth = '96px';
    const onND = (which) => (v) => {
      st[which] = clamp(Math.round(v), 1, 32);
      (which === 'n' ? nBox : dBox).set(st[which]);
      if (st.ratioKey !== 'custom') { st.ratioKey = 'custom'; ratioSel.set('custom'); }
      if (st.lock) followLock();
      paintReadouts();
    };
    const nBox = UI.numberBox({ label: t('n'), min: 1, max: 32, step: 1, value: st.n, onChange: onND('n') });
    const dBox = UI.numberBox({ label: t('d'), min: 1, max: 32, step: 1, value: st.d, onChange: onND('d') });
    nBox.el.style.width = '84px';
    dBox.el.style.width = '84px';

    const bigRead = UI.readout('—', 'big');
    bigRead.el.style.marginTop = '10px';

    // ---- presets ---------------------------------------------------------------

    function applyPreset(p) {
      st.L.det = 0; st.R.det = 0;
      ui.L.fine.set(0); ui.R.fine.set(0);
      rampDetune('L'); rampDetune('R');
      if (p.lock) {
        st.ratioKey = p.lock;
        ratioSel.set(p.lock);
        st.lock = true;
        lockTg.set(true);
        setFreq('L', p.fL);       // followLock drags R along
      } else {
        st.lock = false;
        lockTg.set(false);
        setFreq('L', p.fL);
        setFreq('R', p.fR);
      }
    }

    // ---- assemble --------------------------------------------------------------

    body.append(
      UI.grid(ui.L.grp, ui.R.grp),
      UI.group(t('coupling'),
        UI.grid(glideSl, volSl),
        UI.row(lockTg, ratioSel, nBox, dBox),
        bigRead,
      ),
      UI.chips({ label: t('presets'), items: PRESETS, onPick: applyPreset }).el,
    );

    const powerCtl = UI.power({
      title: t('tone lab power'),
      onChange: (on) => { if (on) start(); else stop(); },
    });
    head.append(powerCtl.el);

    Engine.onStopAll(() => { stop(); powerCtl.set(false); });

    // ---- remote (VIBE macro layer) ---------------------------------------------

    // Same code path as the lock toggle's onChange, plus its UI.
    function setLock(v) {
      st.lock = !!v;
      lockTg.set(st.lock);
      if (st.lock) followLock();
      paintReadouts();
    }

    // r: 'phi' | {n, d} — engages the matching ratio select / custom boxes.
    function setRatio(r) {
      if (r === 'phi') {
        st.ratioKey = 'φ:1';
      } else if (r && typeof r === 'object' && isFinite(+r.n) && isFinite(+r.d)) {
        const n = clamp(Math.round(+r.n), 1, 32);
        const d = clamp(Math.round(+r.d), 1, 32);
        const key = `${n}:${d}`;
        if (RATIO_KEYS.includes(key)) {
          st.ratioKey = key;
        } else {
          st.n = n; st.d = d;
          nBox.set(n); dBox.set(d);
          st.ratioKey = 'custom';
        }
      } else {
        return;                   // unrecognized ratio spec — ignore
      }
      ratioSel.set(st.ratioKey);
      if (st.lock) followLock();
      paintReadouts();
    }

    MOD.remote = {
      isOn: () => running,

      // fade = seconds for THIS transition's output-gain envelope.
      power(on, fade) {
        on = !!on;
        if (on === running) return;               // idempotent
        if (on) start(typeof fade === 'number' ? fade : undefined);
        else stop(typeof fade === 'number' ? fade : 0.08);
        powerCtl.set(on);
      },

      apply(p) {
        if (!p || typeof p !== 'object') return;
        if (p.glide !== undefined && isFinite(+p.glide)) {
          st.glide = clamp(+p.glide, 0, 2);
          glideSl.set(st.glide);
        }
        if (p.ratio !== undefined) setRatio(p.ratio);
        if (p.lock !== undefined) setLock(p.lock);
        for (const k of ['L', 'R']) {
          const w = p['wave' + k];
          if (WAVES.includes(w)) { st[k].wave = w; ui[k].wave.set(w); setWave(k); }
          const lv = p['level' + k];
          if (lv !== undefined && isFinite(+lv)) {
            st[k].level = clamp(+lv, 0, 1);
            ui[k].level.set(st[k].level);
            rampLevel(k);
          }
          const mu = p['mute' + k];
          if (mu !== undefined) { st[k].mute = !!mu; ui[k].mute.set(st[k].mute); rampLevel(k); }
        }
        // Freqs last so lock/ratio above shape the result; setFreq handles UI,
        // ramps, readouts, and (for L under lock) dragging R along.
        if (p.freqL !== undefined && isFinite(+p.freqL)) setFreq('L', +p.freqL);
        if (p.freqR !== undefined && isFinite(+p.freqR)) setFreq('R', +p.freqR);
      },

      // noteIdx 0=C … 11=B → L = pitch class in octave 3; R follows the lock,
      // or keeps its interval by scaling with the same multiplier.
      setKey(noteIdx) {
        if (!isFinite(+noteIdx)) return;
        const idx = ((Math.round(+noteIdx) % 12) + 12) % 12;
        const newL = midiToFreq(48 + idx);
        if (st.lock) {
          setFreq('L', newL);                     // followLock drags R along
        } else {
          const newR = clamp(st.R.freq * (newL / st.L.freq), F_MIN, F_MAX);
          setFreq('L', newL);
          setFreq('R', newR);
        }
      },
    };

    paintReadouts();
}
