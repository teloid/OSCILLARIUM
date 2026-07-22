// fretboard.js — OSCILLARIUM virtual fretboard (DOJO's companion view).
// A standard-tuning EADGBE neck, nut + 15 frets, low E drawn at the BOTTOM.
// createFretboard(canvas) → { setSequence(midis), draw(state) }.
//   setSequence solves a {string, fret} position for every note of the
//   (already transposed) sequence ONCE, greedy least-motion: minimize
//   |fret − prevFret|, tie-break lower fret (so an open string wins ties but
//   a fretted spot wins when it genuinely reduces hand travel). Notes off the
//   neck clamp to the nearest playable spot and are flagged so draw() can
//   render them hollow/dashed.
//   draw(state) paints markers for { notes: [{ idx, midi, phase }],
//   countdownGlow? } — phases: current | next | upcoming | hit | partial |
//   miss | past. Hit rings key off phase FLIPS (tracked per idx), not
//   wall-clock. DPR-scaled like viz.js; nothing allocated in the draw path.
import { NOTE_NAMES } from './engine.js';

const OPEN = [40, 45, 50, 55, 59, 64];            // E2 A2 D3 G3 B3 E4, bottom → top
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];
const FRETS = 15;
const NORM = 1 - Math.pow(2, -FRETS / 12);        // realistic-spacing normalizer
const SINGLE_INLAYS = [3, 5, 7, 9, 15];
const TAU = Math.PI * 2;
const RING_MS = 350;                              // hit-ring lifetime
const DASH = [4, 3];
const SOLID = [];

// palette (matches the dojo roll)
const C_CURRENT = '#ffb300';
const C_NEXT = '#b26bff';
const C_UPCOMING = 'rgba(178, 107, 255, 0.30)';
const C_HIT = '#48dbc3';
const C_PARTIAL = 'rgba(255, 179, 0, 0.45)';
const C_MISS = '#ff5470';
const C_PAST = 'rgba(168, 166, 190, 0.22)';
const C_NUT = 'rgba(222, 220, 238, 0.8)';
const C_INLAY = 'rgba(141, 138, 168, 0.16)';
const C_LABEL = 'rgba(141, 138, 168, 0.75)';
const C_STRING = 'rgba(178, 182, 200, 0.55)';
const C_STRING_HI = 'rgba(236, 238, 248, 0.22)';
const C_NAME = 'rgba(7, 7, 12, 0.92)';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_FONT = '11px ' + MONO;
const NAME_FONT = '700 10px ' + MONO;

export function createFretboard(canvas) {
  const g = canvas.getContext('2d');

  // ---- geometry (recomputed on resize only — draw() reads cached arrays) -------
  let W = 0, H = 0, dpr = 1;
  const fretX = new Float64Array(FRETS + 1);  // wire x per fret (0 = nut edge)
  const noteX = new Float64Array(FRETS + 1);  // marker x per fret (0 = open)
  const stringY = new Float64Array(6);
  const stringW = new Float64Array(6);        // thickness 2.6 → 1.1 bottom → top
  let bx0 = 0, bx1 = 0, by0 = 0, by1 = 0, nutX = 0, yMid = 0, gap = 24, mR = 9;
  let wireGrad = null, boardGrad = null;

  function recompute() {
    bx0 = 34; bx1 = W - 12; by0 = 8; by1 = H - 10;
    nutX = bx0 + 10;
    const span = Math.max(1, bx1 - nutX - 8);
    fretX[0] = nutX;
    for (let k = 1; k <= FRETS; k++) {
      fretX[k] = nutX + span * (1 - Math.pow(2, -k / 12)) / NORM;
    }
    const yTop = by0 + 16, yBot = by1 - 16;
    gap = (yBot - yTop) / 5;
    yMid = (yTop + yBot) / 2;
    for (let i = 0; i < 6; i++) {
      stringY[i] = yBot - i * gap;
      stringW[i] = 2.6 - i * 0.3;
    }
    noteX[0] = nutX + Math.min(14, span * 0.02 + 8); // open markers just right of the nut
    for (let k = 1; k <= FRETS; k++) noteX[k] = (fretX[k - 1] + fretX[k]) / 2;
    mR = Math.max(4, Math.min(11, gap * 0.4));
    wireGrad = g.createLinearGradient(0, by0, 0, by1);
    wireGrad.addColorStop(0, 'rgba(148, 152, 172, 0.30)');
    wireGrad.addColorStop(0.5, 'rgba(214, 218, 236, 0.52)');
    wireGrad.addColorStop(1, 'rgba(148, 152, 172, 0.30)');
    boardGrad = g.createLinearGradient(0, by0, 0, by1);
    boardGrad.addColorStop(0, '#0c0c13');
    boardGrad.addColorStop(1, '#07070c');
  }

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    recompute();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- solved positions (rebuilt only by setSequence — never in draw) ----------
  let seqStr = new Int8Array(0);
  let seqFret = new Int8Array(0);
  let seqClamped = new Uint8Array(0);
  let seqNames = [];
  let lastPhase = [];                  // per-idx phase memory → flip detection
  let flipAt = new Float64Array(0);    // performance.now() of the last flip

  function setSequence(midis) {
    const n = midis.length;
    seqStr = new Int8Array(n);
    seqFret = new Int8Array(n);
    seqClamped = new Uint8Array(n);
    seqNames = new Array(n);
    lastPhase = new Array(n).fill('');
    flipAt = new Float64Array(n);
    let prevFret = -1;
    for (let i = 0; i < n; i++) {
      const m = midis[i];
      let bs = -1, bf = 0, bc = Infinity;
      for (let s = 0; s < 6; s++) {
        const f = m - OPEN[s];
        if (f < 0 || f > FRETS) continue;
        // least motion vs the previous note; before any note, settle low
        const cost = prevFret < 0 ? f : Math.abs(f - prevFret);
        if (cost < bc || (cost === bc && f < bf)) { bc = cost; bs = s; bf = f; }
      }
      if (bs < 0) { // off the neck — clamp to the nearest playable spot
        seqClamped[i] = 1;
        if (m < OPEN[0]) { bs = 0; bf = 0; }
        else { bs = 5; bf = FRETS; }
      }
      seqStr[i] = bs;
      seqFret[i] = bf;
      seqNames[i] = NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
      prevFret = bf;
    }
  }

  // ---- render -------------------------------------------------------------------
  function roundRectPath(x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  function drawBoard() {
    // fingerboard: near-black rounded panel
    g.fillStyle = boardGrad;
    roundRectPath(bx0, by0, bx1 - bx0, by1 - by0, 8);
    g.fill();
    // nut: thick pale bar at the left
    g.fillStyle = C_NUT;
    roundRectPath(nutX - 6, by0 + 3, 6, by1 - by0 - 6, 2);
    g.fill();
    // fret wires (one path, subtle metallic gradient)
    g.strokeStyle = wireGrad;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let k = 1; k <= FRETS; k++) {
      g.moveTo(fretX[k], by0 + 3);
      g.lineTo(fretX[k], by1 - 3);
    }
    g.stroke();
    // inlay dots: single at 3/5/7/9/15, double at 12
    g.fillStyle = C_INLAY;
    for (let d = 0; d < SINGLE_INLAYS.length; d++) {
      g.beginPath();
      g.arc(noteX[SINGLE_INLAYS[d]], yMid, 4.5, 0, TAU);
      g.fill();
    }
    g.beginPath();
    g.arc(noteX[12], yMid - gap, 4.5, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(noteX[12], yMid + gap, 4.5, 0, TAU);
    g.fill();
    // strings: steel base + faint highlight above the crown
    for (let i = 0; i < 6; i++) {
      const y = stringY[i];
      g.strokeStyle = C_STRING;
      g.lineWidth = stringW[i];
      g.beginPath();
      g.moveTo(nutX - 6, y);
      g.lineTo(bx1 - 3, y);
      g.stroke();
      g.strokeStyle = C_STRING_HI;
      g.lineWidth = Math.max(0.6, stringW[i] * 0.35);
      g.beginPath();
      g.moveTo(nutX - 6, y - stringW[i] * 0.3);
      g.lineTo(bx1 - 3, y - stringW[i] * 0.3);
      g.stroke();
    }
    // open-string labels in the left gutter
    g.fillStyle = C_LABEL;
    g.font = LABEL_FONT;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let i = 0; i < 6; i++) g.fillText(STRING_LABELS[i], bx0 - 8, stringY[i]);
  }

  function draw(state) {
    if (Math.min(window.devicePixelRatio || 1, 2) !== dpr) resize();
    if (W < 8 || H < 8) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    drawBoard();

    // count-in: a calm amber breath around the board, in time with the clicks
    const glow = state.countdownGlow || 0;
    if (glow > 0) {
      g.strokeStyle = C_CURRENT;
      g.globalAlpha = 0.3 * glow;
      g.lineWidth = 2;
      roundRectPath(bx0 + 1, by0 + 1, bx1 - bx0 - 2, by1 - by0 - 2, 7);
      g.stroke();
      g.globalAlpha = 1;
    }

    const list = state.notes;
    if (!list || !list.length) return;
    const now = performance.now();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < list.length; k++) {
      const nt = list[k];
      const i = nt.idx;
      if (i < 0 || i >= seqStr.length) continue;
      const phase = nt.phase;
      if (phase !== lastPhase[i]) { lastPhase[i] = phase; flipAt[i] = now; }
      const x = noteX[seqFret[i]];
      const y = stringY[seqStr[i]];
      const hollow = seqClamped[i] === 1;
      // fresh hit → expanding, fading ring from the moment the phase flipped
      if (phase === 'hit') {
        const p = (now - flipAt[i]) / RING_MS;
        if (p >= 0 && p < 1) {
          g.strokeStyle = C_HIT;
          g.globalAlpha = (1 - p) * 0.7;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x, y, mR + p * 14, 0, TAU);
          g.stroke();
          g.globalAlpha = 1;
        }
      }
      let fill = C_PAST, stroke = null, named = false, lit = false;
      if (phase === 'current') { fill = C_CURRENT; named = true; lit = true; }
      else if (phase === 'next') { fill = null; stroke = C_NEXT; }
      else if (phase === 'upcoming') fill = C_UPCOMING;
      else if (phase === 'hit') fill = C_HIT;
      else if (phase === 'partial') fill = C_PARTIAL;
      else if (phase === 'miss') fill = C_MISS;
      if (hollow) { stroke = stroke || fill; fill = null; g.setLineDash(DASH); }
      g.beginPath();
      g.arc(x, y, mR, 0, TAU);
      if (fill) {
        if (lit) { g.shadowColor = C_CURRENT; g.shadowBlur = 14; }
        g.fillStyle = fill;
        g.fill();
        if (lit) g.shadowBlur = 0;
      }
      if (stroke) {
        g.strokeStyle = stroke;
        g.lineWidth = 2;
        g.stroke();
      }
      if (hollow) g.setLineDash(SOLID);
      if (named && mR >= 7) {
        g.fillStyle = hollow ? C_CURRENT : C_NAME;
        g.font = NAME_FONT;
        g.fillText(seqNames[i], x, y + 0.5);
      }
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  }

  return { setSequence, draw };
}
