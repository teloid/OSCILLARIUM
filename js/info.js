// info.js — the "?" field manual overlay, fully bilingual.
// Long-form prose lives here as parallel EN/RU content trees rather than in
// the i18n dictionary — a manual is content, not chrome.
import { lang } from './i18n.js';

const EN = {
  title: 'OSCILLARIUM · field manual',
  close: 'close',
  sections: [
    {
      h: 'what is this',
      p: ['A self-contained audio-frequency laboratory: tone generators, a drum machine, drones with chord progressions, harmony pads, live guitar processing, and interactive lessons — all synthesized in your browser with Web Audio. No samples, no server, no tracking. Everything is math.'],
    },
    {
      h: 'quick start',
      list: [
        'Press POWER ON. Put on headphones. Start quiet.',
        'The LAB | RIG | DOJO | VIBE rocker in the header switches the whole workspace.',
        'EN | RU switches the language (this manual included).',
        'MASTER is the output volume; ■ STOP ALL (or Esc) silences everything instantly.',
        'The strip at the top visualizes whatever is playing: SCOPE, SPECTRUM, LISSAJOUS, MANDALA.',
      ],
    },
    {
      h: 'LAB — the cockpit',
      p: ['Six instruments, all layerable — each with its own power LED, presets, and live readouts:'],
      list: [
        'BINAURAL — entrainment beats (binaural / monaural / isochronic), brainwave presets, noise bed. Binaural mode needs headphones.',
        'TONE LAB — two independent per-ear generators with ratio locking: 3:2, septimal 7:6, the golden ratio φ. Test gear, test ears.',
        'RHYTHM ⇄ PITCH — a polyrhythm you can SPIN UP until it fuses into a justly-tuned chord. Rhythm and harmony are the same thing; hear it.',
        'DRUMS — a 14-genre synthesized drum machine with a GENERATE dice, swing, and odd meters. Drives the shared transport.',
        'DRONE — supersaw / tanpura floors with a chord PROGRESSION engine that locks to the drum machine’s bars and can lead the chord pads.',
        'CHORDS — diatonic pads with an equal-vs-just temperament A/B. Keys 1–7 play the degrees while the module is on.',
      ],
    },
    {
      h: 'RIG — your guitar',
      p: ['Plug an instrument into an audio interface (an iRig, a Scarlett…), then:'],
      list: [
        'Press ⏺ enable input and allow the microphone; pick your interface in the device list.',
        'Raise input gain until the meter dances without lighting the clip dot.',
        'Monitoring through speakers with a live microphone WILL feedback — headphones.',
        'The chain runs left to right: gate → sustain → drive → cab → auto-wah → ring mod → pitch → mod → delay → reverb. Stomp a pedal to bring it in.',
        'Preset families: sustain & clarity, modern metal (drive curve "metal" + 4×12/2×12 cab IRs), magical / epic (shimmer cathedral!), creepy (graveyard wind — hold one note).',
        'TUNER: toggle it, play a string, center the needle (green = within 5 cents).',
        'BUFFER: how much latency you trade for stability — try 5 ms, the readout shows what the hardware actually granted.',
        'No guitar handy? The test pluck plays the chain by itself.',
        'Want drop tuning without retuning? Pitch pedal, semis −2, mix 100%.',
      ],
    },
    {
      h: 'DOJO — lessons',
      p: ['Play along and get scored — the site listens to your actual notes.'],
      list: [
        'Pick a lesson chip. LISTEN plays it, PRACTICE loops it while grading softly, SCORE runs it once after a count-in and grades you S / A / B / C / D.',
        'DOJO listens through the RIG input — enable it there first (or let the test pluck play for a demo).',
        'TEMPO slows any lesson to 40% while you learn; TRANSPOSE shifts the whole lesson ±12 semitones — play songs in any tuning without retuning your guitar.',
        'LOAD MIDI imports any .mid file as a lesson (melody track auto-extracted). Guitar Pro users: File → Export → MIDI.',
        'Hit notes turn green, partials amber, misses red. Chase the combo counter.',
        'The virtual FRETBOARD under the roll shows where the notes live — whole bar or note-by-note — lighting up as they play. PRACTICE and SCORE start with a metronome count-in and big on-screen numbers.',
      ],
    },
    {
      h: 'VIBE — the deck',
      p: ['One knob, whole scenes. The deck drives the LAB modules through their remotes — flip back to LAB anytime to see exactly what a scene set up.'],
      list: [
        'Turn the big selector (or click a scene name). Scenes crossfade.',
        'KEY and OCTAVE retune everything — down to B1 if you want the floor to shake.',
        'INTENSITY scales the whole band; MIND sweeps the binaural band (δ→γ); TEMPO bends the drums.',
        'The breath lamp pulses at the scene’s pace — breathe with it.',
        'Jam scenes (CAMPFIRE JAM, DESERT BLUES, IRON HORIZON…) are backing bands: drums + moving chords. Pair IRON HORIZON with the RIG’s djent preset.',
      ],
    },
    {
      h: 'the physics corner',
      p: [
        'Binaural beats do not exist in the air — your brainstem constructs them from the difference between your ears. That is why they need headphones, and why the LISSAJOUS view (L vs R) shows them as a slowly precessing ellipse.',
        'A rhythm sped up 32× becomes a chord: 4:5:6 clicks per cycle fuse into a just major triad. That is what SPIN UP demonstrates — pitch is just fast rhythm.',
        'Just intonation tunes chords to small whole-number ratios (5:4 thirds, −14¢ from a piano’s). The beating stops. CHORDS has the A/B switch; hear the wolf leave the room.',
      ],
    },
    {
      h: 'safety',
      p: ['Protect your ears: keep levels low, take breaks. Entrainment audio is experimental play, not medical advice. If you are prone to seizures, treat pulsing sound and visuals with care.'],
    },
  ],
};

const RU = {
  title: 'OSCILLARIUM · полевое руководство',
  close: 'закрыть',
  sections: [
    {
      h: 'что это',
      p: ['Автономная частотная лаборатория: генераторы, драм-машина, дроны с прогрессиями аккордов, гармонические пэды, обработка живой гитары и интерактивные уроки — всё синтезируется в браузере через Web Audio. Без сэмплов, без сервера, без слежки. Всё — математика.'],
    },
    {
      h: 'быстрый старт',
      list: [
        'Нажмите ВКЛЮЧИТЬ. Наденьте наушники. Начинайте тихо.',
        'Переключатель LAB | RIG | DOJO | VIBE в шапке меняет всё рабочее пространство.',
        'EN | RU переключает язык (включая это руководство).',
        'МАСТЕР — общая громкость; ■ СТОП ВСЁ (или Esc) мгновенно всё глушит.',
        'Полоса сверху визуализирует всё, что звучит: СКОП, СПЕКТР, ЛИССАЖУ, МАНДАЛА.',
      ],
    },
    {
      h: 'LAB — кабина',
      p: ['Шесть инструментов, все совместимы друг с другом — у каждого свой тумблер, пресеты и живые индикаторы:'],
      list: [
        'БИНАУРАЛ — ритмы навязывания (бинауральный / моноуральный / изохронный), пресеты мозговых волн, шумовая подложка. Бинауральный режим — только в наушниках.',
        'ТОН-ЛАБ — два независимых генератора, по одному на ухо, с замком отношения: 3:2, септимальная 7:6, золотое сечение φ.',
        'РИТМ ⇄ ТОН — полиритм, который можно РАЗОГНАТЬ, пока он не сольётся в аккорд чистого строя. Ритм и гармония — одно и то же; послушайте.',
        'БАРАБАНЫ — синтезированная драм-машина с 14 жанрами, кубиком ГЕНЕРАЦИИ, свингом и нечётными размерами. Ведёт общий транспорт.',
        'ДРОН — суперсоу / танпура с движком ПРОГРЕССИЙ, который синхронизируется с тактами барабанов и может вести аккордовые пэды.',
        'АККОРДЫ — диатонические пэды с переключателем «равномерная темперация / чистый строй». Клавиши 1–7 играют ступени, пока модуль включён.',
      ],
    },
    {
      h: 'RIG — ваша гитара',
      p: ['Подключите инструмент через аудиоинтерфейс (iRig, Scarlett…), затем:'],
      list: [
        'Нажмите ⏺ включить вход и разрешите микрофон; выберите интерфейс в списке устройств.',
        'Поднимайте входное усиление, пока индикатор не затанцует — не зажигая точку клипа.',
        'Мониторинг в колонки с живым микрофоном ДАСТ завязку — наушники.',
        'Цепочка слева направо: гейт → сустейн → драйв → кабинет → авто-вау → ринг-мод → питч → модуляция → дилэй → ревёрб. Нажмите на педаль, чтобы включить её.',
        'Семейства пресетов: сустейн и ясность, модерн-метал (кривая «метал» + импульсы кабинетов 4×12/2×12), магия / эпос (шиммер-собор!), жуть (кладбищенский ветер — задержите одну ноту).',
        'ТЮНЕР: включите, сыграйте струну, выведите стрелку в центр (зелёная = в пределах 5 центов).',
        'БУФЕР: сколько задержки вы меняете на стабильность — попробуйте 5 мс; индикатор покажет, что реально дало железо.',
        'Нет гитары под рукой? Тестовый щипок сыграет по цепочке сам.',
        'Дроп-строй без перестройки? Педаль питч: полутона −2, микс 100%.',
      ],
    },
    {
      h: 'DOJO — уроки',
      p: ['Играйте вместе с уроком и получайте оценку — сайт слышит ваши настоящие ноты.'],
      list: [
        'Выберите урок. LISTEN проигрывает его, PRACTICE зацикливает с мягкой оценкой, SCORE запускает один раз после отсчёта и ставит S / A / B / C / D.',
        'DOJO слушает через вход RIG — сначала включите его там (или пусть тестовый щипок сыграет демо).',
        'ТЕМП замедляет любой урок до 40%, пока учитесь; ТРАНСПОЗИЦИЯ сдвигает весь урок на ±12 полутонов — играйте песни в любом строе, не перестраивая гитару.',
        'ЗАГРУЗИТЬ MIDI импортирует любой .mid как урок (мелодическая дорожка выделяется автоматически). Пользователи Guitar Pro: File → Export → MIDI.',
        'Попадания зеленеют, частичные — янтарные, промахи — красные. Гонитесь за счётчиком комбо.',
        'Виртуальный ГРИФ под лентой показывает, где живут ноты — целым тактом или по одной — и подсвечивает их по ходу игры. PRACTICE и SCORE начинаются с отсчёта метронома и больших цифр на экране.',
      ],
    },
    {
      h: 'VIBE — пульт',
      p: ['Одна ручка — целые сцены. Пульт управляет модулями LAB через их удалённые интерфейсы — переключитесь в LAB в любой момент и увидите ровно то, что настроила сцена.'],
      list: [
        'Крутите большой селектор (или кликните имя сцены). Сцены перетекают друг в друга.',
        'ТОН и ОКТАВА перестраивают всё — хоть до B1, если хочется, чтобы пол дрожал.',
        'НАКАЛ масштабирует весь ансамбль; РАЗУМ ведёт бинауральную полосу (δ→γ); ТЕМП гнёт барабаны.',
        'Лампа дыхания пульсирует в темпе сцены — дышите вместе с ней.',
        'Джем-сцены (У КОСТРА, БЛЮЗ ПУСТЫНИ, ЖЕЛЕЗНЫЙ ГОРИЗОНТ…) — это аккомпанирующие группы: барабаны и движущиеся аккорды. Совместите ЖЕЛЕЗНЫЙ ГОРИЗОНТ с пресетом «джент» в RIG.',
      ],
    },
    {
      h: 'уголок физики',
      p: [
        'Бинауральные ритмы не существуют в воздухе — ваш ствол мозга конструирует их из разницы между ушами. Поэтому нужны наушники, и поэтому режим ЛИССАЖУ (Л против П) показывает их как медленно прецессирующий эллипс.',
        'Ритм, ускоренный в 32 раза, становится аккордом: щелчки 4:5:6 за цикл сливаются в чистое мажорное трезвучие. Это и показывает РАЗГОН — высота тона есть быстрый ритм.',
        'Чистый строй настраивает аккорды на отношения малых целых чисел (терции 5:4, на −14¢ от фортепианных). Биения исчезают. В АККОРДАХ есть переключатель — услышьте, как волк уходит из комнаты.',
      ],
    },
    {
      h: 'безопасность',
      p: ['Берегите уши: держите громкость низкой, делайте паузы. Звуковая стимуляция — экспериментальная игра, а не медицина. Если вы склонны к судорогам, будьте осторожны с пульсирующим звуком и визуалом.'],
    },
  ],
};

function elem(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initInfo() {
  const C = lang() === 'ru' ? RU : EN;

  const overlay = elem('div', 'info-overlay');
  overlay.hidden = true;
  const panel = elem('div', 'info-panel');
  const head = elem('div', 'info-head');
  head.append(elem('h2', 'info-title', C.title));
  const closeBtn = elem('button', 'info-close', '✕');
  closeBtn.title = C.close;
  head.append(closeBtn);
  panel.append(head);

  const body = elem('div', 'info-body');
  for (const s of C.sections) {
    const sec = elem('section', 'info-section');
    sec.append(elem('h3', null, s.h));
    for (const p of s.p || []) sec.append(elem('p', null, p));
    if (s.list) {
      const ul = elem('ul');
      for (const li of s.list) ul.append(elem('li', null, li));
      sec.append(ul);
    }
    body.append(sec);
  }
  panel.append(body);
  overlay.append(panel);
  document.body.append(overlay);

  const open = () => { overlay.hidden = false; panel.scrollTop = 0; };
  const close = () => { overlay.hidden = true; };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  return { open, close, isOpen: () => !overlay.hidden };
}
