// QQM — фоновой музыкальный движок «Тот, кто остался».
// Зоны — вариации тем Николая (Suno Cover V6). Фон: зациклен, кроссфейд при смене зоны.
// Смерть: стингер one-shot поверх приглушённого фона. Звук: синк с кнопкой «звук» движка.
window.QQM = (function () {
  "use strict";
  // DLC лежит в подпапке obyasnenie/ — оттуда музыка на уровень выше
  const DIR = location.pathname.includes("obyasnenie") ? "../music/" : "music/";
  const TITLE = "suno_z1_v1.mp3";
  const FALLBACK = "suno_z1_v1.mp3";
  const STINGER = "suno_z4.mp3";
  const VOL = 0.55;           // базовая громкость фона
  const DUCK = 0.12;          // громкость фона под стингером
  const XFADE = 2500;         // кроссфейд зон, мс

  // карта зон: префикс ID сцены -> файл (файлы кладёт конвейер music/suno_zN.mp3)
  const ZONES = [
    { re: /^⊣/,        file: "suno_z10.mp3" }, // тупиковые финалы
    { re: /^Т-00/,     file: "suno_z1_v1.mp3" }, // пролог «Сухое русло» — та же тема, что в меню (решение автора)
    { re: /^Т-01/,     file: "suno_z2.mp3" }, // Чёрная заводь, нырок
    { re: /^Т-02б/,    file: "suno_z2.mp3" },  // вытащили: снова над водой
    { re: /^Т-02/,     file: "suno_z2_under.mp3" },  // под водой: глухой вариант z2 (громкость выровнена)  // под водой: глухой lowpass-вариант z2
    { re: /^DLC/,      file: "suno_z13.mp3" }, // DLC «Трое до рассвета» — ночь без откатов
    { re: /^Т/,        file: "suno_z3.mp3" },  // двор 90-х
    { re: /^В1-0[45]/, file: "suno_z5a_emergency.mp3" }, // В1-04 «Второй взрыв» → В1-05 ВГСЧ: авария до спасения отца (решение автора)
    { re: /^В2-08/,    file: "suno_z14a.mp3" }, // В2-08 «Двенадцать минут» — испытание (дуга)
    { re: /^В3-02/,    file: "suno_z6a.mp3" },  // В3-02 «Голец» — гроза на гольце (дуга)
    { re: /^В5-02/,    file: "suno_z7a.mp3" },  // В5-02 «Полнолуние» — медуза (дуга)
    { re: /^В6-09/,    file: "suno_z15a.mp3" }, // В6-09 «Чужие в моём тоне» — копии (дуга)
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
  let lastScene = null; // последняя сцена: при включении звука играть её зону, а не меню
  let blocked = false;  // браузер отклонил автоплей до первого жеста

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
    lastScene = id || null;
    if (muted) return;               // звук выключен: не стартуем
    const file = id ? trackFor(id) : TITLE;
    switchTo(file);
  }

  // титульный экран и меню
  function screen(screenId) {
    if (screenId === "#title" || screenId === "#intro") { lastScene = null; if (!muted) switchTo(TITLE); }
  }

  function switchTo(file) {
    if (file === current) { if (bg && !stingerEl && bg.volume < VOL * 0.9) fade(bg, bg.volume, VOL, 1200); if (bg && bg.paused && !blocked) { const p = bg.play(); if (p && p.catch) p.catch(() => { blocked = true; }); } return; }
    current = file;
    const old = bg;
    if (old) {
      old.__retired = true; // уходящий трек: его ошибки (в т. ч. от сброса src) не трогают текущую зону
      fade(old, old.volume, 0, XFADE, () => { old.pause(); old.removeAttribute("src"); old.load(); });
    }
    bg = make(file);
    bg.volume = 0;
    const p = bg.play();
    if (p && p.catch) p.catch(() => { blocked = true; }); // автоплей до первого клика — повторим на жесте
    fade(bg, 0, VOL, XFADE);
    const el = bg;
    el.addEventListener("error", () => {
      if (el.__retired || el !== bg) return;
      // файла ещё нет (конвейер не дотащил) — тихо уходим в меню-тему
      if (file !== FALLBACK) { current = null; switchTo(FALLBACK); }
    });
  }

  // стингер смерти: секунда полной тишины -> удар -> фон возвращается приглушённым
  function stinger() {
    if (muted) return;
    try {
      if (bg) fade(bg, bg.volume, 0, 130); // разрыв музыки: короткая пустота
      setTimeout(() => {
        if (stingerEl) { stingerEl.pause(); stingerEl = null; }
        stingerEl = new Audio(DIR + STINGER);
        stingerEl.loop = false;
        stingerEl.volume = 0.85;
        const back = () => { clearTimeout(guard); if (bg && !muted) fade(bg, bg.volume, VOL, 1500); stingerEl = null; };
        const guard = setTimeout(back, 11500); // страховка: фон вернётся в любом случае
        stingerEl.addEventListener("ended", back);
        stingerEl.addEventListener("error", back);
        const p = stingerEl.play();
        if (p && p.catch) p.catch(back);
      }, 850);
    } catch (e) { /* тишина лучше падения */ }
  }

  // хор-шёпоты при сильном холодке (ДАР 60+): текстура qqm_chill.mp3, one-shot поверх фона
  let chillEl = null, lastChill = 0;
  function chill() {
    if (muted) return;
    const now = Date.now();
    if (now - lastChill < 8000) return;
    lastChill = now;
    try {
      if (chillEl) { chillEl.pause(); chillEl = null; }
      chillEl = new Audio(DIR + "qqm_chill.mp3");
      chillEl.loop = false;
      chillEl.volume = 0.16;
      const p = chillEl.play();
      if (p && p.catch) p.catch(() => {});
      chillEl.addEventListener("ended", () => { chillEl = null; });
    } catch (e) { /* ничего */ }
  }

  // синк с кнопкой «звук» движка
  function setMuted(m) {
    m = !!m;
    if (m === muted && (muted || bg)) return; // ничего не поменялось — не дёргать громкость посреди кроссфейда
    muted = m;
    if (muted) {
      if (bg) { bg.__retired = bg.__stopped = true; bg.pause(); bg.removeAttribute("src"); bg.load(); bg = null; current = null; } // выключил — тишина сразу, а не fade
      if (stingerEl) { stingerEl.pause(); stingerEl = null; }
      return;
    }
    switchTo(lastScene ? trackFor(lastScene) : TITLE); // включил — зона текущей сцены (или меню)
  }


  // первый клик/клавиша: браузер разрешил звук — дотянуть отклонённый трек
  function retry() {
    if (!blocked || muted || !bg) return;
    blocked = false;
    const p = bg.play();
    if (p && p.catch) p.catch(() => { blocked = true; });
  }
  for (const ev of ["pointerdown", "keydown", "touchend"]) window.addEventListener(ev, retry, { capture: true, passive: true });

  return { scene, screen, stinger, setMuted, trackFor,
    debug: () => ({ file: current, paused: bg ? bg.paused : null, time: bg ? bg.currentTime : null, blocked, muted, lastScene }) };
})();
