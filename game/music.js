// QQM — фоновой музыкальный движок «Тот, кто остался».
// Зоны — вариации тем Николая (Suno Cover V6). Фон: зациклен, кроссфейд при смене зоны.
// Смерть: стингер one-shot поверх приглушённого фона. Звук: синк с кнопкой «звук» движка.
window.QQM = (function () {
  "use strict";
  const DIR = "music/";
  const TITLE = "suno_z1_v1.mp3";
  const FALLBACK = "suno_z1_v1.mp3";
  const STINGER = "suno_z4.mp3";
  const VOL = 0.55;           // базовая громкость фона
  const DUCK = 0.12;          // громкость фона под стингером
  const XFADE = 2500;         // кроссфейд зон, мс

  // карта зон: префикс ID сцены -> файл (файлы кладёт конвейер music/suno_zN.mp3)
  const ZONES = [
    { re: /^⊣/,        file: "suno_z10.mp3" }, // тупиковые финалы
    { re: /^Т-01/,     file: "suno_z2.mp3" },  // Чёрная заводь, нырок
    { re: /^Т-02/,     file: "suno_z2.mp3" },  // под водой, Корень
    { re: /^Т/,        file: "suno_z3.mp3" },  // двор 90-х
    { re: /^В1/,       file: "suno_z5.mp3" },  // шахта «Глубокая»
    { re: /^В2/,       file: "suno_z14.mp3" }, // лаборатория «Протокол»
    { re: /^В3/,       file: "suno_z6.mp3" },  // север
    { re: /^В4/,       file: "suno_z8.mp3" },  // улица, казино
    { re: /^В5/,       file: "suno_z7.mp3" },  // море, Плой
    { re: /^В6/,       file: "suno_z15.mp3" }, // скит, Хор
    { re: /^В7/,       file: "suno_z16.mp3" }, // обычная жизнь
    { re: /^Я/,        file: "suno_z9.mp3" },  // якорь 2061
    { re: /^Ф-02/,     file: "suno_z11.mp3" }, // светлые финалы
    { re: /^Ф-03/,     file: "suno_z11.mp3" },
    { re: /^Ф-04/,     file: "suno_z11.mp3" },
    { re: /^Ф/,        file: "suno_z12.mp3" }, // вечные финалы
  ];

  let bg = null;      // текущий фоновой элемент
  let current = null; // текущий файл (чтобы не рестартовать ту же зону)
  let muted = false;
  let stingerEl = null;

  function make(file) {
    const a = new Audio(DIR + file);
    a.loop = true;
    a.preload = "auto";
    return a;
  }

  function fade(el, from, to, ms, done) {
    if (!el) { if (done) done(); return; }
    const t0 = performance.now();
    function step(t) {
      if (!el.isConnectedAudioCtxHack) { /* no-op */ }
      if (el.__stopped) { if (done) done(); return; }
      const k = Math.min(1, (t - t0) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
      else if (done) done();
    }
    requestAnimationFrame(step);
  }

  function trackFor(id) {
    for (const z of ZONES) if (z.re.test(id)) return z.file;
    return FALLBACK;
  }

  // плавная смена фона с кроссфейдом; та же зона — ничего не делаем
  function scene(id) {
    if (muted) return;               // звук выключен: не стартуем
    const file = id ? trackFor(id) : TITLE;
    switchTo(file);
  }

  // титульный экран и меню
  function screen(screenId) {
    if (screenId === "#title") switchTo(TITLE);
  }

  function switchTo(file) {
    if (file === current) return;
    current = file;
    const old = bg;
    if (old) {
      fade(old, old.volume, 0, XFADE, () => { old.pause(); old.src = ""; });
    }
    bg = make(file);
    bg.volume = 0;
    const p = bg.play();
    if (p && p.catch) p.catch(() => { /* автоплей до первого клика — разблокируется в tryStart */ });
    fade(bg, 0, VOL, XFADE);
    bg.addEventListener("error", () => {
      // файла ещё нет (конвейер не дотащил) — тихо уходим в меню-тему
      if (file !== FALLBACK) { current = null; switchTo(FALLBACK); }
    });
  }

  // стингер смерти: one-shot, фон приглушается и возвращается
  function stinger() {
    if (muted) return;
    try {
      if (bg) fade(bg, bg.volume, DUCK, 300);
      if (stingerEl) { stingerEl.pause(); stingerEl = null; }
      stingerEl = new Audio(DIR + STINGER);
      stingerEl.loop = false;
      stingerEl.volume = 0.85;
      stingerEl.addEventListener("ended", () => {
        if (bg) fade(bg, bg.volume, VOL, 1500);
        stingerEl = null;
      });
      const p = stingerEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* тишина лучше падения */ }
  }

  // синк с кнопкой «звук» движка
  function setMuted(m) {
    muted = m;
    if (bg) bg.volume = muted ? 0 : VOL;
    if (stingerEl) stingerEl.volume = muted ? 0 : 0.85;
    if (!muted && !bg) screen("#title");
    if (!muted) tryStart();
  }

  // браузеры не дают играть звук до первого касания: на любое взаимодействие пробуем
  // запустить задуманный трек (обычно — меню-тема на титуле). После успеха слушатели снимаем.
  let unlocked = false;
  function tryStart() {
    if (unlocked || muted || !bg || !bg.paused) return;
    const p = bg.play();
    if (p && p.then) p.then(() => {
      unlocked = true;
      ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
        document.removeEventListener(ev, tryStart, true));
    }).catch(() => { /* ещё нет жеста — ждём следующий */ });
  }
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, tryStart, { capture: true }));

  return { scene, screen, stinger, setMuted, trackFor,
    debug: () => ({ file: current, paused: bg ? bg.paused : null, time: bg ? bg.currentTime : null, unlocked, muted }) };
})();
