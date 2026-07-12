// viz.js — the main visualization strip.
// Four modes drawing from the master L/R analysers:
//   scope     — both ear waveforms overlaid (cyan = L, magenta = R)
//   spectrum  — log-frequency spectrum, filled
//   lissajous — L vs R phase plot; binaural beats precess as rotating ellipses
//   mandala   — kaleidoscopic polar spectrum
import { Engine } from './engine.js';

const CYAN = '#00e5ff';
const MAGENTA = '#ff3ec8';
const BG = '#07070c';

export function initViz(canvas) {
  const g = canvas.getContext('2d');
  let mode = 'scope';
  let W = 0, H = 0;
  let frame = 0;

  let lastDpr = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    lastDpr = dpr;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      g.fillStyle = BG;
      g.fillRect(0, 0, w, h);
    }
    W = w; H = h;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  let tL = null, tR = null;
  let fL = null, fR = null;

  function pull() {
    if (!Engine.ready) return false;
    const aL = Engine.analyserL, aR = Engine.analyserR;
    if (!tL) { tL = new Float32Array(aL.fftSize); tR = new Float32Array(aR.fftSize); }
    if (!fL) { fL = new Uint8Array(aL.frequencyBinCount); fR = new Uint8Array(aR.frequencyBinCount); }
    aL.getFloatTimeDomainData(tL);
    aR.getFloatTimeDomainData(tR);
    aL.getByteFrequencyData(fL);
    aR.getByteFrequencyData(fR);
    return true;
  }

  function clear(alpha = 1) {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = alpha >= 1 ? BG : `rgba(7, 7, 12, ${alpha})`;
    g.fillRect(0, 0, W, H);
  }

  function gridLines() {
    g.strokeStyle = 'rgba(35, 35, 58, 0.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, H / 2); g.lineTo(W, H / 2);
    g.stroke();
  }

  // Find a rising zero-crossing in the first half of the buffer so the
  // scope holds still instead of scrolling.
  function trigger(buf) {
    const half = buf.length / 2;
    for (let i = 1; i < half; i++) {
      if (buf[i - 1] <= 0 && buf[i] > 0) return i;
    }
    return 0;
  }

  function drawScope() {
    clear();
    gridLines();
    const start = trigger(tL);
    const span = tL.length / 2;
    const amp = H * 0.42;
    for (const [buf, color] of [[tL, CYAN], [tR, MAGENTA]]) {
      g.strokeStyle = color;
      g.beginPath();
      for (let i = 0; i < span; i++) {
        const x = (i / span) * W;
        const y = H / 2 - buf[start + i] * amp;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      // fake the glow with a wide faint pass, then the thin bright trace
      g.lineWidth = 7;
      g.globalAlpha = 0.18;
      g.stroke();
      g.lineWidth = 2;
      g.globalAlpha = 0.9;
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  function drawSpectrum() {
    clear();
    if (!fL) return;
    const sr = Engine.ctx.sampleRate;
    const bins = fL.length;
    const fMin = 20, fMax = Math.min(20000, sr / 2);
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(0, 229, 255, 0.10)');
    grad.addColorStop(0.55, 'rgba(157, 255, 0, 0.45)');
    grad.addColorStop(1, 'rgba(255, 62, 200, 0.9)');

    g.beginPath();
    g.moveTo(0, H);
    const cols = Math.floor(W / 2);
    for (let c = 0; c <= cols; c++) {
      const freq = fMin * Math.pow(fMax / fMin, c / cols);
      const bin = Math.min(bins - 1, Math.round((freq / (sr / 2)) * bins));
      const v = Math.max(fL[bin], fR[bin]) / 255;
      const x = (c / cols) * W;
      const y = H - Math.pow(v, 1.25) * H * 0.95;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(233, 231, 247, 0.55)';
    g.lineWidth = 1.4;
    g.stroke();

    // frequency ruler
    g.fillStyle = 'rgba(141, 138, 168, 0.6)';
    g.font = `${Math.round(10 * (W > 1500 ? 1.5 : 1))}px ui-monospace, monospace`;
    for (const f of [50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
      const x = (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;
      g.fillRect(x, H - 6, 1, 6);
      g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, H - 8);
    }
  }

  function drawLissajous() {
    clear(0.12);
    const cx = W / 2, cy = H / 2;
    const s = Math.min(W, H) * 0.46;
    const hue = (frame * 0.35) % 360;
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `hsl(${hue}, 100%, 62%)`;
    g.beginPath();
    for (let i = 0; i < tL.length; i += 2) {
      const x = cx + tL[i] * s;
      const y = cy - tR[i] * s;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    // fake the glow with a wide faint pass, then the thin bright trace
    g.lineWidth = 6;
    g.globalAlpha = 0.18;
    g.stroke();
    g.lineWidth = 1.6;
    g.globalAlpha = 1;
    g.stroke();
    g.globalCompositeOperation = 'source-over';
    // faint axes
    g.strokeStyle = 'rgba(35, 35, 58, 0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx, 0); g.lineTo(cx, H);
    g.moveTo(0, cy); g.lineTo(W, cy);
    g.stroke();
  }

  function drawMandala() {
    clear(0.08);
    if (!fL) return;
    const cx = W / 2, cy = H / 2;
    const base = Math.min(W, H) * 0.12;
    const reach = Math.min(W, H) * 0.36;
    const SEGS = 6;
    const SPOKES = 48;
    const rot = frame * 0.002;
    const sr = Engine.ctx.sampleRate;
    const bins = fL.length;
    g.globalCompositeOperation = 'lighter';
    for (let seg = 0; seg < SEGS; seg++) {
      for (let i = 0; i < SPOKES; i++) {
        const freq = 30 * Math.pow(8000 / 30, i / SPOKES);
        const bin = Math.min(bins - 1, Math.round((freq / (sr / 2)) * bins));
        const v = ((fL[bin] + fR[bin]) / 510);
        if (v < 0.02) continue;
        const a = rot + (seg / SEGS) * Math.PI * 2 + (i / SPOKES) * (Math.PI * 2 / SEGS);
        const r0 = base;
        const r1 = base + Math.pow(v, 1.4) * reach;
        const hue = (i / SPOKES) * 300 + frame * 0.2;
        g.strokeStyle = `hsla(${hue}, 100%, 60%, ${0.25 + v * 0.6})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  function drawIdle() {
    clear();
    gridLines();
    g.strokeStyle = 'rgba(0, 229, 255, 0.25)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const y = H / 2 + Math.sin(x * 0.02 + frame * 0.03) * Math.sin(frame * 0.01) * H * 0.06;
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  function loop() {
    frame++;
    if (Math.min(window.devicePixelRatio || 1, 2) !== lastDpr) resize();
    if (pull()) {
      if (mode === 'scope') drawScope();
      else if (mode === 'spectrum') drawSpectrum();
      else if (mode === 'lissajous') drawLissajous();
      else drawMandala();
    } else {
      drawIdle();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    setMode(m) {
      mode = m;
      clear();
    },
    getMode: () => mode,
  };
}
