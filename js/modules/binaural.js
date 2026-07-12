// binaural.js — OSCILLARIUM entrainment beat generator.
// Three ways to make a beat: binaural (phantom, assembled in the brainstem),
// monaural (physically in the signal), isochronic (amplitude-gated pulse).
// All audio is lazy; everything routes through one Engine channel.

import { Engine, noteLabel, midiToFreq, clamp } from '../engine.js';
import * as UI from '../ui.js';
import { t, registerDict } from '../i18n.js';

registerDict('ru', {
  'BINAURAL': 'БИНАУРАЛ',
  'two ears, one phantom beat — headphones on': 'два уха, один фантомный ритм — наденьте наушники',
  // preset chips
  'deep delta': 'глубокая дельта',
  'theta drift': 'тета-дрейф',
  'schumann': 'шуман',
  'alpha calm': 'альфа-покой',
  'beta focus': 'бета-фокус',
  'gamma 40': 'гамма 40',
  'δ 2.5 Hz — slow-wave territory, heavy eyelids, dreamless drift': 'δ 2.5 Гц — территория медленных волн, тяжёлые веки, дрейф без сновидений',
  'θ 5.5 Hz — hypnagogic wandering, the half-dream corridor': 'θ 5.5 Гц — гипнагогические блуждания, коридор полусна',
  "θ 7.83 Hz — earth's resonance, allegedly": 'θ 7.83 Гц — резонанс земли, якобы',
  'α 10 Hz — eyes-closed idle, unclenched mind': 'α 10 Гц — покой с закрытыми глазами, расслабленный ум',
  'β 16.4 Hz — alert and caffeinated, minus the coffee': 'β 16.4 Гц — бодрый и кофеиновый, но без кофе',
  'γ 40 Hz — the neuroscience-paper favorite': 'γ 40 Гц — любимец нейронаучных статей',
  // brainwave bands (readout)
  'δ delta': 'δ дельта',
  'θ theta': 'θ тета',
  'α alpha': 'α альфа',
  'β beta': 'β бета',
  'γ gamma': 'γ гамма',
  // controls
  'mode': 'режим',
  'binaural': 'бинауральный',
  'monaural': 'монауральный',
  'isochronic': 'изохронный',
  'waveform': 'форма волны',
  'sine': 'синус',
  'triangle': 'треугольник',
  'carrier': 'несущая',
  'beat': 'биения',
  'level': 'уровень',
  'noise bed': 'шумовая подложка',
  'off': 'выкл',
  'pink': 'розовый',
  'brown': 'бурый',
  'bed level': 'уровень подложки',
  'entrainment presets': 'пресеты навязывания ритма',
  'binaural power': 'питание бинаурала',
  // readout words & units
  'Hz': 'Гц',
  'mix': 'сумма',
  'tone': 'тон',
  'pulse': 'пульс',
  'binaural mode needs headphones — the beat is constructed by your brainstem, not your speakers.':
    'бинауральный режим требует наушников — биения складываются у вас в стволе мозга, а не в колонках.',
});

const GATE_FLOOR = 0.02; // isochronic gate never fully closes — no dead air, no clicks
const GATE_KNEE = 3.2;   // tanh steepness for the soft gate step

const PRESETS = [
  { name: t('deep delta'), carrier: 110, beat: 2.5, hint: t('δ 2.5 Hz — slow-wave territory, heavy eyelids, dreamless drift') },
  { name: t('theta drift'), carrier: 180, beat: 5.5, hint: t('θ 5.5 Hz — hypnagogic wandering, the half-dream corridor') },
  { name: t('schumann'), carrier: 210, beat: 7.83, hint: t("θ 7.83 Hz — earth's resonance, allegedly") },
  { name: t('alpha calm'), carrier: 240, beat: 10, hint: t('α 10 Hz — eyes-closed idle, unclenched mind') },
  { name: t('beta focus'), carrier: 300, beat: 16.4, hint: t('β 16.4 Hz — alert and caffeinated, minus the coffee') },
  { name: t('gamma 40'), carrier: 340, beat: 40, hint: t('γ 40 Hz — the neuroscience-paper favorite') },
];

function bandOf(beat) {
  if (beat < 4) return t('δ delta');
  if (beat < 8) return t('θ theta');
  if (beat < 13) return t('α alpha');
  if (beat < 30) return t('β beta');
  return t('γ gamma');
}

const MOD = {
  id: 'binaural',
  title: t('BINAURAL'),
  tagline: t('two ears, one phantom beat — headphones on'),
  build,
};
export default MOD;

function build(body, head) {
    const state = {
      mode: 'binaural',   // binaural | monaural | isochronic
      carrier: 200,
      beat: 7.83,
      wave: 'sine',
      level: 0.5,
      noise: 'off',       // off | pink | brown
      noiseLevel: 0.15,
    };

    let bus = null;        // module channel (Engine.createChannel), made once
    let noiseGain = null;  // bed level control, hangs off the bus
    let voice = null;      // active tone graph { mode, out, sources, nodes, ... }
    let noise = null;      // active bed { src, fade }
    let playing = false;
    let raf = 0;
    let gateCurve = null;
    const noiseBuffers = {};

    // ---- helpers ------------------------------------------------------------

    function earFreqs() {
      return [state.carrier - state.beat / 2, state.carrier + state.beat / 2];
    }

    function ensureBus() {
      if (bus) return;
      bus = Engine.createChannel(state.level);
      noiseGain = Engine.ctx.createGain();
      noiseGain.gain.value = state.noiseLevel;
      noiseGain.connect(bus);
    }

    function getGateCurve() {
      if (gateCurve) return gateCurve;
      const N = 2048;
      gateCurve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        gateCurve[i] = GATE_FLOOR + (1 - GATE_FLOOR) * (0.5 + 0.5 * Math.tanh(GATE_KNEE * x));
      }
      return gateCurve;
    }

    // ---- tone voices ----------------------------------------------------------

    function buildVoice(mode) {
      const ctx = Engine.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(bus);
      const [fL, fR] = earFreqs();
      const v = { mode, out, sources: [], nodes: [out], oscL: null, oscR: null, osc: null, lfo: null };

      if (mode === 'binaural') {
        // hard-panned pure tones: the beat exists only between the listener's ears
        for (const [f, pan] of [[fL, -1], [fR, 1]]) {
          const osc = ctx.createOscillator();
          osc.type = state.wave;
          osc.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = 0.4;
          const p = ctx.createStereoPanner();
          p.pan.value = pan;
          osc.connect(g).connect(p).connect(out);
          v.sources.push(osc);
          v.nodes.push(g, p);
        }
        [v.oscL, v.oscR] = v.sources;
      } else if (mode === 'monaural') {
        // both tones summed to both ears — the beat is physically in the signal
        const p = ctx.createStereoPanner();
        p.pan.value = 0;
        p.connect(out);
        v.nodes.push(p);
        for (const f of [fL, fR]) {
          const osc = ctx.createOscillator();
          osc.type = state.wave;
          osc.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = 0.28;
          osc.connect(g).connect(p);
          v.sources.push(osc);
          v.nodes.push(g);
        }
        [v.oscL, v.oscR] = v.sources;
      } else {
        // isochronic: one tone, amplitude-gated at the beat rate.
        // sine LFO -> soft tanh step waveshaper -> gate gain (base 0, floor 0.02)
        const osc = ctx.createOscillator();
        osc.type = state.wave;
        osc.frequency.value = state.carrier;
        const tone = ctx.createGain();
        tone.gain.value = 0.5;
        const gate = ctx.createGain();
        gate.gain.value = 0;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = state.beat;
        const shaper = ctx.createWaveShaper();
        shaper.curve = getGateCurve();
        lfo.connect(shaper).connect(gate.gain);
        osc.connect(tone).connect(gate).connect(out);
        v.sources.push(osc, lfo);
        v.nodes.push(tone, gate, shaper);
        v.osc = osc;
        v.lfo = lfo;
      }

      const t0 = Engine.now();
      v.sources.forEach((s) => s.start(t0));
      return v;
    }

    function fadeVoiceIn(v, secs = 0.15) {
      const t = Engine.now();
      const cur = v.out.gain.value; // read before cancel — cancelling an in-flight ramp reverts .value
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setValueAtTime(cur, t);
      v.out.gain.linearRampToValueAtTime(1, t + secs);
    }

    // graphs that are still fading toward their scheduled teardown (out-gain nodes)
    const dying = new Set();

    // a restart mid-fade must not leave an old graph audible under the new one:
    // cut every pending fade to silence fast (teardown stays on its original schedule)
    function hasten() {
      const t = Engine.now();
      for (const g of dying) {
        const cur = g.gain.value; // read before cancel — cancelling an in-flight ramp reverts .value
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(cur, t);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.03);
      }
    }

    function killVoice(v, secs = 0.15) {
      const t = Engine.now();
      const cur = v.out.gain.value; // read before cancel — cancelling an in-flight ramp reverts .value
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setValueAtTime(cur, t);
      v.out.gain.linearRampToValueAtTime(0.0001, t + secs);
      dying.add(v.out);
      const stopAt = t + secs + 0.1;
      v.sources.forEach((s) => { try { s.stop(stopAt); } catch (e) { /* already stopped */ } });
      v.sources[0].onended = () => {
        dying.delete(v.out);
        v.sources.forEach((s) => { try { s.disconnect(); } catch (e) { /* ok */ } });
        v.nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* ok */ } });
      };
    }

    // swap in a fresh voice for the current mode/waveform with a ~150ms crossfade
    function crossfade() {
      if (!playing) return;
      const old = voice;
      voice = buildVoice(state.mode);
      fadeVoiceIn(voice);
      if (old) killVoice(old);
    }

    // ramp live frequencies to the current state — no zipper, no glitch
    function applyFreqs() {
      if (!voice) return;
      const t = Engine.now();
      if (voice.mode === 'isochronic') {
        voice.osc.frequency.setTargetAtTime(state.carrier, t, 0.03);
        voice.lfo.frequency.setTargetAtTime(state.beat, t, 0.03);
      } else {
        const [fL, fR] = earFreqs();
        voice.oscL.frequency.setTargetAtTime(fL, t, 0.03);
        voice.oscR.frequency.setTargetAtTime(fR, t, 0.03);
      }
    }

    // ---- noise bed -----------------------------------------------------------

    function noiseBuffer(type) {
      if (noiseBuffers[type]) return noiseBuffers[type];
      const ctx = Engine.ctx;
      const sr = ctx.sampleRate;
      const N = Math.floor(sr * 2);
      const F = Math.floor(sr * 0.08); // seam crossfade so the loop never clicks
      const buf = ctx.createBuffer(2, N, sr);
      for (let ch = 0; ch < 2; ch++) {
        const raw = new Float32Array(N + F);
        if (type === 'pink') {
          let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
          for (let i = 0; i < raw.length; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + w * 0.0555179;
            b1 = 0.99332 * b1 + w * 0.0750759;
            b2 = 0.96900 * b2 + w * 0.1538520;
            b3 = 0.86650 * b3 + w * 0.3104856;
            b4 = 0.55000 * b4 + w * 0.5329522;
            b5 = -0.7616 * b5 - w * 0.0168980;
            raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
            b6 = w * 0.115926;
          }
        } else {
          let last = 0; // brown: leaky integrator over white
          for (let i = 0; i < raw.length; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            raw[i] = last * 3.5;
          }
        }
        const data = buf.getChannelData(ch);
        data.set(raw.subarray(0, N));
        for (let i = 0; i < F; i++) {
          const m = i / F;
          data[i] = raw[i] * m + raw[N + i] * (1 - m);
        }
      }
      noiseBuffers[type] = buf;
      return buf;
    }

    function startNoise() {
      if (!playing || state.noise === 'off') return;
      stopNoise();
      const ctx = Engine.ctx;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(state.noise);
      src.loop = true;
      const fade = ctx.createGain();
      fade.gain.value = 0;
      src.connect(fade).connect(noiseGain);
      const t = Engine.now();
      src.start(t);
      fade.gain.setTargetAtTime(1, t, 0.05);
      noise = { src, fade };
    }

    function stopNoise(secs = 0.1) {
      if (!noise) return;
      const { src, fade } = noise;
      noise = null;
      const t = Engine.now();
      const cur = fade.gain.value; // read before cancel — cancelling an in-flight ramp reverts .value
      fade.gain.cancelScheduledValues(t);
      fade.gain.setValueAtTime(cur, t);
      fade.gain.linearRampToValueAtTime(0.0001, t + secs);
      dying.add(fade);
      try { src.stop(t + secs + 0.1); } catch (e) { /* already stopped */ }
      src.onended = () => {
        dying.delete(fade);
        try { src.disconnect(); } catch (e) { /* ok */ }
        try { fade.disconnect(); } catch (e) { /* ok */ }
      };
    }

    // ---- transport -------------------------------------------------------------

    function start(fade = 0.15) {
      Engine.init();
      if (playing) return;
      playing = true;
      hasten(); // cleanly cut anything still fading from a prior stop
      ensureBus();
      voice = buildVoice(state.mode);
      fadeVoiceIn(voice, fade);
      startNoise();
      startAnim();
    }

    // instant off by default: the power button and stop-all must be silent within ~100 ms
    function stop(fade = 0.08) {
      if (!playing) { if (fade < 0.1) hasten(); return; } // instant off must also cut fades already in flight
      playing = false;
      if (voice) { killVoice(voice, fade); voice = null; }
      stopNoise(fade);
      stopAnim();
      draw();
    }

    // ---- scope: beat-envelope over two cycles ------------------------------------

    const canvas = document.createElement('canvas');
    canvas.className = 'mini-canvas';
    canvas.style.height = '64px';
    canvas.style.margin = '10px 0 2px';

    function envAt(u) {
      const t = u * (2 / state.beat);
      if (state.mode === 'isochronic') {
        const s = Math.sin(2 * Math.PI * state.beat * t);
        return GATE_FLOOR + (1 - GATE_FLOOR) * (0.5 + 0.5 * Math.tanh(GATE_KNEE * s));
      }
      return Math.abs(Math.cos(Math.PI * state.beat * t));
    }

    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const accent = (getComputedStyle(canvas).getPropertyValue('--accent') || '#00e5ff').trim();
      const mid = h / 2, amp = h * 0.4;
      const phantom = state.mode === 'binaural'; // dashed: this envelope exists only in your head

      g.beginPath();
      for (let x = 0; x <= w; x++) {
        const y = mid - envAt(x / w) * amp;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      for (let x = w; x >= 0; x--) g.lineTo(x, mid + envAt(x / w) * amp);
      g.closePath();
      g.fillStyle = accent;
      g.globalAlpha = phantom ? 0.06 : 0.12;
      g.fill();

      g.strokeStyle = accent;
      g.lineWidth = 1.2;
      g.globalAlpha = phantom ? 0.55 : 0.9;
      g.setLineDash(phantom ? [4, 4] : []);
      for (const sign of [-1, 1]) {
        g.beginPath();
        for (let x = 0; x <= w; x++) {
          const y = mid + sign * envAt(x / w) * amp;
          x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
      g.setLineDash([]);

      if (playing) {
        const T = 2 / state.beat;
        const u = (Engine.now() % T) / T;
        g.globalAlpha = 0.9;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(u * w, 2);
        g.lineTo(u * w, h - 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    function animTick() { draw(); raf = requestAnimationFrame(animTick); }
    function startAnim() { if (!raf) raf = requestAnimationFrame(animTick); }
    function stopAnim() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    window.addEventListener('resize', draw);

    // ---- readouts ---------------------------------------------------------------

    const big = UI.readout('—', 'big');
    const sub = UI.readout('—');
    sub.el.style.marginTop = '6px';

    function updateReadout() {
      const [fL, fR] = earFreqs();
      const d = state.beat.toFixed(2);
      const b = bandOf(state.beat);
      let txt;
      if (state.mode === 'binaural') {
        txt = `L ${fL.toFixed(2)} ${t('Hz')} · R ${fR.toFixed(2)} ${t('Hz')} · Δ ${d} ${t('Hz')} · ${b}`;
      } else if (state.mode === 'monaural') {
        txt = `${t('mix')} ${fL.toFixed(2)} + ${fR.toFixed(2)} ${t('Hz')} · Δ ${d} ${t('Hz')} · ${b}`;
      } else {
        txt = `${t('tone')} ${state.carrier.toFixed(2)} ${t('Hz')} · ${t('pulse')} ${d} ${t('Hz')} · ${b}`;
      }
      big.set(txt);
      sub.set(`${t('carrier')} ${state.carrier.toFixed(2)} ${t('Hz')} ≈ ${noteLabel(state.carrier)}`);
    }

    // ---- controls ------------------------------------------------------------------

    const modeCtl = UI.select({
      label: t('mode'),
      // values stay English — state.mode and remote.apply compare against them
      options: [
        { value: 'binaural', label: t('binaural') },
        { value: 'monaural', label: t('monaural') },
        { value: 'isochronic', label: t('isochronic') },
      ],
      value: state.mode,
      onChange: (v) => { state.mode = v; crossfade(); updateReadout(); draw(); },
    });

    const waveCtl = UI.select({
      label: t('waveform'),
      // values stay English — they feed osc.type directly
      options: [
        { value: 'sine', label: t('sine') },
        { value: 'triangle', label: t('triangle') },
      ],
      value: state.wave,
      onChange: (v) => { state.wave = v; crossfade(); },
    });

    const carrierCtl = UI.slider({
      label: t('carrier'), min: 40, max: 1000, value: state.carrier, unit: t('Hz'), log: true,
      onInput: (v) => { state.carrier = v; applyFreqs(); updateReadout(); },
    });

    const beatCtl = UI.slider({
      label: t('beat'), min: 0.5, max: 45, step: 0.01, value: state.beat, unit: t('Hz'),
      format: (v) => v.toFixed(2),
      onInput: (v) => { state.beat = v; applyFreqs(); updateReadout(); draw(); },
    });

    const levelCtl = UI.slider({
      label: t('level'), min: 0, max: 1, step: 0.001, value: state.level,
      format: (v) => Math.round(v * 100) + '%',
      onInput: (v) => {
        state.level = v;
        if (bus) bus.gain.setTargetAtTime(v, Engine.now(), 0.03);
      },
    });

    const noiseCtl = UI.select({
      label: t('noise bed'),
      // values stay English — state.noise, noiseBuffer() and remote.apply compare against them
      options: [
        { value: 'off', label: t('off') },
        { value: 'pink', label: t('pink') },
        { value: 'brown', label: t('brown') },
      ],
      value: state.noise,
      onChange: (v) => {
        state.noise = v;
        if (playing) v === 'off' ? stopNoise() : startNoise();
      },
    });

    const noiseLvlCtl = UI.slider({
      label: t('bed level'), min: 0, max: 0.5, step: 0.001, value: state.noiseLevel,
      format: (v) => Math.round(v * 200) + '%',
      onInput: (v) => {
        state.noiseLevel = v;
        if (noiseGain) noiseGain.gain.setTargetAtTime(v, Engine.now(), 0.03);
      },
    });

    const chipsCtl = UI.chips({
      label: t('entrainment presets'),
      items: PRESETS,
      onPick: (p) => applyParams({ carrier: p.carrier, beat: p.beat }),
    });

    const foot = document.createElement('p');
    foot.textContent = t('binaural mode needs headphones — the beat is constructed by your brainstem, not your speakers.');
    foot.style.cssText = 'color: var(--ink-faint); font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.04em; margin: 10px 0 0;';

    // ---- power & assembly ------------------------------------------------------------

    const powerCtl = UI.power({
      title: t('binaural power'),
      onChange: (on) => (on ? start() : stop()),
    });
    head.append(powerCtl.el);

    Engine.onStopAll(() => {
      stop();
      powerCtl.set(false);
    });

    // ---- remote API (VIBE macro layer) -------------------------------------------

    // partial param apply: state + control UI always; live audio ramps when playing.
    // Same machinery the preset chips use. Unknown keys are ignored, never toggles power.
    function applyParams(p) {
      if (!p || typeof p !== 'object') return;
      let rebuild = false; // mode/wave changes need a fresh voice (crossfade)
      let retune = false;  // carrier/beat changes ramp on the live voice
      if ((p.mode === 'binaural' || p.mode === 'monaural' || p.mode === 'isochronic') && p.mode !== state.mode) {
        state.mode = p.mode;
        modeCtl.set(p.mode);
        rebuild = true;
      }
      if ((p.wave === 'sine' || p.wave === 'triangle') && p.wave !== state.wave) {
        state.wave = p.wave;
        waveCtl.set(p.wave);
        rebuild = true;
      }
      if (typeof p.carrier === 'number' && isFinite(p.carrier)) {
        state.carrier = clamp(p.carrier, 40, 1000);
        carrierCtl.set(state.carrier);
        retune = true;
      }
      if (typeof p.beat === 'number' && isFinite(p.beat)) {
        state.beat = clamp(p.beat, 0.5, 45);
        beatCtl.set(state.beat);
        retune = true;
      }
      if (typeof p.level === 'number' && isFinite(p.level)) {
        state.level = clamp(p.level, 0, 1);
        levelCtl.set(state.level);
        if (bus) bus.gain.setTargetAtTime(state.level, Engine.now(), 0.03);
      }
      if ((p.noise === 'off' || p.noise === 'pink' || p.noise === 'brown') && p.noise !== state.noise) {
        state.noise = p.noise;
        noiseCtl.set(p.noise);
        if (playing) state.noise === 'off' ? stopNoise() : startNoise();
      }
      if (typeof p.noiseLevel === 'number' && isFinite(p.noiseLevel)) {
        state.noiseLevel = clamp(p.noiseLevel, 0, 0.5);
        noiseLvlCtl.set(state.noiseLevel);
        if (noiseGain) noiseGain.gain.setTargetAtTime(state.noiseLevel, Engine.now(), 0.03);
      }
      if (rebuild) crossfade();
      else if (retune) applyFreqs();
      updateReadout();
      draw();
    }

    // retune carrier to the pitch class in whichever octave lands nearest the current carrier
    function setKey(noteIdx) {
      const pc = ((Math.round(noteIdx) % 12) + 12) % 12;
      let best = state.carrier;
      let bestDist = Infinity;
      for (let oct = 1; oct <= 6; oct++) {
        const f = midiToFreq(12 * oct + pc + 12);
        const d = Math.abs(f - state.carrier);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      applyParams({ carrier: best });
    }

    MOD.remote = {
      isOn: () => playing,
      power(on, fade) {
        on = !!on;
        if (on === playing) { powerCtl.set(on); return; } // idempotent
        if (on) start(fade); else stop(fade); // same paths as the power button; start() guards Engine.init()
        powerCtl.set(on);
      },
      apply: applyParams,
      setKey,
    };

    body.append(
      big.el,
      sub.el,
      canvas,
      UI.grid(modeCtl, waveCtl, carrierCtl, beatCtl, levelCtl),
      UI.group(t('noise bed'), UI.grid(noiseCtl, noiseLvlCtl)),
      chipsCtl.el,
      foot,
    );

    updateReadout();
    requestAnimationFrame(draw);
}
