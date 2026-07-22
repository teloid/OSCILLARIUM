// app.js — OSCILLARIUM shell: mounts modules, master controls, viz, boot.
import { Engine } from './engine.js';
import * as UI from './ui.js';
import { t, lang, setLang, registerDict } from './i18n.js';
import { initViz } from './viz.js';
import { initVibe } from './vibe.js';
import { initRig } from './rig.js';
import { initDojo } from './dojo.js';
import { initInfo } from './info.js';

registerDict('ru', { 'master': 'мастер' });
import binaural from './modules/binaural.js';
import tonelab from './modules/tonelab.js';
import beatlab from './modules/beatlab.js';
import drums from './modules/drums.js';
import drone from './modules/drone.js';
import chords from './modules/chords.js';

window.__engine = Engine; // debugging & automated verification

// Module contract: default export { id, title, tagline, build(body, head) }.
// build() runs before the AudioContext exists — modules create audio lazily.
const MODULES = [
  { mod: binaural, accent: 'var(--cyan)' },
  { mod: tonelab, accent: 'var(--acid)' },
  { mod: beatlab, accent: 'var(--magenta)', wide: true },
  { mod: drums, accent: 'var(--danger)', wide: true },
  { mod: drone, accent: 'var(--amber)' },
  { mod: chords, accent: 'var(--violet)' },
];

const gridEl = document.getElementById('modules');
for (const { mod, accent, wide } of MODULES) {
  const card = document.createElement('section');
  card.className = 'module-card' + (wide ? ' wide' : '');
  card.style.setProperty('--accent', accent);
  card.id = 'mod-' + mod.id;

  const head = document.createElement('header');
  head.className = 'mod-head';
  const title = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.textContent = mod.title;
  const p = document.createElement('p');
  p.textContent = mod.tagline;
  title.append(h2, p);
  head.append(title);

  const body = document.createElement('div');
  body.className = 'mod-body';
  card.append(head, body);
  gridEl.append(card);

  try {
    mod.build(body, head);
  } catch (err) {
    console.error(`[${mod.id}] build failed`, err);
    const fail = document.createElement('p');
    fail.textContent = '⚠ module failed to load — see console';
    body.append(fail);
  }
}

// ---- master controls ---------------------------------------------------------

const vol = UI.slider({
  label: t('master'), min: 0, max: 1, value: 0.8,
  format: (v) => Math.round(v * 100) + '%',
  onInput: (v) => Engine.setMasterVolume(v),
});
document.getElementById('master-vol').append(vol.el);

const info = initInfo();
document.getElementById('info-btn').addEventListener('click', () => info.open());

document.getElementById('stop-all').addEventListener('click', () => Engine.stopAll());
window.addEventListener('keydown', (e) => {
  // the manual overlay owns Escape while open — close it, don't panic-stop
  if (e.key === 'Escape' && info.isOpen()) { info.close(); return; }
  const t = e.target;
  if (t && t.matches && t.matches('input, select, textarea')) {
    // Let the control consume Escape (dismiss dropdown / cancel edit), then
    // release focus so a second Escape reaches the panic stop below.
    if (e.key === 'Escape') setTimeout(() => t.blur(), 0);
    return;
  }
  if (e.key === 'Escape') Engine.stopAll();
  // 1-7 play the chord degrees when the CHORDS module is powered
  if (e.key >= '1' && e.key <= '7' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (chords.remote && chords.remote.isOn()) chords.remote.play(e.key.charCodeAt(0) - 49);
  }
});

// The drone's progression can lead the chord pads ("lead chords" toggle):
// each change event carries the diatonic degree; deg null = drone-only change.
Engine.on('progression', (p) => {
  if (p.follow && p.deg != null && chords.remote && chords.remote.isOn()) chords.remote.play(p.deg);
});

// ---- visualization -------------------------------------------------------------

const viz = initViz(document.getElementById('viz'));
const modeBtns = document.querySelectorAll('#viz-modes button');
function selectVizMode(mode) {
  modeBtns.forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
  viz.setMode(mode);
}
modeBtns.forEach((b) => b.addEventListener('click', () => selectVizMode(b.dataset.mode)));

// ---- vibe deck ------------------------------------------------------------------

initVibe(document.getElementById('vibe-deck'), MODULES.map((m) => m.mod), selectVizMode);
const rigApi = initRig(document.getElementById('rig-deck'));
initDojo(document.getElementById('dojo-deck'), rigApi);

const modeBtn = document.getElementById('mode-switch');
function setUiMode(mode) {
  if (mode !== 'lab' && mode !== 'rig' && mode !== 'dojo' && mode !== 'vibe') mode = 'lab';
  document.body.classList.toggle('vibe', mode === 'vibe');
  document.body.classList.toggle('rig', mode === 'rig');
  document.body.classList.toggle('dojo', mode === 'dojo');
  modeBtn.setAttribute('data-mode', mode);
  try { localStorage.setItem('osc-mode', mode); } catch (e) { /* private mode */ }
}
modeBtn.addEventListener('click', (e) => {
  const half = e.target.closest('.ms-half');
  if (half && half.dataset.m) setUiMode(half.dataset.m);
});
try { setUiMode(localStorage.getItem('osc-mode') || 'lab'); } catch (e) { setUiMode('lab'); }

// ---- boot ---------------------------------------------------------------------

const boot = document.getElementById('boot');
document.getElementById('boot-btn').addEventListener('click', () => {
  Engine.init();
  Engine.setMasterVolume(vol.get()); // honor any pre-boot slider changes
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 600);
});

// ---- language --------------------------------------------------------------------
// Modules translate themselves via t(); the static index.html chrome is
// overridden here only when Russian is active (English text stays canonical).

const langBtn = document.getElementById('lang-switch');
langBtn.setAttribute('aria-pressed', String(lang() === 'ru'));
langBtn.addEventListener('click', () => setLang(lang() === 'ru' ? 'en' : 'ru'));

if (lang() === 'ru') {
  const tagline = 'частотная лаборатория для ушей, железа и разума';
  document.querySelector('#brand p').textContent = tagline;
  const bootTag = document.querySelector('.boot-tag');
  if (bootTag) bootTag.textContent = tagline;
  const bootBtn = document.getElementById('boot-btn');
  if (bootBtn) bootBtn.textContent = '⏻ ВКЛЮЧИТЬ';
  const bootHint = document.querySelector('.boot-hint');
  if (bootHint) bootHint.textContent = 'лучше в наушниках · начинайте с малой громкости';
  document.getElementById('stop-all').textContent = '■ СТОП ВСЁ';
  const vizNames = { scope: 'СКОП', spectrum: 'СПЕКТР', lissajous: 'ЛИССАЖУ', mandala: 'МАНДАЛА' };
  document.querySelectorAll('#viz-modes button').forEach((b) => { b.textContent = vizNames[b.dataset.mode]; });
  const foot = document.querySelectorAll('#foot p');
  if (foot[0]) foot[0].textContent = '⚠ берегите уши — держите громкость низкой и делайте паузы. звуковая стимуляция — экспериментальная игра, а не медицина. если вы склонны к судорогам, будьте осторожны с пульсирующим звуком и визуалом.';
  if (foot[1]) foot[1].textContent = 'чистый web audio · без сэмплов · без сервера · без слежки · всё — математика';
}
