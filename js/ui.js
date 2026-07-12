// ui.js — OSCILLARIUM shared UI components.
// Every factory returns { el, get, set } unless noted; `set` updates the UI
// without firing the callback. Layout helpers (row/group/grid) accept either
// plain elements or component objects and unwrap them.

function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function unwrap(x) { return x instanceof Node ? x : x.el; }

// Smart number formatting for readouts: 12345 → "12.35k", 3.1416 → "3.14".
export function fmt(v) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return (v / 1000).toFixed(2) + 'k';
  if (a >= 100) return v.toFixed(1);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(2);
}

// Horizontal slider with label + live readout. Use log:true for wide ranges
// (requires min > 0); the range input then holds positions 0..1000 mapped
// exponentially onto [min, max].
export function slider({ label, min, max, step = 'any', value, unit = '', log = false, format = fmt, onInput }) {
  const wrap = elem('div', 'ctl');
  const top = elem('div', 'ctl-top');
  const lab = elem('span', 'ctl-label', label);
  const val = elem('span', 'ctl-value');
  top.append(lab, val);
  const input = elem('input', 'range');
  input.type = 'range';
  const toVal = log ? (p) => min * Math.pow(max / min, p / 1000) : (p) => +p;
  const toPos = log ? (v) => 1000 * (Math.log(v / min) / Math.log(max / min)) : (v) => v;
  if (log) { input.min = 0; input.max = 1000; input.step = 1; }
  else { input.min = min; input.max = max; input.step = step; }
  let cur = value;
  const paint = () => { val.textContent = format(cur) + (unit ? ' ' + unit : ''); };
  input.value = toPos(value);
  paint();
  input.addEventListener('input', () => { cur = toVal(input.value); paint(); onInput && onInput(cur); });
  wrap.append(top, input);
  return { el: wrap, get: () => cur, set(v) { cur = v; input.value = toPos(v); paint(); } };
}

// options: array of strings or {value, label}. get/set use string values.
export function select({ label, options, value, onChange }) {
  const wrap = elem('div', 'ctl');
  if (label) {
    const top = elem('div', 'ctl-top');
    top.append(elem('span', 'ctl-label', label));
    wrap.append(top);
  }
  const sel = elem('select', 'select');
  for (const o of options) {
    const opt = elem('option');
    if (typeof o === 'string') { opt.value = o; opt.textContent = o; }
    else { opt.value = o.value; opt.textContent = o.label; }
    sel.append(opt);
  }
  if (value != null) sel.value = String(value);
  sel.addEventListener('change', () => onChange && onChange(sel.value));
  wrap.append(sel);
  return { el: wrap, get: () => sel.value, set(v) { sel.value = String(v); } };
}

export function toggle({ label, value = false, onChange }) {
  const wrap = elem('label', 'switch');
  const input = elem('input');
  input.type = 'checkbox';
  input.checked = value;
  const track = elem('span', 'switch-track');
  const lab = elem('span', 'switch-label', label);
  input.addEventListener('change', () => onChange && onChange(input.checked));
  wrap.append(input, track, lab);
  return { el: wrap, get: () => input.checked, set(v) { input.checked = !!v; } };
}

// Returns a plain <button> element. kind: '' | 'primary' | 'ghost' | 'danger'.
export function button({ label, onClick, kind = '', title }) {
  const b = elem('button', ('btn ' + kind).trim(), label);
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

export function numberBox({ label, value, min, max, step = 1, unit = '', onChange }) {
  const wrap = elem('div', 'ctl ctl-num');
  const top = elem('div', 'ctl-top');
  top.append(elem('span', 'ctl-label', label + (unit ? ` (${unit})` : '')));
  wrap.append(top);
  const input = elem('input', 'numbox');
  input.type = 'number';
  input.min = min; input.max = max; input.step = step; input.value = value;
  let cur = value;
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (!isFinite(v)) { input.value = cur; return; } // blank/garbage: restore, don't fire
    v = Math.min(max, Math.max(min, v));
    cur = v;
    input.value = v;
    onChange && onChange(v);
  });
  wrap.append(input);
  return { el: wrap, get: () => cur, set(v) { cur = v; input.value = v; } };
}

// Big LED power toggle — every module puts one of these in its card header.
export function power({ onChange, title = 'power' }) {
  const b = elem('button', 'power');
  b.title = title;
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = '<span class="power-icon">⏻</span>';
  let on = false;
  const paint = () => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  };
  b.addEventListener('click', () => { on = !on; paint(); onChange && onChange(on); });
  return { el: b, get: () => on, set(v) { on = !!v; paint(); } };
}

// Preset chip row. items: [{ name, hint? , ...anything }]; onPick(item, index).
export function chips({ label = 'presets', items, onPick }) {
  const wrap = elem('div', 'chips-wrap');
  if (label) wrap.append(elem('span', 'chips-label', label));
  const rowEl = elem('div', 'chips');
  items.forEach((item, i) => {
    const c = elem('button', 'chip', item.name);
    if (item.hint) c.title = item.hint;
    c.addEventListener('click', () => {
      rowEl.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      onPick(item, i);
    });
    rowEl.append(c);
  });
  wrap.append(rowEl);
  return { el: wrap };
}

// Live text display, e.g. "L 437.0 Hz · A4 −12¢".
export function readout(initial = '—', cls = '') {
  const el = elem('div', ('readout ' + cls).trim(), initial);
  return { el, set(t) { el.textContent = t; } };
}

export function row(...children) {
  const r = elem('div', 'ctl-row');
  r.append(...children.map(unwrap));
  return r;
}

export function group(title, ...children) {
  const g = elem('div', 'ctl-group');
  if (title) g.append(elem('div', 'ctl-group-title', title));
  g.append(...children.map(unwrap));
  return g;
}

export function grid(...children) {
  const g = elem('div', 'controls-grid');
  g.append(...children.map(unwrap));
  return g;
}

// Skeuomorphic rotary knob (linear range). Vertical drag, wheel, or arrow keys;
// the indicator sweeps -135°..+135°. step > 0 snaps to detents.
export function knob({ label, min, max, value, step = 0, format = fmt, unit = '', size = 72, onInput }) {
  const wrap = elem('div', 'knob-wrap');
  const k = elem('div', 'knob');
  k.style.width = k.style.height = size + 'px';
  k.tabIndex = 0;
  k.setAttribute('role', 'slider');
  const ind = elem('div', 'knob-ind');
  k.append(ind);
  const lab = elem('div', 'knob-label', label);
  const val = elem('div', 'knob-value');
  wrap.append(k, lab, val);

  let cur = value;
  const paint = () => {
    const t = (cur - min) / (max - min);
    k.style.setProperty('--rot', (-135 + 270 * t) + 'deg');
    k.setAttribute('aria-valuenow', String(cur));
    const text = format(cur);
    val.textContent = text + (unit && text !== '' ? ' ' + unit : '');
  };
  const commit = (v) => {
    v = Math.min(max, Math.max(min, v));
    if (step) v = Math.round((v - min) / step) * step + min;
    if (v === cur) return;
    cur = v;
    paint();
    onInput && onInput(cur);
  };

  let drag = null;
  k.addEventListener('pointerdown', (e) => {
    if (drag) return; // one finger drives the knob
    e.preventDefault();
    k.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y: e.clientY, v: cur };
  });
  k.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    commit(drag.v + ((drag.y - e.clientY) / 150) * (max - min));
  });
  k.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });
  k.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) drag = null; });
  k.addEventListener('lostpointercapture', () => { drag = null; });
  k.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = step || (max - min) / 40;
    commit(cur + (e.deltaY < 0 ? d : -d));
  }, { passive: false });
  k.addEventListener('keydown', (e) => {
    const d = step || (max - min) / 24;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); commit(cur + d); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); commit(cur - d); }
  });

  paint();
  return { el: wrap, knobEl: k, get: () => cur, set(v) { cur = Math.min(max, Math.max(min, v)); paint(); } };
}
