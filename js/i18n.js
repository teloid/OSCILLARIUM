// i18n.js — OSCILLARIUM's tiny optional-language layer.
// English strings ARE the dictionary keys, so t() is a no-op passthrough in
// English and a lookup with English fallback otherwise. Each module registers
// its own entries at import time (registerDict runs before any build()).
// Switching languages persists and reloads the page — a clean re-render beats
// live re-painting every readout, and a language switch is a natural restart.
//
// House rule for translators: translate what the user READS, never what the
// code COMPARES — select option values, preset/genre lookup keys, remote-API
// enum values and event names stay English forever.

const DICTS = { ru: {} };

let cur = 'en';
try { cur = localStorage.getItem('osc-lang') === 'ru' ? 'ru' : 'en'; } catch (e) { /* private mode */ }

export function lang() { return cur; }

export function t(s) {
  if (cur === 'en') return s;
  const d = DICTS[cur];
  return (d && d[s] != null) ? d[s] : s;
}

export function registerDict(l, entries) {
  DICTS[l] = DICTS[l] || {};
  Object.assign(DICTS[l], entries);
}

export function setLang(l) {
  if (l === cur) return;
  try { localStorage.setItem('osc-lang', l); } catch (e) { /* private mode */ }
  location.reload();
}
